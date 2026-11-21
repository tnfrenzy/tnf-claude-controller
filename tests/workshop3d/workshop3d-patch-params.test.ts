import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import type { CadRunner } from "../../src/core/design3d/cad-tools.js";
import { patchParams } from "../../src/core/workshop3d/patch-params.js";

const probe = spawnSync("python", ["--version"], { encoding: "utf8" });
const python = probe.status === 0 ? "python" : null;

function tmpScript(text: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-pp-"));
  const f = path.join(dir, "model.py");
  fs.writeFileSync(f, text, "utf8");
  return f;
}

describe("patchParams wrapper (fake runner)", () => {
  it("passes the script and a params.json file, and parses the JSON line", async () => {
    let seen: { args: string[]; params: unknown } | null = null;
    const run: CadRunner = async (_py, args) => {
      seen = { args, params: JSON.parse(fs.readFileSync(args[2]!, "utf8")) };
      return { code: 0, stdout: 'noise\n{"ok": true, "changed": ["w"], "ignored": ["zz"]}\n', stderr: "", timedOut: false };
    };
    const r = await patchParams("D:/x/model.py", { w: 1200, zz: "a" }, { python: "py", run });
    expect(r).toEqual({ ok: true, changed: ["w"], ignored: ["zz"] });
    expect(path.basename(seen!.args[0]!)).toBe("patch_params.py");
    expect(seen!.args[1]).toBe("D:/x/model.py");
    expect(seen!.params).toEqual({ w: 1200, zz: "a" });
    expect(fs.existsSync(seen!.args[2]!)).toBe(false); // temp file cleaned up
  });
  it("rejects non-finite numbers without running python", async () => {
    let ran = false;
    const run: CadRunner = async () => {
      ran = true;
      return { code: 0, stdout: '{"ok": true, "changed": [], "ignored": []}\n', stderr: "", timedOut: false };
    };
    for (const v of [Number.POSITIVE_INFINITY, Number.NaN, 1e999]) {
      const r = await patchParams("m.py", { w: v }, { python: "py", run });
      expect(r.ok).toBe(false);
      expect(r.error).toMatch(/hữu hạn/);
    }
    expect(ran).toBe(false);
  });
  it("reports the script error, missing python, timeout, garbage and a thrown runner", async () => {
    const fail = await patchParams("m.py", {}, { python: "py", run: async () => ({ code: 1, stdout: '{"ok": false, "error": "Không thấy PARAMS"}\n', stderr: "", timedOut: false }) });
    expect(fail).toEqual({ ok: false, changed: [], ignored: [], error: "Không thấy PARAMS" });
    expect((await patchParams("m.py", {}, { python: null })).ok).toBe(false);
    const t = await patchParams("m.py", {}, { python: "py", run: async () => ({ code: null, stdout: "", stderr: "", timedOut: true }) });
    expect(t.error).toMatch(/quá thời gian/);
    const g = await patchParams("m.py", {}, { python: "py", run: async () => ({ code: 0, stdout: "nope", stderr: "", timedOut: false }) });
    expect(g.ok).toBe(false);
    const thrown = await patchParams("m.py", {}, { python: "py", run: async () => { throw new Error("boom"); } });
    expect(thrown.error).toMatch(/boom/);
  });
});

describe.skipIf(!python)("patch_params.py (real python)", () => {
  const SRC = [
    "# -*- coding: utf-8 -*-",
    '"""Cabin — mô hình."""',
    "import cadquery as cq",
    "",
    "PARAMS = {",
    '    "width": 1100,  # mm',
    '    "depth": 1400.5,',
    '    "finish": "inox sọc",',
    '    "doors": 2,',
    '    "lit": True,',
    "}",
    "",
    "def build():",
    '    PARAMS = {"width": 1}',
    '    return cq.Workplane("XY").box(PARAMS["width"], 1, 1)',
    "",
  ].join("\n");

  it("updates only existing keys, keeps the rest of the file, coerces numeric strings", async () => {
    const f = tmpScript(SRC);
    const r = await patchParams(f, { width: 1200, depth: "1500", finish: "vàng gương", nope: 3, doors: "nhiều", lit: 5 }, { python });
    expect(r.ok).toBe(true);
    expect(r.changed.sort()).toEqual(["depth", "finish", "width"]);
    expect(r.ignored.sort()).toEqual(["doors", "lit", "nope"]);
    const out = fs.readFileSync(f, "utf8");
    expect(out.startsWith('# -*- coding: utf-8 -*-\n"""Cabin — mô hình."""\nimport cadquery as cq\n\nPARAMS = {')).toBe(true);
    expect(out).toContain('def build():\n    PARAMS = {"width": 1}\n');
    const check = spawnSync(python!, ["-c", `import ast,sys;src=open(sys.argv[1],encoding='utf-8').read();t=ast.parse(src);n=[x for x in t.body if isinstance(x,ast.Assign)][0];print(repr(ast.literal_eval(n.value)))`, f], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    expect(check.stdout.trim()).toBe("{'width': 1200, 'depth': 1500, 'finish': 'vàng gương', 'doors': 2, 'lit': True}");
  });

  it("rejects non-finite values in params.json (Infinity, NaN, 1e999, 'inf') and leaves the file alone", async () => {
    const f = tmpScript("PARAMS = {'a': 1, 'b': 2, 'c': 3, 'd': 4}\n");
    const pj = path.join(path.dirname(f), "p.json");
    fs.writeFileSync(pj, '{"a": Infinity, "b": NaN, "c": 1e999, "d": "inf"}', "utf8");
    const r = spawnSync(python!, [path.resolve("tools/workshop3d/patch_params.py"), f, pj], { encoding: "utf8", env: { ...process.env, PYTHONIOENCODING: "utf-8" } });
    const j = JSON.parse(r.stdout.trim().split("\n").pop()!);
    expect(j.ok).toBe(false);
    expect(j.error).toMatch(/hữu hạn/);
    expect(fs.readFileSync(f, "utf8")).toBe("PARAMS = {'a': 1, 'b': 2, 'c': 3, 'd': 4}\n");
  });
  it("fails with one JSON line when PARAMS is missing or not a literal", async () => {
    const a = await patchParams(tmpScript("import cadquery as cq\nX = 1\n"), { x: 1 }, { python });
    expect(a.ok).toBe(false);
    expect(a.error).toMatch(/PARAMS/);
    const b = await patchParams(tmpScript("W = 3\nPARAMS = {'w': W * 2}\n"), { w: 1 }, { python });
    expect(b.ok).toBe(false);
    expect(b.error).toMatch(/PARAMS/);
  });
});
