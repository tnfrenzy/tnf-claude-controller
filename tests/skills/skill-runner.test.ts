import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createSkillStore, type SkillStore } from "../../src/core/skill-workshop/store.js";
import { createSkillTrainer, type RunStep, type StepRole } from "../../src/core/skill-workshop/runner.js";

const RUBRIC = {
  version: 1,
  criteria: [
    { id: "a", label: "A", weight: 40, kind: "ai", prompt: "A?" },
    { id: "b", label: "B", weight: 30, kind: "ai", prompt: "B?" },
    { id: "c", label: "C", weight: 30, kind: "ai", prompt: "C?" }
  ]
};
const fence = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

interface Fake {
  runStep: RunStep;
  calls: { role: StepRole; prompt: string }[];
  composeCount: () => number;
  started: Promise<void>;
}

function fakeSteps(opts: { cost?: number; hold?: Promise<void>; composeInputs?: string } = {}): Fake {
  const calls: { role: StepRole; prompt: string }[] = [];
  let compose = 0;
  let held = false;
  let markStarted!: () => void;
  const started = new Promise<void>((r) => (markStarted = r));
  const runStep: RunStep = async (role, prompt) => {
    calls.push({ role, prompt });
    markStarted();
    const base = { runId: `r${calls.length}`, costUsd: opts.cost ?? 0.1, ok: true };
    if (role === "soan-skill") {
      compose++;
      if (opts.hold && !held) {
        held = true;
        await opts.hold;
      }
      const extra = opts.composeInputs !== undefined ? [{ path: "inputs.json", content: opts.composeInputs }] : [];
      return { ...base, text: fence({ files: [{ path: "SKILL.md", content: `compose-${compose}` }, ...extra] }) };
    }
    if (role === "chay-thu") return { ...base, text: fence({ output: "ok-output" }) };
    return { ...base, text: "no json here" };
  };
  return { runStep, calls, composeCount: () => compose, started };
}

let dir: string;
let store: SkillStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-runner-"));
  store = createSkillStore(dir);
  await store.create({
    slug: "demo", title: "Demo", goal: "Viết email",
    files: {
      "SKILL.md": "compose-0",
      "eval/rubric.json": JSON.stringify(RUBRIC),
      "examples/train-1.json": JSON.stringify({ input: { q: 1 } }),
      "examples/holdout-1.json": JSON.stringify({ input: { q: "HOLD-SECRET" } })
    }
  });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const mk = (f: Fake, extra: Record<string, unknown> = {}) =>
  createSkillTrainer({ store, runStep: f.runStep, now: () => "2026-10-27T00:00:00.000Z", ...extra });

async function trainToScore(t: ReturnType<typeof mk>, overrides?: Record<string, unknown>) {
  await t.train("demo", overrides);
  await t.whenIdle("demo");
}
async function gradeAndWait(t: ReturnType<typeof mk>, score: number, feedback = "nhận xét của người chấm") {
  const r = await t.grade("demo", { score, feedback });
  await t.whenIdle("demo");
  return r;
}

describe("skill runner (human grading)", () => {
  it("writes trial files, waits in awaiting_score and never calls the AI grader", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await trainToScore(t);
    expect(f.calls.map((c) => c.role)).toEqual(["soan-skill", "chay-thu"]);
    expect(f.calls.some((c) => (c.role as string) === "cham-diem")).toBe(false);
    const { meta } = await store.get("demo");
    expect(meta.state).toBe("awaiting_score");
    const files = await store.listTrialFiles("demo", 1);
    expect(files.map((x) => x.name)).toEqual(["sample-1.md"]);
    const md = await store.readTrialFile("demo", 1, "sample-1.md");
    expect(md).toContain("ok-output");
    expect(md).toContain("# Vòng 1 - mẫu 1");
    expect(md).not.toContain("HOLD-SECRET");
    const r = await t.getRounds("demo");
    expect((r.rounds as any[])[0].outputFiles).toEqual(["sample-1.md"]);
    expect((r.rounds as any[])[0].score).toBeUndefined();
  });

  it("saveRunReport gets each chay-thu runId with input, output and saved file name, no holdout", async () => {
    const f = fakeSteps();
    const saved: { runId: string; md: string }[] = [];
    const t = mk(f, { saveRunReport: (runId: string, md: string) => void saved.push({ runId, md }) });
    await trainToScore(t);
    expect(saved).toHaveLength(1);
    expect(saved[0]!.runId).toBe("r2");
    expect(saved[0]!.md).toContain('"q": 1');
    expect(saved[0]!.md).toContain("ok-output");
    expect(saved[0]!.md).toContain("trials/round-1/sample-1.md");
    expect(saved[0]!.md).not.toContain("HOLD-SECRET");
    expect(saved[0]!.md).not.toContain("holdout");
  });

  it("saveRunReport failure is logged and the round still completes", async () => {
    const f = fakeSteps();
    const logs: string[] = [];
    const t = mk(f, { saveRunReport: () => { throw new Error("disk full"); }, log: (m: string) => logs.push(m) });
    await trainToScore(t);
    expect((await store.get("demo")).meta.state).toBe("awaiting_score");
    expect(logs.some((l) => l.includes("disk full"))).toBe(true);
  });

  it("human grade 100 goes to awaiting_approval, approve records approvedAt", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await trainToScore(t);
    await gradeAndWait(t, 100, "");
    expect((await t.getRounds("demo")).state).toBe("awaiting_approval");
    const a = await t.approve("demo");
    expect(a.approvedAt).toBe("2026-10-27T00:00:00.000Z");
  });

  it("grade below 100 feeds the human feedback into the next compose prompt", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await trainToScore(t);
    await t.grade("demo", { score: 60, feedback: "FEEDBACK-NGUOI-CHAM" });
    await t.whenIdle("demo");
    const compose2 = f.calls.filter((c) => c.role === "soan-skill")[1] as { prompt: string };
    expect(compose2.prompt).toContain("FEEDBACK-NGUOI-CHAM");
    expect(compose2.prompt).toContain("NHẬN XÉT VÒNG TRƯỚC");
    const r = await t.getRounds("demo");
    expect((r.rounds as any[])[0]).toMatchObject({ score: 60, feedback: "FEEDBACK-NGUOI-CHAM", gradedBy: "human" });
    expect(r.state).toBe("awaiting_score");
    expect((await store.listTrialFiles("demo", 2)).length).toBe(1);
  });

  it("grade rejects bad input and wrong state", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await expect(t.grade("demo", { score: 50, feedback: "x" })).rejects.toMatchObject({ status: 409, code: "not_awaiting_score" });
    await trainToScore(t);
    await expect(t.grade("demo", { score: 80, feedback: "" })).rejects.toMatchObject({ status: 400, code: "invalid_grade" });
    await expect(t.grade("demo", { score: 101, feedback: "x" })).rejects.toMatchObject({ status: 400 });
  });

  it("awaiting_score survives a restart (new trainer) and can be graded or stopped", async () => {
    const f = fakeSteps();
    await trainToScore(mk(f));
    const t2 = mk(fakeSteps());
    expect((await t2.getRounds("demo")).state).toBe("awaiting_score");
    expect((await t2.pause("demo")).state).toBe("awaiting_score");
    expect((await t2.stop("demo")).state).toBe("stopped");
  });

  it("legacy meta state grading becomes stopped with a Vietnamese note", async () => {
    await store.updateMeta("demo", { state: "grading" });
    const t = mk(fakeSteps());
    expect((await t.stop("demo")).state).toBe("stopped");
    const { meta } = await store.get("demo");
    expect(meta.state).toBe("stopped");
    expect(meta.lastError).toContain("do bạn chấm");
  });

  it("train again from awaiting_score restarts a fresh round", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await trainToScore(t);
    await trainToScore(t);
    expect((await store.get("demo")).meta.state).toBe("awaiting_score");
    expect(f.composeCount()).toBe(2);
  });

  it("pause waits for the running step, resume does not repeat ok steps", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const f = fakeSteps({ hold });
    const t = mk(f);
    await t.train("demo");
    await f.started;
    await t.pause("demo");
    release();
    await t.whenIdle("demo");
    expect(f.calls.length).toBe(1);
    const meta = (await store.get("demo")).meta;
    expect(meta.paused).toBe(true);
    expect(meta.state).toBe("trial");
    await t.resume("demo");
    await t.whenIdle("demo");
    expect(f.calls.length).toBe(2);
    expect((await store.get("demo")).meta.state).toBe("awaiting_score");
  });

  it("stop ends in stopped", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const f = fakeSteps({ hold });
    const t = mk(f);
    await t.train("demo");
    await f.started;
    const s = await t.stop("demo");
    release();
    await t.whenIdle("demo");
    expect(s.state).toBe("stopped");
    expect((await store.get("demo")).meta.state).toBe("stopped");
    expect(f.calls.length).toBe(1);
  });

  it("compose with inputs.json missing `description` repairs it instead of killing the paid round", async () => {
    const bad = JSON.stringify({ fields: [{ name: "chu_de", label: "Chủ đề", type: "text" }] });
    const f = fakeSteps({ composeInputs: bad });
    const t = mk(f);
    await trainToScore(t);
    const r = await t.getRounds("demo");
    expect(r.state).toBe("awaiting_score");
    const rec = await store.get("demo");
    expect(rec.files["SKILL.md"]).toBe("compose-1");
    expect(JSON.parse(rec.files["inputs.json"] as string).description).toBe("Viết email");
    expect((r.rounds as any[])[0].errors.join(" ")).toContain("inputs.json");
    expect(f.calls.some((c) => c.role === "chay-thu")).toBe(true);
  });

  it("compose with unusable inputs.json drops it and keeps the current one", async () => {
    const good = JSON.stringify({ version: 2, fields: [{ id: "a", label: "A", kind: "text", required: true, reason: "r", group: "g" }] });
    await store.update("demo", { files: { ...(await store.get("demo")).files, "inputs.json": good } });
    const f = fakeSteps({ composeInputs: JSON.stringify({ version: 2, fields: [{ id: "A B" }] }) });
    const t = mk(f);
    await trainToScore(t);
    expect((await t.getRounds("demo")).state).toBe("awaiting_score");
    expect((await store.get("demo")).files["inputs.json"]).toBe(good);
  });

  it("compose prompt states the inputs.json v2 schema", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await trainToScore(t);
    const p = (f.calls.find((c) => c.role === "soan-skill") as { prompt: string }).prompt;
    expect(p).toContain('"version":2');
    expect(p).toContain("kind");
  });

  it("second train while running is already_running", async () => {
    let release!: () => void;
    const hold = new Promise<void>((r) => (release = r));
    const f = fakeSteps({ hold });
    const t = mk(f);
    await t.train("demo");
    await expect(t.train("demo")).rejects.toMatchObject({ code: "already_running", status: 409 });
    release();
    await t.whenIdle("demo");
  });

  it("feeds train attachments into the trial prompt and the trial file, never holdout", async () => {
    await store.attachExamples("demo", [
      { pair: "train-1", side: "input", name: "in.csv", data: Buffer.from("col,val\nTRAIN-IN,1") },
      { pair: "train-1", side: "input", name: "part.dwg", data: Buffer.from([0, 255, 254, 1, 2]) },
      { pair: "train-1", side: "expected", name: "out.txt", data: Buffer.from("TRAIN-EXPECTED") },
      { pair: "holdout-1", side: "input", name: "h.txt", data: Buffer.from("HOLD-FILE-SECRET") }
    ]);
    const f = fakeSteps();
    const t = mk(f);
    await trainToScore(t);
    const trial = f.calls.find((c) => c.role === "chay-thu") as { prompt: string };
    expect(trial.prompt).toContain("TRAIN-IN,1");
    expect(trial.prompt).toContain("- part.dwg (5 B)");
    expect(f.calls.every((c) => !c.prompt.includes("HOLD-FILE-SECRET"))).toBe(true);
    const md = await store.readTrialFile("demo", 1, "sample-1.md");
    expect(md).toContain("part.dwg");
    expect(md).not.toContain("HOLD-FILE-SECRET");
    expect((await t.getRounds("demo")).state).toBe("awaiting_score");
  });

  it("cost cap stops the next round after a human grade", async () => {
    // cost 1 per step, cap 3: round 1 = 2 USD, round 2 compose hits 3 -> cap before trial
    const f = fakeSteps({ cost: 1 });
    const t = mk(f);
    await trainToScore(t, { costCapUsd: 3 });
    await gradeAndWait(t, 60);
    const r = await t.getRounds("demo");
    expect(r.state).toBe("cost_cap");
    expect(r.rounds.length).toBe(2);
    expect((r.rounds[1] as any).score).toBeUndefined();
  });
});
