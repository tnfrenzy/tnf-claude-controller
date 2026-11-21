"""Patch the top-level PARAMS = {...} literal of a model script. Usage: python patch_params.py <model.py> <params.json>
Only keys that already exist in PARAMS are updated, with number or string values; everything else is reported as ignored.
The rest of the file is kept byte for byte. Prints one JSON line {"ok": true, "changed": [...], "ignored": [...]}
or {"ok": false, "error": "..."}."""
import ast
import json
import math
import os
import sys


def emit(obj):
    sys.stdout.buffer.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


class PatchError(Exception):
    pass


def find_params(tree):
    for node in tree.body:
        if isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name) and node.targets[0].id == "PARAMS":
            return node.value
        if isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id == "PARAMS" and node.value is not None:
            return node.value
    raise PatchError("Không thấy khối PARAMS = {...} ở cấp đầu của model.py.")


def as_number(text):
    try:
        return int(text)
    except ValueError:
        pass
    v = float(text)
    if not math.isfinite(v):
        raise ValueError(text)
    return v


def not_finite(value):
    """True for inf/nan numbers and for strings that read as such ("inf", "nan", "1e999")."""
    if isinstance(value, bool):
        return False
    if isinstance(value, float):
        return not math.isfinite(value)
    if isinstance(value, str):
        try:
            return not math.isfinite(float(value.strip()))
        except ValueError:
            return False
    return False


def coerce(old, new):
    """Return the value to store, or raise ValueError when the new value is not acceptable for this key."""
    if isinstance(new, bool) or not isinstance(new, (int, float, str)):
        raise ValueError("type")
    if isinstance(new, float) and not math.isfinite(new):
        raise ValueError("finite")
    if isinstance(old, bool):
        raise ValueError("bool key")
    if isinstance(old, (int, float)):
        return as_number(new.strip()) if isinstance(new, str) else new
    if isinstance(old, str):
        return new if isinstance(new, str) else str(new)
    raise ValueError("unsupported key type")


def render(params):
    if not params:
        return "{}"
    return "{\n" + "".join("    %r: %r,\n" % (k, v) for k, v in params.items()) + "}"


def main():
    if len(sys.argv) != 3:
        raise PatchError("Cách dùng: patch_params.py <model.py> <params.json>")
    script, params_file = sys.argv[1], sys.argv[2]
    with open(script, "rb") as f:
        raw = f.read()
    bom = raw.startswith(b"\xef\xbb\xbf")
    body = raw[3:] if bom else raw
    try:
        tree = ast.parse(body.decode("utf-8"))
    except (SyntaxError, UnicodeDecodeError) as e:
        raise PatchError("model.py không đọc được: %s" % e)
    node = find_params(tree)
    if not isinstance(node, ast.Dict):
        raise PatchError("PARAMS phải là một dict literal {...}.")
    try:
        current = ast.literal_eval(node)
    except (ValueError, SyntaxError):
        raise PatchError("PARAMS phải là dict literal chỉ gồm hằng số (không có biểu thức).")
    if not isinstance(current, dict):
        raise PatchError("PARAMS phải là một dict literal {...}.")
    with open(params_file, "r", encoding="utf-8") as f:
        wanted = json.load(f)
    if not isinstance(wanted, dict):
        raise PatchError("params.json phải là một đối tượng.")
    for key, value in wanted.items():
        if not_finite(value):
            raise PatchError("Tham số %s phải là số hữu hạn (không nhận vô cực hay NaN)." % key)

    changed, ignored = [], []
    for key, value in wanted.items():
        if key not in current:
            ignored.append(key)
            continue
        try:
            new = coerce(current[key], value)
        except ValueError:
            ignored.append(key)
            continue
        if new != current[key] or type(new) is not type(current[key]):
            current[key] = new
            changed.append(key)

    if changed:
        # ast offsets are UTF-8 byte columns: splice on bytes.
        lines = body.splitlines(keepends=True)
        starts = [0]
        for line in lines:
            starts.append(starts[-1] + len(line))
        begin = starts[node.lineno - 1] + node.col_offset
        end = starts[node.end_lineno - 1] + node.end_col_offset
        out = body[:begin] + render(current).encode("utf-8") + body[end:]
        tmp = script + ".tmp"
        with open(tmp, "wb") as f:
            f.write((b"\xef\xbb\xbf" if bom else b"") + out)
        os.replace(tmp, script)
    emit({"ok": True, "changed": changed, "ignored": ignored})


if __name__ == "__main__":
    try:
        main()
    except PatchError as e:
        emit({"ok": False, "error": str(e)})
        sys.exit(1)
    except Exception as e:  # noqa: BLE001
        emit({"ok": False, "error": "Lỗi không mong đợi: %s: %s" % (type(e).__name__, e)})
        sys.exit(1)
