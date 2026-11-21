"""Summarise a DXF file as JSON (layers, entity counts, extents, texts, dimensions) so an agent can read it as text.
Usage: python dxf_info.py <file.dxf>. Output is capped so it always fits in a prompt."""
import json
import sys
from collections import Counter

import ezdxf
from ezdxf import bbox

MAX_ITEMS = 80


def main(path: str) -> None:
    doc = ezdxf.readfile(path)
    msp = doc.modelspace()
    entities = list(msp)
    kinds = Counter(e.dxftype() for e in entities)
    layers = Counter(e.dxf.layer for e in entities if e.dxf.hasattr("layer"))
    texts, dims = [], []
    for e in entities:
        t = e.dxftype()
        if t == "TEXT" and len(texts) < MAX_ITEMS:
            texts.append({"layer": e.dxf.layer, "text": e.dxf.text[:120], "at": [round(e.dxf.insert.x, 2), round(e.dxf.insert.y, 2)]})
        elif t == "MTEXT" and len(texts) < MAX_ITEMS:
            texts.append({"layer": e.dxf.layer, "text": e.plain_text()[:120], "at": [round(e.dxf.insert.x, 2), round(e.dxf.insert.y, 2)]})
        elif t == "DIMENSION" and len(dims) < MAX_ITEMS:
            try:
                meas = round(e.get_measurement(), 3)
            except Exception:  # noqa: BLE001 - some dimension kinds have no measurement
                meas = None
            dims.append({"layer": e.dxf.layer, "measurement": meas, "text": (e.dxf.text or "")[:60]})
    ext = None
    try:
        box = bbox.extents(entities)
        if box.has_data:
            ext = {"min": [round(box.extmin.x, 3), round(box.extmin.y, 3)], "max": [round(box.extmax.x, 3), round(box.extmax.y, 3)]}
    except Exception:  # noqa: BLE001
        ext = None
    blocks = [b.name for b in doc.blocks if not b.name.startswith("*")][:MAX_ITEMS]
    out = {
        "format": "dxf",
        "dxfversion": doc.dxfversion,
        "units": int(doc.header.get("$INSUNITS", 0)),
        "entityCount": len(entities),
        "entities": dict(kinds.most_common()),
        "layers": [{"name": n, "count": c} for n, c in layers.most_common(MAX_ITEMS)],
        "extents": ext,
        "texts": texts,
        "dimensions": dims,
        "blocks": blocks,
        "truncated": {"texts": len(texts) >= MAX_ITEMS, "dimensions": len(dims) >= MAX_ITEMS, "layers": len(layers) > MAX_ITEMS},
    }
    print(json.dumps(out, ensure_ascii=False))


if __name__ == "__main__":
    if len(sys.argv) != 2:
        print(json.dumps({"error": "usage: dxf_info.py <file.dxf>"}))
        sys.exit(2)
    main(sys.argv[1])
