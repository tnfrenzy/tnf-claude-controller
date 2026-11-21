"""Assemble part STLs + materials.json into a PBR GLB. Usage: assemble_glb.py <parts_dir> <materials.json> <out.glb> [--max-triangles N] [--texture-px N]
Prints exactly one JSON line (also on failure: {"ok": false, "error": ...}, exit 1).
--max-triangles is best effort: quadric decimation needs the optional fast-simplification package;
"decimation" reports applied / partial / unavailable. It decimates the original parts, correcting the keep ratio after
each pass, until the total is FILL_MIN..100 % of the budget (each part keeps at least MIN_PART_FACES faces, so many
tiny parts can stay above budget).
Textures: texture.kind (hairline, brushed, noise, granite, marble, wood, fabric, diamond_plate, stripes) gets a procedural albedo + normal +
metallic-roughness set (w3d_textures.py); texture.scale = centimetres per tile (never below the kind's minimum);
`library` = folder with albedo.png [normal.png roughness.png meta.json] used instead of the procedural set.
Identical images are stored once in the GLB.
Parts without a materials.json entry inherit one (w3d_matinherit.py): "inherited_materials" {id: {from, how}};
"missing_materials" lists only the parts nothing fits (grey, with a warning)."""
import argparse
import hashlib
import json
import os
import struct

import numpy as np
import trimesh
from trimesh.visual.material import PBRMaterial
from trimesh.visual.texture import TextureVisuals

import w3d_common as c
import w3d_textures as tx

MIN_PART_FACES = 12
MAX_PASSES = 5
FILL_MIN = 0.8  # a decimated total in FILL_MIN..1 x budget is good enough
FILL_AIM = 0.92  # a pass over the budget aims here next
UNDERSHOOT = 0.8  # a part under this share of its target takes no more budget (settled)
CLUSTER_START =1.0 / 4096  # first vertex-clustering cell, fraction of the part diagonal
CLUSTER_STEP = 1.2  # growth per step: the result lands within ~1/1.2^2 of the target, never far below it
TEXTURE_SLOTS = ("baseColorTexture", "normalTexture", "occlusionTexture", "emissiveTexture", "metallicRoughnessTexture")


def resolve_library(value, materials_path):
    """A library folder: absolute, or relative to $W3D_MATERIAL_LIBRARY, or to the folder of materials.json. No '..'."""
    if not isinstance(value, str) or not value.strip() or len(value) > 400:
        return None
    if ".." in value.replace("\\", "/").split("/"):
        return None
    if os.path.isabs(value):
        cands = [value]
    else:
        bases = (os.environ.get("W3D_MATERIAL_LIBRARY"), os.path.dirname(os.path.abspath(materials_path)))
        cands = [os.path.join(b, value) for b in bases if b]
    for d in cands:
        if os.path.isfile(os.path.join(d, "albedo.png")):
            return os.path.abspath(d)
    return None


def cluster_simplify(m, target):
    """Vertex clustering fallback for shapes quadric decimation refuses (long thin cylinders: every collapse would
    flip a sliver triangle). Grows the grid cell from very fine (CLUSTER_START of the diagonal) in small steps and keeps
    the FIRST result that fits: the finest grid under the target, so the part keeps as much detail as the budget allows
    (a coarse first cell turned a 25 748-face bumper into 310 faces when 3 900 were allowed)."""
    diag = float(np.linalg.norm(m.extents))
    if diag <= 0:
        return None
    cell = diag * CLUSTER_START
    best = None
    while cell <= diag / 4.0:
        q = np.floor(m.vertices / cell).astype(np.int64)
        _, idx, inv = np.unique(q, axis=0, return_index=True, return_inverse=True)
        inv = inv.reshape(-1)
        verts = np.zeros((len(idx), 3))
        np.add.at(verts, inv, m.vertices)
        verts /= np.bincount(inv, minlength=len(idx))[:, None]
        faces = inv[m.faces]
        keep = (faces[:, 0] != faces[:, 1]) & (faces[:, 1] != faces[:, 2]) & (faces[:, 0] != faces[:, 2])
        faces = faces[keep]
        faces = faces[np.sort(np.unique(np.sort(faces, axis=1), axis=0, return_index=True)[1])]
        if len(faces) >= 4:
            best = trimesh.Trimesh(vertices=verts, faces=faces, process=True)
            if len(best.faces) <= target:
                return best
        cell *= CLUSTER_STEP
    return best if best is not None and len(best.faces) < len(m.faces) else None


def decimate_once(orig, ratio):
    """One decimation of the given ORIGINAL parts keeping `ratio` of each part's shrinkable faces.
    Returns (parts, targets, failed)."""
    out, targets, failed = {}, {}, 0
    for pid, m in orig.items():
        n = len(m.faces)
        target = max(MIN_PART_FACES, int(MIN_PART_FACES + (n - MIN_PART_FACES) * ratio))
        out[pid], targets[pid] = m, target
        if n <= target:
            continue
        try:
            s = m.simplify_quadric_decimation(face_count=target)
        except Exception:  # noqa: BLE001  (optional dependency missing: keep the mesh)
            failed += 1
            continue
        if len(s.faces) > target * 1.1:
            alt = cluster_simplify(m, target)
            if alt is not None and len(alt.faces) < len(s.faces):
                s = alt
        if 0 < len(s.faces) < n:
            out[pid] = s
    return out, targets, failed


def decimate(parts, max_triangles, warnings):
    """Quadric decimation (vertex clustering where it cannot shrink a part) of the original parts so the total lands at
    FILL_MIN..100 % of the budget instead of far below it. Quadric decimation collapses a flat box far under its target
    (a 9 460-face panel to ~360 faces) and clustering lands under its target too: such parts are settled after a pass and
    the budget they leave is shared by the other parts in the next pass (water filling); a pass over the budget lowers
    the share. Keeps the fullest result under the budget (else the smallest one). Returns the status string."""
    orig = dict(parts)
    settled = {}
    best = smallest = None
    failed = 0
    scale = 0.97  # quadric decimation tends to overshoot a little
    for _ in range(MAX_PASSES):
        active = {k: m for k, m in orig.items() if k not in settled}
        left = max_triangles - sum(len(m.faces) for m in settled.values())
        n_act = sum(len(m.faces) for m in active.values())
        # parts at their floor cannot give anything: spread the budget over the others (0 = all to the floor)
        floor = sum(min(len(m.faces), MIN_PART_FACES) for m in active.values())
        if not active or n_act - floor <= 0:
            break
        ratio = min(1.0, max(0.0, left - floor) / (n_act - floor) * scale)
        trial, targets, failed = decimate_once(active, ratio)
        merged = {k: settled.get(k, trial.get(k)) for k in orig}
        total = sum(len(m.faces) for m in merged.values())
        if total <= max_triangles and (best is None or total > best[0]):
            best = (total, merged)
        if smallest is None or total < smallest[0]:
            smallest = (total, merged)
        if failed or FILL_MIN * max_triangles <= total <= max_triangles:
            break
        if total > max_triangles:
            scale *= FILL_AIM * max_triangles / total
            continue
        more = {k: trial[k] for k in trial if len(trial[k].faces) < UNDERSHOOT * targets[k]}
        if not more:
            break
        settled.update(more)
    pick = best or smallest
    if pick:
        parts.clear()
        parts.update(pick[1])
    done = sum(1 for k in parts if parts[k] is not orig[k])
    if failed:
        warnings.append("Không giảm được tam giác cho %d bộ phận (cần gói fast-simplification), giữ nguyên lưới." % failed)
    left = sum(len(m.faces) for m in parts.values())
    if done and left > max_triangles:
        warnings.append("Bản rút gọn còn %d tam giác (trần %d): các bộ phận nhỏ đã ở mức tối thiểu." % (left, max_triangles))
    return "partial" if done and failed else "applied" if done else "unavailable"


def dedupe_glb_images(path):
    """trimesh writes one copy of every texture image per material: keep one copy per distinct image and compact the
    binary chunk. Returns the number of images left."""
    with open(path, "rb") as f:
        data = f.read()
    magic, version, _ = struct.unpack_from("<III", data, 0)
    if magic != 0x46546C67:
        return 0
    jlen = struct.unpack_from("<I", data, 12)[0]
    doc = json.loads(data[20:20 + jlen].decode("utf-8"))
    off = 20 + jlen
    bin_chunk = b""
    if off + 8 <= len(data):
        blen = struct.unpack_from("<I", data, off)[0]
        bin_chunk = data[off + 8: off + 8 + blen]
    images = doc.get("images") or []
    views = doc.get("bufferViews") or []
    if not images:
        return 0

    def view_bytes(i):
        v = views[i]
        o = v.get("byteOffset", 0)
        return bin_chunk[o:o + v["byteLength"]]

    first_by_hash, image_map, new_images = {}, {}, []
    for i, im in enumerate(images):
        key = (hashlib.sha1(view_bytes(im["bufferView"])).hexdigest() if "bufferView" in im else "uri%d" % i) + im.get("mimeType", "")
        if key not in first_by_hash:
            first_by_hash[key] = len(new_images)
            new_images.append(im)
        image_map[i] = first_by_hash[key]
    tex_map, new_textures, seen_tex = {}, [], {}
    for i, t in enumerate(doc.get("textures") or []):
        t = dict(t)
        if "source" in t:
            t["source"] = image_map[t["source"]]
        key = json.dumps(t, sort_keys=True)
        if key not in seen_tex:
            seen_tex[key] = len(new_textures)
            new_textures.append(t)
        tex_map[i] = seen_tex[key]
    for m in doc.get("materials") or []:
        for holder in (m, m.get("pbrMetallicRoughness") or {}):
            for slot in TEXTURE_SLOTS:
                if isinstance(holder.get(slot), dict) and isinstance(holder[slot].get("index"), int):
                    holder[slot]["index"] = tex_map[holder[slot]["index"]]
    doc["images"] = new_images
    if new_textures:
        doc["textures"] = new_textures

    used = {a["bufferView"] for a in doc.get("accessors") or [] if "bufferView" in a}
    used |= {im["bufferView"] for im in new_images if "bufferView" in im}
    view_map, new_views, chunks, cursor = {}, [], [], 0
    for i, v in enumerate(views):
        if i not in used:
            continue
        b = view_bytes(i)
        pad = (-cursor) % 4
        if pad:
            chunks.append(b"\0" * pad)
            cursor += pad
        nv = dict(v)
        nv["byteOffset"] = cursor
        nv["buffer"] = 0
        chunks.append(b)
        cursor += len(b)
        view_map[i] = len(new_views)
        new_views.append(nv)
    for a in doc.get("accessors") or []:
        if "bufferView" in a:
            a["bufferView"] = view_map[a["bufferView"]]
    for im in new_images:
        if "bufferView" in im:
            im["bufferView"] = view_map[im["bufferView"]]
    doc["bufferViews"] = new_views
    new_bin = b"".join(chunks)
    new_bin += b"\0" * ((-len(new_bin)) % 4)
    doc["buffers"] = [{"byteLength": len(new_bin)}]
    js = json.dumps(doc, separators=(",", ":")).encode("utf-8")
    js += b" " * ((-len(js)) % 4)
    total = 12 + 8 + len(js) + 8 + len(new_bin)
    out = (struct.pack("<III", 0x46546C67, version, total) + struct.pack("<II", len(js), 0x4E4F534A) + js
           + struct.pack("<II", len(new_bin), 0x004E4942) + new_bin)
    with open(path, "wb") as f:
        f.write(out)
    return len(new_images)


def texture_set_for(spec, px, materials_path, cache, warnings, pid):
    """Return (images dict, tile_cm, source) where source is a texture kind or "library"; (None, None, None) = no texture."""
    tex = spec.get("texture") or {}
    lib = spec.get("library")
    if lib:
        d = resolve_library(lib, materials_path)
        if d is None:
            warnings.append("%s: không thấy thư mục thư viện vật liệu '%s' (cần albedo.png), dùng texture sinh bằng mã." % (pid, lib))
        else:
            key = ("lib", d, px)
            if key not in cache:
                try:
                    cache[key] = tx.load_library(d, px)
                except (OSError, ValueError) as e:
                    warnings.append("%s: thư viện vật liệu lỗi (%s), dùng texture sinh bằng mã." % (pid, e))
                    cache[key] = None
            if cache[key] is not None:
                imgs, tile = cache[key]
                return imgs, tile or float(tex.get("scale") or 60), "library"
    kind = tex.get("kind", "none")
    if kind not in tx.KINDS:
        return None, None, None
    angle = float(tex.get("angle") or 0)
    c2 = tex.get("color2")
    c2 = tuple(float(x) for x in c2[:3]) if isinstance(c2, (list, tuple)) and len(c2) >= 3 else None
    key = (kind, round(angle, 3), tuple(round(float(x), 4) for x in spec["color"]), px, c2)
    if key not in cache:
        cache[key] = tx.make_texture_set(kind, spec["color"], px=px, angle=angle, color2=c2)
    return cache[key], tx.tile_cm(kind, tex.get("scale")), kind


def build_material(pid, spec, imgs, source):
    rgb = spec["color"]
    alpha = float(spec.get("opacity", 1.0))
    textured = imgs is not None
    rough = float(spec["roughness"])
    kwargs = dict(
        baseColorFactor=[1.0 if textured else rgb[0], 1.0 if textured else rgb[1], 1.0 if textured else rgb[2], alpha],
        metallicFactor=float(spec["metallic"]),
        roughnessFactor=rough,
        alphaMode="BLEND" if alpha < 1.0 else "OPAQUE",
        doubleSided=alpha < 1.0,
        name=pid,
    )
    if spec.get("emissive"):
        kwargs["emissiveFactor"] = list(spec["emissive"])
    if textured:
        kwargs["baseColorTexture"] = imgs["albedo"]
        if imgs.get("normal") is not None:
            kwargs["normalTexture"] = imgs["normal"]
        if imgs.get("mr") is not None:
            kwargs["metallicRoughnessTexture"] = imgs["mr"]
            # library roughness.png is absolute; the procedural map is a ~0.7..1 multiplier around the asked value
            kwargs["roughnessFactor"] = 1.0 if source == "library" else min(1.0, rough / 0.85)
    return PBRMaterial(**kwargs)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("parts_dir")
    ap.add_argument("materials")
    ap.add_argument("out")
    ap.add_argument("--max-triangles", type=int, default=0)
    ap.add_argument("--texture-px", type=int, default=1024)
    a = ap.parse_args()

    mats = c.load_materials(a.materials)
    parts = c.load_parts(a.parts_dir)
    warnings = []
    decimation = "not requested"
    if a.max_triangles and sum(len(m.faces) for m in parts.values()) > a.max_triangles:
        decimation = decimate(parts, a.max_triangles, warnings)

    scene = trimesh.Scene()
    resolved, inherited, missing = c.resolve_materials(mats, parts.keys(), warnings)
    cache = {}
    kinds = set()
    for pid, m in parts.items():
        spec = resolved.get(pid) or c.GREY
        spec = c.normalise_spec(pid, spec, warnings)
        imgs, tile, source = texture_set_for(spec, a.texture_px, a.materials, cache, warnings, pid)
        mat = build_material(pid, spec, imgs, source)
        if imgs is not None:
            kinds.add(source)
            uv = c.planar_uv(m, tiles_per_metre=1.0 / max(0.001, float(tile) / 100.0))
            m.visual = TextureVisuals(uv=uv, material=mat)
        else:
            m.visual = TextureVisuals(material=mat)
        scene.add_geometry(m, node_name=pid, geom_name=pid)

    scene.export(a.out)
    images = dedupe_glb_images(a.out)
    ext = scene.bounds[1] - scene.bounds[0]
    c.emit({
        "ok": True,
        "triangles": int(sum(len(g.faces) for g in scene.geometry.values())),
        "parts": len(parts),
        "materials": len(parts) - len(missing),
        "bytes": os.path.getsize(a.out),
        "bbox_m": [round(float(x), 4) for x in ext],
        "missing_materials": missing,
        "inherited_materials": inherited,
        "decimation": decimation,
        "texture_px": a.texture_px,
        "textures": len([v for v in cache.values() if v is not None]),
        "images": images,
        "texture_kinds": sorted(kinds),
        "warnings": warnings,
    })


if __name__ == "__main__":
    c.run_main(main)
