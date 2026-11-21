"""Synthetic floor-stone photos for tests (marble veins, granite speckles, light falloff, slight tilt).
Usage: gen_stone.py <out_dir>  -> writes 6 images (png/jpg/webp) plus tiny.png and flat.png; prints one JSON line."""
import json
import os
import sys

import numpy as np
from PIL import Image, ImageFilter


def fractal(rng, h, w, octaves=5):
    out = np.zeros((h, w))
    amp = 1.0
    for o in range(octaves):
        cells = 4 * 2 ** o
        small = rng.random((cells, cells))
        layer = np.asarray(Image.fromarray((small * 255).astype(np.uint8)).resize((w, h), Image.BICUBIC), dtype=np.float64) / 255.0
        out += layer * amp
        amp *= 0.5
    return out / out.max()


def marble(rng, h, w, base, vein, freq, angle):
    y, x = np.mgrid[0:h, 0:w] / max(h, w)
    t = fractal(rng, h, w)
    d = x * np.cos(angle) + y * np.sin(angle)
    v = np.abs(np.sin((d * freq + t * 4.0) * np.pi)) ** 0.25
    rgb = np.array(base)[None, None, :] * v[..., None] + np.array(vein)[None, None, :] * (1 - v[..., None])
    return rgb


def granite(rng, h, w, base, spots):
    rgb = np.ones((h, w, 3)) * np.array(base)
    t = fractal(rng, h, w, 6)
    rgb *= (0.85 + 0.3 * t)[..., None]
    for color, density in spots:
        mask = rng.random((h, w)) < density
        m = np.asarray(Image.fromarray((mask * 255).astype(np.uint8)).filter(ImageFilter.MaxFilter(3)), dtype=bool)
        rgb[m] = color
    return rgb


def finish(rng, rgb, falloff, tilt, noise):
    h, w, _ = rgb.shape
    y, x = np.mgrid[0:h, 0:w]
    light = 1.0 - falloff * (x / w * 0.6 + y / h * 0.4)
    rgb = rgb * light[..., None] + rng.normal(0, noise, rgb.shape)
    img = Image.fromarray((np.clip(rgb, 0, 1) * 255).astype(np.uint8))
    if tilt:
        img = img.rotate(tilt, resample=Image.BICUBIC, expand=False, fillcolor=(40, 40, 40))
    return img


def main():
    out = sys.argv[1]
    os.makedirs(out, exist_ok=True)
    rng = np.random.default_rng(42)
    specs = [
        ("marble-white.jpg", lambda: marble(rng, 900, 1200, (0.93, 0.92, 0.9), (0.45, 0.45, 0.48), 3.0, 0.6), 0.25, 1.5, 0.02),
        ("marble-black.png", lambda: marble(rng, 800, 800, (0.12, 0.12, 0.13), (0.85, 0.83, 0.8), 2.0, 2.1), 0.15, 0.0, 0.015),
        ("granite-grey.webp", lambda: granite(rng, 700, 1000, (0.55, 0.55, 0.56), [((0.1, 0.1, 0.1), 0.02), ((0.9, 0.9, 0.88), 0.015)]), 0.2, -1.0, 0.03),
        ("granite-red.jpg", lambda: granite(rng, 1024, 768, (0.55, 0.25, 0.22), [((0.08, 0.06, 0.06), 0.025), ((0.85, 0.75, 0.7), 0.01)]), 0.1, 0.8, 0.02),
        ("travertine.png", lambda: marble(rng, 600, 600, (0.85, 0.76, 0.6), (0.65, 0.55, 0.4), 6.0, 0.05), 0.3, 0.0, 0.02),
        ("emperador.jpg", lambda: marble(rng, 1100, 1400, (0.42, 0.3, 0.22), (0.8, 0.7, 0.55), 4.0, 1.1), 0.2, -2.0, 0.025),
    ]
    files = []
    for name, gen, falloff, tilt, noise in specs:
        img = finish(rng, gen(), falloff, tilt, noise)
        p = os.path.join(out, name)
        if name.endswith(".jpg"):
            img.save(p, quality=90)
        elif name.endswith(".webp"):
            img.save(p, quality=90)
        else:
            img.save(p)
        files.append(p)
    Image.fromarray((rng.random((200, 300, 3)) * 255).astype(np.uint8)).save(os.path.join(out, "tiny.png"))
    Image.new("RGB", (600, 600), (128, 128, 130)).save(os.path.join(out, "flat.png"))
    sys.stdout.write(json.dumps({"ok": True, "files": files}) + "\n")


if __name__ == "__main__":
    main()
