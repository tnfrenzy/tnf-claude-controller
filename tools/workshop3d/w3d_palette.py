"""Colours measured from images, no tokens: the reference palette for material-artist and the colour delta for
visual-reviewer. Pillow + numpy (CAD venv).

  w3d_palette.py palette <reference image>... --out reference-palette.json
  w3d_palette.py delta <reference-palette.json> <render png>... --mode fast|hq --out color-delta.json
  w3d_palette.py pair "<view>|<blender png>|<viewer shot png>[|<original GLB shot png>]"... --out view-similarity.json

Regions are simple horizontal bands of the whole image (an interior photo: ceiling at the top, walls in the middle, floor
at the bottom) plus the whole image; nothing is detected. Per region: dominant colours by a small k-means after dropping
near-white / near-black pixels (text backgrounds, burnt highlights, deep shadow), the mean colour and the brightness.
The delta compares the MEAN colour of each band of a render with the mean of the same band of the reference (CIE76 dE in
Lab, and the L* difference). Different viewpoints make this a hint, never a verdict. Prints one JSON line.
"""
import argparse
import json
import os
import sys

import numpy as np
from PIL import Image

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import w3d_common as c  # noqa: E402

REGIONS = (("tran", "trần / nửa trên", 0.0, 0.3), ("vach", "vách / giữa", 0.3, 0.75), ("san", "sàn / dưới", 0.75, 1.0))
WHOLE = ("toan_anh", "toàn ảnh", 0.0, 1.0)
MAX_PIXELS = 20000
K = 4
LUM_MIN, LUM_MAX = 0.04, 0.96  # extremes dropped before the k-means (0..1 luminance, sRGB)
# dE76 thresholds of the delta table (Lab): under WARN_DE close enough for a different viewpoint, over BAD_DE clearly off
WARN_DE = 12.0
BAD_DE = 25.0


def load_rgb(path, max_side=480):
    try:
        im = Image.open(path)
        im.load()
    except Exception as e:  # noqa: BLE001
        raise c.W3DError("Không đọc được ảnh %s: %s" % (os.path.basename(path), e))
    im = im.convert("RGB")
    im.thumbnail((max_side, max_side))
    return np.asarray(im, dtype=np.float64) / 255.0


def srgb_to_lab(rgb):
    rgb = np.asarray(rgb, dtype=np.float64)
    lin = np.where(rgb <= 0.04045, rgb / 12.92, ((rgb + 0.055) / 1.055) ** 2.4)
    m = np.array([[0.4124, 0.3576, 0.1805], [0.2126, 0.7152, 0.0722], [0.0193, 0.1192, 0.9505]])
    xyz = lin @ m.T / np.array([0.95047, 1.0, 1.08883])
    f = np.where(xyz > 0.008856, np.cbrt(xyz), 7.787 * xyz + 16 / 116)
    return np.stack([116 * f[..., 1] - 16, 500 * (f[..., 0] - f[..., 1]), 200 * (f[..., 1] - f[..., 2])], axis=-1)


def hexof(rgb):
    return "#" + "".join("%02x" % int(round(max(0.0, min(1.0, v)) * 255)) for v in rgb)


def luminance(rgb):
    rgb = np.asarray(rgb)
    return 0.2126 * rgb[..., 0] + 0.7152 * rgb[..., 1] + 0.0722 * rgb[..., 2]


def kmeans(px, k=K, iters=12):
    """Deterministic small k-means: seeds at luminance quantiles. Returns (centres, shares) sorted by share."""
    if len(px) == 0:
        return np.zeros((0, 3)), np.zeros(0)
    k = min(k, len(px))
    order = np.argsort(luminance(px))
    centres = px[order[((np.arange(k) + 0.5) / k * len(px)).astype(int)]].copy()
    for _ in range(iters):
        d = ((px[:, None, :] - centres[None, :, :]) ** 2).sum(axis=2)
        lab = d.argmin(axis=1)
        for j in range(k):
            sel = px[lab == j]
            if len(sel):
                centres[j] = sel.mean(axis=0)
    shares = np.bincount(lab, minlength=k) / len(px)
    idx = np.argsort(-shares)
    return centres[idx], shares[idx]


def region_pixels(img, y0, y1):
    h = img.shape[0]
    band = img[int(round(y0 * h)):max(int(round(y0 * h)) + 1, int(round(y1 * h)))]
    return band.reshape(-1, 3)


def sample(px, n=MAX_PIXELS):
    if len(px) <= n:
        return px
    step = len(px) / n
    return px[(np.arange(n) * step).astype(int)]


def describe_region(px):
    px = sample(px)
    lum = luminance(px)
    keep = px[(lum >= LUM_MIN) & (lum <= LUM_MAX)]
    used = keep if len(keep) >= 50 else px
    centres, shares = kmeans(used)
    mean = used.mean(axis=0)
    return {
        "contrast": round(float(luminance(used).std()), 4),
        "dominant": [{"hex": hexof(cc), "rgb": [round(float(v), 3) for v in cc], "share": round(float(s), 3),
                      "brightness": round(float(luminance(cc)), 3)} for cc, s in zip(centres, shares) if s >= 0.03],
        "mean_hex": hexof(mean),
        "mean_rgb": [round(float(v), 3) for v in mean],
        "brightness": round(float(luminance(mean)), 3),
        "lab": [round(float(v), 1) for v in srgb_to_lab(mean)],
        "kept_share": round(len(keep) / max(1, len(px)), 3),
    }


def palette(images):
    out = []
    for p in images:
        img = load_rgb(p)
        regions = {}
        for rid, label, y0, y1 in REGIONS + (WHOLE,):
            r = describe_region(region_pixels(img, y0, y1))
            r["label"] = label
            r["band"] = [y0, y1]
            regions[rid] = r
        out.append({"image": os.path.basename(p), "regions": regions})
    return {"version": 1, "method": "dải ngang (trên 30 %%, giữa 45 %%, dưới 25 %%) + toàn ảnh; k-means %d màu, bỏ điểm quá sáng/tối" % K,
            "images": out}


def ref_means(pal):
    """Mean Lab and hex per region over all reference images (weighted equally)."""
    acc = {}
    for im in pal.get("images", []):
        for rid, r in (im.get("regions") or {}).items():
            if isinstance(r.get("mean_rgb"), list) and len(r["mean_rgb"]) == 3:
                acc.setdefault(rid, []).append(r["mean_rgb"])
    return {rid: np.mean(np.array(v), axis=0) for rid, v in acc.items()}


def ref_details(pal):
    """Per region over all reference images: mean contrast (luminance std) and the dominant colour (rgb) of the image whose
    dominant cluster is largest. Missing fields (an older palette file) = region absent."""
    acc = {}
    for im in pal.get("images", []):
        for rid, r in (im.get("regions") or {}).items():
            dom = r.get("dominant") or []
            if isinstance(r.get("contrast"), (int, float)) and dom and isinstance(dom[0].get("rgb"), list):
                acc.setdefault(rid, []).append((float(r["contrast"]), dom[0]["rgb"], float(dom[0].get("share", 0))))
    out = {}
    for rid, v in acc.items():
        best = max(v, key=lambda t: t[2])
        out[rid] = {"contrast": float(np.mean([t[0] for t in v])), "dom_rgb": np.array(best[1], dtype=np.float64)}
    return out


def detail_check(px, ref):
    """Floor / detail hint for one region of a render: dE between the dominant colours (the stone colour, not the mean
    that mirrors and shadows drag around) and the ratio of the luminance contrast (render / reference: <1 = flat, no veining)."""
    px = sample(px)
    lum = luminance(px)
    keep = px[(lum >= LUM_MIN) & (lum <= LUM_MAX)]
    used = keep if len(keep) >= 50 else px
    centres, shares = kmeans(used)
    out = {"clip": round(float((lum > 0.97).mean()), 3)}
    if ref is None or len(centres) == 0:
        return out
    de = float(np.sqrt(((srgb_to_lab(centres[0]) - srgb_to_lab(ref["dom_rgb"])) ** 2).sum()))
    out["dom_dE"] = round(de, 1)
    out["render_dom_hex"] = hexof(centres[0])
    out["ref_dom_hex"] = hexof(ref["dom_rgb"])
    if ref["contrast"] > 1e-4:
        out["contrast_ratio"] = round(float(luminance(used).std()) / ref["contrast"], 2)
    return out


def level(de):
    return "ok" if de < WARN_DE else ("lech_vua" if de < BAD_DE else "lech_nhieu")


def delta(pal, renders, mode):
    refs = ref_means(pal)
    details = ref_details(pal)
    views = []
    for p in renders:
        img = load_rgb(p)
        regions = {}
        for rid, _label, y0, y1 in REGIONS + (WHOLE,):
            if rid not in refs:
                continue
            px = sample(region_pixels(img, y0, y1))
            mean = px.mean(axis=0)
            la, lb = srgb_to_lab(mean), srgb_to_lab(refs[rid])
            de = float(np.sqrt(((la - lb) ** 2).sum()))
            regions[rid] = {"render_hex": hexof(mean), "ref_hex": hexof(refs[rid]), "dE": round(de, 1),
                            "dL": round(float(la[0] - lb[0]), 1), "level": level(de)}
            regions[rid].update(detail_check(px, details.get(rid)))
        views.append({"view": os.path.splitext(os.path.basename(p))[0], "regions": regions})
    summary = {}
    for rid in [r[0] for r in REGIONS + (WHOLE,)]:
        vals = [v["regions"][rid] for v in views if rid in v["regions"]]
        if vals:
            de = float(np.mean([x["dE"] for x in vals]))
            summary[rid] = {"dE": round(de, 1), "dL": round(float(np.mean([x["dL"] for x in vals])), 1), "level": level(de)}
    return {"version": 1, "mode": mode, "thresholds": {"warn_dE": WARN_DE, "bad_dE": BAD_DE}, "views": views, "summary": summary}


GRID = 4  # pair: the mean dE of a GRID x GRID split of the frame (where the two images differ, not only on average)


def compare_images(a_path, b_path):
    """Same viewpoint, two images (a = Blender, b = viewer shot): per band and whole image the mean-colour dE76 / dL*,
    the brightness of both, and the mean dE over a GRID x GRID split. b is resized to a's size."""
    a = load_rgb(a_path)
    b = load_rgb(b_path)
    if b.shape != a.shape:
        im = Image.fromarray((b * 255).astype(np.uint8)).resize((a.shape[1], a.shape[0]))
        b = np.asarray(im, dtype=np.float64) / 255.0
    regions = {}
    for rid, _label, y0, y1 in REGIONS + (WHOLE,):
        ma = region_pixels(a, y0, y1).mean(axis=0)
        mb = region_pixels(b, y0, y1).mean(axis=0)
        la, lb = srgb_to_lab(ma), srgb_to_lab(mb)
        de = float(np.sqrt(((la - lb) ** 2).sum()))
        regions[rid] = {"ref_hex": hexof(ma), "view_hex": hexof(mb), "dE": round(de, 1), "dL": round(float(lb[0] - la[0]), 1),
                        "ref_brightness": round(float(luminance(ma)), 3), "view_brightness": round(float(luminance(mb)), 3), "level": level(de)}
    h, w = a.shape[:2]
    cells = []
    for i in range(GRID):
        for j in range(GRID):
            ca = a[i * h // GRID:(i + 1) * h // GRID, j * w // GRID:(j + 1) * w // GRID].reshape(-1, 3).mean(axis=0)
            cb = b[i * h // GRID:(i + 1) * h // GRID, j * w // GRID:(j + 1) * w // GRID].reshape(-1, 3).mean(axis=0)
            cells.append(float(np.sqrt(((srgb_to_lab(ca) - srgb_to_lab(cb)) ** 2).sum())))
    return {"regions": regions, "grid_dE": round(float(np.mean(cells)), 1), "grid_max_dE": round(float(np.max(cells)), 1)}


def pair(items):
    """items: "name|ref.png|view.png[|before.png]". before = the original GLB shot from the same camera (for a before/after)."""
    views = []
    for it in items:
        parts = it.split("|")
        if len(parts) < 3:
            raise c.W3DError("Mục so sánh sai dạng (cần tên|ảnh Blender|ảnh bản xem): %s" % it)
        v = {"view": parts[0], "after": compare_images(parts[1], parts[2])}
        if len(parts) > 3 and parts[3]:
            v["before"] = compare_images(parts[1], parts[3])
        views.append(v)
    summary = {}
    for key in ("after", "before"):
        vals = [v[key] for v in views if key in v]
        if vals:
            whole = [x["regions"]["toan_anh"] for x in vals]
            de = float(np.mean([x["dE"] for x in whole]))
            summary[key] = {"dE": round(de, 1), "dL": round(float(np.mean([x["dL"] for x in whole])), 1),
                            "grid_dE": round(float(np.mean([x["grid_dE"] for x in vals])), 1), "level": level(de),
                            "ref_brightness": round(float(np.mean([x["ref_brightness"] for x in whole])), 3),
                            "view_brightness": round(float(np.mean([x["view_brightness"] for x in whole])), 3)}
    return {"version": 1, "method": "cùng góc camera: màu trung bình theo dải ngang + toàn ảnh (dE76, dL*), lưới %dx%d" % (GRID, GRID),
            "thresholds": {"warn_dE": WARN_DE, "bad_dE": BAD_DE}, "views": views, "summary": summary}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cmd", choices=["palette", "delta", "pair"])
    ap.add_argument("inputs", nargs="+")
    ap.add_argument("--out", required=True)
    ap.add_argument("--mode", default="fast")
    a = ap.parse_args()
    if a.cmd == "palette":
        res = palette(a.inputs)
    elif a.cmd == "pair":
        res = pair(a.inputs)
    else:
        with open(a.inputs[0], encoding="utf-8") as f:
            pal = json.load(f)
        if not a.inputs[1:]:
            raise c.W3DError("Không có ảnh render để so màu.")
        res = delta(pal, a.inputs[1:], a.mode)
    with open(a.out, "w", encoding="utf-8") as f:
        json.dump(res, f, ensure_ascii=False, indent=1)
    c.emit({"ok": True, "out": a.out, "images": len(res.get("images", res.get("views", [])))})


if __name__ == "__main__":
    c.run_main(main)
