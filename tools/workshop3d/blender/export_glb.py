"""Write outputs/model-blender.glb: the session GLB with the photo materials of the high-quality render baked in.

Usage: blender -b --factory-startup -P export_glb.py -- <job.json>
job.json: {glb, materials|null, libraryDir|null, polyhavenDir|null, out, device}
Procedural Blender node setups do not survive glTF, so only what improves the viewer is changed (pilot export_glb.py,
generalised): parts with a photo / library texture (Poly Haven stone, user stone library) get their base colour baked
into a JPEG on a fresh planar UV map; mirrors get a clean glTF mirror (metallic 1, roughness 0.02); every other part keeps
the material of assemble_glb.py (its hairline / brushed textures). Prints `W3D_RESULT {json}`; the controller validates
the file with gltf-validator and keeps it only with 0 errors.
"""
import json
import os
import sys
import time
import traceback

sys.dont_write_bytecode = True  # never leave __pycache__ next to the shipped scripts
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

import bpy  # noqa: E402

import w3d_bscene as S  # noqa: E402

T0 = time.time()


def result(obj, code):
    print("W3D_RESULT " + json.dumps(obj, ensure_ascii=False), flush=True)
    os._exit(code)


def planar_uvs(o):
    """New UV map from world position on the part's main plane (0..1 over its box); the only UV map left."""
    ua, va, a, b = S.plane_axes(o)
    me = o.data
    for uv in list(me.uv_layers):
        me.uv_layers.remove(uv)
    layer = me.uv_layers.new(name="UVMap")
    mw = o.matrix_world
    du = max(1e-6, b[ua] - a[ua])
    dv = max(1e-6, b[va] - a[va])
    for loop in me.loops:
        p = mw @ me.vertices[loop.vertex_index].co
        layer.data[loop.index].uv = ((p[ua] - a[ua]) / du, (p[va] - a[va]) / dv)
    return layer


def principled(m):
    return next(n for n in m.node_tree.nodes if n.type == "BSDF_PRINCIPLED")


def main():
    job = json.load(open(sys.argv[sys.argv.index("--") + 1], encoding="utf-8"))
    objs = S.load_scene(job["glb"])
    spec = {}
    if job.get("materials") and os.path.isfile(job["materials"]):
        spec = json.load(open(job["materials"], encoding="utf-8")).get("materials", {})
    spec = S.inherit_materials(objs, spec)
    assets = S.polyhaven_assets(job.get("polyhavenDir"))
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    sc.cycles.device = "CPU"
    sc.cycles.samples = 1
    sc.cycles.use_denoising = False

    originals = {o.name: list(o.data.materials) for o in objs}
    changed = S.apply_materials(objs, spec, assets, job.get("libraryDir"), job.get("materials"),
                                only=lambda o, s: True)
    baked, mirrors = 0, 0
    for o in changed:
        m = o.data.materials[0]
        b = principled(m)
        if m.get("w3d_image"):
            a, bb = S.bbox(o)
            dims = sorted(bb - a, reverse=True)
            size = 1024 if dims[0] * dims[1] > 0.5 else 512
            # bake through the world-position mapping, then switch the material to the baked image on the new UVs
            img = bpy.data.images.new(S.part_id(o) + "_basecolor", size, size)
            nt = m.node_tree
            t = nt.nodes.new("ShaderNodeTexImage")
            t.image = img
            nt.nodes.active = t
            planar_uvs(o)
            bpy.ops.object.select_all(action="DESELECT")
            o.select_set(True)
            bpy.context.view_layer.objects.active = o
            sc.render.bake.use_pass_direct = False
            sc.render.bake.use_pass_indirect = False
            sc.render.bake.use_pass_color = True
            sc.render.bake.margin = 4
            bpy.ops.object.bake(type="DIFFUSE")
            img.file_format = "JPEG"
            img.pack()
            rough = b.inputs["Roughness"].default_value if not b.inputs["Roughness"].is_linked else 0.25
            for n in list(nt.nodes):
                if n.type not in ("OUTPUT_MATERIAL", "BSDF_PRINCIPLED") and n != t:
                    nt.nodes.remove(n)
            nt.links.new(t.outputs["Color"], b.inputs["Base Color"])
            b.inputs["Roughness"].default_value = rough
            b.inputs["Metallic"].default_value = 0.0
            baked += 1
            continue
        s = spec.get(S.part_id(o), {})
        if S.is_mirror(s):
            for n in list(m.node_tree.nodes):
                if n.type not in ("OUTPUT_MATERIAL", "BSDF_PRINCIPLED"):
                    m.node_tree.nodes.remove(n)
            b.inputs["Base Color"].default_value = (0.9, 0.905, 0.91, 1)
            b.inputs["Metallic"].default_value = 1.0
            b.inputs["Roughness"].default_value = 0.02
            mirrors += 1
            continue
        # every other part: put the material assemble_glb.py wrote back (hairline / brushed textures survive glTF)
        o.data.materials.clear()
        for mat in originals.get(o.name, []):
            o.data.materials.append(mat)
    restored = sum(1 for o in changed if not o.data.materials or not o.data.materials[0].name.endswith("_hq"))
    bpy.ops.export_scene.gltf(filepath=job["out"], export_format="GLB", use_selection=False, export_cameras=False,
                              export_lights=False, export_image_format="AUTO", export_yup=True, export_apply=True)
    if not os.path.isfile(job["out"]):
        result({"ok": False, "error": "Blender không ghi ra GLB."}, 1)
    result({"ok": True, "baked": baked, "mirrors": mirrors, "restored": restored, "bytes": os.path.getsize(job["out"]),
            "seconds": round(time.time() - T0, 1), "warnings": S.WARNINGS}, 0)


try:
    main()
except SystemExit:
    raise
except Exception as e:  # noqa: BLE001
    traceback.print_exc()
    result({"ok": False, "error": f"{type(e).__name__}: {e}"[:600]}, 1)
