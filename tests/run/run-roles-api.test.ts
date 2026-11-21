import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "r".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;
let testConfig: ControllerConfig;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-roles-api-"));
  const config: ControllerConfig = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: ["Agent"],
      agentsFile: path.join(root, "roles.json"),
      systemPromptFile: path.join(root, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: ["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"],
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  };
  testConfig = config;
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_WRITE_ARTIFACTS: "1" },
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/runs/:id/roles", () => {
  it("returns effective roles (override, default, 404, 401)", async () => {
    fs.writeFileSync(path.join(root, "roles.json"), JSON.stringify({ searcher: { description: "s", prompt: "p", tools: ["WebSearch"] } }), "utf8");
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "roles api", kind: "research", roles: true }) });
    const { run } = (await r.json()) as { run: { id: string } };
    await started.manager.waitFor(run.id);
    const def = (await (await fetch(`${base}/api/runs/${run.id}/roles`, { headers: H })).json()) as { roles: { id: string; prompt?: string }[] };
    expect(def.roles.length).toBeGreaterThan(0);
    expect(def.roles[0]).not.toHaveProperty("prompt");
    const dir = path.join(testConfig.dataDir, "runs", run.id);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "roles.json"), JSON.stringify({ solo: { description: "Một mình", prompt: "x", model: "haiku" } }), "utf8");
    const ov = (await (await fetch(`${base}/api/runs/${run.id}/roles`, { headers: H })).json()) as { roles: { id: string; description: string; model?: string }[] };
    expect(ov.roles).toEqual([{ id: "solo", description: "Một mình", model: "haiku" }]);
    expect((await fetch(`${base}/api/runs/nope/roles`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/runs/${run.id}/roles`)).status).toBe(401);
  });
});
