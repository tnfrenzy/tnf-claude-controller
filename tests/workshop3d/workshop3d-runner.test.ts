import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { BuildOptions, BuildResult } from "../../src/core/workshop3d/build.js";
import type { PatchResult } from "../../src/core/workshop3d/patch-params.js";
import { createW3DRunner, type W3DRunnerDeps } from "../../src/core/workshop3d/runner.js";
import { COST_NOTE_PREFIX } from "../../src/core/workshop3d/runner-helpers.js";
import { W3DError } from "../../src/core/workshop3d/state.js";
import type { W3DStepResult } from "../../src/core/workshop3d/step-adapter.js";
import { createW3DStore, type W3DStore } from "../../src/core/workshop3d/store.js";
import type { W3DBrief, Workshop3DRole } from "../../src/core/workshop3d/types.js";

const json = (o: unknown): string => "```json\n" + JSON.stringify(o) + "\n```";
const VERDICT_OK = json({ scores: { beauty: 9, detail: 9, proportion: 9 }, ok: true, issues: [] });
const MAT = { color: [0.8, 0.8, 0.8], metallic: 1, roughness: 0.2 };
const DEFAULTS: Record<Workshop3DRole, string> = {
  "tiep-nhan-3d": json({ done: true, questions: [], brief: { title: "Cabin khách", object: "cabin thang máy", detail: "high", params: { w: 1100 } } }),
  "art-director": json({ style: "sang trọng", palette: ["#c0c0c0"], materials: ["inox sọc"] }),
  "detail-planner": json({ bbox_mm: [1100, 1400, 2300], tolerance_mm: 2, parts: [{ id: "floor", name: "Sàn", material: "đá" }, { id: "wall", name: "Vách", material: "inox" }] }),
  "cad-modeler": "```python\nPARAMS = {\"w\": 1100}\nprint('model')\n```",
  "material-artist": json({ materials: { floor: MAT, wall: MAT } }),
  "render-director": json({ environment: "studio", exposure: 1, cameras: [] }),
  "visual-reviewer": VERDICT_OK,
  "ar-optimizer": json({ max_triangles: 100000, texture_px: 1024, notes: "ổn" }),
  "render-presenter": "# Báo cáo\nCabin đã dựng xong.",
};
const ORDER: Workshop3DRole[] = ["tiep-nhan-3d", "art-director", "detail-planner", "cad-modeler", "material-artist", "render-director", "visual-reviewer", "ar-optimizer", "render-presenter"];
const BRIEF: W3DBrief = { title: "Cabin", object: "cabin", params: { w: 1000 }, detail: "standard", attachments: [] };

type Reply = Partial<W3DStepResult> | string;
const BUILD_OK: BuildResult = { ok: true, stage: "done", bboxMm: [1100, 1400, 2300], triangles: 5000, glbBytes: 100, warnings: [], files: [] };

let tmp: string;
let store: W3DStore;
let clock: number;
let events: string[];
let calls: { role: Workshop3DRole; prompt: string; slug: string }[];
let replies: Partial<Record<Workshop3DRole, Reply[]>>;
let builds: Partial<BuildResult>[];
let renders: { ok: boolean; files: string[]; error?: string }[];
let mobile: Partial<BuildResult>[];
let sleeps: number[];
let onStep: ((role: Workshop3DRole, slug: string, n: number) => void) | null;
let onSleep: ((n: number) => void) | null;
let resetAt: number | null;
let patches: { script: string; params: Record<string, string | number> }[];
let patchResult: PatchResult;
let cancelCalls: number;
let resetCalls: number;
let inflight: Map<string, number>;
let maxInflight: number;

const slugOf = (dir: string): string => path.basename(dir);
const sessionFile = (slug: string, rel: string): string => path.join(store.dir(slug), rel);
const rolesCalled = (): Workshop3DRole[] => calls.map((c) => c.role);
const promptsOf = (role: Workshop3DRole): string[] => calls.filter((c) => c.role === role).map((c) => c.prompt);

function deps(over: Partial<W3DRunnerDeps> = {}): W3DRunnerDeps {
  return {
    store,
    runStep: async (role, prompt, dir) => {
      const slug = slugOf(dir);
      calls.push({ role, prompt, slug });
      events.push(role);
      const n = (inflight.get(slug) ?? 0) + 1;
      inflight.set(slug, n);
      maxInflight = Math.max(maxInflight, n);
      try {
        await new Promise((r) => setTimeout(r, 1));
        onStep?.(role, slug, calls.filter((c) => c.role === role && c.slug === slug).length);
        const q = replies[role];
        const reply: Reply = q && q.length > 0 ? q.shift()! : DEFAULTS[role];
        const base: W3DStepResult = { runId: "r", costUsd: 0.1, text: "", ok: true, interrupted: false, rateLimited: false, cancelled: false };
        return typeof reply === "string" ? { ...base, text: reply } : { ...base, text: DEFAULTS[role], ...reply };
      } finally {
        inflight.set(slug, (inflight.get(slug) ?? 1) - 1);
      }
    },
    build: async () => {
      events.push("build");
      await new Promise((r) => setTimeout(r, 1));
      return { ...BUILD_OK, ...(builds.shift() ?? {}) };
    },
    assemble: async (_slug: string, opts: BuildOptions) => {
      events.push(opts.maxTriangles ? "assemble-mobile" : "assemble");
      return { ...BUILD_OK, ...(opts.maxTriangles ? (mobile.shift() ?? {}) : {}) };
    },
    render: async () => {
      events.push("render");
      return renders.shift() ?? { ok: true, files: ["renders/front.png", "renders/iso.png"] };
    },
    patchParams: async (script, params) => {
      events.push("patch");
      patches.push({ script, params });
      return patchResult;
    },
    now: () => clock,
    sleep: async (ms) => {
      sleeps.push(ms);
      clock += ms;
      onSleep?.(sleeps.length);
    },
    quotaResetAt: () => resetAt,
    cancelActive: () => {
      cancelCalls++;
    },
    resetCancel: () => {
      resetCalls++;
    },
    ...over,
  };
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-runner-"));
  store = createW3DStore(tmp);
  clock = 1_000_000;
  events = [];
  calls = [];
  replies = {};
  builds = [];
  renders = [];
  mobile = [];
  sleeps = [];
  onStep = null;
  onSleep = null;
  resetAt = null;
  patches = [];
  patchResult = { ok: true, changed: ["w"], ignored: [] };
  cancelCalls = 0;
  resetCalls = 0;
  inflight = new Map();
  maxInflight = 0;
});
afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("workshop3d runner", () => {
  it("happy path: nine roles in order, build and render in between, files written, done", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF, { "a.dxf.cad.json": "{}" });
    await runner.idle();
    expect(rolesCalled()).toEqual(ORDER);
    expect(events).toEqual(["tiep-nhan-3d", "art-director", "detail-planner", "cad-modeler", "build", "material-artist", "render-director", "assemble", "render", "visual-reviewer", "ar-optimizer", "assemble-mobile", "render-presenter"]);
    const rec = store.get(slug)!;
    expect(rec.snapshot.state).toBe("done");
    expect(rec.snapshot.costUsd).toBeCloseTo(0.9);
    expect(rec.brief.title).toBe("Cabin khách");
    expect(rec.brief.params).toEqual({ w: 1100 });
    expect(rec.brief.attachments).toEqual(["a.dxf.cad.json"]);
    expect(store.readFile(slug, "inbox/a.dxf.cad.json")).toBe("{}");
    for (const f of ["model.py", "spec.json", "materials.json", "REPORT.md", "art.json", "render-plan.json", "optimize.json", "outputs/.build-ok", "rounds/0/cad-modeler.txt"]) {
      expect(fs.existsSync(sessionFile(slug, f)), f).toBe(true);
    }
    expect(store.readFile(slug, "model.py")).toContain("PARAMS");
    expect(JSON.parse(store.readFile(slug, "spec.json")!).parts).toHaveLength(2);
    expect(store.readFile(slug, "REPORT.md")).toContain("Cabin đã dựng xong");
    expect(promptsOf("visual-reviewer")[0]).toContain(sessionFile(slug, "renders/front.png").replace(/\\/g, "/"));
  });

  it("intake asks back: awaiting_user, then answer() feeds the reply into the next intake prompt", async () => {
    replies["tiep-nhan-3d"] = [json({ done: false, questions: ["Cabin cao bao nhiêu?"] })];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("awaiting_user");
    expect(s.questions).toEqual(["Cabin cao bao nhiêu?"]);
    expect(rolesCalled()).toEqual(["tiep-nhan-3d"]);
    expect(() => runner.answer(slug, "   ")).toThrow(W3DError);
    runner.answer(slug, "cao 2300 mm");
    await runner.idle();
    const p = promptsOf("tiep-nhan-3d")[1]!;
    const data = p.slice(p.indexOf("<<<DU_LIEU"));
    expect(data).toContain("cao 2300 mm");
    expect(data).toContain("Cabin cao bao nhiêu?");
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(() => runner.answer(slug, "nữa")).toThrow(W3DError);
  });

  it("build fails twice then passes: cad-modeler called 3 times with the build error, buildRetries back to 0", async () => {
    builds = [{ ok: false, stage: "script", error: "Script lỗi (mã 1).\nNameError: foo_bar" }, { ok: false, stage: "measure", error: "Kích thước lệch" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(promptsOf("cad-modeler")).toHaveLength(3);
    expect(promptsOf("cad-modeler")[1]).toContain("NameError: foo_bar");
    expect(promptsOf("cad-modeler")[1]).toContain("print('model')"); // current script
    expect(promptsOf("cad-modeler")[2]).toContain("Kích thước lệch");
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.buildRetries).toBe(0);
  });

  it("build fails 4 times: failed with a script error", async () => {
    builds = Array.from({ length: 4 }, () => ({ ok: false, stage: "script" as const, error: "boom" }));
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.error).toMatch(/script/i);
    expect(promptsOf("cad-modeler")).toHaveLength(4);
    expect(fs.existsSync(sessionFile(slug, "outputs/.build-ok"))).toBe(false);
  });

  it("review keeps failing on geometry: cad-modeler gets the issues, after maxFixRounds the session is done with a note", async () => {
    // Scores keep improving, so the early stop (no improvement) never fires: only the round limit ends the loop.
    const bad = (n: number) => json({ scores: { beauty: n, detail: 3, proportion: 3 }, ok: false, issues: [{ target: "geometry", text: "thiếu tay vịn" }] });
    replies["visual-reviewer"] = Array.from({ length: 10 }, (_, i) => bad(i));
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.note).toMatch(/tối đa/);
    expect(promptsOf("visual-reviewer")).toHaveLength(7);
    expect(promptsOf("cad-modeler")).toHaveLength(7);
    expect(promptsOf("cad-modeler")[1]).toContain("thiếu tay vịn");
    expect(promptsOf("material-artist")).toHaveLength(7);
    expect(fs.existsSync(sessionFile(slug, "rounds/6/cad-modeler.txt"))).toBe(true);
  });

  it("material/render issues go back to materials; a render issue asks render-director again", async () => {
    replies["visual-reviewer"] = [json({ scores: { beauty: 5, detail: 8, proportion: 8 }, ok: false, issues: [{ target: "material", text: "vách quá tối" }, { target: "render", text: "góc thiếu sáng" }] })];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(promptsOf("cad-modeler")).toHaveLength(1);
    expect(promptsOf("material-artist")).toHaveLength(2);
    expect(promptsOf("material-artist")[1]).toContain("vách quá tối");
    expect(promptsOf("render-director")).toHaveLength(2);
  });

  it("a role failing 3 times in a row fails the session; resume() continues to done", async () => {
    replies["art-director"] = [{ ok: false, error: "x" }, { ok: false, interrupted: true, error: "timeout" }, { ok: false, error: "y" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    let s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.resumeState).toBe("art");
    expect(s.error).toMatch(/art-director/);
    runner.resume(slug);
    await runner.idle();
    s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(promptsOf("art-director")).toHaveLength(4);
  });

  it("a parse failure counts as a step failure and the next prompt carries the error", async () => {
    replies["art-director"] = ["không có json"];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(promptsOf("art-director")).toHaveLength(2);
    expect(promptsOf("art-director")[1]).toContain("Lần trước lỗi");
    expect(promptsOf("art-director")[1]).toContain("```json");
  });

  it("materials missing a part id fail the step with the ids; unknown ids are dropped with a note", async () => {
    replies["material-artist"] = [json({ materials: { floor: MAT } }), json({ materials: { floor: MAT, wall: MAT, ghost_part: MAT } })];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(promptsOf("material-artist")).toHaveLength(2);
    expect(promptsOf("material-artist")[1]).toMatch(/Lần trước lỗi:[\s\S]*wall/);
    expect(s.note).toContain("ghost_part");
    expect(Object.keys(JSON.parse(store.readFile(slug, "materials.json")!).materials).sort()).toEqual(["floor", "wall"]);
  });

  it("rateLimited: waiting_quota until quotaResetAt, sleeping in chunks of at most 60 s, then continues to done", async () => {
    resetAt = clock + 150_000;
    replies["art-director"] = [{ ok: false, rateLimited: true, error: "You've hit your limit" }];
    let seen: { state: string; waitUntil: number | null } | null = null;
    let slug = "";
    onSleep = (n) => {
      if (n === 1) seen = { state: store.get(slug)!.snapshot.state, waitUntil: store.get(slug)!.snapshot.waitUntil };
    };
    const runner = createW3DRunner(deps());
    slug = runner.start(BRIEF);
    await runner.idle();
    expect(seen).toEqual({ state: "waiting_quota", waitUntil: 1_150_000 });
    expect(sleeps).toEqual([60_000, 60_000, 30_000]);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.stepFailures).toBe(0);
    expect(promptsOf("art-director")).toHaveLength(2);
  });

  it("rateLimited without a known reset time waits 30 minutes", async () => {
    replies["art-director"] = [{ ok: false, rateLimited: true, error: "limit reached" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(sleeps.reduce((a, b) => a + b, 0)).toBe(30 * 60_000);
    expect(sleeps.every((ms) => ms <= 60_000)).toBe(true);
    expect(store.get(slug)!.snapshot.state).toBe("done");
  });

  it("pause() during the quota wait interrupts it between chunks", async () => {
    resetAt = clock + 10 * 60_000;
    replies["art-director"] = [{ ok: false, rateLimited: true, error: "limit reached" }];
    let slug = "";
    const runner = createW3DRunner(deps());
    onSleep = (n) => {
      if (n === 2) runner.pause(slug);
    };
    slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(sleeps).toHaveLength(2);
    expect(s.state).toBe("paused");
    expect(s.resumeState).toBe("art");
    onSleep = null;
    runner.resume(slug);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
  });

  it("pause() mid-step: the running step is kept, no further role is called; resume() continues", async () => {
    const runner = createW3DRunner(deps());
    onStep = (role, slug, n) => {
      if (role === "detail-planner" && n === 1) runner.pause(slug);
    };
    const slug = runner.start(BRIEF);
    await runner.idle();
    let s = store.get(slug)!.snapshot;
    expect(s.state).toBe("paused");
    expect(s.resumeState).toBe("modeling");
    expect(rolesCalled()).toEqual(["tiep-nhan-3d", "art-director", "detail-planner"]);
    expect(fs.existsSync(sessionFile(slug, "spec.json"))).toBe(true);
    runner.resume(slug);
    await runner.idle();
    s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(rolesCalled()).toEqual(ORDER);
  });

  it("stop() mid-step drops the late result (state not advanced, cost counted); resume() redoes that step", async () => {
    const runner = createW3DRunner(deps());
    onStep = (role, slug, n) => {
      if (role === "detail-planner" && n === 1) runner.stop(slug);
    };
    const slug = runner.start(BRIEF);
    await runner.idle();
    let s = store.get(slug)!.snapshot;
    expect(s.state).toBe("stopped");
    expect(s.resumeState).toBe("planning");
    expect(s.costUsd).toBeCloseTo(0.3);
    expect(cancelCalls).toBe(1);
    expect(fs.existsSync(sessionFile(slug, "spec.json"))).toBe(false);
    const resetsBefore = resetCalls;
    runner.resume(slug);
    expect(resetCalls).toBeGreaterThan(resetsBefore);
    await runner.idle();
    s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(promptsOf("detail-planner")).toHaveLength(2);
    expect(rolesCalled().filter((r) => r === "art-director")).toHaveLength(1);
  });

  it("a cancelled result while the session still runs is retried after resetCancel, not counted as a failure", async () => {
    replies["art-director"] = [{ ok: false, cancelled: true, error: "Đã hủy." }, { ok: false, error: "a" }, { ok: false, error: "b" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    const resetsAfterStart = resetCalls;
    await runner.idle();
    expect(resetCalls).toBeGreaterThan(resetsAfterStart);
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(promptsOf("art-director")).toHaveLength(4);
  });

  it("recover(): resumes running sessions from the store (modeling, waiting_quota), skips finished ones", async () => {
    const first = createW3DRunner(deps());
    const done = first.start(BRIEF);
    await first.idle();
    calls = [];
    events = [];
    const modeling = store.create(BRIEF);
    store.writeFile(modeling, "spec.json", JSON.stringify({ bbox_mm: [1100, 1400, 2300], tolerance_mm: 2, parts: [{ id: "floor", name: "Sàn", material: "đá" }, { id: "wall", name: "Vách", material: "inox" }] }));
    store.writeFile(modeling, "art.json", JSON.stringify({ style: "s", palette: [], materials: ["inox"] }));
    store.saveSnapshot(modeling, { ...store.get(modeling)!.snapshot, state: "modeling" });
    const waiting = store.create(BRIEF);
    store.saveSnapshot(waiting, { ...store.get(waiting)!.snapshot, state: "waiting_quota", resumeState: "intake", waitUntil: clock + 60_000 });
    const runner = createW3DRunner(deps());
    const slugs = runner.recover();
    expect(slugs.sort()).toEqual([modeling, waiting].sort());
    await runner.idle();
    expect(store.get(modeling)!.snapshot.state).toBe("done");
    expect(store.get(waiting)!.snapshot.state).toBe("done");
    expect(store.get(done)!.snapshot.state).toBe("done");
    expect(calls.filter((c) => c.slug === modeling).map((c) => c.role)[0]).toBe("cad-modeler");
    expect(calls.filter((c) => c.slug === modeling).some((c) => c.role === "tiep-nhan-3d")).toBe(false);
    expect(calls.some((c) => c.slug === done)).toBe(false);
    expect(sleeps).toEqual([60_000]);
  });

  it("rebuild(newParams): patches model.py, writes brief.params, reruns build/render/review onwards without intake, cad-modeler or material-artist", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    calls = [];
    events = [];
    runner.rebuild(slug, { w: 1200 });
    await runner.idle();
    expect(store.get(slug)!.brief.params["w"]).toBe(1200);
    expect(patches).toEqual([{ script: sessionFile(slug, "model.py"), params: { w: 1200 } }]);
    expect(events).toEqual(["patch", "build", "assemble", "render", "visual-reviewer", "ar-optimizer", "assemble-mobile", "render-presenter"]);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.fixRounds).toBe(s.maxFixRounds); // rebuild = build + render: the review cannot start fix rounds
    expect(fs.existsSync(sessionFile(slug, "rebuild.json"))).toBe(false);
  });

  it("rebuild() refuses without model.py or a successful build, and while running", async () => {
    const runner = createW3DRunner(deps());
    const fresh = store.create(BRIEF);
    store.saveSnapshot(fresh, { ...store.get(fresh)!.snapshot, state: "stopped" });
    expect(() => runner.rebuild(fresh, { w: 1 })).toThrow(/model\.py/);
    store.writeFile(fresh, "model.py", "PARAMS = {}\n");
    expect(() => runner.rebuild(fresh, { w: 1 })).toThrow(W3DError);
    const slug = runner.start(BRIEF);
    expect(() => runner.rebuild(slug)).toThrow(W3DError);
    await runner.idle();
    builds = [{ ok: false, stage: "script", error: "x" }];
    replies["cad-modeler"] = [{ ok: false, error: "a" }, { ok: false, error: "b" }, { ok: false, error: "c" }];
    runner.rebuild(slug);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("failed");
    expect(() => runner.rebuild(slug)).toThrow(/dựng/);
  });

  it("rebuild(): a PARAMS patch error fails the session with the reason", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    patchResult = { ok: false, changed: [], ignored: [], error: "Không thấy khối PARAMS" };
    runner.rebuild(slug, { w: 5 });
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.error).toContain("PARAMS");
    expect(events.filter((e) => e === "build")).toHaveLength(1);
    expect(store.get(slug)!.brief.params["w"]).toBe(1100); // brief untouched when the patch failed
    expect(fs.existsSync(sessionFile(slug, "rebuild.json"))).toBe(false);
  });

  it("rebuild() caps params: at most 50 keys, strings up to 200 chars, finite numbers only", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const many = Object.fromEntries(Array.from({ length: 51 }, (_, i) => [`k${i}`, i]));
    expect(() => runner.rebuild(slug, many)).toThrow(/50/);
    expect(() => runner.rebuild(slug, { w: "x".repeat(201) })).toThrow(/200/);
    expect(() => runner.rebuild(slug, { w: Number.POSITIVE_INFINITY })).toThrow(W3DError);
    expect(() => runner.rebuild(slug, { w: Number.NaN })).toThrow(W3DError);
    expect(() => runner.rebuild(slug, { w: 1e999 })).toThrow(W3DError);
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(fs.existsSync(sessionFile(slug, "rebuild.json"))).toBe(false);
  });

  it("one loop per session: start/recover/resume while active never runs a second loop", async () => {
    const runner = createW3DRunner(deps());
    onStep = () => {
      runner.recover();
    };
    const a = runner.start(BRIEF);
    const b = runner.start(BRIEF);
    expect(runner.recover()).toEqual([]);
    expect(() => runner.resume(a)).toThrow(W3DError);
    await runner.idle();
    expect(maxInflight).toBe(1);
    expect(store.get(a)!.snapshot.state).toBe("done");
    expect(store.get(b)!.snapshot.state).toBe("done");
    expect(calls.filter((c) => c.slug === a).map((c) => c.role)).toEqual(ORDER);
    expect(calls.filter((c) => c.slug === b).map((c) => c.role)).toEqual(ORDER);
  });

  it("render failure counts as a step failure; mobile assemble failure is only a note", async () => {
    renders = [{ ok: false, files: [], error: "Không tìm thấy Edge" }];
    mobile = [{ ok: false, stage: "assemble", error: "hết bộ nhớ" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(events.filter((e) => e === "render")).toHaveLength(2);
    expect(s.note).toMatch(/di động[\s\S]*hết bộ nhớ/);
  });

  it("costWarnUsd: notes once when the estimate passes the threshold, never stops", async () => {
    const runner = createW3DRunner(deps({ costWarnUsd: 0.25 }));
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.note!.split(COST_NOTE_PREFIX)).toHaveLength(2);
  });

  it("pause/resume/stop/answer on an unknown session throw W3DError", () => {
    const runner = createW3DRunner(deps());
    expect(() => runner.pause("20261110-000000-abcdef")).toThrow(W3DError);
    expect(() => runner.stop("nope")).toThrow(W3DError);
  });

  it("quota reset time in the past: every rate-limited retry waits at least 60 s, then the session finishes", async () => {
    resetAt = clock - 5_000;
    replies["art-director"] = Array.from({ length: 5 }, () => ({ ok: false, rateLimited: true, error: "hit your limit" }));
    const artTimes: number[] = [];
    onStep = (role) => {
      if (role === "art-director") artTimes.push(clock);
    };
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(artTimes).toHaveLength(6);
    for (let i = 1; i < artTimes.length; i++) expect(artTimes[i]! - artTimes[i - 1]!).toBeGreaterThanOrEqual(60_000);
    expect(sleeps.every((ms) => ms > 0 && ms <= 60_000)).toBe(true);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.stepFailures).toBe(0);
  });

  it.each([
    ["unknown state", { state: "bogus" }],
    ["empty object", {}],
    ["array", []],
    ["non-numeric counters", { state: "modeling", round: "x", fixRounds: 0, maxFixRounds: 6, buildRetries: 0, stepFailures: 0, costUsd: 0 }],
  ])("recover() skips a session whose snapshot is invalid (%s) and never spins", async (_name, snapshot) => {
    const bad = store.create(BRIEF);
    let gets = 0;
    const logs: string[] = [];
    // Fake store that bypasses store.get validation; after 1000 reads it reports the session gone so a broken loop cannot hang the test.
    const fake = Object.assign(Object.create(store) as W3DStore, {
      get: (slug: string) => (++gets > 1000 ? null : slug === bad ? { slug, brief: BRIEF, snapshot, createdAt: "" } : store.get(slug)),
      list: () => [{ slug: bad, title: "x", state: String((snapshot as { state?: unknown }).state), costUsd: 0, updatedAt: 0 }],
    });
    let fired = false;
    setTimeout(() => {
      fired = true;
    }, 5);
    const runner = createW3DRunner(deps({ store: fake, log: (m) => logs.push(m) }));
    expect(runner.recover()).toEqual([]);
    await runner.idle();
    await new Promise((r) => setTimeout(r, 20));
    expect(fired).toBe(true);
    expect(calls).toHaveLength(0);
    expect(gets).toBeLessThan(10);
    expect(logs.join(" | ")).toContain(bad);
  });

  it("a loop that makes no progress (snapshot never changes) stops after 3 iterations instead of spinning", async () => {
    const slug = store.create(BRIEF);
    store.saveSnapshot(slug, { ...store.get(slug)!.snapshot, state: "art" });
    const logs: string[] = [];
    const frozen = Object.assign(Object.create(store) as W3DStore, { saveSnapshot: () => undefined });
    const runner = createW3DRunner(deps({ store: frozen, log: (m) => logs.push(m) }));
    expect(runner.recover()).toEqual([slug]);
    await runner.idle();
    expect(calls.length).toBeLessThanOrEqual(3);
    expect(logs.join(" | ")).toMatch(/không tiến triển/);
  });
});

describe("workshop3d runner: environment failures, rebuild, issue routing, stats", () => {
  it("an infra build failure fails at building without calling cad-modeler again; resume() retries the build", async () => {
    builds = [{ ok: false, stage: "script", infra: true, error: "Chưa có Python cho công cụ CAD." }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.resumeState).toBe("building");
    expect(s.buildRetries).toBe(0);
    expect(s.issues).toEqual([]);
    expect(s.error).toContain("Chưa có Python cho công cụ CAD.");
    expect(s.error).toMatch(/môi trường/i);
    expect(s.error).toMatch(/Tiếp tục/);
    expect(promptsOf("cad-modeler")).toHaveLength(1);
    runner.resume(slug);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(promptsOf("cad-modeler")).toHaveLength(1);
    expect(events.filter((e) => e === "build")).toHaveLength(2);
  });

  it("an infra failure of the material re-assemble fails the session at rendering at once", async () => {
    let n = 0;
    const runner = createW3DRunner(deps({
      assemble: async () => (n++ === 0 ? { ok: false, stage: "assemble", infra: true, error: "No module named 'trimesh'", warnings: [], files: [] } : BUILD_OK),
    }));
    const slug = runner.start(BRIEF);
    await runner.idle();
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.resumeState).toBe("rendering");
    expect(s.error).toContain("trimesh");
    expect(events.filter((e) => e === "render")).toHaveLength(0);
  });

  it("rebuild: skips the old bbox check, writes the measured box to spec.json, merges only the changed params, review cannot loop", async () => {
    const opts: (BuildOptions | undefined)[] = [];
    const bad = json({ scores: { beauty: 3, detail: 3, proportion: 3 }, ok: false, issues: [{ target: "geometry", text: "méo" }] });
    const runner = createW3DRunner(deps({
      build: async (_slug, _plan, o) => {
        events.push("build");
        opts.push(o);
        return { ...BUILD_OK, bboxMm: opts.length > 1 ? [1300.04, 1400, 2300] : [1100, 1400, 2300] };
      },
    }));
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(opts[0]?.skipBboxCheck).toBeFalsy();
    patchResult = { ok: true, changed: ["w"], ignored: ["rong_mm"] };
    calls = [];
    replies["visual-reviewer"] = [bad, bad];
    runner.rebuild(slug, { w: 1300, rong_mm: 1300 });
    await runner.idle();
    expect(opts[1]).toMatchObject({ skipBboxCheck: true });
    const rec = store.get(slug)!;
    expect(rec.brief.params).toEqual({ w: 1300 });
    expect(rec.snapshot.note).toContain("rong_mm");
    expect(JSON.parse(store.readFile(slug, "spec.json")!).bbox_mm).toEqual([1300, 1400, 2300]);
    expect(rec.snapshot.state).toBe("done");
    expect(rec.snapshot.fixRounds).toBe(rec.snapshot.maxFixRounds);
    expect(rolesCalled()).not.toContain("cad-modeler");
    expect(promptsOf("visual-reviewer")).toHaveLength(1);
  });

  it("mixed geometry + material review issues: cad-modeler gets the geometry ones, material-artist still gets the material ones", async () => {
    replies["visual-reviewer"] = [json({ scores: { beauty: 5, detail: 5, proportion: 8 }, ok: false, issues: [{ target: "geometry", text: "thiếu tay vịn" }, { target: "material", text: "vách quá tối" }] })];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(promptsOf("cad-modeler")).toHaveLength(2);
    expect(promptsOf("cad-modeler")[1]).toContain("thiếu tay vịn");
    expect(promptsOf("cad-modeler")[1]).not.toContain("vách quá tối");
    expect(promptsOf("material-artist")).toHaveLength(2);
    expect(promptsOf("material-artist")[1]).toContain("vách quá tối");
    expect(promptsOf("material-artist")[1]).not.toContain("thiếu tay vịn");
  });

  it("material issues survive a failed build in the fix round", async () => {
    replies["visual-reviewer"] = [json({ scores: { beauty: 5, detail: 5, proportion: 8 }, ok: false, issues: [{ target: "geometry", text: "thiếu tay vịn" }, { target: "material", text: "vách quá tối" }] })];
    builds = [{}, { ok: false, stage: "script", error: "NameError: x" }];
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    expect(promptsOf("cad-modeler")).toHaveLength(3);
    expect(promptsOf("cad-modeler")[2]).toContain("NameError: x");
    expect(promptsOf("material-artist")[1]).toContain("vách quá tối");
  });

  it("build.json is rewritten after every assemble with part count and texture size; the optimizer sees it", async () => {
    let n = 0;
    const runner = createW3DRunner(deps({
      assemble: async (_s, o) => {
        n++;
        return { ...BUILD_OK, bboxMm: undefined as never, glbBytes: 1000 + n, parts: 2, texturePx: o.texturePx ?? 1024, textures: 1, ...(o.maxTriangles ? { mobileGlbBytes: 500 } : {}) } as BuildResult;
      },
    }));
    const slug = runner.start(BRIEF);
    await runner.idle();
    const opt = promptsOf("ar-optimizer")[0]!;
    expect(opt).toContain('"parts": 2');
    expect(opt).toContain('"texturePx": 1024');
    expect(opt).toContain('"glbBytes": 1001'); // the material GLB, not the grey build GLB (100 B)
    const stats = JSON.parse(store.readFile(slug, "outputs/build.json")!);
    expect(stats).toMatchObject({ bboxMm: [1100, 1400, 2300], parts: 2, mobileGlbBytes: 500 });
  });

  it("render paths in the reviewer and presenter prompts use forward slashes (matches the Read allow rule)", async () => {
    const runner = createW3DRunner(deps());
    const slug = runner.start(BRIEF);
    await runner.idle();
    const want = sessionFile(slug, "renders/front.png").replace(/\\/g, "/");
    expect(promptsOf("visual-reviewer")[0]).toContain(want);
    expect(promptsOf("render-presenter")[0]).toContain(want);
    expect(promptsOf("visual-reviewer")[0]).not.toContain(sessionFile(slug, "renders\\front.png"));
  });
});
