"""Turn one photo of a floor stone into a library material (no AI, pure image processing).
Usage:
  make_material.py <image> <out_dir> [--tile-cm N] [--size 1024] [--slab-mm W D H] [--mapping auto|tile|fit]
                   [--name NAME] [--source FILE_NAME]
  make_material.py --slab-only <out_dir> [--tile-cm N] [--slab-mm W D H]   (rebuild slab.glb + preview.png from the maps)
Two mappings:
  tile  a stone texture: the photo becomes a seamless tile (albedo wraps), repeated every tile_cm on the slab.
  fit   a whole floor design (inlay medallion, framed panel: catalogue floors are mostly this): the photo is cropped to the
        slab's aspect and laid ONCE over the top face, never repeated. albedo.png is then NOT seamless.
  auto  (default) fit when the photo is strongly mirror-symmetric (designs are; natural stone is not), else tile.
Writes into out_dir: albedo.png (square, power of two), normal.png, roughness.png (grey, 0..255 = 0..1), meta.json
{"id","name","kind":"stone","tile_cm","source","created"} plus "mapping", "category", "entry", "size_mm", "session",
slab.glb (W x D x H mm, default 600 x 600 x 20, in metres, +Y up, origin at the centre of the bottom face) and
preview.png. Prints exactly one JSON line (also on failure)."""
import argparse
import datetime
import json
import os

import numpy as np
import trimesh
from PIL import Image, ImageDraw, ImageFilter, ImageOps
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

import w3d_common as c

MIN_PX = 256
DEFAULT_SLAB_MM = (600.0, 600.0, 20.0)  # width (x), depth (z), height / thickness (y, up)
ROUGH_MIN, ROUGH_MAX = 0.15, 0.5
NORMAL_STRENGTH = 2.0
MAX_SLOPE_P90 = {"tile": 0.2, "fit": 0.08}  # an inlay floor is polished flat: only a hint of relief
MAX_PIXELS = 60_000_000
BAND_FRAC = 0.25
SYMMETRY_FIT = 0.5


def pow2_ok(n):
    return 64 <= n <= 4096 and (n & (n - 1)) == 0


def gaussian(arr, sigma):
    """Wrap-around gaussian blur of a 2-D float array (keeps a seamless tile seamless) via FFT."""
    if sigma <= 0:
        return arr
    h, w = arr.shape
    fy = np.fft.fftfreq(h)[:, None]
    fx = np.fft.fftfreq(w)[None, :]
    k = np.exp(-2.0 * (np.pi ** 2) * (sigma ** 2) * (fx ** 2 + fy ** 2))
    return np.real(np.fft.ifft2(np.fft.fft2(arr) * k))


def luminance(rgb):
    return rgb[..., 0] * 0.2126 + rgb[..., 1] * 0.7152 + rgb[..., 2] * 0.0722


def open_rgb(path):
    try:
        img = Image.open(path)
        if img.width * img.height > MAX_PIXELS:
            raise c.W3DError("Ảnh quá lớn (%d x %d px, tối đa %d triệu điểm ảnh)." % (img.width, img.height, MAX_PIXELS // 1_000_000))
        img = ImageOps.exif_transpose(img).convert("RGB")
    except c.W3DError:
        raise
    except Exception as e:  # noqa: BLE001
        raise c.W3DError("Không đọc được ảnh (chỉ nhận PNG, JPG, WEBP): %s" % e)
    w, h = img.size
    if min(w, h) < MIN_PX:
        raise c.W3DError("Ảnh quá nhỏ (%d x %d px): cạnh ngắn cần ít nhất %d px. Hãy chụp gần hơn hoặc dùng ảnh gốc." % (w, h, MIN_PX))
    return img


def crop_aspect(img, aspect):
    """Largest centred crop with width / height == aspect."""
    w, h = img.size
    if w / h > aspect:
        nw = int(round(h * aspect))
        left = (w - nw) // 2
        return img.crop((left, 0, left + nw, h))
    nh = int(round(w / aspect))
    top = (h - nh) // 2
    return img.crop((0, top, w, top + nh))


def to_array(img, px):
    return np.asarray(img.resize((px, px), Image.LANCZOS), dtype=np.float64) / 255.0


def check_not_flat(rgb):
    std = float(luminance(rgb).std())
    if std < 0.012:
        raise c.W3DError("Ảnh gần như một màu (độ lệch sáng %.4f): không thấy vân đá để dựng vật liệu. Hãy chụp rõ bề mặt đá." % std)
    return std


def symmetry(img):
    """Mean of the left-right and top-bottom mirror correlations of the brightness (1 = perfectly symmetric)."""
    a = luminance(np.asarray(img.resize((128, 128), Image.BILINEAR), dtype=np.float64) / 255.0)
    a = a - a.mean()
    den = float((a * a).sum()) or 1e-9
    lr = float((a * a[:, ::-1]).sum()) / den
    ud = float((a * a[::-1, :]).sum()) / den
    return (lr + ud) / 2.0


def balance_light(rgb, strength=0.7):
    """Remove slow light falloff (a corner darker than the other) and stretch levels gently."""
    lum = luminance(rgb)
    low = gaussian(lum, rgb.shape[0] / 8.0)
    gain = np.clip(lum.mean() / np.maximum(low, 1e-3), 0.7, 1.4)
    gain = 1.0 + strength * (gain - 1.0)
    out = rgb * gain[..., None]
    lo = np.percentile(out, 0.5)
    hi = np.percentile(out, 99.5)
    if hi - lo > 0.05:
        # stretch towards the full range but only half way: stone photos must keep their real tone
        target_lo, target_hi = lo * 0.5, hi + (1.0 - hi) * 0.5
        out = (out - lo) / (hi - lo) * (target_hi - target_lo) + target_lo
    return np.clip(out, 0.0, 1.0)


def band_px(size):
    return int(round(size * BAND_FRAC))


def make_seamless(ext, size):
    """Overlap blend, one axis at a time. `ext` is (size+B) x (size+B): the tile plus a B-px strip of the photo that
    continues past its right and bottom edges. The first B columns of the tile fade from that continuation strip
    (photo columns size..size+B) into the tile itself, so column size-1 meets column 0 exactly as it met column size in
    the photo: the tile wraps. Unlike a half-tile offset blend nothing is shown twice. Then the same along y. The mix
    keeps local contrast (variance-preserving) so the band does not look washed out."""
    b = ext.shape[0] - size
    t = np.clip(np.arange(b, dtype=np.float64) / max(1, b - 1), 0.0, 1.0)
    f = t * t * (3.0 - 2.0 * t)  # 0 at the tile edge (all continuation) -> 1 at the end of the band (all tile)

    def blend(a, cont, w):
        mean = np.concatenate([a, cont]).reshape(-1, 3).mean(axis=0)
        norm = np.sqrt(w * w + (1.0 - w) * (1.0 - w))
        return mean + (w * (a - mean) + (1.0 - w) * (cont - mean)) / norm

    out = ext[:, :size].copy()
    out[:, :b] = blend(ext[:, :b], ext[:, size:size + b], f[None, :, None])
    res = out[:size].copy()
    res[:b] = blend(out[:b], out[size:size + b], f[:, None, None])
    return np.clip(res, 0.0, 1.0)


def seam_ratio(rgb):
    """Mean |difference| across the wrap seams divided by the mean |difference| between neighbouring pixels inside.
    About 1 for a seamless tile; a hard edge gives several times more."""
    lum = luminance(rgb)
    inner_x = np.abs(np.diff(lum, axis=1)).mean()
    inner_y = np.abs(np.diff(lum, axis=0)).mean()
    seam_x = np.abs(lum[:, 0] - lum[:, -1]).mean()
    seam_y = np.abs(lum[0, :] - lum[-1, :]).mean()
    inner = max(1e-6, (inner_x + inner_y) / 2.0)
    return float((seam_x + seam_y) / 2.0 / inner)


def max_line_ratio(rgb):
    """Worst straight seam anywhere (wrap included): the largest mean |difference| between two neighbouring
    columns or rows, divided by the average one. A hidden seam line inside the tile shows up here."""
    lum = luminance(rgb)
    dx = np.abs(lum - np.roll(lum, -1, axis=1)).mean(axis=0)
    dy = np.abs(lum - np.roll(lum, -1, axis=0)).mean(axis=1)
    return float(max(dx.max() / max(dx.mean(), 1e-6), dy.max() / max(dy.mean(), 1e-6)))


def normal_map(rgb, max_slope, strength=NORMAL_STRENGTH):
    """Tangent-space normal map (glTF/OpenGL: +X right, +Y up) from brightness with a wrap-around Sobel."""
    h = gaussian(luminance(rgb), 1.0)
    r = lambda a, dy, dx: np.roll(a, (dy, dx), axis=(0, 1))  # noqa: E731
    gx = (r(h, 1, -1) + 2 * r(h, 0, -1) + r(h, -1, -1) - r(h, 1, 1) - 2 * r(h, 0, 1) - r(h, -1, 1)) / 8.0
    gy_down = (r(h, -1, 1) + 2 * r(h, -1, 0) + r(h, -1, -1) - r(h, 1, 1) - 2 * r(h, 1, 0) - r(h, 1, -1)) / 8.0
    k = strength * rgb.shape[0] / 256.0  # same bump look whatever the texture size
    # Polished stone is nearly flat: speckled granite must not turn into sandpaper. Cap the slope of most pixels.
    p90 = float(np.percentile(np.hypot(gx, gy_down), 90))
    k = min(k, max_slope / max(p90, 1e-6))
    n = np.stack([-gx * k, gy_down * k, np.ones_like(gx)], axis=-1)  # image rows go down, texture +Y goes up
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n


def roughness_map(rgb):
    """Polished stone: light areas read glossier. Inverse of local brightness, mapped into 0.15..0.5."""
    local = gaussian(luminance(rgb), 3.0)
    lo, hi = np.percentile(local, 2), np.percentile(local, 98)
    t = np.clip((local - lo) / max(1e-6, hi - lo), 0.0, 1.0)
    return ROUGH_MIN + (ROUGH_MAX - ROUGH_MIN) * (1.0 - t)


def to_img(arr01, mode="RGB"):
    return Image.fromarray((np.clip(arr01, 0, 1) * 255.0 + 0.5).astype(np.uint8), mode)


def slab_mesh(size_mm, mapping, tile_cm):
    """Box W x H x D mm in metres (+Y up, origin at the centre of the bottom face). UVs: 'tile' = one texture tile per
    tile_cm on every face; 'fit' = the top face spans the texture once (0..1), the sides take the matching border strip."""
    w, d, h = (float(v) / 1000.0 for v in size_mm)
    m = trimesh.creation.box(extents=[w, h, d])
    m.apply_translation([0.0, h / 2.0, 0.0])
    m.unmerge_vertices()
    n = np.abs(m.face_normals)
    axis = n.argmax(axis=1)
    tri = m.vertices[m.faces] + np.array([w / 2.0, 0.0, d / 2.0])  # 0..w, 0..h, 0..d
    uv = np.zeros((len(m.faces), 3, 2))
    if mapping == "fit":
        # Top-down projection on every face: the top shows the whole design once (image top = far edge, z = 0, since
        # trimesh's v=1 is the image top); on a side face x or z is constant, so it takes the design's border row.
        uv[:, :, 0] = tri[:, :, 0] / w
        uv[:, :, 1] = 1.0 - tri[:, :, 2] / d
    else:
        tpm = 100.0 / float(tile_cm)
        for a, (i, j) in enumerate([(2, 1), (0, 2), (0, 1)]):  # drop x -> (z,y); drop y -> (x,z); drop z -> (x,y)
            sel = axis == a
            uv[sel, :, 0] = tri[sel, :, i] * tpm
            uv[sel, :, 1] = tri[sel, :, j] * tpm
    # unmerge_vertices leaves faces == arange(3F): corner k of face f is vertex 3f+k
    assert np.array_equal(m.faces.reshape(-1), np.arange(m.faces.size))
    return m, uv.reshape(-1, 2)


def build_slab(out_dir, size_mm, mapping, tile_cm):
    albedo = Image.open(os.path.join(out_dir, "albedo.png")).convert("RGB")
    kwargs = dict(baseColorTexture=albedo, baseColorFactor=[1.0, 1.0, 1.0, 1.0], metallicFactor=0.0, roughnessFactor=1.0, name="stone")
    npath = os.path.join(out_dir, "normal.png")
    rpath = os.path.join(out_dir, "roughness.png")
    if os.path.exists(npath):
        kwargs["normalTexture"] = Image.open(npath).convert("RGB")
    if os.path.exists(rpath):
        g = np.asarray(Image.open(rpath).convert("L"))
        # glTF metallicRoughness: G = roughness, B = metallic (0 for stone), R unused
        mr = np.stack([np.full_like(g, 255), g, np.zeros_like(g)], axis=-1)
        kwargs["metallicRoughnessTexture"] = Image.fromarray(mr, "RGB")
    else:
        kwargs["roughnessFactor"] = 0.3
    mesh, uv = slab_mesh(size_mm, mapping, tile_cm)
    mesh.visual = TextureVisuals(uv=uv, material=PBRMaterial(**kwargs))
    scene = trimesh.Scene()
    scene.add_geometry(mesh, node_name="slab", geom_name="slab")
    glb = os.path.join(out_dir, "slab.glb")
    tmp = glb + ".tmp"
    with open(tmp, "wb") as f:
        f.write(scene.export(file_type="glb"))
    os.replace(tmp, glb)
    ext = scene.bounds[1] - scene.bounds[0]
    make_preview(out_dir, albedo, size_mm, mapping, tile_cm)
    return {"glb_bytes": os.path.getsize(glb), "bbox_m": [round(float(x), 4) for x in ext], "triangles": int(len(mesh.faces))}


def make_preview(out_dir, albedo, size_mm, mapping, tile_cm, px=512):
    """Simple composite: the slab seen from the front and above (top face squashed, darker front edge) on a light card."""
    sw, sd, sh = (float(v) for v in size_mm)
    box = px * 0.8
    top_w, top_d = (box, box * sd / sw) if sw >= sd else (box * sw / sd, box)
    top_w, top_d = max(8, int(round(top_w))), max(8, int(round(top_d)))
    if mapping == "fit":
        top = albedo.resize((top_w, top_d), Image.LANCZOS)
    else:
        tile_px = max(4, int(round(top_w * float(tile_cm) * 10.0 / sw)))
        a = albedo.resize((tile_px, tile_px), Image.LANCZOS)
        top = Image.new("RGB", (top_w, top_d))
        for y in range(0, top_d, tile_px):
            for x in range(0, top_w, tile_px):
                top.paste(a, (x, y))
    arr = np.asarray(top, dtype=np.float64) / 255.0
    top = to_img(arr * np.linspace(1.04, 0.92, top_d)[:, None, None])  # light falloff for a little depth
    top_h = max(4, int(top_d * 0.62))
    top = top.resize((top_w, top_h), Image.LANCZOS)
    edge_h = min(int(px * 0.12), max(5, int(top_w * sh / sw * 2.2)))
    strip = top.crop((0, top_h - edge_h, top_w, top_h)).transpose(Image.FLIP_TOP_BOTTOM)
    edge = to_img(np.asarray(strip, dtype=np.float64) / 255.0 * 0.6)
    canvas = Image.new("RGB", (px, px), (236, 238, 241))
    shadow = Image.new("L", (px, px), 0)
    ox, oy = (px - top_w) // 2, (px - top_h - edge_h) // 2
    ImageDraw.Draw(shadow).rectangle([ox + 6, oy + 14, ox + top_w + 6, oy + top_h + edge_h + 14], fill=110)
    canvas.paste((150, 152, 158), (0, 0), shadow.filter(ImageFilter.GaussianBlur(12)))
    canvas.paste(top, (ox, oy))
    canvas.paste(edge, (ox, oy + top_h))
    canvas.save(os.path.join(out_dir, "preview.png"))


def read_meta(out_dir):
    try:
        with open(os.path.join(out_dir, "meta.json"), "r", encoding="utf-8") as f:
            return json.load(f)
    except Exception:  # noqa: BLE001
        return None


def write_meta(out_dir, meta):
    tmp = os.path.join(out_dir, "meta.json.tmp")
    with open(tmp, "w", encoding="utf-8") as f:
        json.dump(meta, f, ensure_ascii=False, indent=2)
    os.replace(tmp, os.path.join(out_dir, "meta.json"))


def check_tile(v):
    if not (5.0 <= v <= 500.0):
        raise c.W3DError("tile_cm phải trong khoảng 5 đến 500 cm (đang là %s)." % v)
    return v


def check_slab(v):
    w, d, h = (float(x) for x in v)
    if not (10 <= w <= 5000 and 10 <= d <= 5000 and 1 <= h <= 500):
        raise c.W3DError("Kích thước tấm không hợp lệ: Rộng, Sâu 10-5000 mm, Dày 1-500 mm (đang là %s x %s x %s)." % (w, d, h))
    return [w, d, h]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("paths", nargs="+")
    ap.add_argument("--tile-cm", type=float, default=None)
    ap.add_argument("--size", type=int, default=1024)
    ap.add_argument("--slab-mm", type=float, nargs=3, default=None)
    ap.add_argument("--mapping", choices=["auto", "tile", "fit"], default="auto")
    ap.add_argument("--name", default=None)
    ap.add_argument("--source", default=None)
    ap.add_argument("--slab-only", action="store_true")
    a = ap.parse_args()

    if a.slab_only:
        if len(a.paths) != 1:
            raise c.W3DError("--slab-only cần đúng một thư mục vật liệu.")
        out_dir = a.paths[0]
        meta = read_meta(out_dir)
        if meta is None or not os.path.exists(os.path.join(out_dir, "albedo.png")):
            raise c.W3DError("Thư mục vật liệu thiếu meta.json hoặc albedo.png.")
        tile = check_tile(float(a.tile_cm if a.tile_cm is not None else meta.get("tile_cm", 60)))
        sm = meta.get("size_mm") or {}
        slab = check_slab(a.slab_mm or [sm.get("w", 600), sm.get("d", 600), sm.get("h", 20)])
        mapping = meta.get("mapping") if meta.get("mapping") in ("tile", "fit") else "tile"
        res = build_slab(out_dir, slab, mapping, tile)
        meta["tile_cm"] = tile
        meta["size_mm"] = {"w": slab[0], "d": slab[1], "h": slab[2]}
        write_meta(out_dir, meta)
        c.emit({"ok": True, "id": meta.get("id"), "tile_cm": tile, "mapping": mapping, **res})
        return

    if len(a.paths) != 2:
        raise c.W3DError("Cần <ảnh_vào> <thư_mục_ra>.")
    src, out_dir = a.paths
    if not pow2_ok(a.size):
        raise c.W3DError("--size phải là lũy thừa của 2 từ 64 đến 4096.")
    tile = check_tile(float(a.tile_cm if a.tile_cm is not None else 60.0))
    slab = check_slab(a.slab_mm or DEFAULT_SLAB_MM)
    if not os.path.isfile(src):
        raise c.W3DError("Không thấy ảnh vào.")
    img = open_rgb(src)
    std = check_not_flat(np.asarray(img.resize((256, 256)), dtype=np.float64) / 255.0)
    sym = symmetry(crop_aspect(img, slab[0] / slab[1]))
    mapping = a.mapping if a.mapping != "auto" else ("fit" if sym >= SYMMETRY_FIT else "tile")
    stats = {}
    if mapping == "fit":
        # the whole design once: crop to the slab's aspect (no stretching on the slab), no seamless blend, no relighting
        albedo = to_array(crop_aspect(img, slab[0] / slab[1]), a.size)
    else:
        b = band_px(a.size)
        side = min(img.size)
        left, top = (img.size[0] - side) // 2, (img.size[1] - side) // 2
        ext = balance_light(to_array(img.crop((left, top, left + side, top + side)), a.size + b))
        stats["seam_before"] = round(seam_ratio(ext[:a.size, :a.size]), 3)
        albedo = make_seamless(ext, a.size)
        stats["seam_after"] = round(seam_ratio(albedo), 3)
        stats["max_line_ratio"] = round(max_line_ratio(albedo), 3)
    normal = normal_map(albedo, MAX_SLOPE_P90[mapping])
    rough = roughness_map(albedo)

    os.makedirs(out_dir, exist_ok=True)
    to_img(albedo).save(os.path.join(out_dir, "albedo.png"))
    to_img(normal * 0.5 + 0.5).save(os.path.join(out_dir, "normal.png"))
    to_img(rough, "L").save(os.path.join(out_dir, "roughness.png"))
    mid = os.path.basename(os.path.normpath(out_dir))
    source = a.source or os.path.basename(src)
    name = (a.name or os.path.splitext(source)[0]).strip()[:80] or mid
    prev = read_meta(out_dir) or {}
    meta = {
        "id": mid,
        "name": name,
        "kind": "stone",
        "tile_cm": tile,
        "source": source,
        "created": prev.get("created") or datetime.datetime.now(datetime.timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z"),
        "mapping": mapping,
        "category": "stone",
        "entry": "material",
        "size_mm": {"w": slab[0], "d": slab[1], "h": slab[2]},
        "session": None,
    }
    write_meta(out_dir, meta)
    res = build_slab(out_dir, slab, mapping, tile)
    c.emit({
        "ok": True,
        "id": mid,
        "size_px": a.size,
        "tile_cm": tile,
        "mapping": mapping,
        "symmetry": round(sym, 3),
        **stats,
        "contrast": round(std, 4),
        "normal_z_mean": round(float(normal[..., 2].mean()), 4),
        "roughness_range": [round(float(rough.min()), 3), round(float(rough.max()), 3)],
        **res,
    })


if __name__ == "__main__":
    c.run_main(main)
