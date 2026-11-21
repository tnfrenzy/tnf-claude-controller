"""Procedural, seamless PBR texture sets (albedo + normal + metallic-roughness) made with numpy only (no network).

Every pattern is built from periodic (FFT) noise or integer-frequency waves, so a tile repeats without a seam.
One tile covers `tile_cm` centimetres of the real surface (see TILE_MIN_CM: a tile is never smaller than the
pattern needs to stay visible). glTF conventions: metallicRoughness = G roughness, B metalness (multiplied by the
material factors), normal map = tangent space, OpenGL (+Y up).

A material can also point at a library folder (`library`): <dir>/albedo.png (required), normal.png and
roughness.png (optional), meta.json {"tile_cm": number} (optional). See load_library().
"""
import json
import os

import numpy as np

try:  # PIL is absent inside Blender, which only uses the numpy patterns (blender/w3d_bscene.py)
    from PIL import Image
except ImportError:  # pragma: no cover
    Image = None

KINDS = ("hairline", "brushed", "noise", "granite", "marble", "wood", "fabric", "diamond_plate", "stripes")
# Smallest real tile (cm) per kind: below this the streaks/grains are finer than a texel at render distance and the
# surface turns into a flat colour (the "invisible hairline" of the first real run, where scale was 2 cm).
TILE_MIN_CM = {"hairline": 30, "brushed": 30, "noise": 20, "granite": 40, "marble": 80, "wood": 60, "fabric": 8,
               "diamond_plate": 8, "stripes": 4}
DIAMOND_CELLS = 4  # lugs per tile and direction (a tile of 8 cm = lugs on a 2 cm pitch, like a tread plate)
STRIPE_DEFAULT_COLOR2 = (0.02, 0.02, 0.02)  # black bands of a yellow/black safety bumper


def tile_cm(kind, scale):
    try:
        s = float(scale)
    except (TypeError, ValueError):
        s = 0.0
    return max(s, float(TILE_MIN_CM.get(kind, 10)))


def _freq(px):
    f = np.fft.fftfreq(px) * px  # integer cycles per tile
    return f[None, :], f[:, None]  # fx varies along columns (u), fy along rows (v)


def _norm(a):
    lo, hi = float(a.min()), float(a.max())
    return (a - lo) / (hi - lo) if hi > lo else np.zeros_like(a)


def periodic_noise(px, rng, fx_scale, fy_scale=None, beta=0.0):
    """Gaussian band-limited noise, periodic over the tile. fx_scale/fy_scale = feature frequency (cycles per tile)
    along u/v: a small fy_scale stretches the features along v (streaks)."""
    fy_scale = fx_scale if fy_scale is None else fy_scale
    fx, fy = _freq(px)
    spec = np.fft.fft2(rng.standard_normal((px, px)))
    filt = np.exp(-((fx / fx_scale) ** 2 + (fy / fy_scale) ** 2))
    if beta:
        f = np.sqrt(fx ** 2 + fy ** 2)
        f[0, 0] = 1.0
        filt = filt / f ** beta
    filt[0, 0] = 0.0
    return _norm(np.real(np.fft.ifft2(spec * filt)))


def _height_to_normal(h, strength):
    """Tangent-space normal map (OpenGL, +Y up) from a periodic height field (np.roll keeps the tile seamless)."""
    dx = (np.roll(h, -1, axis=1) - np.roll(h, 1, axis=1)) * 0.5 * strength
    dy = (np.roll(h, 1, axis=0) - np.roll(h, -1, axis=0)) * 0.5 * strength  # image rows go down, +v goes up
    n = np.stack([-dx, -dy, np.ones_like(h)], axis=-1)
    n /= np.linalg.norm(n, axis=-1, keepdims=True)
    return n * 0.5 + 0.5


def _rgb(base, tint):
    return np.clip(np.asarray(base, dtype=np.float64)[None, None, :] * tint[..., None], 0, 1)


def _mix(a, b, t):
    return a * (1 - t[..., None]) + b * t[..., None]


def _pattern(kind, px, base, rng, color2=None):
    """Return (albedo HxWx3 0..1, height HxW 0..1, roughness multiplier HxW 0..1, normal strength)."""
    base = np.asarray(base, dtype=np.float64)
    if kind == "diamond_plate":
        # Tread plate: raised elongated lugs at +45 / -45 degrees in a checkerboard, DIAMOND_CELLS per tile; the worn
        # lug tops are a little brighter and smoother than the plate.
        n = DIAMOND_CELLS
        u = (np.arange(px)[None, :] + 0.5) / px * n
        v = (np.arange(px)[:, None] + 0.5) / px * n
        x, y = u - np.floor(u) - 0.5, v - np.floor(v) - 0.5
        o = np.where(((np.floor(u) + np.floor(v)) % 2) == 0, 1.0, -1.0)
        a = (x + o * y) / np.sqrt(2)
        b = (x - o * y) / np.sqrt(2)
        h = np.clip((1.0 - (np.abs(a) / 0.40 + np.abs(b) / 0.11)) * 3.0, 0, 1)
        grain = periodic_noise(px, rng, px * 0.2)
        col = _rgb(base, 0.86 + 0.06 * grain + 0.2 * h)
        rough = 0.95 - 0.25 * h + 0.05 * grain
        return col, h, rough, 6.0
    if kind == "stripes":
        # Diagonal bands: per tile one base-colour band (f < 0.5) and one color2 band (u + v keeps the tile seamless),
        # with a soft 2-texel edge.
        c2 = np.asarray(color2 if color2 is not None else STRIPE_DEFAULT_COLOR2, dtype=np.float64)
        u = (np.arange(px)[None, :] + 0.5) / px
        v = (np.arange(px)[:, None] + 0.5) / px
        f = (u + v) % 1.0
        e = 2.0 / px
        t = np.clip((f - 0.5) / e + 0.5, 0, 1) * np.clip((1.0 - f) / e + 0.5, 0, 1)
        col = _mix(np.broadcast_to(base, (px, px, 3)), np.broadcast_to(c2, (px, px, 3)), t)
        grain = periodic_noise(px, rng, px * 0.2)
        return col, 0.15 * grain, 0.95 + 0.05 * grain, 0.5
    if kind in ("hairline", "brushed"):
        # Streaks run along v (vertical on a wall at angle 0): very fine lines + longer, softer streaks.
        # fy tiny = each line runs (almost) the whole tile; fx high = lines a few texels apart
        fine = periodic_noise(px, rng, px * 0.45, 2.0 if kind == "hairline" else 4.0)
        mid = periodic_noise(px, rng, px * 0.08, 1.5)
        h = _norm(0.7 * fine + 0.3 * mid)
        amp = 0.12 if kind == "hairline" else 0.08
        albedo = _rgb(base, 1.0 - amp + amp * h)
        rough = 0.78 + 0.22 * h  # brighter lines = rougher grooves
        return albedo, h, rough, (1.2 if kind == "hairline" else 1.0)
    if kind == "granite":
        mottle = periodic_noise(px, rng, 6, beta=0.0)
        g1 = periodic_noise(px, rng, px * 0.08)
        g2 = periodic_noise(px, rng, px * 0.11)
        g3 = periodic_noise(px, rng, px * 0.05)
        dark = np.clip((g1 - 0.62) / 0.08, 0, 1)
        light = np.clip((g2 - 0.64) / 0.07, 0, 1)
        accent = np.clip((g3 - 0.70) / 0.06, 0, 1)
        col = _rgb(base, 0.90 + 0.14 * mottle)
        col = _mix(col, _rgb(base, np.full((px, px), 0.22)), dark * 0.95)
        col = _mix(col, np.clip(_rgb(base, np.full((px, px), 1.18)), 0, 1), light * 0.85)
        warm = np.clip(base * np.array([1.05, 0.82, 0.70]), 0, 1)
        col = _mix(col, np.broadcast_to(warm, col.shape), accent * 0.6)
        h = _norm(dark * 0.5 + light * 0.3 + 0.2 * mottle)
        rough = 0.85 + 0.15 * periodic_noise(px, rng, 20)
        return col, h, rough, 0.6
    if kind == "marble":
        u = np.arange(px)[None, :] / px
        v = np.arange(px)[:, None] / px
        turb = periodic_noise(px, rng, 3) + 0.35 * periodic_noise(px, rng, 8) + 0.12 * periodic_noise(px, rng, 24)
        s = np.abs(np.sin(np.pi * (1 * u + 1 * v + 1.4 * turb)))
        vein = (1.0 - s) ** 14
        thin = (1.0 - np.abs(np.sin(np.pi * (2 * u - 1 * v + 0.45 * periodic_noise(px, rng, 4))))) ** 40
        cloud = periodic_noise(px, rng, 4)
        col = _rgb(base, 0.94 + 0.06 * cloud)
        col = _mix(col, _rgb(base, np.full((px, px), 0.55)), np.clip(vein * 0.85 + thin * 0.5, 0, 1))
        h = _norm(vein + 0.5 * thin)
        rough = 0.9 + 0.1 * cloud
        return col, h, rough, 0.4
    if kind == "wood":
        u = np.arange(px)[None, :] / px
        turb = periodic_noise(px, rng, 3, 1.2)
        rings = 0.5 + 0.5 * np.sin(2 * np.pi * (14 * u + 1.6 * turb))
        rings = rings ** 3
        grain = periodic_noise(px, rng, px * 0.25, px * 0.01)
        t = np.clip(0.55 * rings + 0.25 * grain, 0, 1)
        col = _rgb(base, 1.08 - 0.42 * t)
        h = _norm(0.6 * grain + 0.4 * rings)
        rough = 0.8 + 0.2 * grain
        return col, h, rough, 2.5
    if kind == "fabric":
        n = 48  # threads per tile and direction
        u = np.arange(px)[None, :] / px
        v = np.arange(px)[:, None] / px
        warp = np.abs(np.sin(np.pi * n * u))
        weft = np.abs(np.sin(np.pi * n * v))
        over = ((np.floor(n * u) + np.floor(n * v)) % 2).astype(np.float64)
        h = _norm(over * weft + (1 - over) * warp + 0.25 * periodic_noise(px, rng, px * 0.2))
        col = _rgb(base, 0.82 + 0.22 * h)
        rough = 0.9 + 0.1 * h
        return col, h, rough, 3.0
    # noise (legacy): soft grain
    h = periodic_noise(px, rng, px * 0.15)
    col = _rgb(base, 0.9 + 0.1 * h)
    return col, h, 0.9 + 0.1 * h, 1.0


def _rotate(a, angle):
    q = int(round((angle % 360) / 90.0)) % 4
    if abs((angle % 90)) < 1e-6 or abs((angle % 90) - 90) < 1e-6:
        return np.rot90(a, q, axes=(0, 1)).copy()  # multiples of 90 stay seamless
    img = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    return np.asarray(img.rotate(angle, resample=Image.BICUBIC, expand=False), dtype=np.float64) / 255.0


def _rotate_normal(n, angle):
    """Rotate a normal map image by a multiple of 90 degrees and turn its XY vectors with it."""
    q = int(round((angle % 360) / 90.0)) % 4
    if q == 0 or not (abs(angle % 90) < 1e-6 or abs((angle % 90) - 90) < 1e-6):
        return _rotate(n, angle)
    r = np.rot90(n, q, axes=(0, 1)).copy()
    x, y = r[..., 0] * 2 - 1, r[..., 1] * 2 - 1
    for _ in range(q):  # rot90 is counter-clockwise: (x, y) -> (-y, x)
        x, y = -y, x
    r[..., 0], r[..., 1] = x * 0.5 + 0.5, y * 0.5 + 0.5
    return r


def to_image(a, mode="RGB", jpeg=True, quality=90):
    """numpy 0..1 -> PIL image. JPEG-encoded images keep format "JPEG" so the glTF exporter stores them as JPEG
    (noise textures are 3-5x smaller than PNG)."""
    import io
    img = Image.fromarray((np.clip(a, 0, 1) * 255 + 0.5).astype(np.uint8), mode)
    if not jpeg:
        return img
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=quality)
    buf.seek(0)
    out = Image.open(buf)
    out.load()
    return out


def pattern_arrays(kind, base_rgb, px=512, seed=7, color2=None):
    """numpy (albedo HxWx3, normal HxWx3, roughness multiplier HxW), 0..1, row 0 = top: Blender builds its images
    from these (blender/w3d_bscene.py), so the GLB and the Blender render show the same pattern."""
    if kind not in KINDS:
        kind = "noise"
    rng = np.random.default_rng(seed + KINDS.index(kind) * 101)
    albedo, h, rough, strength = _pattern(kind, px, base_rgb, rng, color2)
    return albedo, _height_to_normal(h, strength * px / 1024.0), np.clip(rough, 0, 1)


def make_texture_set(kind, base_rgb, px=1024, angle=0.0, seed=7, color2=None):
    """Return {"albedo", "normal", "mr"} as PIL RGB images (mr: G = roughness multiplier, B = 1 metallic multiplier).
    color2 = second colour of "stripes" (default black)."""
    if kind not in KINDS:
        kind = "noise"
    px = int(max(64, min(4096, px)))
    rng = np.random.default_rng(seed + KINDS.index(kind) * 101)
    albedo, h, rough, strength = _pattern(kind, px, base_rgb, rng, color2)
    normal = _height_to_normal(h, strength * px / 1024.0)
    mr = np.stack([np.ones_like(rough), np.clip(rough, 0, 1), np.ones_like(rough)], axis=-1)
    if angle:
        albedo, mr, normal = _rotate(albedo, angle), _rotate(mr, angle), _rotate_normal(normal, angle)
    return {"albedo": to_image(albedo, quality=90), "normal": to_image(normal, quality=94), "mr": to_image(mr, quality=90)}


def load_library(dirpath, px=None):
    """Read a material library folder. Returns ({"albedo", "normal"?, "mr"?}, tile_cm or None). Raises ValueError."""
    albedo = os.path.join(dirpath, "albedo.png")
    if not os.path.isfile(albedo):
        raise ValueError("thiếu albedo.png trong %s" % dirpath)

    def load(name, mode):
        p = os.path.join(dirpath, name)
        if not os.path.isfile(p):
            return None
        im = Image.open(p)
        im.load()
        im = im.convert(mode)
        if px and max(im.size) > px:
            im = im.resize((px, px), Image.LANCZOS)
        return im

    out = {"albedo": load("albedo.png", "RGB")}
    n = load("normal.png", "RGB")
    if n is not None:
        out["normal"] = n
    r = load("roughness.png", "L")
    if r is not None:
        g = np.asarray(r, dtype=np.uint8)
        out["mr"] = Image.fromarray(np.stack([np.full_like(g, 255), g, np.full_like(g, 255)], axis=-1), "RGB")
    tile = None
    meta = os.path.join(dirpath, "meta.json")
    if os.path.isfile(meta):
        try:
            with open(meta, "r", encoding="utf-8") as f:
                t = json.load(f).get("tile_cm")
            if isinstance(t, (int, float)) and 0.1 <= float(t) <= 10000:
                tile = float(t)
        except (OSError, ValueError, AttributeError):
            tile = None
    return out, tile
