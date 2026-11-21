"""Material inheritance for parts that have no entry in materials.json (one rule for the GLB, the USDZ and Blender).

The material-artist role only sees the part ids of the plan (spec.json), but the CAD script may add parts of its own
(for example `bumper_left_soc`, the stripes of a bumper, or `cop_man_led_nen`, the panel behind a screen). Without a
rule they render in the default grey / white. Pure Python (no numpy): imported by assemble_glb.py and export_usdz.py
(CAD venv) and by blender/w3d_bscene.py (Blender's own Python).

Order, first match wins:
1. exact id;
2. parent by dropping trailing `_` segments: `bumper_left_soc` -> `bumper_left` -> `bumper`; at each level an exact key,
   else the keys below that prefix (siblings `vach_trai_1..3` for `vach_trai_4`; the most common spec among them);
3. dropping leading segments (`nen_cop_man_led` -> `cop_man_led`), exact keys only;
4. keyword category of the name (floor/san, ceiling/tran, wall/vach, door/cua, handrail/tay_vin, bumper, ...): the most
   common spec of the materials.json keys of the same category, else a neutral preset of the category;
5. nothing: unresolved (the caller uses grey and warns).
An inherited spec never glows (`emissive` is dropped: a screen's back panel or a lamp's rim is not a light), except a
keyword match in the lamp category.

CLI (tests): w3d_matinherit.py <materials.json> <part id>... -> one JSON line {resolved, inherited, unresolved}.
"""
import json
import re
import sys

# category -> regex on the `_`-separated id; checked in this order (specific before generic)
CATEGORIES = (
    ("handrail", r"tay_vin|tayvin|handrail|grab_rail"),
    ("bumper", r"bumper|chong_va|chongva|giam_chan|bao_ve_vach"),
    ("lamp", r"den|lamp|light|led|downlight|spot"),
    ("cop", r"cop|lop|goi_tang|bang_goi|button|nut"),
    ("door", r"canh_cua|cua|door|nguong|sill"),
    ("ceiling", r"tran|ceiling|roof"),
    ("floor", r"san|floor|sol"),
    ("wall", r"vach|wall|panel|tam"),
    ("frame", r"khung|frame|nep|trim|vien|bao_che|dam|tru|transom|lanh_to|bracket|gia_do"),
    ("glass", r"kinh|glass"),
    ("stone", r"marble|granite|da_hoa|stone"),
)
_CAT_RE = [(name, re.compile(r"(^|_)(%s)(_|$)" % rx)) for name, rx in CATEGORIES]

STEEL = {"color": [0.8, 0.8, 0.82], "metallic": 0.9, "roughness": 0.3, "texture": {"kind": "hairline", "scale": 40, "angle": 0}}
PRESETS = {
    "handrail": {"color": [0.82, 0.82, 0.84], "metallic": 0.9, "roughness": 0.22},
    "bumper": {"color": [0.05, 0.05, 0.05], "metallic": 0.0, "roughness": 0.7},
    "lamp": {"color": [1.0, 1.0, 1.0], "metallic": 0.0, "roughness": 0.4, "emissive": [1.0, 0.95, 0.85]},
    "cop": STEEL,
    "door": STEEL,
    "ceiling": STEEL,
    "floor": {"color": [0.62, 0.63, 0.65], "metallic": 0.85, "roughness": 0.4},
    "wall": STEEL,
    "frame": STEEL,
    "glass": {"color": [0.85, 0.9, 0.92], "metallic": 0.0, "roughness": 0.05, "opacity": 0.3},
    "stone": {"color": [0.55, 0.53, 0.5], "metallic": 0.0, "roughness": 0.25, "texture": {"kind": "granite", "scale": 60, "angle": 0}},
}


def category(pid):
    for name, rx in _CAT_RE:
        if rx.search(pid):
            return name
    return None


def _most_common(mats, keys):
    """Spec shared by most keys (ties: the first key in sorted order)."""
    count, first = {}, {}
    for k in sorted(keys):
        sig = json.dumps(mats[k], sort_keys=True)
        count[sig] = count.get(sig, 0) + 1
        first.setdefault(sig, k)
    sig = max(count, key=lambda s: (count[s], -sorted(keys).index(first[s])))
    return first[sig]


def _copy(spec, keep_emissive=False):
    out = json.loads(json.dumps(spec))
    if not keep_emissive:
        out.pop("emissive", None)
    return out


def infer(mats, pid):
    """(spec, source key or preset name, how) for one part without its own entry; (None, None, None) when nothing fits.
    how: parent | sibling | trimmed | category | preset."""
    keys = [k for k in mats if isinstance(mats.get(k), dict)]
    seg = pid.split("_")
    for n in range(len(seg) - 1, 0, -1):
        pre = "_".join(seg[:n])
        if pre in mats and isinstance(mats[pre], dict):
            return _copy(mats[pre]), pre, "parent"
        below = [k for k in keys if k.startswith(pre + "_") and k != pid]
        if below:
            src = _most_common(mats, below)
            return _copy(mats[src]), src, "sibling"
    below = [k for k in keys if k.startswith(pid + "_")]
    if below:
        src = _most_common(mats, below)
        return _copy(mats[src]), src, "sibling"
    for n in range(1, len(seg)):
        post = "_".join(seg[n:])
        if post in mats and isinstance(mats[post], dict):
            return _copy(mats[post]), post, "trimmed"
    cat = category(pid)
    if cat is None:
        return None, None, None
    same = [k for k in keys if category(k) == cat]
    if same:
        src = _most_common(mats, same)
        return _copy(mats[src], keep_emissive=cat == "lamp"), src, "category"
    return _copy(PRESETS[cat], keep_emissive=True), "preset:" + cat, "preset"


def resolve(mats, part_ids):
    """Returns (resolved {id: spec} for every part that has or inherits one, inherited {id: {from, how}}, unresolved [ids]).
    Inheritance only reads the ORIGINAL materials.json entries (never chains through an inherited spec)."""
    mats = mats if isinstance(mats, dict) else {}
    resolved, inherited, unresolved = {}, {}, []
    for pid in part_ids:
        s = mats.get(pid)
        if isinstance(s, dict):
            resolved[pid] = s
            continue
        spec, src, how = infer(mats, pid)
        if spec is None:
            unresolved.append(pid)
        else:
            resolved[pid] = spec
            inherited[pid] = {"from": src, "how": how}
    return resolved, inherited, unresolved


def warnings_for(inherited, unresolved, limit=12):
    """Vietnamese report lines (build warnings / Blender warnings)."""
    out = []
    if inherited:
        items = ["%s ← %s" % (k, v["from"]) for k, v in sorted(inherited.items())]
        more = " (và %d chi tiết khác)" % (len(items) - limit) if len(items) > limit else ""
        out.append("Kế thừa vật liệu cho %d chi tiết không có trong materials.json: %s%s." % (len(items), ", ".join(items[:limit]), more))
    if unresolved:
        more = " (và %d chi tiết khác)" % (len(unresolved) - limit) if len(unresolved) > limit else ""
        out.append("CẢNH BÁO: còn %d chi tiết không có vật liệu sau khi suy (dùng xám mặc định): %s%s." % (len(unresolved), ", ".join(sorted(unresolved)[:limit]), more))
    return out


if __name__ == "__main__":
    with open(sys.argv[1], encoding="utf-8") as f:
        m = json.load(f).get("materials", {})
    r, i, u = resolve(m, sys.argv[2:])
    sys.stdout.buffer.write((json.dumps({"resolved": r, "inherited": i, "unresolved": u, "warnings": warnings_for(i, u)}, ensure_ascii=False) + "\n").encode("utf-8"))
