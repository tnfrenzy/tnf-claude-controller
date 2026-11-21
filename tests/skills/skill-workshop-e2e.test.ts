// End-to-end skill training with the fake Claude CLI, using the fake elevator BOM skill fixture.
//
// Scoring model (runner.ts: per-criterion mean over the 2 train samples; computeScore):
//   score = 40*c1 + 40*c2 + 20*ai, rounded to 0.1
//   c1 = 1 always (every trial output contains EX-MAT-001)
//   c2 = hit/2 where hit = number of train samples whose trial output matches /EX-MAT-002 x2\b/
//   ai = ratio returned by the fake grader for criterion "quy-cach" (same for both samples)
//   => score = 40 + 20*hit + 20*ai
//   Main path: round 1 hit=1 ai=0.1 -> 62; round 2 hit=2 ai=0.05 -> 81; round 3 hit=2 ai=0.65 -> 93.
// rounds.json stores POINTS (score 0..100, criteria {id, score, max}), not ratios.
// Limit: `expected` must be a string (runner.ts only passes string expected to the grade prompt),
// and matching by material code is done only through contains/regex checks on the trial output.
// Steps per round with 2 train samples = 5: compose, trial x2, grade x2.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { createSkillStore, type SkillStore } from "../../src/core/skill-workshop/store.js";
import { createSkillTrainer } from "../../src/core/skill-workshop/runner.js";
import { createManagerRunStep, type StepManager } from "../../src/core/skill-workshop/run-step.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const HELLO = path.resolve(__dirname, "..", "..", "fixtures", "hello.stream.jsonl");
const SKILL = path.resolve(__dirname, "..", "..", "fixtures", "skill-workshop", "elevator-bom.skill.json");
const STEP_COST = 0.01;
const fence = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

function writeFixture(file: string, text: string): void {
  const lines = fs.readFileSync(HELLO, "utf8").split(/\r?\n/).filter(Boolean);
  const out = lines.map((l) => {
    const j = JSON.parse(l);
    if (j.type === "result") return JSON.stringify({ ...j, result: text, total_cost_usd: STEP_COST });
    return l;
  });
  fs.writeFileSync(file, out.join("\n") + "\n");
}

function tmpConfig(root: string): ControllerConfig {
  const roles = path.join(root, "roles.json");
  const coord = path.join(root, "coord.md");
  fs.writeFileSync(roles, "{}");
  fs.writeFileSync(coord, "coordinator");
  return {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "workspace"),
    worktreesDir: path.join(root, "workspace", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: ["Agent"],
      agentsFile: roles,
      systemPromptFile: coord,
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: roles, systemPromptFile: coord, disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent", "Read"],
        agentsFile: roles,
        systemPromptFile: coord,
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: [],
        extraArgs: [],
        maxRoleCalls: 8
      }
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 }
  };
}

/** Writes 5 fixtures per round (compose, trial1, trial2, grade1, grade2) and returns their paths in order. */
function buildScenario(root: string, rounds: { hit: 0 | 1 | 2; ai: number }[]): string[] {
  const seq: string[] = [];
  let n = 0;
  const add = (text: string) => {
    const f = path.join(root, `fx-${n++}.jsonl`);
    writeFixture(f, text);
    seq.push(f);
  };
  rounds.forEach((r, i) => {
    add(fence({ files: [{ path: "rules.md", content: `- vong ${i + 1}\n` }] }));
    for (const sample of [1, 2]) {
      add(fence({ output: `EX-MAT-001 x4; EX-MAT-002 x${r.hit >= sample ? 2 : 3}` }));
    }
  });
  return seq;
}

/** Starts training, then grades each awaiting round by hand with the given scores. */
async function drive(trainer: ReturnType<typeof createSkillTrainer>, slug: string, scores: number[], cfg: Record<string, unknown>) {
  await trainer.train(slug, cfg);
  await trainer.whenIdle(slug);
  for (const s of scores) {
    const st = (await trainer.getRounds(slug)).state;
    if (st !== "awaiting_score") break;
    await trainer.grade(slug, { score: s, feedback: "cham tay" });
    await trainer.whenIdle(slug);
  }
}

let root: string;
let runStore: RunStore;
let skills: SkillStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sk-e2e-"));
  runStore = new RunStore(":memory:");
  skills = createSkillStore(path.join(root, "data"));
});
afterEach(() => {
  runStore.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function setup(rounds: { hit: 0 | 1 | 2; ai: number }[]) {
  const seq = buildScenario(root, rounds);
  expect(seq.length).toBe(rounds.length * 3);
  const mgr = new RunManager({
    config: tmpConfig(root),
    store: runStore,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: {
      ...process.env,
      TNF_FAKE_CLAUDE: "1",
      FAKE_CLAUDE_SEQUENCE: seq.join("|"),
      FAKE_CLAUDE_COUNTER_FILE: path.join(root, "counter.txt")
    }
  });
  const fx = JSON.parse(fs.readFileSync(SKILL, "utf8"));
  await skills.create({ slug: fx.slug, title: fx.title, goal: fx.goal, files: fx.files });
  const adapter = createManagerRunStep(mgr as unknown as StepManager);
  const trainer = createSkillTrainer({
    store: skills,
    runStep: adapter.runStep,
    cancelActive: adapter.cancelActive,
    now: () => "2026-10-27T00:00:00.000Z"
  });
  return { trainer, slug: fx.slug as string };
}

describe("đường chính", () => {
  it("scores 62 -> 81 -> 93, stops at >= 90, waits for approval, rounds.json is correct", async () => {
    const { trainer, slug } = await setup([
      { hit: 1, ai: 0.1 },
      { hit: 2, ai: 0.05 },
      { hit: 2, ai: 0.65 }
    ]);
    await drive(trainer, slug, [62, 81, 100], { maxRounds: 5, passScore: 90, costCapUsd: 3 });

    const r = await trainer.getRounds(slug);
    const rounds = r.rounds as any[];
    expect(rounds.map((x) => x.score)).toEqual([62, 81, 100]);
    expect(rounds.every((x) => x.gradedBy === "human")).toBe(true);
    expect(r.state).toBe("awaiting_approval");
    expect(JSON.stringify(r)).not.toContain("HOLDOUT-EX-SECRET");

    const rec = await skills.get(slug);
    expect(rec.meta.approvedAt).toBeUndefined();

    const file = JSON.parse(rec.files["rounds.json"] as string);
    expect(file.version).toBe(1);
    expect(file.rounds.length).toBe(3);
    expect(file.rounds.map((x: any) => x.n)).toEqual([1, 2, 3]);
    for (const x of file.rounds) {
      expect(typeof x.score).toBe("number");
      expect(x.steps.length).toBe(3);
      expect(typeof x.skillSha).toBe("string");
      expect(x.skillSha.length).toBeGreaterThan(0);
    }
    expect(new Set(file.rounds.map((x: any) => x.skillSha)).size).toBe(3);
    expect(JSON.stringify(file)).not.toContain("HOLDOUT-EX-SECRET");

    const ap = await trainer.approve(slug);
    expect(ap.approvedAt).toBe("2026-10-27T00:00:00.000Z");
    expect((await skills.get(slug)).meta.approvedAt).toBe(ap.approvedAt);
  }, 120_000);

  it("goes to approval after round 1 when the human scores 100", async () => {
    const { trainer, slug } = await setup([{ hit: 2, ai: 0.65 }]);
    await drive(trainer, slug, [100], { maxRounds: 5, passScore: 90, costCapUsd: 3 });
    const r = await trainer.getRounds(slug);
    expect((r.rounds as any[]).map((x) => x.score)).toEqual([100]);
    expect(r.state).toBe("awaiting_approval");
    expect((await skills.get(slug)).meta.approvedAt).toBeUndefined();
  }, 120_000);

  it("a human score below 100 (88) starts another round instead of finishing", async () => {
    const { trainer, slug } = await setup([
      { hit: 2, ai: 0.4 },
      { hit: 1, ai: 0.4 }
    ]);
    await trainer.train(slug, { maxRounds: 5, passScore: 90, costCapUsd: 3 });
    await trainer.whenIdle(slug);
    await trainer.grade(slug, { score: 88, feedback: "thieu quy cach" });
    await trainer.whenIdle(slug);
    const r = await trainer.getRounds(slug);
    expect((r.rounds as any[])[0].score).toBe(88);
    expect(r.state).toBe("awaiting_score");
    await expect(trainer.approve(slug)).rejects.toThrow();
  }, 120_000);

  it("rejects a grade below 100 without feedback and a grade when nothing awaits scoring", async () => {
    const { trainer, slug } = await setup([{ hit: 1, ai: 0.1 }]);
    await expect(trainer.grade(slug, { score: 50, feedback: "x" })).rejects.toThrow();
    await trainer.train(slug, { maxRounds: 5, passScore: 90, costCapUsd: 3 });
    await trainer.whenIdle(slug);
    await expect(trainer.grade(slug, { score: 50, feedback: "" })).rejects.toThrow();
    expect((await trainer.getRounds(slug)).state).toBe("awaiting_score");
  }, 120_000);

  it("rejects approve when the skill is not awaiting approval", async () => {
    const { trainer, slug } = await setup([{ hit: 2, ai: 0.65 }]);
    await expect(trainer.approve(slug)).rejects.toThrow();
    expect((await skills.get(slug)).meta.approvedAt).toBeUndefined();
  });
});
