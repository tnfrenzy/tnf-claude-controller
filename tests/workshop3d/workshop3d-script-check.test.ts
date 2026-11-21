import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { checkScript } from "../../src/core/workshop3d/script-check.js";

const probe = spawnSync("python", ["--version"], { encoding: "utf8" });
const python = probe.status === 0 ? "python" : null;

function tmpScript(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-"));
  const f = path.join(dir, "model.py");
  fs.writeFileSync(f, text, "utf8");
  return f;
}

describe("checkScript wrapper (fake runner)", () => {
  it("parses the JSON the script prints", async () => {
    const r = await checkScript("x.py", {
      python: "py",
      run: async () => ({ code: 0, stdout: '{"ok": false, "errors": ["a"]}\n', stderr: "", timedOut: false }),
    });
    expect(r).toEqual({ ok: false, errors: ["a"] });
  });
  it("rejects when python is missing, on timeout and on garbage output", async () => {
    expect((await checkScript("x.py", { python: null })).ok).toBe(false);
    const t = await checkScript("x.py", { python: "py", run: async () => ({ code: null, stdout: "", stderr: "", timedOut: true }) });
    expect(t.ok).toBe(false);
    const g = await checkScript("x.py", { python: "py", run: async () => ({ code: 0, stdout: "nope", stderr: "", timedOut: false }) });
    expect(g.ok).toBe(false);
  });
  it("reports a rejected runner promise as a failed check", async () => {
    const r = await checkScript("x.py", {
      python: "py",
      run: async () => {
        throw new Error("boom");
      },
    });
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/^Không chạy được bước kiểm script: boom/);
  });
});

describe.skipIf(!python)("check_script.py (real python)", () => {
  const run = (code: string) => checkScript(tmpScript(code), { python });
  it("accepts a plain cadquery script", async () => {
    const r = await run("import cadquery as cq\nimport math\nimport os\nout = os.environ.get('X', '.')\nb = cq.Workplane('XY').box(1, 2, 3)\n");
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it.each([
    ["import subprocess\n", /subprocess/],
    ["import socket\n", /socket/],
    ["from shutil import rmtree\n", /shutil/],
    ["import os\nos.system('dir')\n", /os\.system/],
    ["eval('1')\n", /eval/],
    ["open('x', 'w')\n", /open/],
    ["x = ().__class__\n", /__class__/],
    ["getattr(object, 'a')\n", /getattr/],
    ["from os import system\n", /system/],
    ["from os import system, remove\n", /system/],
    ["import os as o\no.system('x')\n", /system/],
    ["from os import path as p\nimport os as q\nq.system('x')\n", /system/],
    ["import sys\nsys.modules['os']\n", /modules/],
    ["from sys import modules\n", /modules/],
    ["import sys as s\ns.modules['os']\n", /modules/],
    ["import os\nos.path.os.system('x')\n", /\.os/],
    ["import os\nos.path.sys.modules['subprocess']\n", /\.sys/],
    ["from os import *\n", /\*/],
    ["__builtins__['open']('x', 'w')\n", /__builtins__/],
    ["import os\nshell = os\nshell.system('dir')\n", /chỉ được dùng dạng os\.<thuộc tính>/],
    ["import sys\nalias = sys\n", /chỉ được dùng dạng os\.<thuộc tính>/],
    ["import os as o\nf = [o]\n", /chỉ được dùng dạng os\.<thuộc tính>/],
    ["from sys import *\n", /\*/],
    ["import sys\nsys._getframe().f_builtins['open']\n", /_getframe/],
    ["import sys\nf = sys._getframe\n", /_getframe/],
    ["from sys import _getframe\n", /_getframe/],
    ["x = (i for i in [1]).gi_frame\n", /gi_frame/],
    ["import cadquery as cq\nb = cq.Workplane('XY')\nc = b._x\n", /\._x/],
    ["import sys\nsys._getframe()\n", /_getframe/],
    ["x = object()\nx._y\n", /\._y/],
    ["class A:\n    def f(self):\n        return self.__class__\n", /__class__/],
    ["x = super().__class__\n", /__class__/],
    ["obj = None\nobj.__init__()\n", /__init__/],
    ["import numpy as np\nnp.ctypeslib.load_library('x', '.')\n", /ctypeslib/],
    ["import numpy as np\nd = np.DataSource('.')\n", /DataSource/],
    ["import numpy as np\na = np.genfromtxt('x.csv')\n", /genfromtxt/],
    ["import numpy as np\na = np.loadtxt('x.csv')\n", /loadtxt/],
    ["import numpy as np\na = np.fromfile('x.bin')\n", /fromfile/],
    ["import numpy as np\nnp.zeros(3).tofile('x.bin')\n", /tofile/],
    ["import numpy as np\nnp.savetxt('x.csv', np.zeros(3))\n", /savetxt/],
    ["import numpy as np\nm = np.memmap('x.bin')\n", /memmap/],
    ["from numpy import loadtxt\n", /loadtxt/],
    ["from numpy.ctypeslib import load_library\n", /ctypeslib/],
  ])("rejects %j", async (code, re) => {
    const r = await run(code);
    expect(r.ok).toBe(false);
    expect(r.errors.join("\n")).toMatch(re);
  });
  it("still accepts allowed os and sys uses", async () => {
    const r = await run("from os import path\nimport os as o\nimport sys\nx = o.environ.get('X', '.')\ny = path.join('a', 'b')\nv = sys.argv\n");
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it("accepts private self/cls members and super().__init__ inside classes", async () => {
    const r = await run(
      [
        "class Plate:",
        "    _count = 0",
        "    def __init__(self, w):",
        "        super().__init__()",
        "        self._w = w",
        "    def area(self):",
        "        return self._w * 2",
        "    @classmethod",
        "    def bump(cls):",
        "        cls._count += 1",
        "        return cls._count",
        "",
      ].join("\n"),
    );
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it("still accepts a normal cadquery chain", async () => {
    const r = await run(
      "import cadquery as cq\nimport os\nbase = cq.Workplane('XY').box(10, 10, 5).faces('>Z').workplane().hole(2)\nout = os.path.join(os.getcwd(), 'out.step')\n",
    );
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it("accepts numpy maths, pathlib paths and an if __name__ guard", async () => {
    const r = await run(
      [
        "import os",
        "import sys",
        "from pathlib import Path",
        "import numpy as np",
        "OUTPUT_DIR = sys.argv[1]",
        "pts = np.linspace(0, 1, 5)",
        "parts = Path(OUTPUT_DIR) / 'parts'",
        "def main():",
        "    os.makedirs(os.path.join(OUTPUT_DIR, 'parts'), exist_ok=True)",
        "if __name__ == '__main__':",
        "    main()",
        "",
      ].join("\n"),
    );
    expect(r).toEqual({ ok: true, errors: [] });
  });
  it("reports a syntax error as a rejection", async () => {
    const r = await run("def (:\n");
    expect(r.ok).toBe(false);
    expect(r.errors[0]).toMatch(/cú pháp|syntax/i);
  });
});
