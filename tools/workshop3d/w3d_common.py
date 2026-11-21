"""Shared helpers: load part meshes, materials, planar UVs and procedural textures. Units: input mm, output metres."""
import json
import os
import re
import sys

import numpy as np
import trimesh
from PIL import Image, ImageFilter

GREY = {"color": [0.6, 0.6, 0.6], "metallic": 0.0, "roughness": 0.6}
ID_RE = re.compile(r"^[a-z0-9][a-z0-9_]{0,63}$")


class W3DError(Exception):
    """A user-facing failure: reported as one JSON line {"ok": false, "error": ...} and exit code 1."""


def run_main(fn):
    """Run fn(); on any failure print exactly one JSON error line and exit 1 (contract: every script prints ONE JSON line)."""
    try:
        fn()
    except SystemExit as e:
        if e.code in (None, 0):
            raise
        emit({"ok": False, "error": e.code if isinstance(e.code, str) else "Lỗi tham số (mã %s)." % e.code})
        sys.exit(1)
    except W3DError as e:
        emit({"ok": False, "error": str(e)})
        sys.exit(1)
    except Exception as e:  # noqa: BLE001
        emit({"ok": False, "error": "Lỗi không mong đợi: %s: %s" % (type(e).__name__, e)})
        sys.exit(1)


def normalise_spec(pid, spec, warnings):
    """Fill missing colour/metallic/roughness with defaults (and a warning) so a partial materials entry cannot crash."""
    out = dict(spec)
    if not isinstance(out.get("color"), (list, tuple)) or len(out["color"]) != 3:
        warnings.append("%s: thiếu color, dùng xám tạm" % pid)
        out["color"] = GREY["color"]
    if "metallic" not in out:
        warnings.append("%s: thiếu metallic, dùng 0.0" % pid)
        out["metallic"] = 0.0
    if "roughness" not in out:
        warnings.append("%s: thiếu roughness, dùng 0.5" % pid)
        out["roughness"] = 0.5
    return out


def emit(obj):
    """Print one JSON line as UTF-8 bytes (a piped stdout on Windows uses cp1252 and would crash on Vietnamese text)."""
    sys.stdout.buffer.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def load_materials(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f).get("materials", {})


def load_parts(parts_dir):
    """Return {id: Trimesh} in metres, Z-up converted to Y-up, origin at the centre of the floor footprint."""
    meshes = {}
    for name in sorted(os.listdir(parts_dir)):
        if not name.lower().endswith(".stl"):
            continue
        part_id = os.path.splitext(name)[0]  # the file stem IS the part id
        if not ID_RE.match(part_id):
            raise W3DError("Tên file %s không hợp lệ: id bộ phận chỉ gồm a-z, 0-9, gạch dưới (tối đa 64 ký tự)." % name)
        try:
            m = trimesh.load(os.path.join(parts_dir, name), force="mesh")
        except Exception as e:  # noqa: BLE001
            raise W3DError("Không đọc được %s: %s" % (name, e))
        if len(getattr(m, "faces", [])) == 0 or len(getattr(m, "vertices", [])) == 0:
            raise W3DError("File %s rỗng hoặc không có mặt tam giác." % name)
        m.apply_scale(0.001)
        meshes[part_id] = m
    if not meshes:
        raise W3DError("Không có file STL trong thư mục bộ phận.")
    allv = np.vstack([m.vertices for m in meshes.values()])
    lo, hi = allv.min(axis=0), allv.max(axis=0)
    shift = np.array([-(lo[0] + hi[0]) / 2, -(lo[1] + hi[1]) / 2, -lo[2]])
    z_up_to_y_up = trimesh.transformations.rotation_matrix(-np.pi / 2, [1, 0, 0])
    for m in meshes.values():
        m.apply_translation(shift)
        m.apply_transform(z_up_to_y_up)
    return meshes


def planar_uv(mesh, tiles_per_metre=1.0):
    """Per-corner UVs by projecting each face along its dominant normal axis; unmerges vertices."""
    mesh.unmerge_vertices()
    n = np.abs(mesh.face_normals)
    axis = n.argmax(axis=1)
    tri = mesh.vertices[mesh.faces]  # (F, 3, 3)
    uv = np.zeros((len(mesh.faces), 3, 2))
    for a, (i, j) in enumerate([(2, 1), (0, 2), (0, 1)]):  # drop x -> (z,y); drop y -> (x,z); drop z -> (x,y)
        sel = axis == a
        uv[sel, :, 0] = tri[sel, :, i]
        uv[sel, :, 1] = tri[sel, :, j]
    return (uv.reshape(-1, 2) * tiles_per_metre).astype(np.float64)


def make_texture(kind, scale, angle, base_rgb, px=1024, seed=7):
    """Procedural albedo: 'hairline'/'brushed' = streaks along one axis, 'noise' = soft grain. Returns a PIL RGB image."""
    rng = np.random.default_rng(seed)
    if kind in ("hairline", "brushed"):
        line = rng.random((1, px))
        arr = np.repeat(line, px, axis=0)
        amp = 0.10 if kind == "hairline" else 0.06
        arr = 1.0 - amp + amp * arr
        if kind == "brushed":
            arr = arr * (0.97 + 0.03 * rng.random((px, 1)))
    else:
        arr = 0.9 + 0.1 * rng.random((px, px))
    img = Image.fromarray((arr * 255).astype(np.uint8)).filter(ImageFilter.GaussianBlur(0.6 if kind == "hairline" else 1.2))
    if kind in ("hairline", "brushed") and abs(angle % 180) > 1:
        img = img.rotate(angle, resample=Image.BICUBIC, expand=False)
    base = np.array(img, dtype=np.float64)[..., None] / 255.0 * np.array(base_rgb)[None, None, :]
    return Image.fromarray((np.clip(base, 0, 1) * 255).astype(np.uint8), "RGB")


def material_for(mats, part_id):
    return mats.get(part_id)


def resolve_materials(mats, part_ids, warnings):
    """materials.json entries for every part, with inheritance for parts the role did not list (w3d_matinherit.py, the
    same rule as Blender). Appends the Vietnamese report lines to warnings. Returns (resolved, inherited, unresolved)."""
    import w3d_matinherit as mi
    resolved, inherited, unresolved = mi.resolve(mats, list(part_ids))
    warnings.extend(mi.warnings_for(inherited, unresolved))
    return resolved, inherited, unresolved
