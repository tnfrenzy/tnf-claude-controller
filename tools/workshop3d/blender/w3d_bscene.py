"""Shared Blender scene setup of the 3D workshop high-quality step (render_view.py, export_glb.py).

Runs INSIDE Blender (bpy). Adapted from the Blender pilot (D:\\tnf-claude-workspace\\pilot-blender\\scripts\\render_blender.py)
but generic: no part names are hard-coded except a few hints (door, COP, screen, lamp), everything else comes from
materials.json (written by the material-artist role) and from the geometry.

Frames: the GLB is metres, +Y up, origin at the centre of the floor (assemble_glb.py). The glTF importer turns it into
Blender's +Z up: blender (x, y, z) = (gx, -gz, gy).

Materials (materials.json `materials[<part id>]`, see role-output.ts W3DMaterial):
- `emissive` -> emission (panel / lamp / LED strength by size and name hint; a screen becomes dark glass)
- metallic >= 0.9 and roughness <= 0.08 -> mirror (pushed 1.5 mm off a coplanar frame to avoid z-fighting): roughness
  <= 0.01 a glass mirror, else mirror stainless (mirror_kind)
- `library` -> image set of the user's material library (albedo.png [normal.png roughness.png] meta.json {tile_cm, mapping})
- texture.kind granite / marble -> Poly Haven CC0 photo texture when present in <polyhaven dir>, else procedural
- texture.kind hairline / brushed -> procedural anisotropic brushed steel (Poly Haven has no brushed stainless)
- opacity < 1 -> glass (transmission)
- everything else -> plain Principled BSDF
Missing assets never fail: the material falls back to the procedural one and a Vietnamese warning is recorded.
"""
import json
import math
import os
import re

import bpy
from mathutils import Vector

import w3d_blight as L

WARNINGS = []


def warn(msg):
    if msg not in WARNINGS:
        WARNINGS.append(msg)


# ---------------------------------------------------------------- scene / geometry
def load_scene(glb):
    bpy.ops.wm.read_factory_settings(use_empty=True)
    bpy.ops.import_scene.gltf(filepath=glb)
    return [o for o in bpy.data.objects if o.type == "MESH"]


def part_id(o):
    """glTF node name = part id; Blender may add a .001 suffix to duplicates."""
    return re.sub(r"\.\d{3}$", "", o.name)


def bbox(o):
    cs = [o.matrix_world @ Vector(c) for c in o.bound_box]
    return (Vector([min(c[i] for c in cs) for i in range(3)]), Vector([max(c[i] for c in cs) for i in range(3)]))


def scene_box(objs):
    mn = Vector((math.inf,) * 3)
    mx = Vector((-math.inf,) * 3)
    for o in objs:
        a, b = bbox(o)
        for i in range(3):
            mn[i] = min(mn[i], a[i])
            mx[i] = max(mx[i], b[i])
    return mn, mx


FLOOR_RE = re.compile(r"(^|_)(san|floor|sol)(_|$)", re.I)
CEIL_RE = re.compile(r"(^|_)(tran|ceiling|roof)(_|$)", re.I)
FIXTURE_RE = re.compile(r"(^|_)(den|lamp|light|led|spot|quat|fan)(_|$)", re.I)
RAY_DIRS = ((1, 0, 0), (-1, 0, 0), (0, 1, 0), (0, -1, 0), (0, 0, 1), (0, 0, -1))
# Off-axis jitter of the probing rays (metres). Symmetric models have panel seams exactly on the axes through the
# centre (two back panels meeting at x = 0, four door leaves meeting at x = 0): a single ray from the exact centre slips
# through the seam. Odd, unequal offsets never all land in the same seam.
RAY_JITTER = ((0.0, 0.0), (0.023, 0.011), (-0.017, 0.031), (0.041, -0.027), (-0.036, -0.019))
INTERIOR_SOURCE = {"source": None}


def _median(v):
    s = sorted(v)
    n = len(s)
    return s[n // 2] if n % 2 else (s[n // 2 - 1] + s[n // 2]) / 2


def _flat_parts(objs, rx):
    """Large horizontal plates whose id matches rx (floor / ceiling), lamps and fixtures excluded."""
    out = []
    for o in objs:
        pid = part_id(o)
        if not rx.search(pid) or FIXTURE_RE.search(pid):
            continue
        a, b = bbox(o)
        e = b - a
        if e.x * e.y >= 0.25 and e.z <= 0.25 * min(e.x, e.y):
            out.append((a, b))
    return out


def interior_hint(objs):
    """Interior box from the parts named like the cabin floor and ceiling (name hints, no rays): xy = overlap of the
    largest ceiling and the floor under it, z = floor top .. ceiling underside. None without a usable pair."""
    ceils = _flat_parts(objs, CEIL_RE)
    floors = _flat_parts(objs, FLOOR_RE)
    if not ceils or not floors:
        return None
    ca, cb = max(ceils, key=lambda p: (p[1].x - p[0].x) * (p[1].y - p[0].y))

    def overlap(p):
        a, b = p
        w = min(b.x, cb.x) - max(a.x, ca.x)
        d = min(b.y, cb.y) - max(a.y, ca.y)
        return w * d if (w > 0 and d > 0 and b.z < ca.z) else 0.0

    fa, fb = max(floors, key=overlap)
    if overlap((fa, fb)) <= 0:
        return None
    imn = Vector((max(fa.x, ca.x), max(fa.y, ca.y), fb.z))
    imx = Vector((min(fb.x, cb.x), min(fb.y, cb.y), ca.z))
    if min(imx[i] - imn[i] for i in range(3)) < 0.3:
        return None
    return imn, imx


def _probe(c, box, dg):
    """Box of free space around c from 6 axis directions x 5 jittered rays; per direction the median of the inward hits
    (at least 2 of 5). Returns (directions hit, box) or None when c does not look enclosed."""
    mn, mx = box
    far = (mx - mn).length * 2
    sc = bpy.context.scene
    imn, imx = mn.copy(), mx.copy()
    n = 0
    for d in RAY_DIRS:
        dv = Vector(d)
        ax = next(i for i in range(3) if d[i] != 0)
        p, q = [i for i in range(3) if i != ax]
        hits = []
        for j0, j1 in RAY_JITTER:
            o = c.copy()
            o[p] += j0
            o[q] += j1
            ok, loc, nor, _i, _o, _m = sc.ray_cast(dg, o, dv, distance=far)
            if ok and nor.dot(dv) < 0:
                hits.append(loc[ax])
        if len(hits) >= 2:
            n += 1
            if d[ax] > 0:
                imx[ax] = _median(hits)
            else:
                imn[ax] = _median(hits)
    if n < 5 or min(imx[i] - imn[i] for i in range(3)) < 0.2:
        return None
    if not all(imn[i] < c[i] < imx[i] for i in range(3)):
        return None
    return n, (imn, imx)


def find_interior(objs, box):
    """Free interior box of a hollow model (cabin), None for a solid one.

    Probes many seed points (the centre of the floor/ceiling parts first, then a 5 x 5 x 2 grid over the scene with odd
    offsets) with jittered rays (_probe), keeps the largest enclosed box (most directions hit first) and the median of the
    boxes agreeing with it. When rays find nothing but the model has a floor and a ceiling part, their boxes are used
    (warning): an interior view must never fall back to an outside camera because of a seam. INTERIOR_SOURCE records how."""
    mn, mx = box
    dg = bpy.context.evaluated_depsgraph_get()
    hint = interior_hint(objs)
    seeds = []
    if hint:
        hmn, hmx = hint
        for fx, fy in ((0.5, 0.5), (0.37, 0.41), (0.63, 0.58)):
            seeds.append(Vector((hmn.x + fx * (hmx.x - hmn.x), hmn.y + fy * (hmx.y - hmn.y), hmn.z + 0.45 * (hmx.z - hmn.z))))
    seeds.append(Vector(((mn.x + mx.x) / 2 + 0.019, (mn.y + mx.y) / 2 + 0.013, mn.z + 0.45 * (mx.z - mn.z))))
    for fz in (0.37, 0.61):
        for fy in (0.13, 0.31, 0.5, 0.69, 0.87):
            for fx in (0.13, 0.31, 0.5, 0.69, 0.87):
                seeds.append(Vector((mn.x + fx * (mx.x - mn.x) + 0.011, mn.y + fy * (mx.y - mn.y) + 0.007, mn.z + fz * (mx.z - mn.z))))
    found = [r for r in (_probe(c, box, dg) for c in seeds) if r]

    def vol(b):
        e = b[1] - b[0]
        return e.x * e.y * e.z

    if found:
        best = max(found, key=lambda r: (r[0], vol(r[1])))[1]
        agree = [b for _n, b in found if all(abs(b[k][i] - best[k][i]) <= 0.05 for k in (0, 1) for i in range(3))]
        imn = Vector([_median([b[0][i] for b in agree]) for i in range(3)])
        imx = Vector([_median([b[1][i] for b in agree]) for i in range(3)])
        centre = (imn + imx) / 2
        if hint and not all(hint[0][i] <= centre[i] <= hint[1][i] for i in range(3)):
            warn("Lòng cabin đo bằng tia không nằm giữa sàn và trần: dùng hộp của bộ phận sàn/trần cho camera nội thất.")
            INTERIOR_SOURCE["source"] = "parts"
            return hint
        INTERIOR_SOURCE["source"] = "rays"
        return imn, imx
    if hint:
        warn("Không đo được lòng cabin bằng tia (khe hở hoặc mặt hở): dùng hộp của bộ phận sàn/trần cho camera nội thất.")
        INTERIOR_SOURCE["source"] = "parts"
        return hint
    INTERIOR_SOURCE["source"] = None
    return None


DOOR_RE = re.compile(r"(^|_)(canh_cua|cua|door)(_|$)", re.I)
COP_RE = re.compile(r"(^|_)cop(_|$)", re.I)


def front_axis(objs, inner):
    """Unit horizontal vector from the cabin centre towards the door (door-named parts), default glTF +Z = Blender -Y."""
    imn, imx = inner
    c = (imn + imx) / 2
    acc = Vector((0, 0, 0))
    for o in objs:
        if DOOR_RE.search(part_id(o)):
            a, b = bbox(o)
            acc += ((a + b) / 2) - c
    if acc.length < 1e-6:
        return Vector((0, -1, 0))
    if abs(acc.x) > abs(acc.y):
        return Vector((math.copysign(1, acc.x), 0, 0))
    return Vector((0, math.copysign(1, acc.y), 0))


def cop_box(objs):
    best, vol = None, 0.0
    for o in objs:
        if COP_RE.search(part_id(o)):
            a, b = bbox(o)
            v = max(1e-9, (b.x - a.x) * (b.y - a.y) * (b.z - a.z))
            if v > vol:
                best, vol = (a, b), v
    return best


def fix_mirrors(objs, spec, centre):
    """Mirror panels are often coplanar with their frame (z-fighting): push them 1.5 mm towards the centre."""
    for o in objs:
        s = spec.get(part_id(o))
        if not s or not is_mirror(s):
            continue
        a, b = bbox(o)
        ext = b - a
        k = min(range(3), key=lambda i: ext[i])
        mid = (a + b) / 2
        d = Vector((0, 0, 0))
        d[k] = -math.copysign(1, mid[k] - centre[k]) if abs(mid[k] - centre[k]) > 1e-6 else 0
        o.location += d * 0.0015


# ---------------------------------------------------------------- materials
def _tools_on_path():
    import sys
    tools = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if tools not in sys.path:
        sys.path.insert(0, tools)


def inherit_materials(objs, spec):
    """materials.json entries for every mesh, with the SAME inheritance rule as assemble_glb.py (w3d_matinherit.py): a
    part the CAD script added (bumper_left_soc) takes its parent's material instead of the GLB's grey. Adds the report
    lines to WARNINGS; returns the expanded spec."""
    _tools_on_path()
    import w3d_matinherit as mi
    ids = sorted({part_id(o) for o in objs})
    resolved, inherited, unresolved = mi.resolve(spec, ids)
    for w in mi.warnings_for(inherited, unresolved):
        warn(w)
    out = dict(spec)
    out.update(resolved)
    return out


def is_mirror(s):
    return s.get("metallic", 0) >= 0.9 and s.get("roughness", 0.5) <= 0.08 and "emissive" not in s


def new_mat(name):
    m = bpy.data.materials.new(name + "_hq")
    m.use_nodes = True
    nt = m.node_tree
    for n in list(nt.nodes):
        nt.nodes.remove(n)
    out = nt.nodes.new("ShaderNodeOutputMaterial")
    bsdf = nt.nodes.new("ShaderNodeBsdfPrincipled")
    nt.links.new(bsdf.outputs[0], out.inputs[0])
    return m, nt, bsdf


def vec_const(nt, v):
    c = nt.nodes.new("ShaderNodeCombineXYZ")
    for i in range(3):
        c.inputs[i].default_value = v[i]
    return c.outputs[0]


def plane_axes(o):
    """The two largest world axes of a part (its main face), largest first."""
    a, b = bbox(o)
    ext = b - a
    order = sorted(range(3), key=lambda i: -ext[i])
    return order[0], order[1], a, b


def planar_uv(nt, o, mode, tile_m=1.0, crop=(0.0, 0.0, 1.0, 1.0)):
    """UV from world position on the part's main plane. mode 'tile': tile_m metres per repeat; 'fit': the part's box maps
    once onto the crop rectangle (u0, v0, u1, v1) of the image."""
    ua, va, a, b = plane_axes(o)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    sep = nt.nodes.new("ShaderNodeSeparateXYZ")
    nt.links.new(geo.outputs["Position"], sep.inputs[0])
    comb = nt.nodes.new("ShaderNodeCombineXYZ")
    nt.links.new(sep.outputs[ua], comb.inputs[0])
    nt.links.new(sep.outputs[va], comb.inputs[1])
    mp = nt.nodes.new("ShaderNodeMapping")
    nt.links.new(comb.outputs[0], mp.inputs["Vector"])
    if mode == "fit":
        u0, v0, u1, v1 = crop
        su = (u1 - u0) / max(1e-6, b[ua] - a[ua])
        sv = (v1 - v0) / max(1e-6, b[va] - a[va])
        mp.inputs["Scale"].default_value = (su, sv, 1)
        mp.inputs["Location"].default_value = (u0 - a[ua] * su, v0 - a[va] * sv, 0)
    else:
        s = 1.0 / max(0.01, tile_m)
        mp.inputs["Scale"].default_value = (s, s, 1)
    return mp.outputs[0]


def image_node(nt, path, uv, noncolor, extend):
    t = nt.nodes.new("ShaderNodeTexImage")
    t.image = bpy.data.images.load(path, check_existing=True)
    if noncolor:
        t.image.colorspace_settings.name = "Non-Color"
    t.extension = "EXTEND" if extend else "REPEAT"
    nt.links.new(uv, t.inputs["Vector"])
    return t


def lum(col):
    return 0.2126 * col[0] + 0.7152 * col[1] + 0.0722 * col[2]


GLASS_MIRROR_MAX_ROUGH = 0.01
MIRROR_STEEL_WAVE = 0.25  # bump strength of the mirror stainless waviness
MIRROR_STEEL_DEEP_ROUGH = 0.25  # extra roughness of a mirror stainless panel seen in another mirror


def mirror_kind(s):
    """'glass' = a true glass mirror (roughness <= 0.01 in materials.json); 'steel' = mirror stainless (inox guong), the
    usual cabin panel: it reflects much less than a glass mirror and is never perfectly flat."""
    return "glass" if s.get("roughness", 0.5) <= GLASS_MIRROR_MAX_ROUGH else "steel"


def mirror_mat(name, kind, rough=None):
    """Glass mirror: bright, sharp. Mirror stainless: reflectance ~0.68, slight blur, much blurrier when seen in another
    mirror (no endless corridor), and a very low-frequency waviness of the normal (real panels are not optically flat)
    that gives the soft light/dark bands of a stainless photo."""
    m, nt, b = new_mat(name)
    b.inputs["Metallic"].default_value = 1.0
    if kind == "glass":
        b.inputs["Base Color"].default_value = (0.86, 0.865, 0.87, 1)
        b.inputs["Roughness"].default_value = 0.0 if rough is None else rough
        return m
    b.inputs["Base Color"].default_value = (0.68, 0.685, 0.69, 1)
    r0 = 0.08 if rough is None else rough
    # a reflection seen in another mirror panel is much blurrier (glossy depth >= 1): facing panels then show one clear
    # reflection and a soft grey beyond it, not an endless sharp corridor that fades to black
    lp = nt.nodes.new("ShaderNodeLightPath")
    gt = nt.nodes.new("ShaderNodeMath")
    gt.operation = "GREATER_THAN"
    gt.inputs[1].default_value = 0.5
    nt.links.new(lp.outputs["Glossy Depth"], gt.inputs[0])
    ra = nt.nodes.new("ShaderNodeMath")
    ra.operation = "MULTIPLY_ADD"
    ra.inputs[1].default_value = MIRROR_STEEL_DEEP_ROUGH
    ra.inputs[2].default_value = r0
    nt.links.new(gt.outputs[0], ra.inputs[0])
    nt.links.new(ra.outputs[0], b.inputs["Roughness"])
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (2.2, 2.2, 0.35)  # stretched vertically: soft vertical light/dark bands
    nt.links.new(geo.outputs["Position"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 1.0
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = MIRROR_STEEL_WAVE
    bump.inputs["Distance"].default_value = 0.02
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])
    return m


def brushed_mat(name, col, rough, axis, fine=900.0, strength=0.12, aniso=0.75, contrast=0.72):
    """Hairline / brushed stainless: streak noise stretched along `axis` (0=x, 1=y, 2=z)."""
    m, nt, b = new_mat(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mp = nt.nodes.new("ShaderNodeMapping")
    sc = [fine, fine, fine]
    sc[axis] = 3.0
    mp.inputs["Scale"].default_value = sc
    nt.links.new(geo.outputs["Position"], mp.inputs["Vector"])
    nz = nt.nodes.new("ShaderNodeTexNoise")
    nz.inputs["Scale"].default_value = 1.0
    nz.inputs["Detail"].default_value = 6.0
    nz.inputs["Roughness"].default_value = 0.6
    nt.links.new(mp.outputs[0], nz.inputs["Vector"])
    bump = nt.nodes.new("ShaderNodeBump")
    bump.inputs["Strength"].default_value = strength
    bump.inputs["Distance"].default_value = 0.0005
    nt.links.new(nz.outputs["Fac"], bump.inputs["Height"])
    nt.links.new(bump.outputs[0], b.inputs["Normal"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    ramp.color_ramp.elements[0].position = 0.3
    ramp.color_ramp.elements[0].color = (col[0] * contrast, col[1] * contrast, col[2] * contrast, 1)
    ramp.color_ramp.elements[1].position = 0.7
    ramp.color_ramp.elements[1].color = (col[0], col[1], col[2], 1)
    nt.links.new(nz.outputs["Fac"], ramp.inputs[0])
    nt.links.new(ramp.outputs[0], b.inputs["Base Color"])
    rmap = nt.nodes.new("ShaderNodeMapRange")
    # clamped like every non-mirror metal (w3d_blight): the streaks never dip into a near-mirror
    metal, rough = L.clamp_metal(1.0, rough)
    rmap.inputs["To Min"].default_value = max(L.METAL_ROUGH_MIN, rough * 0.75)
    rmap.inputs["To Max"].default_value = rough * 1.25
    nt.links.new(nz.outputs["Fac"], rmap.inputs["Value"])
    nt.links.new(rmap.outputs[0], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = metal
    b.inputs["Anisotropic"].default_value = aniso
    t = [0, 0, 0]
    t[axis] = 1
    nt.links.new(vec_const(nt, t), b.inputs["Tangent"])
    return m


def is_black_stone(col):
    """Black granite (the role prompt's black is [0.05, 0.05, 0.055]; older prompts asked [0.08, 0.08, 0.09])."""
    return lum(col) < 0.09


def stone_ramp(nt, col, black):
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    if black:  # polished black granite: almost black body, sparse grey and white flecks
        stops = [(0.0, (0.003, 0.003, 0.0035)), (0.70, (0.012, 0.012, 0.014)), (0.90, (0.035, 0.035, 0.04)), (1.0, (0.22, 0.22, 0.23))]
    else:
        # recolour the photo's luminance around the asked colour. A polished red granite photographs as a dark red-brown
        # with black grains and a few greyish crystals, so the asked colour sits at the bright end and most of the stone
        # is darker; a light top end desaturates towards grey instead of going pink.
        k = [max(0.02, v) for v in col[:3]]
        g = sum(k) / 3
        stops = [(0.0, tuple(v * 0.03 for v in k)), (0.28, tuple(v * 0.16 for v in k)), (0.55, tuple(v * 0.36 for v in k)),
                 (0.82, tuple(v * 0.72 for v in k)), (1.0, tuple(min(1, 0.55 * v + 0.45 * g + 0.05) for v in k))]
    cr.elements[0].position, cr.elements[0].color = stops[0][0], (*stops[0][1], 1)
    cr.elements[1].position, cr.elements[1].color = stops[-1][0], (*stops[-1][1], 1)
    for p, c in stops[1:-1]:
        e = cr.elements.new(p)
        e.color = (*c, 1)
    return ramp


FLOOR_GLOSSY_SATURATION = 0.45  # saturation of a stone colour seen in a metal reflection


def glossy_muted(nt, colour):
    """Colour of a strongly coloured floor as seen in metal reflections: half saturation and a bit darker. A bright red
    floor otherwise tints every stainless trim and the ceiling battens red-brown, which a catalogue photo never shows
    (its studio lighting dominates); the camera still sees the true colour."""
    hsv = nt.nodes.new("ShaderNodeHueSaturation")
    hsv.inputs["Saturation"].default_value = FLOOR_GLOSSY_SATURATION
    hsv.inputs["Value"].default_value = 0.85
    nt.links.new(colour, hsv.inputs["Color"])
    lp = nt.nodes.new("ShaderNodeLightPath")
    mix = nt.nodes.new("ShaderNodeMix")
    mix.data_type = "RGBA"
    nt.links.new(lp.outputs["Is Glossy Ray"], mix.inputs["Factor"])
    nt.links.new(colour, mix.inputs[6])
    nt.links.new(hsv.outputs[0], mix.inputs[7])
    return mix.outputs[2]


def photo_stone_mat(name, o, asset, col, rough, recolour):
    """Poly Haven photo texture: granite tiles are cropped to one tile (no grout) and recoloured; marble tiles by size."""
    m, nt, b = new_mat(name)
    crop = asset.get("crop")
    uv = planar_uv(nt, o, "fit", crop=crop) if crop else planar_uv(nt, o, "tile", tile_m=float(asset.get("size_m", 1.0)))
    diff = image_node(nt, asset["files"]["diff"], uv, False, bool(crop))
    if recolour:
        bw = nt.nodes.new("ShaderNodeRGBToBW")
        nt.links.new(diff.outputs["Color"], bw.inputs[0])
        mr = nt.nodes.new("ShaderNodeMapRange")
        mr.inputs["From Min"].default_value = 0.025
        mr.inputs["From Max"].default_value = 0.16
        nt.links.new(bw.outputs[0], mr.inputs["Value"])
        ramp = stone_ramp(nt, col, is_black_stone(col))
        nt.links.new(mr.outputs[0], ramp.inputs[0])
        base = ramp.outputs[0]
    else:
        base = diff.outputs["Color"]
    nt.links.new(glossy_muted(nt, base), b.inputs["Base Color"])
    if asset["files"].get("nor"):
        nor = image_node(nt, asset["files"]["nor"], uv, True, bool(crop))
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.15
        nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], b.inputs["Normal"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Specular IOR Level"].default_value = 0.5
    m["w3d_image"] = 1
    return m


def marble_mat(name, o, col, rough, tile_m=0.9):
    """Procedural polished marble in the ASKED colour: veins from a distorted wave texture. The Poly Haven photo
    (marble_01) is a beige limestone slab with grout lines, so using it made every marble beige-brown whatever
    materials.json said. Black marble: near-black body, white veins. Light marble: the body colour, soft grey veins."""
    m, nt, b = new_mat(name)
    geo = nt.nodes.new("ShaderNodeNewGeometry")
    mp = nt.nodes.new("ShaderNodeMapping")
    mp.inputs["Scale"].default_value = (1.0 / tile_m,) * 3
    nt.links.new(geo.outputs["Position"], mp.inputs["Vector"])
    noise = nt.nodes.new("ShaderNodeTexNoise")
    noise.inputs["Scale"].default_value = 2.2
    noise.inputs["Detail"].default_value = 8.0
    noise.inputs["Roughness"].default_value = 0.6
    nt.links.new(mp.outputs[0], noise.inputs["Vector"])
    wave = nt.nodes.new("ShaderNodeTexWave")
    wave.wave_type = "BANDS"
    wave.bands_direction = "DIAGONAL"
    wave.inputs["Scale"].default_value = 2.2
    wave.inputs["Distortion"].default_value = 7.0
    wave.inputs["Detail"].default_value = 3.0
    wave.inputs["Detail Scale"].default_value = 1.4
    nt.links.new(mp.outputs[0], wave.inputs["Vector"])
    nt.links.new(noise.outputs["Fac"], wave.inputs["Phase Offset"])
    ramp = nt.nodes.new("ShaderNodeValToRGB")
    cr = ramp.color_ramp
    k = [max(0.003, v) for v in col[:3]]
    if is_black_stone(col):
        body, vein, soft = (0.004, 0.004, 0.0045), (0.82, 0.83, 0.85), (0.02, 0.02, 0.022)
    else:
        body, vein, soft = tuple(k), tuple(max(0.0, v * 0.62) for v in k), tuple(v * 0.9 for v in k)
    cr.elements[0].position, cr.elements[0].color = 0.0, (*body, 1)
    cr.elements[1].position, cr.elements[1].color = 0.985, (*vein, 1)
    e = cr.elements.new(0.94)
    e.color = (*soft, 1)
    e = cr.elements.new(0.60)
    e.color = (*body, 1)
    nt.links.new(wave.outputs["Fac"], ramp.inputs[0])
    nt.links.new(glossy_muted(nt, ramp.outputs[0]), b.inputs["Base Color"])
    b.inputs["Roughness"].default_value = rough
    b.inputs["Metallic"].default_value = 0.0
    b.inputs["Specular IOR Level"].default_value = 0.5
    return m


def library_mat(name, o, d, s):
    """User material library folder: albedo.png [normal.png roughness.png] meta.json {tile_cm, mapping: tile|fit}."""
    meta = {}
    try:
        with open(os.path.join(d, "meta.json"), encoding="utf-8") as f:
            meta = json.load(f)
    except Exception:
        pass
    mode = "fit" if meta.get("mapping") == "fit" else "tile"
    tile_m = float(meta.get("tile_cm") or (s.get("texture") or {}).get("scale") or 60) / 100.0
    m, nt, b = new_mat(name)
    uv = planar_uv(nt, o, mode, tile_m=tile_m)
    alb = image_node(nt, os.path.join(d, "albedo.png"), uv, False, mode == "fit")
    nt.links.new(alb.outputs["Color"], b.inputs["Base Color"])
    if os.path.isfile(os.path.join(d, "normal.png")):
        nor = image_node(nt, os.path.join(d, "normal.png"), uv, True, mode == "fit")
        nm = nt.nodes.new("ShaderNodeNormalMap")
        nm.inputs["Strength"].default_value = 0.3
        nt.links.new(nor.outputs["Color"], nm.inputs["Color"])
        nt.links.new(nm.outputs[0], b.inputs["Normal"])
    if os.path.isfile(os.path.join(d, "roughness.png")):
        r = image_node(nt, os.path.join(d, "roughness.png"), uv, True, mode == "fit")
        nt.links.new(r.outputs["Color"], b.inputs["Roughness"])
    else:
        b.inputs["Roughness"].default_value = s.get("roughness", 0.3)
    b.inputs["Metallic"].default_value = L.clamp_metal(s.get("metallic", 0.0), 0.5)[0]
    m["w3d_image"] = 1
    return m


PATTERN_KINDS = ("diamond_plate", "stripes")
PATTERN_PX = 512


def _array_image(name, arr, noncolor):
    """bpy image from a numpy HxWx3 (or HxW) 0..1 array whose row 0 is the top."""
    import numpy as np
    a = np.asarray(arr, dtype=np.float32)
    if a.ndim == 2:
        a = np.repeat(a[..., None], 3, axis=2)
    h, w = a.shape[:2]
    rgba = np.concatenate([a[::-1], np.ones((h, w, 1), dtype=np.float32)], axis=2)  # Blender rows go bottom-up
    img = bpy.data.images.new(name, width=w, height=h, alpha=False, float_buffer=False)
    if noncolor:
        img.colorspace_settings.name = "Non-Color"
    img.pixels.foreach_set(rgba.ravel())
    img.pack()
    return img


def pattern_mat(name, o, s, kind):
    """diamond_plate / stripes: the same numpy pattern as the GLB (w3d_textures.pattern_arrays) as packed images,
    tiled by texture.scale centimetres on the part's main plane."""
    _tools_on_path()
    import w3d_textures as tx
    tex = s.get("texture") or {}
    col = s.get("color", [0.7, 0.7, 0.7])[:3]
    c2 = tex.get("color2")
    albedo, normal, rough = tx.pattern_arrays(kind, col, px=PATTERN_PX, color2=c2[:3] if isinstance(c2, list) and len(c2) >= 3 else None)
    m, nt, b = new_mat(name)
    tile_m = tx.tile_cm(kind, tex.get("scale")) / 100.0
    uv = planar_uv(nt, o, "tile", tile_m=tile_m)
    if float(tex.get("angle") or 0) % 180 > 45:
        sw = nt.nodes.new("ShaderNodeMapping")  # 90 degrees: flip the diagonal / lug direction
        sw.inputs["Rotation"].default_value = (0, 0, math.radians(90))
        nt.links.new(uv, sw.inputs["Vector"])
        uv = sw.outputs[0]

    def img_node(img):
        t = nt.nodes.new("ShaderNodeTexImage")
        t.image = img
        t.extension = "REPEAT"
        nt.links.new(uv, t.inputs["Vector"])
        return t

    nt.links.new(img_node(_array_image(name + "_albedo", albedo, False)).outputs["Color"], b.inputs["Base Color"])
    nm = nt.nodes.new("ShaderNodeNormalMap")
    nm.inputs["Strength"].default_value = 1.0
    nt.links.new(img_node(_array_image(name + "_normal", normal, True)).outputs["Color"], nm.inputs["Color"])
    nt.links.new(nm.outputs[0], b.inputs["Normal"])
    rm = nt.nodes.new("ShaderNodeMath")
    rm.operation = "MULTIPLY"
    rm.inputs[1].default_value = float(s.get("roughness", 0.5))
    nt.links.new(img_node(_array_image(name + "_rough", rough, True)).outputs["Color"], rm.inputs[0])
    nt.links.new(rm.outputs[0], b.inputs["Roughness"])
    b.inputs["Metallic"].default_value = L.clamp_metal(float(s.get("metallic", 0.0)), 0.5)[0]
    m["w3d_image"] = 1
    return m


def emissive_mat(name, col, em, strength):
    m, nt, b = new_mat(name)
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = 0.5
    b.inputs["Emission Color"].default_value = (*em, 1)
    b.inputs["Emission Strength"].default_value = strength
    return m


def glass_mat(name, col, rough, opacity):
    m, nt, b = new_mat(name)
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Roughness"].default_value = rough
    b.inputs["Transmission Weight"].default_value = max(0.0, min(1.0, 1.0 - opacity * 0.6))
    b.inputs["IOR"].default_value = 1.5
    return m


def plain_mat(name, col, metal, rough):
    metal, rough = L.clamp_metal(metal, rough)
    m, nt, b = new_mat(name)
    b.inputs["Base Color"].default_value = (*col, 1)
    b.inputs["Metallic"].default_value = metal
    b.inputs["Roughness"].default_value = rough
    return m


def resolve_library(value, library_dir, materials_path):
    if not value or ".." in re.split(r"[\\/]", value):
        return None
    if os.path.isabs(value):
        return value if os.path.isdir(value) else None
    for base in (library_dir, os.path.dirname(os.path.abspath(materials_path)) if materials_path else None):
        if base:
            d = os.path.join(base, value)
            if os.path.isfile(os.path.join(d, "albedo.png")):
                return d
    return None


def polyhaven_assets(ph_dir):
    """Poly Haven folder written by `tnf w3d fetch-assets`: <dir>/<id>/meta.json {id, type, use, files: {diff, nor, rough, hdr}}."""
    out = {}
    if not ph_dir or not os.path.isdir(ph_dir):
        return out
    for name in sorted(os.listdir(ph_dir)):
        mp = os.path.join(ph_dir, name, "meta.json")
        try:
            with open(mp, encoding="utf-8") as f:
                meta = json.load(f)
        except Exception:
            continue
        files = {k: os.path.join(ph_dir, name, v) for k, v in (meta.get("files") or {}).items() if isinstance(v, str)}
        if not all(os.path.isfile(p) for p in files.values()):
            continue
        meta["files"] = files
        out[meta.get("id", name)] = meta
    return out


def asset_for(assets, use, col=None):
    """First asset serving a texture kind; for granite a light neutral colour prefers a grey stone ('granite_light')."""
    if use == "granite" and col is not None and lum(col) > 0.35 and max(col[:3]) - min(col[:3]) < 0.08:
        for a in assets.values():
            if a.get("use") == "granite_light" and "diff" in a["files"]:
                return a
    for a in assets.values():
        if a.get("use") == use and "diff" in a["files"]:
            return a
    return None


EMISSION_PANEL = 1.4  # W/m2-ish emission strength of ceiling diffusers (area >= 0.03 m2)
EMISSION_LAMP = 10.0  # small parts named like a lamp (downlights)
EMISSION_SMALL = 4.0  # other small emissive parts (LED rings, buttons)

SCREEN_RE = re.compile(r"(man_hinh|screen|display|lcd)", re.I)
LAMP_RE = re.compile(r"(den|lamp|light|spot)", re.I)


def material_for(o, s, assets, library_dir, materials_path, mirror_rough):
    pid = part_id(o)
    col = s.get("color", [0.7, 0.7, 0.7])[:3]
    metal, rough = s.get("metallic", 0.0), s.get("roughness", 0.5)
    tex = s.get("texture") or {}
    a, b = bbox(o)
    ext = b - a
    dims = sorted(ext, reverse=True)
    area = dims[0] * dims[1]
    if "emissive" in s:
        if SCREEN_RE.search(pid):
            return plain_mat(pid, (0.01, 0.01, 0.012), 0.0, 0.08)
        # large diffuser panels stay just above white under AgX so their frames and battens still read
        strength = EMISSION_PANEL if area >= 0.03 else (EMISSION_LAMP if LAMP_RE.search(pid) else EMISSION_SMALL)
        return emissive_mat(pid, col, s["emissive"], strength)
    if s.get("library"):
        d = resolve_library(s["library"], library_dir, materials_path)
        if d:
            return library_mat(pid, o, d, s)
        warn(f"Không thấy thư mục thư viện vật liệu '{s['library']}' (cần albedo.png): dùng vật liệu thủ tục.")
    if is_mirror(s):
        return mirror_mat(pid, mirror_kind(s), mirror_rough)
    if s.get("opacity", 1.0) < 0.95:
        return glass_mat(pid, col, rough, s["opacity"])
    kind = tex.get("kind")
    if kind in PATTERN_KINDS:
        try:
            return pattern_mat(pid, o, s, kind)
        except Exception as e:  # noqa: BLE001 - a pattern failure never fails the render
            warn(f"Không dựng được texture {kind} trong Blender ({e}): dùng màu phẳng.")
    if kind == "marble":
        return marble_mat(pid, o, col, min(max(rough, 0.04), 0.2))
    if kind in ("granite", "marble"):
        asset = asset_for(assets, kind, col)
        if asset:
            recolour = kind == "granite" and asset.get("use") == "granite"
            # polished stone: black granite trims look glossy black only with a low roughness
            srough = (0.05 if is_black_stone(col) else 0.1) if kind == "granite" else 0.1
            return photo_stone_mat(pid, o, asset, col, srough, recolour)
        warn(f"Thiếu tài nguyên Poly Haven cho đá ({kind}): dùng vật liệu thủ tục, kém đẹp hơn. Chạy: tnf w3d fetch-assets --yes")
    if kind in ("hairline", "brushed"):
        if tex.get("angle", 0) == 0 and ext.z > 0.05:
            axis = 2
        else:
            axis = 0 if ext.x >= ext.y else 1
        if kind == "hairline":
            # fine hairline: clearly duller and streakier than the mirror panels it frames
            return brushed_mat(pid, [c * 0.82 for c in col], 0.3, axis)
        return brushed_mat(pid, col, 0.18, axis, fine=1500.0, strength=0.03, aniso=0.6, contrast=0.86)
    return plain_mat(pid, col, metal, rough)


def apply_materials(objs, spec, assets, library_dir, materials_path, mirror_rough=None, only=None):
    """Assign a Blender material to every part with a spec; `only(o, s)` filters parts. Returns the parts changed."""
    done = []
    for o in objs:
        s = spec.get(part_id(o))
        if s is None or (only and not only(o, s)):
            continue
        m = material_for(o, s, assets, library_dir, materials_path, mirror_rough)
        o.data.materials.clear()
        o.data.materials.append(m)
        done.append(o)
    return done


# ---------------------------------------------------------------- world, lights, render settings
HDRI_ROTATION_DEG = 325.0  # studio_small_09: a soft box lands obliquely on the side panels (light/dark gradient)
BACKDROP_LINEAR = (0.776, 0.807, 0.855)  # sRGB #e4e8ee (the fast renders' backdrop) in linear light
BACKDROP_STRENGTH = 0.75  # under AgX + the default exposure this displays close to #e4e8ee, not white


def setup_world(assets, strength=0.3):
    sc = bpy.context.scene
    world = bpy.data.worlds.new("hq_world")
    sc.world = world
    world.use_nodes = True
    wn = world.node_tree
    for n in list(wn.nodes):
        wn.nodes.remove(n)
    bg = wn.nodes.new("ShaderNodeBackground")
    bg.inputs["Strength"].default_value = strength
    wo = wn.nodes.new("ShaderNodeOutputWorld")
    hdri = next((a for a in assets.values() if a.get("type") == "hdri" and "hdr" in a["files"]), None)
    if hdri:
        env = wn.nodes.new("ShaderNodeTexEnvironment")
        env.image = bpy.data.images.load(hdri["files"]["hdr"])
        tc = wn.nodes.new("ShaderNodeTexCoord")
        rot = wn.nodes.new("ShaderNodeMapping")
        rot.inputs["Rotation"].default_value = (0, 0, math.radians(HDRI_ROTATION_DEG))
        wn.links.new(tc.outputs["Generated"], rot.inputs["Vector"])
        wn.links.new(rot.outputs[0], env.inputs["Vector"])
        wn.links.new(env.outputs[0], bg.inputs[0])
        # the studio photo lights the model and shows in its reflections, but the camera itself sees a clean, light
        # neutral backdrop (like the fast renders' #e4e8ee) instead of the studio's equipment, cables and dark walls
        plain = wn.nodes.new("ShaderNodeBackground")
        plain.inputs["Color"].default_value = (*BACKDROP_LINEAR, 1)
        plain.inputs["Strength"].default_value = BACKDROP_STRENGTH
        lp = wn.nodes.new("ShaderNodeLightPath")
        mix = wn.nodes.new("ShaderNodeMixShader")
        wn.links.new(lp.outputs["Is Camera Ray"], mix.inputs[0])
        wn.links.new(bg.outputs[0], mix.inputs[1])
        wn.links.new(plain.outputs[0], mix.inputs[2])
        wn.links.new(mix.outputs[0], wo.inputs[0])
        return
    bg.inputs["Color"].default_value = (0.55, 0.55, 0.56, 1)
    warn("Thiếu HDRI studio (Poly Haven): dùng nền xám đơn sắc, phản chiếu kém sinh động hơn. Chạy: tnf w3d fetch-assets --yes")
    wn.links.new(bg.outputs[0], wo.inputs[0])


def has_mirror(spec, objs):
    return any(is_mirror(spec.get(part_id(o)) or {}) for o in objs)


def add_fill_light(inner, box, glossy_ok=False):
    """Hollow model: lights hidden from the camera, power from the size of the interior (w3d_blight.interior_lights): a
    soft panel just under the ceiling (seen by the brushed stainless reflections only when the cabin has no mirror panel,
    `glossy_ok`) and an up-light near the floor for the ceiling and the upper walls. Solid model: one soft area light above
    the front. Returns the lights (for the result line)."""
    sc = bpy.context.scene
    if inner:
        imn, imx = inner
        made = []
        for spec in L.interior_lights(imx.x - imn.x, imx.y - imn.y, imx.z - imn.z, glossy_ok):
            ld = bpy.data.lights.new(spec["name"], "AREA")
            ld.shape = "RECTANGLE"
            ld.color = (1.0, 0.97, 0.93)
            ld.size, ld.size_y, ld.energy = spec["size"], spec["size_y"], spec["energy"]
            lo = bpy.data.objects.new(spec["name"], ld)
            lo.location = ((imn.x + imx.x) / 2, (imn.y + imx.y) / 2, imn.z + spec["z"])
            if spec["up"]:
                lo.rotation_euler = (math.pi, 0, 0)  # area lights shine along -Z: flipped, it lights the ceiling
            # never seen by the camera: the ceiling, its lamps and the floor stay visible
            lo.visible_camera = False
            lo.visible_glossy = spec["glossy"]
            sc.collection.objects.link(lo)
            made.append({k: spec[k] for k in ("name", "energy", "glossy")})
        return made
    ld = bpy.data.lights.new("fill", "AREA")
    ld.shape = "RECTANGLE"
    ld.color = (1.0, 0.97, 0.93)
    lo = bpy.data.objects.new("fill", ld)
    mn, mx = box
    diag = (mx - mn).length
    ld.size = ld.size_y = diag
    ld.energy = 120.0 * diag * diag
    lo.location = ((mn.x + mx.x) / 2, mn.y - diag, mx.z + diag)
    lo.rotation_euler = (Vector((0, 0, 0)) - Vector((0, -1, 1))).to_track_quat("-Z", "Y").to_euler()
    sc.collection.objects.link(lo)
    return [{"name": "fill", "energy": round(ld.energy, 1), "glossy": True}]


def setup_render(width, height, samples, device, exposure, out_png):
    """Cycles, denoised, AgX. device 'auto' uses CUDA when a CUDA GPU is listed, else CPU. Returns the device used."""
    sc = bpy.context.scene
    sc.render.engine = "CYCLES"
    cy = sc.cycles
    used = "CPU"
    if device in ("auto", "cuda"):
        try:
            prefs = bpy.context.preferences.addons["cycles"].preferences
            prefs.compute_device_type = "CUDA"
            prefs.get_devices()
            cuda = [d for d in prefs.devices if d.type == "CUDA"]
            for d in prefs.devices:
                d.use = d.type == "CUDA"
            if cuda:
                used = "CUDA"
            elif device == "cuda":
                warn("Không thấy GPU CUDA: render bằng CPU (chậm hơn nhiều).")
        except Exception as e:  # noqa: BLE001 - any failure means CPU
            warn(f"Không bật được GPU CUDA ({e}): render bằng CPU.")
    cy.device = "GPU" if used == "CUDA" else "CPU"
    cy.samples = samples
    cy.use_adaptive_sampling = True
    cy.adaptive_threshold = 0.02
    cy.use_denoising = True
    cy.denoiser = "OPENIMAGEDENOISE"
    cy.max_bounces = 8
    cy.glossy_bounces = 6
    cy.diffuse_bounces = 3
    cy.transmission_bounces = 2
    cy.transparent_max_bounces = 4
    cy.sample_clamp_indirect = 8.0
    cy.caustics_reflective = False
    cy.caustics_refractive = False
    sc.render.resolution_x, sc.render.resolution_y = width, height
    sc.render.resolution_percentage = 100
    sc.render.image_settings.file_format = "PNG"
    sc.render.image_settings.color_mode = "RGB"
    sc.render.image_settings.color_depth = "8"
    sc.render.filepath = out_png
    try:
        sc.view_settings.view_transform = "AgX"
        sc.view_settings.look = "AgX - Medium High Contrast"
    except Exception as e:  # noqa: BLE001
        warn(f"Không đặt được AgX: {e}")
    sc.view_settings.exposure = exposure
    return used
