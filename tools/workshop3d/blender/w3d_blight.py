"""Pure rules (no bpy) of the Blender interior lighting and metal materials, so vitest can check them with plain Python.

Lesson of the E30 run: every wall, the ceiling and the floor were metallic = 1 in a closed box, the fill light was hidden
from glossy rays, so the stainless only reflected other dark stainless and the cabin came out far darker than the bright
silver catalogue photo. Two fixes:
- metals other than mirrors are clamped (metallic <= METAL_MAX, roughness >= METAL_ROUGH_MIN): a little diffuse light
  survives and brushed stainless is never a near-mirror; mirrors (is_mirror in w3d_bscene) keep their low roughness;
- the cabin gets lights hidden from the camera whose power follows the size of the interior (interior_lights).
"""
METAL_MAX = 0.92
METAL_ROUGH_MIN = 0.18

# Watts per square metre of cabin floor for the soft panel just under the ceiling, and the share of the up-light near
# the floor (stands in for the light bounced off a real floor; lights the ceiling and the upper walls).
CEILING_W_PER_M2 = 4.0
UPLIGHT_SHARE = 0.35
# Walls of a taller cabin are further from the ceiling light: power grows with the height above 2.2 m.
REF_HEIGHT_M = 2.2
MIN_POWER_W = 5.0


def clamp_metal(metallic, roughness):
    """(metallic, roughness) for a non-mirror metal surface; non-metals (metallic < 0.5) are left as they are."""
    m = float(metallic)
    r = float(roughness)
    if m < 0.5:
        return m, r
    return min(m, METAL_MAX), max(r, METAL_ROUGH_MIN)


def interior_lights(width, depth, height, glossy_ok):
    """Hidden interior lights of a cabin of width x depth x height metres.

    Returns a list of dicts {name, size, size_y, energy, z (height above the floor), up (points up), glossy}.
    `glossy_ok` (no mirror panel in the cabin) lets the ceiling panel show in the reflections of the brushed stainless,
    which gives the bright upper walls of a catalogue photo; with mirror panels it stays hidden from glossy rays (a white
    sheet over the ceiling in every mirror)."""
    w, d, h = max(0.2, float(width)), max(0.2, float(depth)), max(0.5, float(height))
    area = w * d
    k = max(1.0, h / REF_HEIGHT_M) ** 2
    main = max(MIN_POWER_W, CEILING_W_PER_M2 * area * k)
    return [
        {"name": "fill", "size": 0.78 * w, "size_y": 0.78 * d, "energy": round(main, 1), "z": h - 0.01, "up": False, "glossy": bool(glossy_ok)},
        {"name": "fill_up", "size": 0.6 * w, "size_y": 0.6 * d, "energy": round(main * UPLIGHT_SHARE, 1), "z": 0.05, "up": True, "glossy": False},
    ]
