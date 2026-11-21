import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { CAD_DEFAULT_PYTHON, CAD_PYTHON_MISSING_MSG, addCadSummaries, cadKind, cadStatus, defaultCadRunner, findCadPython, inspectCad, type CadRunner } from "../../src/core/design3d/cad-tools.js";

const PY = "D:\\tnf-claude-workspace\\tools\\cad-venv\\Scripts\\python.exe";
const has = (...paths: string[]) => (p: string) => paths.includes(p);
const errOf = (r: unknown) => (r as { error: string }).error;

describe("cadKind", () => {
  it("recognises dxf, step, stp (any case) and flags dwg", () => {
    expect(cadKind("a.DXF")).toBe("dxf");
    expect(cadKind("b.step")).toBe("step");
    expect(cadKind("b.STP")).toBe("step");
    expect(cadKind("c.dwg")).toBe("dwg");
    expect(cadKind("d.sldprt")).toBeNull();
    expect(cadKind("e.cad.json")).toBeNull();
  });
});

describe("findCadPython", () => {
  it("the default venv is D:\\tnf-cad-tools (not inside a workspace) and wins over the old location", () => {
    expect(CAD_DEFAULT_PYTHON).toBe("D:\\tnf-cad-tools\\cad-venv\\Scripts\\python.exe");
    expect(findCadPython({}, null, has(CAD_DEFAULT_PYTHON, PY))).toBe(CAD_DEFAULT_PYTHON);
  });
  it("prefers TNF_CAD_PYTHON, then the configured path, then the usual venv", () => {
    const env = { TNF_CAD_PYTHON: "X:\\a\\python.exe" } as NodeJS.ProcessEnv;
    expect(findCadPython(env, "Y:\\b\\python.exe", has("X:\\a\\python.exe", "Y:\\b\\python.exe", PY))).toBe("X:\\a\\python.exe");
    expect(findCadPython({}, "Y:\\b\\python.exe", has("Y:\\b\\python.exe", PY))).toBe("Y:\\b\\python.exe");
    expect(findCadPython({}, null, has(PY))).toBe(PY);
  });
  it("falls back to the LocalAppData venv and returns null when nothing exists", () => {
    const local = "C:\\Users\\u\\AppData\\Local\\TNF\\Controller\\tools\\cad-venv\\Scripts\\python.exe";
    expect(findCadPython({ LOCALAPPDATA: "C:\\Users\\u\\AppData\\Local" }, null, has(local))).toBe(local);
    expect(findCadPython({}, null, has())).toBeNull();
  });
});

describe("cadStatus", () => {
  it("reports missing Python with the fix in the message", async () => {
    const st = await cadStatus({ env: {}, exists: has() });
    expect(st.available).toBe(false);
    expect(st.python).toBeNull();
    expect(st.message).toMatch(/pip install ezdxf cadquery/);
  });
  it("parses check_env.py output, and names a missing library", async () => {
    const ok: CadRunner = async () => ({ code: 0, stdout: JSON.stringify({ python: "3.12.10", ezdxf: "1.4.5", cadquery: "2.8.0", errors: {} }), stderr: "", timedOut: false });
    const a = await cadStatus({ env: {}, exists: has(PY), run: ok });
    expect(a).toMatchObject({ available: true, ezdxf: "1.4.5", cadquery: "2.8.0", message: "Sẵn sàng." });
    const part: CadRunner = async () => ({ code: 0, stdout: JSON.stringify({ python: "3.12", ezdxf: "1.4.5", cadquery: null, errors: {} }), stderr: "", timedOut: false });
    const b = await cadStatus({ env: {}, exists: has(PY), run: part });
    expect(b.available).toBe(true);
    expect(b.message).toContain("cadquery");
  });
  it("a broken or timed out Python is reported, not thrown", async () => {
    const bad: CadRunner = async () => ({ code: 1, stdout: "", stderr: "boom", timedOut: false });
    expect((await cadStatus({ env: {}, exists: has(PY), run: bad })).message).toContain("boom");
    const slow: CadRunner = async () => ({ code: null, stdout: "", stderr: "", timedOut: true });
    expect((await cadStatus({ env: {}, exists: has(PY), run: slow })).message).toContain("quá thời gian");
  });
});

describe("inspectCad (fake runner)", () => {
  const file = "D:\\drawings\\a.dxf";
  const exists = has(PY, file);

  it("rejects DWG with the ODA hint, unknown extensions and missing files", async () => {
    expect(errOf(await inspectCad("x.dwg", { env: {}, exists }))).toContain("ODA");
    expect(await inspectCad("x.sldprt", { env: {}, exists })).toMatchObject({ ok: false });
    expect(await inspectCad("D:\\none.dxf", { env: {}, exists })).toMatchObject({ ok: false, error: "Không thấy tệp CAD." });
  });

  it("needs a Python and says how to get one", async () => {
    const r = await inspectCad(file, { env: {}, exists: has(file) });
    expect(r.ok).toBe(false);
    expect(errOf(r)).toContain("Python");
  });

  it("runs dxf_info.py for dxf and step_info.py for step with the file as the only argument", async () => {
    const seen: string[][] = [];
    const run: CadRunner = async (py, args) => {
      seen.push([py, ...args]);
      return { code: 0, stdout: JSON.stringify({ format: args[0]!.endsWith("dxf_info.py") ? "dxf" : "step" }), stderr: "", timedOut: false };
    };
    expect(await inspectCad(file, { env: {}, exists, run, toolsDir: "T" })).toMatchObject({ ok: true, kind: "dxf" });
    const stepFile = "D:\\drawings\\b.STEP";
    expect(await inspectCad(stepFile, { env: {}, exists: has(PY, stepFile), run, toolsDir: "T" })).toMatchObject({ ok: true, kind: "step" });
    expect(seen[0]).toEqual([PY, path.join("T", "dxf_info.py"), file]);
    expect(seen[1]).toEqual([PY, path.join("T", "step_info.py"), stepFile]);
  });

  it("turns common failures into Vietnamese messages", async () => {
    const mk = (stderr: string): CadRunner => async () => ({ code: 1, stdout: "", stderr, timedOut: false });
    expect(errOf(await inspectCad(file, { env: {}, exists, run: mk("ModuleNotFoundError: No module named 'ezdxf'") }))).toContain("ezdxf");
    expect(errOf(await inspectCad(file, { env: {}, exists, run: mk("ezdxf.lldxf.const.DXFStructureError: bad") }))).toContain("hỏng");
    expect(errOf(await inspectCad(file, { env: {}, exists, run: async () => ({ code: null, stdout: "", stderr: "", timedOut: true }) }))).toContain("quá thời gian");
    expect(errOf(await inspectCad(file, { env: {}, exists, run: async () => ({ code: 0, stdout: "not json", stderr: "", timedOut: false }) }))).toContain("JSON");
  });
});

describe("CAD_PYTHON_MISSING_MSG", () => {
  it("names the venv path and every package of the 3D workshop, in Vietnamese", () => {
    expect(CAD_PYTHON_MISSING_MSG).toContain("D:\\tnf-cad-tools\\cad-venv");
    expect(CAD_PYTHON_MISSING_MSG).toContain("pip install ezdxf cadquery trimesh pillow usd-core");
    expect(CAD_PYTHON_MISSING_MSG).toContain("fast-simplification");
    expect(CAD_PYTHON_MISSING_MSG).toMatch(/Chưa có Python/);
    expect(CAD_PYTHON_MISSING_MSG).toContain("TNF_CAD_PYTHON");
  });
});

describe("defaultCadRunner timeout", () => {
  it("kills the whole process tree (a venv launcher spawns the real python as a grandchild)", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cad-tree-"));
    try {
      const grand = path.join(dir, "grand.mjs");
      fs.writeFileSync(grand, "setInterval(() => {}, 1000);\n");
      const parent = path.join(dir, "parent.mjs");
      fs.writeFileSync(
        parent,
        [
          'import { spawn } from "node:child_process";',
          // detached: outside node's kill-on-close job object, like the real python.exe a venv launcher starts
          `const g = spawn(process.execPath, [${JSON.stringify(grand)}], { stdio: ["ignore", "inherit", "inherit"], detached: true });`,
          'process.stdout.write("GRAND " + g.pid + "\\n");',
          "setInterval(() => {}, 1000);",
          "",
        ].join("\n"),
      );
      const t0 = Date.now();
      const r = await defaultCadRunner(process.execPath, [parent], 1500);
      expect(r.timedOut).toBe(true);
      expect(Date.now() - t0).toBeLessThan(20_000);
      const pid = Number(/GRAND (\d+)/.exec(r.stdout)?.[1]);
      expect(pid, r.stdout).toBeGreaterThan(0);
      const alive = (): boolean => {
        try {
          process.kill(pid, 0);
          return true;
        } catch {
          return false;
        }
      };
      for (let i = 0; i < 50 && alive(); i++) await new Promise((res) => setTimeout(res, 100));
      const still = alive();
      if (still) process.kill(pid);
      expect(still, "grandchild survived the timeout").toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 30_000);
});

describe("addCadSummaries", () => {
  it("writes <name>.cad.json next to each dxf/step, skips existing ones and other files", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cad-"));
    try {
      fs.writeFileSync(path.join(dir, "a.dxf"), "x");
      fs.writeFileSync(path.join(dir, "b.step"), "x");
      fs.writeFileSync(path.join(dir, "note.txt"), "x");
      fs.writeFileSync(path.join(dir, "b.step.cad.json"), "{}");
      const run: CadRunner = async () => ({ code: 0, stdout: '{"format":"dxf"}', stderr: "", timedOut: false });
      const written = await addCadSummaries(dir, { env: {}, exists: (p) => p === PY || fs.existsSync(p), run });
      expect(written).toEqual(["a.dxf.cad.json"]);
      expect(fs.readFileSync(path.join(dir, "a.dxf.cad.json"), "utf8").trim()).toBe('{"format":"dxf"}');
      expect(fs.readFileSync(path.join(dir, "b.step.cad.json"), "utf8")).toBe("{}");
      expect(fs.existsSync(path.join(dir, "note.txt.cad.json"))).toBe(false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("is silent when there is no Python or the folder does not exist", async () => {
    expect(await addCadSummaries("Z:\\nope", { env: {}, exists: has() })).toEqual([]);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cad-"));
    try {
      fs.writeFileSync(path.join(dir, "a.dxf"), "x");
      expect(await addCadSummaries(dir, { env: {}, exists: (p) => fs.existsSync(p) && !p.endsWith("python.exe") })).toEqual([]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

// Real round trip with the venv installed for this machine; skipped where it does not exist (CI, other PCs).
const realPython = findCadPython({}, null);
describe.skipIf(!realPython)("real CAD Python", () => {
  it("summarises a DXF written by ezdxf and a STEP written by cadquery", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cad-real-"));
    try {
      const mk = path.join(dir, "mk.py");
      fs.writeFileSync(mk, [
        "import ezdxf, cadquery as cq, sys",
        "d = ezdxf.new('R2018'); m = d.modelspace(); m.add_line((0,0),(100,0)); m.add_circle((50,50),20)",
        "d.saveas(sys.argv[1] + '/a.dxf')",
        "cq.exporters.export(cq.Workplane('XY').box(40,30,10).faces('>Z').workplane().hole(8), sys.argv[1] + '/b.step')",
      ].join("\n"));
      const made = await defaultCadRunner(realPython!, [mk, dir], 280_000);
      expect(made.code, made.stderr).toBe(0);
      const dxf = await inspectCad(path.join(dir, "a.dxf"), { timeoutMs: 280_000 });
      expect(dxf.ok).toBe(true);
      const ds = (dxf as { summary: { entities: Record<string, number>; extents: { max: number[] } } }).summary;
      expect(ds.entities).toMatchObject({ LINE: 1, CIRCLE: 1 });
      expect(ds.extents.max).toEqual([100, 70]);
      const step = await inspectCad(path.join(dir, "b.step"), { timeoutMs: 280_000 });
      expect(step.ok).toBe(true);
      const ss = (step as { summary: { volume: number; solids: number; cylindricalFaces: Array<{ radius: number }> } }).summary;
      expect(ss.solids).toBe(1);
      expect(ss.volume).toBeCloseTo(11497.35, 1);
      expect(ss.cylindricalFaces[0]!.radius).toBe(4);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  }, 600_000);
});
