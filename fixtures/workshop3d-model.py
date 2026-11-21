# Display box ("hop trung bay") 400 x 300 x 200 mm with three parts: base, lid, handle.
import math
import os
import sys
import cadquery as cq

OUTPUT_DIR = sys.argv[1]
PARAMS = {"width": 400, "depth": 300, "base_h": 120, "lid_h": 60, "handle_w": 100, "handle_d": 40, "handle_h": 20, "fillet": 1}

W, D = PARAMS["width"], PARAMS["depth"]
BASE_H, LID_H = PARAMS["base_h"], PARAMS["lid_h"]


def block(w, d, h, z0):
    solid = cq.Workplane("XY").box(w, d, h, centered=(True, True, False)).translate((0, 0, z0))
    return solid.edges().fillet(PARAMS["fillet"])


base = block(W, D, BASE_H, 0)
lid = block(W, D, LID_H, BASE_H)
handle = block(PARAMS["handle_w"], PARAMS["handle_d"], PARAMS["handle_h"], BASE_H + LID_H)
parts = {"base": base, "lid": lid, "handle": handle}

os.makedirs(os.path.join(OUTPUT_DIR, "parts"), exist_ok=True)
for part_id, wp in parts.items():
    cq.exporters.export(wp, os.path.join(OUTPUT_DIR, "parts", part_id + ".stl"), tolerance=0.2, angularTolerance=0.1)
compound = cq.Compound.makeCompound([wp.val() for wp in parts.values()])
cq.exporters.export(compound, os.path.join(OUTPUT_DIR, "model.step"))
print("model ok", math.floor(W))
