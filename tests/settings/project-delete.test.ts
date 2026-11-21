import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

let tmp: string;
const names = (s: RunStore) => s.listProjects().map((p) => p.name);

function mkRun(store: RunStore, id: string, project: string, extra: Record<string, unknown> = {}) {
  store.createRun({ id, status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project, claude_version: null, run_dir: path.join(tmp, id), ...extra } as never);
}

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pdel-"));
});
afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("project deletion", () => {
  it("deletes the project, keeps runs, survives reopen, and re-adding clears the tombstone", () => {
    const db = path.join(tmp, "a.db");
    let store = new RunStore(db);
    store.upsertProject({ name: "alpha", repo_path: null, base_branch: null, allowed_commands: [] });
    mkRun(store, "r1", "alpha");
    expect(names(store)).toContain("alpha");
    store.deleteProject("alpha");
    expect(names(store)).not.toContain("alpha");
    expect(store.getRun("r1")?.project).toBe("alpha");
    store.close();

    store = new RunStore(db);
    expect(names(store)).not.toContain("alpha");
    expect(store.getRun("r1")).not.toBeNull();
    store.upsertProject({ name: "alpha", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(names(store)).toContain("alpha");
    store.close();

    store = new RunStore(db);
    expect(names(store)).toContain("alpha");
    store.close();
  });

  it("manager refuses default, unknown, running and uncleaned-worktree projects with Vietnamese messages", () => {
    const store = new RunStore(path.join(tmp, "b.db"));
    const mgr = new RunManager({ config: {} as unknown as ControllerConfig, store, skipBillingGuard: true });
    expect(() => mgr.removeProject("default")).toThrow(/default/);
    expect(() => mgr.removeProject("nope")).toThrow(/Không tìm thấy/);

    store.upsertProject({ name: "busy", repo_path: null, base_branch: null, allowed_commands: [] });
    mkRun(store, "b1", "busy");
    store.updateRun("b1", { status: "running" });
    expect(() => mgr.removeProject("busy")).toThrow(/chưa xong|worktree/);

    store.upsertProject({ name: "wt", repo_path: null, base_branch: null, allowed_commands: [] });
    const wt = path.join(tmp, "wt-dir");
    fs.mkdirSync(wt);
    mkRun(store, "w1", "wt", { kind: "coding", worktree_path: wt, branch: "tnf/w1" });
    expect(() => mgr.removeProject("wt")).toThrow(/worktree chưa dọn/);
    fs.rmSync(wt, { recursive: true });
    mgr.removeProject("wt");
    expect(names(store)).not.toContain("wt");
    store.close();
  });
});

describe("DELETE /api/projects/:name", () => {
  let started: StartedServer;
  let root: string;
  const TOKEN = "d".repeat(48);
  const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pdel-srv-"));
    const cfg = {
      repoRoot: root,
      claudePath: null,
      models: [{ id: "sonnet", label: "sonnet" }],
      workspaceDir: path.join(root, "ws"),
      worktreesDir: path.join(root, "ws", "worktrees"),
      dataDir: path.join(root, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
      defaults: {
        authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: ["Agent"],
        agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
        research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
        coding: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles-coding.json"), systemPromptFile: path.join(root, "coord-coding.md"), settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
    } as unknown as ControllerConfig;
    started = await startServer({ config: cfg, port: 0, token: TOKEN });
  });
  afterAll(async () => {
    await started.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("401 without token; 200 with token; 400 for default", async () => {
    const base = `http://127.0.0.1:${started.policy.port}`;
    await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "gamma" }) });
    expect((await fetch(`${base}/api/projects/gamma`, { method: "DELETE" })).status).toBe(401);
    const ok = await fetch(`${base}/api/projects/gamma`, { method: "DELETE", headers: H });
    expect(ok.status).toBe(200);
    const list = (await (await fetch(`${base}/api/projects`, { headers: H })).json()) as { projects: { name: string }[] };
    expect(list.projects.map((p) => p.name)).not.toContain("gamma");
    const bad = await fetch(`${base}/api/projects/default`, { method: "DELETE", headers: H });
    expect(bad.status).toBe(400);
  });
});
