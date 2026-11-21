// Light tests for `tnf skill train` (src/cli-skill.ts): no spawn of the CLI binary, fake claude only.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import { runSkillCli } from "../../src/cli-skill.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const HELLO = path.resolve(__dirname, "..", "..", "fixtures", "hello.stream.jsonl");
const SKILL = path.resolve(__dirname, "..", "..", "fixtures", "skill-workshop", "elevator-bom.skill.json");
const fence = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

function writeFixture(file: string, text: string): void {
  const lines = fs.readFileSync(HELLO, "utf8").split(/\r?\n/).filter(Boolean);
  const out = lines.map((l) => {
    const j = JSON.parse(l);
    return j.type === "result" ? JSON.stringify({ ...j, result: text, total_cost_usd: 0.01 }) : l;
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
      coding: { allowedTools: ["Agent", "Read"], agentsFile: roles, systemPromptFile: coord, settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 }
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 }
  };
}

let root: string;
let runStore: RunStore;

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-skcli-"));
  runStore = new RunStore(":memory:");
});
afterEach(() => {
  runStore.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function makeManager(seq: string[] = []): RunManager {
  return new RunManager({
    config: tmpConfig(root),
    store: runStore,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, TNF_FAKE_CLAUDE: "1", FAKE_CLAUDE_SEQUENCE: seq.join("|"), FAKE_CLAUDE_COUNTER_FILE: path.join(root, "counter.txt") }
  });
}

describe("tnf skill train", () => {
  it("refuses a real run without --yes and never starts training", async () => {
    const errs: string[] = [];
    const code = await runSkillCli(["train", "demo"], { manager: makeManager(), fake: false, log: () => {}, err: (l) => errs.push(l) });
    expect(code).toBe(2);
    expect(errs.join("\n")).toContain("--yes");
  });

  it("requires a slug and a known subcommand", async () => {
    const errs: string[] = [];
    const deps = { manager: makeManager(), fake: true, log: () => {}, err: (l: string) => errs.push(l) };
    expect(await runSkillCli(["train"], deps)).toBe(1);
    expect(await runSkillCli(["bogus"], deps)).toBe(1);
  });

  it("trains with the fake CLI, reports rounds and leaves approval to the user", async () => {
    const seq: string[] = [];
    const add = (t: string) => {
      const f = path.join(root, `fx-${seq.length}.jsonl`);
      writeFixture(f, t);
      seq.push(f);
    };
    add(fence({ files: [{ path: "rules.md", content: "- v1\n" }] }));
    add(fence({ output: "EX-MAT-001 x4; EX-MAT-002 x2" }));
    add(fence({ output: "EX-MAT-001 x4; EX-MAT-002 x2" }));
    for (let i = 0; i < 2; i++) add(fence({ scores: [{ id: "quy-cach", ratio: 0.65, reason: "ok" }] }));

    const fx = JSON.parse(fs.readFileSync(SKILL, "utf8"));
    await createSkillStore(path.join(root, "data")).create({ slug: fx.slug, title: fx.title, goal: fx.goal, files: fx.files });

    const lines: string[] = [];
    const code = await runSkillCli(["train", fx.slug, "--max-rounds", "3"], { manager: makeManager(seq), fake: true, log: (l) => lines.push(l), err: () => {} });
    expect(code).toBe(0);
    expect(lines.join("\n")).toContain("awaiting_score");
    expect((await createSkillStore(path.join(root, "data")).get(fx.slug)).meta.approvedAt).toBeUndefined();
  }, 120_000);
});
