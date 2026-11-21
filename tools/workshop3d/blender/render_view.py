"""Render ONE high-quality view of a workshop GLB with Blender Cycles (spawned by src/core/workshop3d/blender.ts).

Usage: blender -b --factory-startup -P render_view.py -- <job.json>
job.json: {glb, materials|null, libraryDir|null, polyhavenDir|null, out (png), width, height, samples, device (auto|cuda|cpu),
           exposure, attempt (0 = planned camera, 1 = wider retry after a blank image),
           view: {name, preset?: overview|door|ceiling|floor|wall_left|wall_right|wall_back|cop,
                  orbit?: {az, el, dist, target?}}}   (orbit = a render-director camera, glTF degrees / metres)
Prints one line `W3D_RESULT {json}` (ok, mode, device, seconds, hollow, camera, warnings) and exits 0; any failure prints
`W3D_RESULT {"ok": false, "error": ...}` and exits 1. One view per process: the controller checkpoints every image,
enforces a timeout per image and frees the memory of low-memory machines between images.
"""
import json
import math
import os
import sys
import time
import traceback

sys.dont_write_bytecode = True  # never leave __pycache__ next to the shipped scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402
from mathutils import Vector  # noqa: E402

import w3d_bscene as S  # noqa: E402

T0 = time.time()


def result(obj, code):
    print("W3D_RESULT " + json.dumps(obj, ensure_ascii=False), flush=True)
    sys.stdout.flush()
    os._exit(code)  # skip Blender's own shutdown chatter / atexit handlers


def gl_dir(az, el):
    """render-director direction (camera.js: az 0 = glTF +Z) converted to Blender (x, -z, y)."""
    a, e = math.radians(az), math.radians(el)
    gx, gy, gz = math.sin(a) * math.cos(e), math.sin(e), math.cos(a) * math.cos(e)
    return Vector((gx, -gz, gy)).normalized()


def fit_distance(box, lens):
    mn, mx = box
    fov = 2 * math.atan(18.0 / lens)
    return (mx - mn).length / 2 / math.sin(fov / 2) * 1.08


# The ceiling view looks straight into the light panels: darker so the diffusers and frames do not burn out.
EXPOSURE_OFFSET = {"ceiling": -0.3}

EXTERIOR_PRESET = {  # solid model: preset name -> (azimuth, elevation) around the whole object
    "overview": (35, 20), "door": (0, 10), "ceiling": (0, 55), "floor": (0, -25), "wall_left": (-90, 10),
    "wall_right": (90, 10), "wall_back": (180, 10), "cop": (160, 15),
}


INTERIOR_ONLY = ("ceiling", "floor", "wall_left", "wall_right", "wall_back")


def clamp_in(p, inner, m=0.04):
    imn, imx = inner
    return Vector([min(max(p[i], imn[i] + m), imx[i] - m) for i in range(3)])


def exterior(box, az, el, lens=40, target=None):
    mn, mx = box
    t = target if target is not None else (mn + mx) / 2
    d = gl_dir(az, el)
    return {"mode": "exterior", "loc": t + d * fit_distance(box, lens), "tgt": t, "lens": lens, "hide_front": False}


def interior_preset(name, box, inner, f, cop, attempt):
    imn, imx = inner
    up = Vector((0, 0, 1))
    r = f.cross(up)
    c = Vector(((imn.x + imx.x) / 2, (imn.y + imx.y) / 2, imn.z))
    hd = abs((imx - imn).dot(f)) / 2
    hw = abs((imx - imn).dot(r)) / 2
    H = imx.z - imn.z

    def P(af, ar, z):
        return c + f * af + r * ar + up * z

    if attempt > 0 and name != "overview":
        # retry of a blank image: stand in the middle and look wider at the same thing
        cam = interior_preset(name, box, inner, f, cop, 0)
        if cam is None:
            return None
        return {"mode": "interior", "loc": P(0, 0, 0.6 * H), "tgt": cam["tgt"], "lens": 14, "hide_front": False}
    if name == "pano":  # 360 degrees from the middle of the cabin at eye height, the centre of the image looks at the back wall
        loc = clamp_in(P(0, 0, 0.62 * H), inner)
        return {"mode": "pano", "loc": loc, "tgt": loc - f, "lens": 14, "hide_front": False}
    if name == "overview":  # outside the front wall (hidden from the camera), looking at the back wall
        return {"mode": "cutaway", "loc": P(hd + 0.72 * (2 * hd / 1.5), 0, 0.587 * H), "tgt": P(-hd, 0, 0.455 * H), "lens": 19, "hide_front": True}
    if name == "door":
        cam = {"loc": P(-hd + 0.075, 0, 0.67 * H), "tgt": P(hd, 0, 0.434 * H), "lens": 15}
    elif name == "ceiling":
        cam = {"loc": P(0.5 * hd, 0, 0.6 * H), "tgt": P(-0.3 * hd, 0, H + 0.06), "lens": 14}
    elif name == "floor":
        cam = {"loc": P(0.82 * hd, 0, 0.8 * H), "tgt": P(-0.4 * hd, 0, 0), "lens": 15}
    elif name == "wall_back":
        cam = {"loc": P(0.85 * hd, 0, 0.62 * H), "tgt": P(-hd, 0, 0.45 * H), "lens": 16}
    elif name in ("wall_right", "wall_left"):
        s = 1 if name == "wall_right" else -1
        cam = {"loc": P(0.43 * hd, -s * 0.775 * hw, 0.62 * H), "tgt": P(-0.17 * hd, s * hw, 0.475 * H), "lens": 17}
    elif name == "cop":
        if cop is None:
            return None
        cmn, cmx = cop
        t = (cmn + cmx) / 2
        away = Vector((c.x - t.x, c.y - t.y, 0))
        away = away.normalized() if away.length > 1e-6 else -f
        cam = {"loc": t + away * 0.85 + up * 0.1, "tgt": t, "lens": 28}
    else:
        return None
    cam["loc"] = clamp_in(cam["loc"], inner)
    cam.update({"mode": "interior", "hide_front": False})
    return cam


def orbit_camera(o, box, inner, objs, attempt):
    if attempt > 0:
        return exterior(box, 35, 25)
    mn, mx = box
    tgt = (mn + mx) / 2
    name = o.get("target")
    if name:
        parts = [x for x in objs if S.part_id(x) == name]
        if parts:
            a, b = S.bbox(parts[0])
            tgt = (a + b) / 2
    d = gl_dir(float(o.get("az", 35)), float(o.get("el", 20)))
    dist = min(max(float(o.get("dist", 1.0)), 0.1), 100.0)
    if inner:
        imn, imx = inner
        inside_t = all(imn[i] < tgt[i] < imx[i] for i in range(3))
        loc = tgt + d * dist
        inside_p = all(imn[i] < loc[i] < imx[i] for i in range(3))
        if name and (inside_t or inside_p):
            return {"mode": "interior", "loc": clamp_in(loc, inner), "tgt": tgt, "lens": 30, "hide_front": False}
    # exterior: never inside the outer box
    diag = (mx - mn).length
    t_exit = 0.0
    if all(mn[i] <= tgt[i] <= mx[i] for i in range(3)):
        ts = [((mx[i] if d[i] > 0 else mn[i]) - tgt[i]) / d[i] for i in range(3) if abs(d[i]) > 1e-9]
        t_exit = max(0.0, min(ts)) if ts else 0.0
    dist = max(dist, t_exit + 0.05 * diag)
    if not name:
        dist = max(dist, fit_distance(box, 40))
    return {"mode": "exterior", "loc": tgt + d * dist, "tgt": tgt, "lens": 40, "hide_front": False}


def front_parts(objs, inner, f):
    """Parts entirely in the front band of the cabin (front wall, door, COP on the return panel): hidden for the cutaway."""
    imn, imx = inner
    c = (imn + imx) / 2
    hd = abs((imx - imn).dot(f)) / 2
    out = []
    for o in objs:
        a, b = S.bbox(o)
        lo = min((a - c).dot(f), (b - c).dot(f))
        if lo >= 0.6 * hd:
            out.append(o)
    return out


def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    view = job["view"]
    attempt = int(job.get("attempt", 0))
    objs = S.load_scene(job["glb"])
    if not objs:
        result({"ok": False, "error": "GLB không có lưới nào."}, 1)
    spec = {}
    if job.get("materials") and os.path.isfile(job["materials"]):
        spec = json.load(open(job["materials"], encoding="utf-8")).get("materials", {})
    else:
        S.warn("Thiếu materials.json: dùng vật liệu của GLB.")
    spec = S.inherit_materials(objs, spec)
    box = S.scene_box(objs)
    inner = S.find_interior(objs, box)
    assets = S.polyhaven_assets(job.get("polyhavenDir"))
    if inner:
        S.fix_mirrors(objs, spec, (inner[0] + inner[1]) / 2)
    mr = job.get("mirrorRoughness")  # optional override; default = per mirror kind (w3d_bscene.mirror_mat)
    S.apply_materials(objs, spec, assets, job.get("libraryDir"), job.get("materials"), float(mr) if mr is not None else None)
    S.setup_world(assets)
    lights = S.add_fill_light(inner, box, glossy_ok=not S.has_mirror(spec, objs))
    device = S.setup_render(int(job["width"]), int(job["height"]), int(job["samples"]), job.get("device", "auto"),
                            float(job.get("exposure", 0.6)) + EXPOSURE_OFFSET.get(view.get("preset"), 0.0), job["out"])

    f = S.front_axis(objs, inner) if inner else Vector((0, -1, 0))
    if view.get("orbit"):
        cam = orbit_camera(view["orbit"], box, inner, objs, attempt)
    elif inner:
        cam = interior_preset(view.get("preset", "overview"), box, inner, f, S.cop_box(objs), attempt)
    else:
        if view.get("preset") in INTERIOR_ONLY:
            S.warn("Không tìm thấy lòng trong của mô hình (không có sàn/trần khép kín): góc nội thất chụp từ bên ngoài.")
        az, el = EXTERIOR_PRESET.get(view.get("preset", "overview"), (35, 20))
        cam = exterior(box, az, el) if attempt == 0 else exterior(box, 35, 25)
    if cam is not None and view.get("preset") == "pano" and cam["mode"] != "pano":
        cam = None  # a solid model has no inside to stand in
    if cam is None:
        result({"ok": False, "skip": True, "error": "Mô hình không có bộ phận cho góc này (ví dụ thiếu COP)."}, 1)

    hidden = front_parts(objs, inner, f) if (cam.get("hide_front") and inner) else []
    for o in hidden:
        # removed for every ray, not only the camera: like a catalogue photo taken through the open front, the back and
        # side panels then reflect the soft studio HDRI instead of the hidden front mirrors (an endless mirror corridor)
        o.hide_render = True
    cd = bpy.data.cameras.new("cam")
    cd.sensor_width = 36
    cd.lens = cam["lens"]
    if cam["mode"] == "pano":
        cd.type = "PANO"
        try:
            cd.panorama_type = "EQUIRECTANGULAR"
        except Exception:  # noqa: BLE001 - older API keeps it on the Cycles scene settings
            bpy.context.scene.cycles.panorama_type = "EQUIRECTANGULAR"
    if job.get("format") == "jpg":
        bpy.context.scene.render.image_settings.file_format = "JPEG"
        bpy.context.scene.render.image_settings.quality = 90
    cd.clip_start = 0.01
    cd.clip_end = max(50.0, (box[1] - box[0]).length * 10)
    co = bpy.data.objects.new("cam", cd)
    bpy.context.scene.collection.objects.link(co)
    bpy.context.scene.camera = co
    co.location = cam["loc"]
    co.rotation_euler = (Vector(cam["tgt"]) - Vector(cam["loc"])).to_track_quat("-Z", "Y").to_euler()

    t = time.time()
    bpy.ops.render.render(write_still=True)
    if not os.path.isfile(job["out"]):
        result({"ok": False, "error": "Blender không ghi ra ảnh."}, 1)
    result({
        "ok": True, "view": view.get("name"), "mode": cam["mode"], "device": device, "hollow": bool(inner),
        "interior": S.INTERIOR_SOURCE.get("source"), "lights": lights,
        "renderSeconds": round(time.time() - t, 1), "seconds": round(time.time() - T0, 1), "hiddenParts": len(hidden),
        "camera": {"location": [round(v, 3) for v in cam["loc"]], "target": [round(v, 3) for v in cam["tgt"]], "lens": cam["lens"]},
        "warnings": S.WARNINGS,
    }, 0)


if __name__ == "__main__":  # bake_view.py imports the camera rules without rendering
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:  # noqa: BLE001
        traceback.print_exc()
        result({"ok": False, "error": f"{type(e).__name__}: {e}"[:600]}, 1)
