"""Summarise a STEP file as JSON (solids, faces, volume, bounding box, cylindrical holes) so an agent can read it as text.
Usage: python step_info.py <file.step|.stp>."""
import json
import sys

import cadquery as cq

MAX_ITEMS = 60


def main(path: str) -> None:
    shape = cq.importers.importStep(path)
    val = shape.val()
    bb = val.BoundingBox()
    solids = shape.solids().vals()
    faces = shape.faces().vals()
    cylinders = []
    for f in faces:
        if f.geomType() == "CYLINDER" and len(cylinders) < MAX_ITEMS:
            c = f.Center()
            try:
                radius = round(f._geomAdaptor().Cylinder().Radius(), 3)
            except Exception:  # noqa: BLE001
                radius = None
            cylinders.append({"radius": radius, "center": [round(c.x, 2), round(c.y, 2), round(c.z, 2)]})
    out = {
        "format": "step",
        "solids": len(solids),
        "faces": len(faces),
        "edges": len(shape.edges().vals()),
        "volume": round(sum(s.Volume() for s in solids), 3),
        "area": round(sum(f.Area() for f in faces), 3),
        "boundingBox": {"x": round(bb.xlen, 3), "y": round(bb.ylen, 3), "z": round(bb.zlen, 3), "min": [round(bb.xmin, 3), round(bb.ymin, 3), round(bb.zmin, 3)]},
        "cylindricalFaces": cylinders,
        "truncated": len(cylinders) >= MAX_ITEMS,
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: step_info.py <file.step>"}))
        sys.exit(2)
    main(sys.argv[1])
