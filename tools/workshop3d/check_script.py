"""Static guard for model scripts written by an agent. Usage: python check_script.py <file.py>
Prints one JSON line {"ok": bool, "errors": [str]}. A guard for cooperating agents, not a sandbox.
Known limit (by design, cooperating-agent threat model): pathlib and exporters such as cadquery can still write files, and the attribute checks are static, so a determined script can still reach behaviour the rules do not name."""
import ast
import json
import sys

ALLOWED_MODULES = {
    "cadquery", "math", "json", "sys", "typing", "dataclasses", "itertools", "functools", "collections", "numpy", "os", "pathlib", "__future__",
}
ALLOWED_OS_ATTRS = {"path", "environ", "makedirs", "getcwd", "sep"}
# Attribute names that reach dangerous modules or frames from any object (e.g. os.path.sys.modules, os.path.os.system,
# gi_frame.f_builtins). Applied to every attribute access, whatever the object is.
BANNED_ATTRS = {
    "modules", "os", "sys",
    "f_back", "f_builtins", "f_globals", "f_locals", "f_code",
    "gi_frame", "gi_code", "cr_frame", "cr_code", "ag_frame", "ag_code", "tb_frame", "func_globals",
}
# numpy members that load native code or read/write arbitrary files (np.loadtxt, arr.tofile, np.ctypeslib...).
# Rejected as attributes, as `from numpy import <name>` and as a module path part (numpy.ctypeslib).
FILE_IO_ATTRS = {"ctypeslib", "DataSource", "genfromtxt", "loadtxt", "fromfile", "tofile", "savetxt", "memmap"}
BANNED_ATTRS |= FILE_IO_ATTRS
# pathlib stays allowed: scripts build output paths with Path(OUTPUT_DIR) / "parts". Path.write_text and friends can
# still write files, which is the documented limit above (cooperating agents; exporters write files anyway).
BANNED_NAMES = {
    "eval", "exec", "compile", "__import__", "__builtins__", "open", "input", "globals", "locals", "getattr", "setattr", "delattr", "vars", "breakpoint", "exit", "quit",
}
MAX_BYTES = 200_000


def is_private_attr(node: ast.Attribute) -> bool:
    """True when an attribute access is not allowed because of its underscore prefix.
    Single-underscore members are allowed only on the plain names self/cls (a script's own helper classes).
    Dunders are rejected except super().__init__. Everything else with a leading underscore is rejected."""
    attr = node.attr
    if attr.startswith("__"):
        is_super_call = isinstance(node.value, ast.Call) and isinstance(node.value.func, ast.Name) and node.value.func.id == "super"
        return not (attr == "__init__" and is_super_call)
    if attr.startswith("_"):
        return not (isinstance(node.value, ast.Name) and node.value.id in {"self", "cls"})
    return False


def check(source: str) -> list[str]:
    errors: list[str] = []
    try:
        tree = ast.parse(source)
    except SyntaxError as e:
        return [f"Lỗi cú pháp (syntax) dòng {e.lineno}: {e.msg}"]
    # Names bound to the os / sys modules (import os as o, import sys as s). Collected first so order does not matter.
    os_aliases = {"os"}
    sys_aliases = {"sys"}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                if a.name == "os" and a.asname:
                    os_aliases.add(a.asname)
                if a.name == "sys" and a.asname:
                    sys_aliases.add(a.asname)
    module_aliases = os_aliases | sys_aliases
    # Parent map so a bare module name can be allowed only as the value of an attribute (os.<attr>).
    parents = {child: parent for parent in ast.walk(tree) for child in ast.iter_child_nodes(parent)}
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for a in node.names:
                root = a.name.split(".")[0]
                if root not in ALLOWED_MODULES or any(p in FILE_IO_ATTRS for p in a.name.split(".")):
                    errors.append(f"dòng {node.lineno}: không được import {a.name}")
        elif isinstance(node, ast.ImportFrom):
            root = (node.module or "").split(".")[0]
            if node.level or root not in ALLOWED_MODULES or any(p in FILE_IO_ATTRS for p in (node.module or "").split(".")):
                errors.append(f"dòng {node.lineno}: không được import từ {node.module or '.'}")
            elif root == "os":
                for a in node.names:
                    if a.name == "*" or a.name not in ALLOWED_OS_ATTRS:
                        errors.append(f"dòng {node.lineno}: không được import {a.name} từ os")
            elif root == "sys":
                for a in node.names:
                    if a.name == "*" or a.name in BANNED_ATTRS or a.name.startswith("_"):
                        errors.append(f"dòng {node.lineno}: không được import {a.name} từ sys")
            for a in node.names:
                if (a.name.startswith("_") and root != "__future__") or a.name in FILE_IO_ATTRS:
                    errors.append(f"dòng {node.lineno}: không được import {a.name}")
        if isinstance(node, ast.Name):
            if node.id in BANNED_NAMES:
                errors.append(f"dòng {node.lineno}: không được dùng {node.id}")
            if node.id in module_aliases:
                parent = parents.get(node)
                if not (isinstance(parent, ast.Attribute) and parent.value is node):
                    errors.append(f"dòng {node.lineno}: os/sys chỉ được dùng dạng os.<thuộc tính>")
        if isinstance(node, ast.Attribute):
            if is_private_attr(node) or node.attr in BANNED_ATTRS:
                errors.append(f"dòng {node.lineno}: không được truy cập .{node.attr}")
            if isinstance(node.value, ast.Name) and node.value.id in os_aliases and node.attr not in ALLOWED_OS_ATTRS:
                errors.append(f"dòng {node.lineno}: không được dùng os.{node.attr}")
    return errors


def emit(obj: dict) -> None:
    # Write UTF-8 bytes directly: on Windows a piped stdout uses the locale codec (cp1252) and crashes on Vietnamese text.
    sys.stdout.buffer.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    sys.stdout.buffer.flush()


def main(path: str) -> None:
    with open(path, "rb") as f:
        raw = f.read(MAX_BYTES + 1)
    if len(raw) > MAX_BYTES:
        emit({"ok": False, "errors": ["Script quá dài (trên 200 KB)."]})
        return
    errors = check(raw.decode("utf-8", errors="replace"))
    emit({"ok": not errors, "errors": errors[:20]})


if __name__ == "__main__":
    if len(sys.argv) != 2:
        emit({"ok": False, "errors": ["usage: check_script.py <file.py>"]})
        sys.exit(2)
    main(sys.argv[1])
