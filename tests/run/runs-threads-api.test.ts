import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "t".repeat(48);
const H = { "x-controller-token": TOKEN };

let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-threads-"));
  const config: ControllerConfig = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
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
        allowedTools: ["Agent", "Read"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: ["Bash(git push*)"],
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  };
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" } });
  base = `http://127.0.0.1:${started.policy.port}`;
  const mk = (id: string, parent: string | null) =>
    started.manager.store.createRun({ id, status: "done", prompt: id, mode: "m", model: null, session_id: null, parent_run_id: parent, project: "default", claude_version: null, run_dir: root });
  mk("root1", null);
  await new Promise((r) => setTimeout(r, 5));
  mk("other", null);
  await new Promise((r) => setTimeout(r, 5));
  mk("reply1", "root1");
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("GET /api/runs threads=1", () => {
  it("counts threads and returns the whole thread; without the flag the list stays flat", async () => {
    const t = (await (await fetch(`${base}/api/runs?threads=1&limit=1`, { headers: H })).json()) as { runs: { id: string; parent_run_id: string | null }[]; total: number };
    expect(t.total).toBe(2);
    expect(t.runs.map((r) => r.id)).toEqual(["reply1", "root1"]);
    const flat = (await (await fetch(`${base}/api/runs?limit=1`, { headers: H })).json()) as { runs: { id: string }[]; total: number };
    expect(flat.total).toBe(3);
    expect(flat.runs.map((r) => r.id)).toEqual(["reply1"]);
  });
});
