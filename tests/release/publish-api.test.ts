import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });

describe("POST /api/runs/:id/publish and merged flag", () => {
  let started: StartedServer;
  let root: string;
  const TOKEN = "f".repeat(48);
  const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pub-api-"));
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

  it("409 before merge, merged flag flips, 200 after merge", async () => {
    const base = `http://127.0.0.1:${started.policy.port}`;
    const store = new RunStore(path.join(root, "data", "controller.db"));
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    G(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "package.json"), '{\n  "name": "x",\n  "version": "2.0.0"\n}\n');
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "init"]);
    G(repo, ["checkout", "-q", "-b", "tnf/c1"]);
    fs.writeFileSync(path.join(repo, "f.txt"), "f\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "feat"]);
    G(repo, ["checkout", "-q", "main"]);
    store.upsertProject({ name: "rp", repo_path: repo, base_branch: "main", allowed_commands: [] });
    const mk = (id: string, extra: Record<string, unknown>) =>
      store.createRun({ id, status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project: "rp", claude_version: null, run_dir: path.join(root, id), ...extra } as never);
    mk("c1", { kind: "coding", worktree_path: path.join(root, "wt1"), branch: "tnf/c1" });
    mk("r1", {});
    store.close();

    expect((await fetch(`${base}/api/runs/c1/publish`, { method: "POST" })).status).toBe(401);
    const early = await fetch(`${base}/api/runs/c1/publish`, { method: "POST", headers: H, body: "{}" });
    expect(early.status).toBe(409);
    expect(((await early.json()) as { message: string }).message).toMatch(/commit vào main/);

    const g1 = (await (await fetch(`${base}/api/runs/c1`, { headers: H })).json()) as { run: { merged?: boolean } };
    expect(g1.run.merged).toBe(false);
    const gr = (await (await fetch(`${base}/api/runs/r1`, { headers: H })).json()) as { run: { merged?: boolean } };
    expect(gr.run.merged).toBeUndefined();

    G(repo, ["merge", "--no-ff", "-m", "merge", "tnf/c1"]);
    const g2 = (await (await fetch(`${base}/api/runs/c1`, { headers: H })).json()) as { run: { merged?: boolean } };
    expect(g2.run.merged).toBe(true);
    const ok = await fetch(`${base}/api/runs/c1/publish`, { method: "POST", headers: H, body: "{}" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { version: string }).version).toBe("2.0.1");
  });
});
