// Runner with the Blender high-quality phase: geometry review -> hqrender -> final review -> targeted material fix ->
// partial re-render -> done; the old single-phase flow without Blender; pause / resume between images.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { W3D_BLENDER_DEFAULTS } from "../../src/core/app/config.js";
import type { BlenderRun } from "../../src/core/workshop3d/blender.js";
import type { BuildResult } from "../../src/core/workshop3d/build.js";
import { createHqDeps } from "../../src/core/workshop3d/index.js";
import { encodePng } from "../../src/core/workshop3d/png.js";
import { REVIEW_FINAL_TEXT, REVIEW_GEOMETRY_TEXT } from "../../src/core/workshop3d/prompts.js";
import { createW3DRunner, type W3DRunner, type W3DRunnerDeps } from "../../src/core/workshop3d/runner.js";
import type { W3DStepResult } from "../../src/core/workshop3d/step-adapter.js";
import { createW3DStore, type W3DStore } from "../../src/core/workshop3d/store.js";
import type { W3DBrief, W3DHqMode, Workshop3DRole } from "../../src/core/workshop3d/types.js";

const json = (o: unknown): string => "```json\n" + JSON.stringify(o) + "\n```";
const MAT = { color: [0.8, 0.8, 0.8], metallic: 1, roughness: 0.2 };
const verdict = (ok: boolean, n: number, issues: unknown[] = []) => json({ scores: { beauty: n, detail: n, proportion: n }, ok, issues });
const DEFAULTS: Record<Workshop3DRole, string> = {
  "tiep-nhan-3d": json({ done: true, questions: [], brief: { title: "Cabin", object: "cabin", detail: "high", params: { w: 1100 } } }),
  "art-director": json({ style: "sang", palette: ["#c0c0c0"], materials: ["inox"] }),
  "detail-planner": json({ bbox_mm: [1100, 1400, 2300], tolerance_mm: 2, parts: [{ id: "floor", name: "Sàn", material: "đá" }, { id: "wall", name: "Vách", material: "inox" }] }),
  "cad-modeler": "```python\nPARAMS = {\"w\": 1100}\nprint('model')\n```",
  "material-artist": json({ materials: { floor: MAT, wall: MAT } }),
  "render-director": json({ environment: "studio", exposure: 1, cameras: [] }),
  "visual-reviewer": verdict(true, 8),
  "ar-optimizer": json({ max_triangles: 100000, texture_px: 1024, notes: "ổn" }),
  "render-presenter": "# Báo cáo\nCabin đã dựng xong.",
};
const BRIEF: W3DBrief = { title: "Cabin", object: "cabin", params: { w: 1000 }, detail: "standard", attachments: [] };
const BUILD_OK: BuildResult = { ok: true, stage: "done", bboxMm: [1100, 1400, 2300], triangles: 5000, glbBytes: 100, warnings: [], files: [] };

function png(): Buffer {
  const w = 16, h = 12, data = new Uint8Array(w * h * 4);
  for (let i = 0; i < w * h; i++) data.set([(i * 37) % 255, (i * 11) % 255, 200, 255], i * 4);
  return encodePng({ width: w, height: h, data });
}

let tmp: string;
let store: W3DStore;
let events: string[];
let calls: { role: Workshop3DRole; prompt: string }[];
let replies: Partial<Record<Workshop3DRole, string[]>>;
let blenderViews: string[];
let onBlender: ((n: number) => void) | null;
let blenderPresent: boolean;

const fakeRun: BlenderRun = async (_exe, args) => {
  const job = JSON.parse(fs.readFileSync(args[args.length - 1]!, "utf8"));
  const name = job.view?.name ?? "export";
  blenderViews.push(name);
  events.push(`blender:${name}`);
  onBlender?.(blenderViews.length);
  fs.writeFileSync(job.out, job.view ? png() : Buffer.from("glTF"));
  return { code: 0, stdout: 'W3D_RESULT {"ok": true, "seconds": 3, "device": "CUDA"}\n', stderr: "", timedOut: false, aborted: false };
};

function touchGlb(slug: string): void {
  const f = path.join(store.dir(slug), "outputs", "model.glb");
  fs.mkdirSync(path.dirname(f), { recursive: true });
  fs.writeFileSync(f, "glb");
}

function makeRunner(mode: W3DHqMode): W3DRunner {
  const hq = createHqDeps({
    config: { workshop3d: { blender: { ...W3D_BLENDER_DEFAULTS } }, tools: { cad: { python: null } } },
    dataDir: tmp, store, blender: "blender.exe", run: fakeRun, validateGlb: async () => ({ errors: 0, warnings: 0, messages: [] }),
  });
  const deps: W3DRunnerDeps = {
    store,
    runStep: async (role, prompt) => {
      calls.push({ role, prompt });
      events.push(role);
      await new Promise((r) => setTimeout(r, 1));
      const q = replies[role];
      const text = q && q.length > 0 ? q.shift()! : DEFAULTS[role];
      const base: W3DStepResult = { runId: "r", costUsd: 0.1, text, ok: true, interrupted: false, rateLimited: false, cancelled: false };
      return base;
    },
    build: async (slug) => {
      events.push("build");
      touchGlb(slug);
      return BUILD_OK;
    },
    assemble: async (slug, o) => {
      events.push(o.maxTriangles ? "assemble-mobile" : "assemble");
      touchGlb(slug);
      return BUILD_OK;
    },
    render: async () => {
      events.push("render");
      return { ok: true, files: ["renders/front.png"] };
    },
    patchParams: async () => ({ ok: true, changed: [], ignored: [] }),
    now: () => Date.now(),
    sleep: async () => undefined,
    quotaResetAt: () => null,
    hq: { ...hq.hq, available: () => blenderPresent },
    hqMode: () => mode,
    limits: { maxHqFixRounds: 1 },
  };
  return createW3DRunner(deps);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-hq-runner-"));
  store = createW3DStore(tmp);
  events = [];
  calls = [];
  replies = {};
  blenderViews = [];
  onBlender = null;
  blenderPresent = true;
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

const reviewerPrompts = (): string[] => calls.filter((c) => c.role === "visual-reviewer").map((c) => c.prompt);

describe("two-phase session with Blender", () => {
  it("geometry review, Blender set, final review, targeted material fix re-rendering only the named view, done", async () => {
    replies["visual-reviewer"] = [
      // phase 1: a mirror complaint of the fast renderer must not start a fix round
      verdict(false, 7, [{ target: "material", text: "gương như kính mờ" }]),
      // phase 2: material issue seen on the door view only
      verdict(false, 6, [{ target: "material", text: "gương còn mờ", views: ["door"] }, { target: "geometry", text: "nẹp trần hơi lệch" }]),
      verdict(true, 8),
    ];
    const runner = makeRunner("final");
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const rec = store.get(slug)!;
    expect(rec.snapshot.state).toBe("done");
    const prompts = reviewerPrompts();
    expect(prompts).toHaveLength(3);
    expect(prompts[0]).toContain(REVIEW_GEOMETRY_TEXT);
    expect(prompts[1]).toContain(REVIEW_FINAL_TEXT);
    expect(prompts[1]).toContain("renders/hq/overview.png");
    // 6 views, export, then only the door again after the material fix (and the GLB again: materials changed)
    expect(blenderViews.filter((v) => v !== "export" && v !== "pano")).toEqual(["overview", "door", "ceiling", "wall_left", "wall_right", "cop", "door"]);
    expect(events.filter((e) => e === "cad-modeler")).toHaveLength(1);
    const afterFinal = events.slice(events.lastIndexOf("material-artist"));
    expect(afterFinal.slice(0, 3)).toEqual(["material-artist", "assemble", "blender:door"]);
    expect(rec.snapshot.finalScores).toEqual({ beauty: 8, detail: 8, proportion: 8 });
    expect(rec.snapshot.backlog).toEqual([]);
    const review = JSON.parse(store.readFile(slug, "review.json")!);
    expect(review.scores.beauty).toBe(7);
    expect(review.final.scores.beauty).toBe(8);
    const report = store.readFile(slug, "REPORT.md")!;
    expect(report).toContain("## Điểm duyệt");
    expect(report).toContain("Pha 1");
    expect(report).toContain("Pha 2");
    expect(report).toContain("model-blender.glb");
    const presenter = calls.find((c) => c.role === "render-presenter")!.prompt;
    expect(presenter).toContain("renders/hq/door.png");
    const detail = JSON.parse(fs.readFileSync(path.join(store.dir(slug), "renders/hq/progress.json"), "utf8"));
    expect(detail.running).toBe(false);
  });

  it("out of final fix rounds: geometry and material issues end in the report backlog", async () => {
    replies["visual-reviewer"] = [verdict(true, 8), verdict(false, 5, [{ target: "geometry", text: "thiếu COP" }])];
    const runner = makeRunner("final");
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.backlog).toEqual([{ target: "geometry", text: "thiếu COP" }]);
    expect(store.readFile(slug, "REPORT.md")).toContain("thiếu COP");
  });

  it("pause between images, resume renders only the missing ones", async () => {
    const runner = makeRunner("final");
    let slug = "";
    onBlender = (n) => {
      if (n === 2) runner.pause(slug);
    };
    slug = runner.start(BRIEF);
    await runner.idle(slug);
    expect(store.get(slug)!.snapshot.state).toBe("paused");
    expect(store.get(slug)!.snapshot.resumeState).toBe("hqrender");
    onBlender = null;
    runner.resume(slug);
    await runner.idle(slug);
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(blenderViews.filter((v) => v !== "export" && v !== "pano")).toEqual(["overview", "door", "ceiling", "wall_left", "wall_right", "cop"]);
  });

  it("Blender removed after the session started: the final phase is skipped with a note, never failed", async () => {
    blenderPresent = false;
    const runner = makeRunner("final");
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.note).toMatch(/Không tìm thấy Blender/);
    expect(reviewerPrompts()).toHaveLength(1);
  });
});

describe("without Blender (hqMode off)", () => {
  it("keeps the old single-phase flow: full review, no Blender, no review section", async () => {
    const runner = makeRunner("off");
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("done");
    expect(s.hqMode).toBeUndefined();
    expect(blenderViews).toEqual([]);
    expect(reviewerPrompts()[0]).not.toContain(REVIEW_GEOMETRY_TEXT);
    expect(store.readFile(slug, "REPORT.md")).not.toContain("## Điểm duyệt");
  });
});

describe("in-loop Blender (strong machine)", () => {
  it("Blender renders the review images every round, full review, no final phase", async () => {
    const runner = makeRunner("loop");
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    expect(store.get(slug)!.snapshot.state).toBe("done");
    expect(events).not.toContain("render");
    expect(reviewerPrompts()).toHaveLength(1);
    expect(reviewerPrompts()[0]).toContain("renders/hq/overview.png");
    expect(reviewerPrompts()[0]).not.toContain(REVIEW_GEOMETRY_TEXT);
  });
});
