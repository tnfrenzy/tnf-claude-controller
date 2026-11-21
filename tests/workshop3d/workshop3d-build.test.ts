import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CadRunner, CadRunResult } from "../../src/core/design3d/cad-tools.js";
import { runAssemble, runBuild, type BuildDeps } from "../../src/core/workshop3d/build.js";
import type { W3DPlan } from "../../src/core/workshop3d/role-output.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";

const PLAN: W3DPlan = { bbox_mm: [1100, 1400, 2300], tolerance_mm: 2, parts: [{ id: "a", name: "A", material: "m" }] };
const ok = (o: unknown): CadRunResult => ({ code: 0, stdout: JSON.stringify(o) + "\n", stderr: "", timedOut: false });

let tmp: string;
let store: ReturnType<typeof createW3DStore>;
let slug: string;
let calls: string[][];
let timeouts: Record<string, number>;

function fake(over: { check?: CadRunResult; script?: CadRunResult; bbox?: [number, number, number]; info?: CadRunResult; stl?: string[]; usdz?: CadRunResult; assemble?: CadRunResult; noGlb?: boolean; mobile?: CadRunResult; mobileWrites?: boolean } = {}): CadRunner {
  return async (_py, args, t) => {
    calls.push(args);
    const name = path.basename(args[0]!);
    timeouts[name] = t;
    const out = path.join(store.dir(slug), "outputs");
    if (name === "check_script.py") return over.check ?? ok({ ok: true, errors: [] });
    if (name === "model.py") {
      if (over.script) return over.script;
      fs.mkdirSync(path.join(out, "parts"), { recursive: true });
      fs.writeFileSync(path.join(out, "model.step"), "step");
      for (const id of over.stl ?? ["a"]) fs.writeFileSync(path.join(out, "parts", `${id}.stl`), "stl");
      return ok({});
    }
    if (name === "step_info.py") { if (over.info) return over.info; const b = over.bbox ?? [1100, 1400, 2300]; return ok({ boundingBox: { x: b[0], y: b[1], z: b[2], min: [0, 0, 0] } }); }
    if (name === "assemble_glb.py") {
      fs.mkdirSync(out, { recursive: true });
      const isMobile = args.includes("--max-triangles");
      if (isMobile && over.mobile) { if (over.mobileWrites) fs.writeFileSync(args[3]!, "partial"); return over.mobile; }
      if (!over.noGlb) fs.writeFileSync(args[3]!, "glb");
      return over.assemble ?? ok({ ok: true, triangles: 120, parts: 1, materials: 1, bytes: 3, bbox_m: [1, 1, 1], missing_materials: [], warnings: ["w1"], decimation: "not requested" });
    }
    if (name === "export_usdz.py") { if (over.usdz) return over.usdz; fs.writeFileSync(args[3]!, "usdz"); return ok({ ok: true, bytes: 4 }); }
    throw new Error("unexpected " + name);
  };
}
const deps = (run: CadRunner, extra: Partial<BuildDeps> = {}): BuildDeps => ({ python: "py", run, validateGlb: async () => ({ errors: 0, warnings: 0, messages: [] }), ...extra });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-build-"));
  store = createW3DStore(tmp);
  slug = store.create({ title: "t", description: "d" } as never);
  fs.writeFileSync(path.join(store.dir(slug), "model.py"), "import cadquery as cq\n");
  fs.writeFileSync(path.join(store.dir(slug), "materials.json"), JSON.stringify({ materials: {} }));
  calls = [];
  timeouts = {};
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe("runBuild", () => {
  it("stops at check without running the script", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ check: ok({ ok: false, errors: ["dòng 1: import os bị cấm"] }) })));
    expect(r).toMatchObject({ ok: false, stage: "check" });
    expect(r.error).toContain("import os");
    expect(calls.some((a) => path.basename(a[0]!) === "model.py")).toBe(false);
  });
  it("reports script failure with stderr tail", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ script: { code: 1, stdout: "", stderr: "Traceback (most recent call last)\nValueError", timedOut: false } })));
    expect(r).toMatchObject({ ok: false, stage: "script" });
    expect(r.error).toContain("Traceback");
  });
  it("reports timeout", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ script: { code: null, stdout: "", stderr: "", timedOut: true } })));
    expect(r.stage).toBe("script");
    expect(r.error).toContain("quá thời gian");
  });
  it("catches a rejected runner", async () => {
    const base = fake();
    const run: CadRunner = async (p, a, t) => { if (path.basename(a[0]!) === "model.py") throw new Error("boom"); return base(p, a, t); };
    const r = await runBuild(store, slug, PLAN, deps(run));
    expect(r).toMatchObject({ ok: false, stage: "script" });
  });
  it("fails when script writes no step/stl", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ script: ok({}) })));
    expect(r.stage).toBe("script");
  });
  it("rejects a bbox outside tolerance with numbers", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ bbox: [1150, 1525, 2400] })));
    expect(r).toMatchObject({ ok: false, stage: "measure" });
    expect(r.error).toContain("2400");
    expect(r.error).toContain("2300");
  });
  it("accepts axes in another order and assembles", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ bbox: [2300, 1100, 1400] })));
    expect(r).toMatchObject({ ok: true, stage: "done", triangles: 120 });
    expect(r.files).toContain("outputs/model.glb");
    expect(r.files).toContain("outputs/model.usdz");
    expect(r.files.filter((f) => f === "build.log")).toHaveLength(1);
    expect(fs.existsSync(path.join(store.dir(slug), "build.log"))).toBe(true);
  });
  it("axis order is irrelevant: measured sorted vs plan in another order passes", async () => {
    const r = await runBuild(store, slug, { ...PLAN, bbox_mm: [2300, 1100, 1400] }, deps(fake({ bbox: [1100, 1400, 2300] })));
    expect(r.ok).toBe(true);
  });
  it("true mismatch reports both number sets", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ bbox: [1150, 1525, 2400] })));
    expect(r.stage).toBe("measure");
    for (const n of ["2400", "1525", "1150", "2300", "1400", "1100"]) expect(r.error).toContain(n);
  });
  it("removes stale outputs when the script stage fails", async () => {
    const out = path.join(store.dir(slug), "outputs");
    fs.mkdirSync(out, { recursive: true });
    for (const f of ["model.glb", "model-mobile.glb", "model.usdz"]) fs.writeFileSync(path.join(out, f), "old");
    const r = await runBuild(store, slug, PLAN, deps(fake({ script: { code: 1, stdout: "", stderr: "Traceback", timedOut: false } })));
    expect(r.stage).toBe("script");
    for (const f of ["model.glb", "model-mobile.glb", "model.usdz"]) {
      expect(r.files).not.toContain("outputs/" + f);
      expect(fs.existsSync(path.join(out, f))).toBe(false);
    }
  });
  it("assemble ok without writing a GLB fails even if a stale GLB exists", async () => {
    const out = path.join(store.dir(slug), "outputs");
    fs.mkdirSync(path.join(out, "parts"), { recursive: true });
    fs.writeFileSync(path.join(out, "parts", "a.stl"), "stl");
    fs.writeFileSync(path.join(out, "model.glb"), "stale");
    const r = await runAssemble(store, slug, deps(fake({ noGlb: true })));
    expect(r).toMatchObject({ ok: false, stage: "assemble" });
    expect(r.files).not.toContain("outputs/model.glb");
  });
  it("rebuild without mobile options leaves no model-mobile.glb", async () => {
    const first = await runBuild(store, slug, PLAN, deps(fake()), { maxTriangles: 1000 });
    expect(first.files).toContain("outputs/model-mobile.glb");
    const second = await runBuild(store, slug, PLAN, deps(fake()));
    expect(second.ok).toBe(true);
    expect(second.files).not.toContain("outputs/model-mobile.glb");
  });
  it("failing mobile assemble keeps the build ok with a warning", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ mobile: { code: 1, stdout: JSON.stringify({ ok: false, error: "x" }), stderr: "", timedOut: false } })), { maxTriangles: 1000 });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("model-mobile.glb");
    expect(r.files).not.toContain("outputs/model-mobile.glb");
  });
  it("surfaces decimation unavailable as a warning", async () => {
    const asm = ok({ ok: true, triangles: 120, parts: 1, materials: 1, bytes: 3, bbox_m: [1, 1, 1], missing_materials: [], warnings: [], decimation: "unavailable" });
    const r = await runBuild(store, slug, PLAN, deps(fake({ assemble: asm })), { maxTriangles: 10 });
    expect(r.warnings.join(" ").toLowerCase()).toContain("tam giác");
  });
  it("validate errors fail the build", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake(), { validateGlb: async () => ({ errors: 1, warnings: 0, messages: ["bad accessor"] }) }));
    expect(r).toMatchObject({ ok: false, stage: "validate" });
    expect(r.error).toContain("bad accessor");
  });
  it("usdz failure is only a warning", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ usdz: { code: 1, stdout: JSON.stringify({ ok: false, error: "no pxr" }), stderr: "", timedOut: false } })));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("USDZ");
  });
  it("mobile build writes model-mobile.glb", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake()), { maxTriangles: 1000, texturePx: 512 });
    expect(r.ok).toBe(true);
    expect(r.files).toContain("outputs/model-mobile.glb");
    const mob = calls.find((a) => a.includes("--max-triangles"));
    expect(mob).toContain("1000");
    expect(mob).toContain("512");
  });
});

describe("files only list this run's outputs", () => {
  const stale = (): void => {
    const out = path.join(store.dir(slug), "outputs");
    fs.mkdirSync(path.join(out, "parts"), { recursive: true });
    for (const f of ["model.glb", "model.usdz", "model.step", "parts/a.stl"]) fs.writeFileSync(path.join(out, f), "old");
  };
  it("python missing", async () => {
    stale();
    const r = await runBuild(store, slug, PLAN, { python: null, run: fake() }, {});
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });
  it("missing model.py", async () => {
    stale();
    fs.rmSync(path.join(store.dir(slug), "model.py"));
    const r = await runBuild(store, slug, PLAN, deps(fake()));
    expect(r.stage).toBe("check");
    expect(r.files).toEqual([]);
  });
  it("rejected check", async () => {
    stale();
    const r = await runBuild(store, slug, PLAN, deps(fake({ check: ok({ ok: false, errors: ["x"] }) })));
    expect(r.stage).toBe("check");
    expect(r.files).toEqual([]);
  });
  it("runAssemble with no parts", async () => {
    stale();
    fs.rmSync(path.join(store.dir(slug), "outputs", "parts"), { recursive: true });
    const r = await runAssemble(store, slug, deps(fake()));
    expect(r.ok).toBe(false);
    expect(r.files).toEqual([]);
  });
  it("mobile run writes the file then exits 1: file removed, build ok", async () => {
    const bad = { code: 1, stdout: "", stderr: "boom", timedOut: false };
    const r = await runBuild(store, slug, PLAN, deps(fake({ mobile: bad, mobileWrites: true })), { maxTriangles: 100 });
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("model-mobile.glb");
    expect(r.files).not.toContain("outputs/model-mobile.glb");
    expect(fs.existsSync(path.join(store.dir(slug), "outputs", "model-mobile.glb"))).toBe(false);
  });
  it("mobile run writes the file then times out: file removed, build ok", async () => {
    const to = { code: null, stdout: "", stderr: "", timedOut: true };
    const r = await runBuild(store, slug, PLAN, deps(fake({ mobile: to, mobileWrites: true })), { maxTriangles: 100 });
    expect(r.ok).toBe(true);
    expect(r.files).not.toContain("outputs/model-mobile.glb");
    expect(fs.existsSync(path.join(store.dir(slug), "outputs", "model-mobile.glb"))).toBe(false);
  });
});

describe("runAssemble", () => {
  it("warns on missing materials.json", async () => {
    fs.rmSync(path.join(store.dir(slug), "materials.json"));
    fs.mkdirSync(path.join(store.dir(slug), "outputs", "parts"), { recursive: true });
    fs.writeFileSync(path.join(store.dir(slug), "outputs", "parts", "a.stl"), "stl");
    const r = await runAssemble(store, slug, deps(fake()));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("materials.json");
  });
});

const fail1 = (stderr: string, stdout = ""): CadRunResult => ({ code: 1, stdout, stderr, timedOut: false });
const late: CadRunResult = { code: null, stdout: "", stderr: "", timedOut: true };
const IMPORT_ERR = "Traceback (most recent call last):\n  File \"x.py\", line 1\nModuleNotFoundError: No module named 'trimesh'";

describe("infra failures are flagged (environment, not the model)", () => {
  it("python missing", async () => {
    const r = await runBuild(store, slug, PLAN, { python: null, run: fake() });
    expect(r).toMatchObject({ ok: false, infra: true });
  });
  it("script check: timeout, spawn error and unreadable output are infra; a rejection is not", async () => {
    expect(await runBuild(store, slug, PLAN, deps(fake({ check: late })))).toMatchObject({ ok: false, stage: "check", infra: true });
    expect(await runBuild(store, slug, PLAN, deps(fake({ check: { code: 1, stdout: "", stderr: "python crashed", timedOut: false } })))).toMatchObject({ stage: "check", infra: true });
    const base = fake();
    const boom: CadRunner = async (p, a, t) => { if (path.basename(a[0]!) === "check_script.py") throw new Error("spawn EACCES"); return base(p, a, t); };
    expect(await runBuild(store, slug, PLAN, deps(boom))).toMatchObject({ stage: "check", infra: true });
    const rejected = await runBuild(store, slug, PLAN, deps(fake({ check: ok({ ok: false, errors: ["dòng 1: không được import x"] }) })));
    expect(rejected.infra).toBeUndefined();
  });
  it("model script: spawn error and a missing module are infra; a Traceback of the model is not; a script timeout is the model's (too heavy)", async () => {
    const base = fake();
    const boom: CadRunner = async (p, a, t) => { if (path.basename(a[0]!) === "model.py") throw new Error("spawn ENOENT"); return base(p, a, t); };
    expect(await runBuild(store, slug, PLAN, deps(boom))).toMatchObject({ stage: "script", infra: true });
    expect(await runBuild(store, slug, PLAN, deps(fake({ script: fail1("ModuleNotFoundError: No module named 'cadquery'") })))).toMatchObject({ stage: "script", infra: true });
    expect((await runBuild(store, slug, PLAN, deps(fake({ script: fail1("Traceback\nValueError: bad fillet") })))).infra).toBeUndefined();
    expect((await runBuild(store, slug, PLAN, deps(fake({ script: late })))).infra).toBeUndefined();
  });
  it("step_info: timeout and import errors are infra; an unreadable STEP is not", async () => {
    expect(await runBuild(store, slug, PLAN, deps(fake({ info: late })))).toMatchObject({ stage: "measure", infra: true });
    expect(await runBuild(store, slug, PLAN, deps(fake({ info: fail1(IMPORT_ERR) })))).toMatchObject({ stage: "measure", infra: true });
    expect((await runBuild(store, slug, PLAN, deps(fake({ info: fail1("StepReaderError: no shape") })))).infra).toBeUndefined();
  });
  it("assemble: timeout, missing trimesh/pillow and spawn errors are infra; a model-content error is not", async () => {
    expect(await runBuild(store, slug, PLAN, deps(fake({ assemble: late })))).toMatchObject({ stage: "assemble", infra: true });
    expect(await runBuild(store, slug, PLAN, deps(fake({ assemble: fail1(IMPORT_ERR) })))).toMatchObject({ stage: "assemble", infra: true });
    expect(await runBuild(store, slug, PLAN, deps(fake({ assemble: fail1("", JSON.stringify({ ok: false, error: "Lỗi không mong đợi: ImportError: cannot import name 'PIL'" })) })))).toMatchObject({ stage: "assemble", infra: true });
    expect((await runBuild(store, slug, PLAN, deps(fake({ assemble: fail1("", JSON.stringify({ ok: false, error: "STL rỗng: a.stl" })) })))).infra).toBeUndefined();
  });
  it("validator: a throwing validator (gltf-validator missing) is infra; validation errors are not", async () => {
    const thrown = await runBuild(store, slug, PLAN, deps(fake(), { validateGlb: async () => { throw new Error("Cannot find package 'gltf-validator'"); } }));
    expect(thrown).toMatchObject({ ok: false, stage: "validate", infra: true });
    const bad = await runBuild(store, slug, PLAN, deps(fake(), { validateGlb: async () => ({ errors: 1, warnings: 0, messages: ["x"] }) }));
    expect(bad.infra).toBeUndefined();
  });
});

describe("timeouts", () => {
  it("script 600 s, step_info 300 s, assemble/usdz 180 s", async () => {
    await runBuild(store, slug, PLAN, deps(fake()), { maxTriangles: 1000 });
    expect(timeouts["model.py"]).toBe(600_000);
    expect(timeouts["step_info.py"]).toBe(300_000);
    expect(timeouts["assemble_glb.py"]).toBe(180_000);
    expect(timeouts["export_usdz.py"]).toBe(180_000);
  });
});

describe("bbox tolerance", () => {
  it("uses max(tolerance_mm, 1% of the largest planned dimension) and states it", async () => {
    // 2300 mm -> 23 mm: frames and curved faces may overshoot the plan a little
    expect((await runBuild(store, slug, PLAN, deps(fake({ bbox: [1120, 1415, 2321] })))).ok).toBe(true);
    const r = await runBuild(store, slug, PLAN, deps(fake({ bbox: [1100, 1400, 2330] })));
    expect(r).toMatchObject({ ok: false, stage: "measure" });
    expect(r.error).toContain("dung sai 23 mm");
    expect(r.error).toContain("2330");
    // a larger planned tolerance wins over 1 %
    expect((await runBuild(store, slug, { ...PLAN, tolerance_mm: 40 }, deps(fake({ bbox: [1100, 1400, 2335] })))).ok).toBe(true);
  });
  it("skipBboxCheck (rebuild) measures but does not compare", async () => {
    const r = await runBuild(store, slug, PLAN, deps(fake({ bbox: [1300, 1400, 2300] })), { skipBboxCheck: true });
    expect(r.ok).toBe(true);
    expect(r.bboxMm).toEqual([1300, 1400, 2300]);
  });
});

describe("parts against the plan", () => {
  const PLAN2: W3DPlan = { ...PLAN, parts: [{ id: "a", name: "A", material: "m" }, { id: "b", name: "B", material: "m" }, { id: "c", name: "C", material: "m" }] };
  it("a plan part without outputs/parts/<id>.stl is a geometry issue listing the missing ids", async () => {
    const r = await runBuild(store, slug, PLAN2, deps(fake({ stl: ["a"] })));
    expect(r).toMatchObject({ ok: false, stage: "script" });
    expect(r.infra).toBeUndefined();
    expect(r.error).toContain("b, c");
  });
  it("an STL that is not in the plan is only a warning", async () => {
    const r = await runBuild(store, slug, PLAN2, deps(fake({ stl: ["a", "b", "c", "extra_bolt"] })));
    expect(r.ok).toBe(true);
    expect(r.warnings.join(" ")).toContain("extra_bolt");
  });
});

describe("stats for the optimizer", () => {
  it("reports part count, texture px and the mobile GLB size", async () => {
    const asm = ok({ ok: true, triangles: 120, parts: 3, materials: 3, bytes: 3, bbox_m: [1, 1, 1], missing_materials: [], warnings: [], decimation: "not requested", texture_px: 1024, textures: 2 });
    const r = await runBuild(store, slug, PLAN, deps(fake({ assemble: asm })), { maxTriangles: 1000 });
    expect(r).toMatchObject({ ok: true, parts: 3, texturePx: 1024, textures: 2 });
    expect(r.mobileGlbBytes).toBe(3);
  });
});

describe("clearing old outputs", () => {
  it("retries a busy outputs/parts folder (EBUSY) and then builds", async () => {
    const real = fs.rmSync;
    let n = 0;
    const spy = vi.spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike, o?: fs.RmOptions) => {
      if (String(p).endsWith("parts") && n++ < 2) throw Object.assign(new Error("EBUSY: resource busy or locked"), { code: "EBUSY" });
      return real(p, o);
    }) as typeof fs.rmSync);
    try {
      const r = await runBuild(store, slug, PLAN, deps(fake()));
      expect(r.ok).toBe(true);
      expect(n).toBeGreaterThanOrEqual(3);
    } finally {
      spy.mockRestore();
    }
  });
  it("a folder that stays locked is an infra error with a clear message", async () => {
    const real = fs.rmSync;
    const spy = vi.spyOn(fs, "rmSync").mockImplementation(((p: fs.PathLike, o?: fs.RmOptions) => {
      if (String(p).endsWith("parts")) throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
      return real(p, o);
    }) as typeof fs.rmSync);
    try {
      const r = await runBuild(store, slug, PLAN, deps(fake()));
      expect(r).toMatchObject({ ok: false, infra: true });
      expect(r.error).toMatch(/Không xoá được/);
      expect(calls.some((a) => path.basename(a[0]!) === "model.py")).toBe(false);
    } finally {
      spy.mockRestore();
    }
  });
});
