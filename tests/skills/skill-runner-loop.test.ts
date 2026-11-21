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
}

/** Fake runStep: compose returns SKILL.md "compose-<n>" (plus optional extra files), trial echoes the sample input. */
function fakeSteps(opts: { composeFiles?: { path: string; content: string }[]; composeOk?: boolean; composeText?: string } = {}): Fake {
  const calls: { role: StepRole; prompt: string }[] = [];
  let compose = 0;
  let trial = 0;
  const runStep: RunStep = async (role, prompt) => {
    calls.push({ role, prompt });
    const base = { runId: `r${calls.length}`, costUsd: 0.1, ok: true };
    if (role === "soan-skill") {
      compose++;
      if (opts.composeOk === false) return { ...base, ok: false, error: "boom", text: "" };
      if (opts.composeText !== undefined) return { ...base, text: opts.composeText };
      const files = opts.composeFiles ?? [{ path: "SKILL.md", content: `compose-${compose}` }];
      return { ...base, text: fence({ files }) };
    }
    trial++;
    return { ...base, text: fence({ output: `OUT-${trial}` }) };
  };
  return { runStep, calls };
}

let dir: string;
let store: SkillStore;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), "skill-loop-"));
  store = createSkillStore(dir);
  await store.create({
    slug: "demo", title: "Demo", goal: "Viết email",
    files: {
      "SKILL.md": "compose-0",
      "eval/rubric.json": JSON.stringify(RUBRIC),
      "examples/train-1.json": JSON.stringify({ input: { q: "one" } }),
      "examples/train-2.json": JSON.stringify({ input: { q: "two" } }),
      "examples/holdout-1.json": JSON.stringify({ input: { q: "HOLD-SECRET" } })
    }
  });
});
afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

const mk = (f: Fake) => createSkillTrainer({ store, runStep: f.runStep, now: () => "2026-11-02T00:00:00.000Z" });
const roles = (f: Fake) => f.calls.map((c) => c.role);

describe("skill training loop (integration)", () => {
  it("compose -> trial per sample -> awaiting_score -> grade 60 -> round 2 -> grade 100 -> awaiting_approval", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await t.train("demo");
    await t.whenIdle("demo");

    expect(roles(f)).toEqual(["soan-skill", "chay-thu", "chay-thu"]);
    expect((await store.get("demo")).files["SKILL.md"]).toBe("compose-1");

    const s1 = await store.readTrialFile("demo", 1, "sample-1.md");
    const s2 = await store.readTrialFile("demo", 1, "sample-2.md");
    expect(s1).toContain("OUT-1");
    expect(s1).toContain("one");
    expect(s2).toContain("OUT-2");
    expect(s2).toContain("two");
    expect(s1).not.toContain("HOLD-SECRET");
    expect(s2).not.toContain("HOLD-SECRET");

    expect((await store.get("demo")).meta.state).toBe("awaiting_score");
    const r1 = (await t.getRounds("demo")).rounds as any[];
    expect(r1).toHaveLength(1);
    expect(r1[0].outputFiles).toEqual(["sample-1.md", "sample-2.md"]);

    await t.grade("demo", { score: 60, feedback: "FEEDBACK-VONG-1" });
    await t.whenIdle("demo");

    expect(roles(f)).toEqual(["soan-skill", "chay-thu", "chay-thu", "soan-skill", "chay-thu", "chay-thu"]);
    expect(f.calls[3]!.prompt).toContain("FEEDBACK-VONG-1");
    expect((await store.get("demo")).meta.state).toBe("awaiting_score");
    expect((await store.get("demo")).files["SKILL.md"]).toBe("compose-2");
    expect((await store.readTrialFile("demo", 2, "sample-1.md"))).toContain("OUT-3");
    expect((await store.readTrialFile("demo", 2, "sample-2.md"))).toContain("OUT-4");
    const r2 = (await t.getRounds("demo")).rounds as any[];
    expect(r2).toHaveLength(2);
    expect(r2[0].score).toBe(60);
    expect(r2[1].outputFiles).toEqual(["sample-1.md", "sample-2.md"]);

    await t.grade("demo", { score: 100, feedback: "" });
    await t.whenIdle("demo");
    expect(f.calls).toHaveLength(6);
    expect((await t.getRounds("demo")).state).toBe("awaiting_approval");
  });

  it("stops at awaiting_approval right away when round 1 is graded 100", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await t.train("demo");
    await t.whenIdle("demo");
    await t.grade("demo", { score: 100, feedback: "" });
    await t.whenIdle("demo");
    expect(f.calls).toHaveLength(3);
    expect((await t.getRounds("demo")).state).toBe("awaiting_approval");
    expect(await store.listTrialFiles("demo", 2)).toEqual([]);
  });
});

describe("listTrialFiles per round", () => {
  it("returns only the files of the requested round, empty for rounds not run", async () => {
    const f = fakeSteps();
    const t = mk(f);
    await t.train("demo");
    await t.whenIdle("demo");
    await t.grade("demo", { score: 60, feedback: "x" });
    await t.whenIdle("demo");
    const names = async (n: number) => (await store.listTrialFiles("demo", n)).map((x) => x.name).sort();
    expect(await names(1)).toEqual(["sample-1.md", "sample-2.md"]);
    expect(await names(2)).toEqual(["sample-1.md", "sample-2.md"]);
    expect(await store.readTrialFile("demo", 1, "sample-1.md")).toContain("OUT-1");
    expect(await store.readTrialFile("demo", 2, "sample-1.md")).toContain("OUT-3");
    expect(await names(3)).toEqual([]);
  });
});

describe("compose failure keeps the current skill", () => {
  it("a package rejected by the store (invalid rubric) leaves the old skill and skips trials", async () => {
    const before = await store.get("demo");
    // Passes parseComposeResult (allowed path, string content) but store.update throws SkillError.
    const f = fakeSteps({ composeFiles: [{ path: "SKILL.md", content: "NEW-SKILL" }, { path: "eval/rubric.json", content: JSON.stringify({ version: 1, criteria: [] }) }] });
    const t = mk(f);
    await t.train("demo");
    await t.whenIdle("demo");

    expect(roles(f)).toEqual(["soan-skill"]);
    const after = await store.get("demo");
    // rounds.json legitimately records the paid compose step; everything else must be untouched.
    const strip = (x: Record<string, string>) => Object.fromEntries(Object.entries(x).filter(([k]) => k !== "rounds.json"));
    expect(strip(after.files)).toEqual(strip(before.files));
    expect(after.files["SKILL.md"]).toBe("compose-0");
    expect(after.meta.title).toBe("Demo");
    expect(after.meta.goal).toBe("Viết email");
    expect(after.meta.version).toBe(before.meta.version);
    expect(await store.listTrialFiles("demo", 1)).toEqual([]);
    expect(after.meta.state).toBe("stopped");
    expect(after.meta.lastError).toContain("giữ nguyên");
  });
});

describe("retrain same round with fewer train samples", () => {
  it("removes stale sample files so listTrialFiles matches outputFiles", async () => {
    const dir2 = await fs.mkdtemp(path.join(os.tmpdir(), "skill-loop-c-"));
    try {
      const st = createSkillStore(dir2);
      await st.create({
        slug: "demo",
        title: "Demo",
        goal: "g",
        files: {
          "SKILL.md": "compose-0",
          "eval/rubric.json": JSON.stringify(RUBRIC),
          "examples/train-1.json": JSON.stringify({ input: { q: "one" } }),
          "examples/train-2.json": JSON.stringify({ input: { q: "two" } })
        }
      });
      let compose = 0;
      const runStep: RunStep = async (role) => {
        const base = { runId: "r", costUsd: 0.1, ok: true };
        if (role === "soan-skill") {
          compose++;
          return { ...base, text: fence({ files: [{ path: "SKILL.md", content: `c-${compose}` }] }) };
        }
        return { ...base, text: fence({ output: "OUT" }) };
      };
      const t = createSkillTrainer({ store: st, runStep, now: () => "2026-11-02T00:00:00.000Z" });
      await t.train("demo");
      await t.whenIdle("demo");
      expect((await st.listTrialFiles("demo", 1)).map((x) => x.name)).toEqual(["sample-1.md", "sample-2.md"]);

      const cur = await st.get("demo");
      const { ["examples/train-2.json"]: _drop, ...rest } = cur.files;
      await st.update("demo", { files: rest });

      await t.train("demo");
      await t.whenIdle("demo");
      const outputFiles = ((await t.getRounds("demo")).rounds as any[])[0].outputFiles;
      expect(outputFiles).toEqual(["sample-1.md"]);
      expect((await st.listTrialFiles("demo", 1)).map((x) => x.name)).toEqual(["sample-1.md"]);
    } finally {
      await fs.rm(dir2, { recursive: true, force: true });
    }
  });
});
