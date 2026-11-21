"""Report which CAD libraries this Python has (JSON on stdout). Used by `tnf cad status` and the Settings screen.
Reads package metadata instead of importing: importing cadquery takes many seconds, and a status check must be quick."""
import json
import sys
from importlib import metadata

out = {"python": sys.version.split()[0], "ezdxf": None, "cadquery": None, "errors": {}}
for name in ("ezdxf", "cadquery"):
    try:
        out[name] = metadata.version(name)
    except metadata.PackageNotFoundError:
        out["errors"][name] = "not installed"
    except Exception as e:  # noqa: BLE001 - report, never crash
        out["errors"][name] = f"{type(e).__name__}: {e}"
print(json.dumps(out, ensure_ascii=False))
