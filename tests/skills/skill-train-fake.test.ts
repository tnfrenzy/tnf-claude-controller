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
const STEP_COST = 0.01;
const fence = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

/** hello.stream.jsonl with the final `result` text replaced and a fixed cost. */
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

let root: string;
let runStore: RunStore;
let skills: SkillStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-skfake-"));
  runStore = new RunStore(":memory:");
  skills = createSkillStore(path.join(root, "data"));
});
afterEach(() => {
  runStore.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("skill training end to end with fake claude", () => {
  it("scores 62, 81, 93 through real RunManager runs, then needs explicit approval", async () => {
    const seq: string[] = [];
    let n = 0;
    for (const pct of [62, 81, 93]) {
      for (const kind of ["compose", "trial"]) {
        const f = path.join(root, `fx-${n++}.jsonl`);
        const text =
          kind === "compose"
            ? fence({ files: [{ path: "SKILL.md", content: `v-${pct}` }] })
            : fence({ output: "ket qua" });
        writeFixture(f, text);
        seq.push(f);
      }
    }
    const cfg = tmpConfig(root);
    const mgr = new RunManager({
      config: cfg,
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
    await skills.create({
      slug: "demo",
      title: "Demo",
      goal: "Viet email",
      files: {
        "SKILL.md": "v-0",
        "eval/rubric.json": JSON.stringify({ version: 1, criteria: [
          { id: "a", label: "A", weight: 40, kind: "ai", prompt: "A?" },
          { id: "b", label: "B", weight: 30, kind: "ai", prompt: "B?" },
          { id: "c", label: "C", weight: 30, kind: "ai", prompt: "C?" }
        ] }),
        "examples/train-1.json": JSON.stringify({ input: { q: 1 } }),
        "examples/holdout-1.json": JSON.stringify({ input: { q: "HOLD-SECRET" } })
      }
    });
    const adapter = createManagerRunStep(mgr as unknown as StepManager);
    const trainer = createSkillTrainer({
      store: skills,
      runStep: adapter.runStep,
      cancelActive: adapter.cancelActive,
      now: () => "2026-10-27T00:00:00.000Z"
    });

    await trainer.train("demo", { maxRounds: 5 });
    await trainer.whenIdle("demo");
    for (const s of [62, 81, 100]) {
      expect((await trainer.getRounds("demo")).state).toBe("awaiting_score");
      await trainer.grade("demo", { score: s, feedback: "cham tay" });
      await trainer.whenIdle("demo");
    }

    const r = await trainer.getRounds("demo");
    const rounds = r.rounds as { score: number; costUsdEstimate: number; steps: { runId: string }[] }[];
    expect(rounds.map((x) => x.score)).toEqual([62, 81, 100]);
    expect(r.state).toBe("awaiting_approval");
    expect(JSON.stringify(r)).not.toMatch(/holdout|HOLD-SECRET/i);

    const { meta } = await skills.get("demo");
    expect(meta.approvedAt).toBeUndefined();

    const runIds = rounds.flatMap((x) => x.steps.map((s) => s.runId));
    expect(runIds.length).toBe(6);
    expect(new Set(runIds).size).toBe(6);
    const sumRuns = runIds.reduce((a, id) => a + (runStore.getRun(id)?.cost_usd_est ?? 0), 0);
    expect(sumRuns).toBeGreaterThan(0);
    expect(meta.costUsdEstimate).toBeCloseTo(sumRuns, 6);

    const ap = await trainer.approve("demo");
    expect(ap.approvedAt).toBe("2026-10-27T00:00:00.000Z");
    expect((await skills.get("demo")).meta.approvedAt).toBe(ap.approvedAt);
  }, 120_000);
});
