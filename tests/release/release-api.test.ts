import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });

describe("release API", () => {
  let started: StartedServer;
  let root: string;
  let repo: string;
  const calls: string[][] = [];
  const TOKEN = "e".repeat(48);
  const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
  const url = (s: string) => `http://127.0.0.1:${started.policy.port}${s}`;

  async function waitDone(id: string): Promise<{ id: string; status: string; error?: string }> {
    for (let n = 0; n < 200; n++) {
      const got = await fetch(url(`/api/releases/${id}`), { headers: H });
      if (got.status === 200) {
        const j = (await got.json()) as { id: string; status: string; error?: string };
        if (j.status !== "running") return j;
      }
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("release did not finish");
  }

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-api-"));
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
    started = await startServer({
      config: cfg, port: 0, token: TOKEN,
      releaseDeps: { runner: async (argv) => { calls.push(argv); return { exitCode: 0, output: "ok" }; }, fetch: async () => ({ status: 200 }) },
    });
    repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    G(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "package.json"), '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": { "test": "echo t" }\n}\n');
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "init"]);
    const store = new RunStore(path.join(root, "data", "controller.db"));
    store.upsertProject({ name: "rp", repo_path: repo, base_branch: "main", allowed_commands: [] });
    store.upsertProject({ name: "norepo", repo_path: null, base_branch: null, allowed_commands: [] } as never);
    store.close();
  });
  afterAll(async () => {
    await started.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("400 without config, 404 unknown project, 401 without token", async () => {
    expect((await fetch(url("/api/projects/rp/release"), { method: "POST", body: "{}" })).status).toBe(401);
    expect((await fetch(url("/api/projects/zzz/release"), { method: "POST", headers: H, body: "{}" })).status).toBe(404);
    const r = await fetch(url("/api/projects/rp/release"), { method: "POST", headers: H, body: "{}" });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toMatch(/cấu hình phát hành/);
  });

  it("dry-run by default writes nothing; real run writes a log readable via GET", async () => {
    const put = await fetch(url("/api/projects/rp/release-config"), {
      method: "PUT", headers: H,
      body: JSON.stringify({ config: { steps: [{ type: "bump" }, { type: "build", script: "test" }] } }),
    });
    expect(put.status).toBe(200);
    const dry = await fetch(url("/api/projects/rp/release"), { method: "POST", headers: H, body: "{}" });
    expect(dry.status).toBe(200);
    const dj = (await dry.json()) as { dryRun: boolean; ok: boolean; plan: Array<{ argv: string[] }> };
    expect(dj.dryRun).toBe(true);
    expect(dj.plan.length).toBe(2);
    expect(fs.existsSync(path.join(root, "data", "releases"))).toBe(false);
    expect(calls.length).toBe(0);

    const real = await fetch(url("/api/projects/rp/release"), { method: "POST", headers: H, body: JSON.stringify({ dryRun: false }) });
    expect(real.status).toBe(202);
    const rj = (await real.json()) as { releaseId: string };
    const fin = await waitDone(rj.releaseId);
    expect(fin.status).toBe("success");
    expect(calls.length).toBe(1);
    expect(fin.id).toBe(rj.releaseId);
  });

  it("preconditions failure ends as a failed log with an error; bad release ids rejected", async () => {
    fs.writeFileSync(path.join(repo, "dirty.txt"), "x\n");
    const r = await fetch(url("/api/projects/rp/release"), { method: "POST", headers: H, body: JSON.stringify({ dryRun: false }) });
    expect(r.status).toBe(202);
    const fin = await waitDone(((await r.json()) as { releaseId: string }).releaseId);
    expect(fin.status).toBe("failed");
    expect(fin.error).toBeTruthy();
    expect((await fetch(url("/api/releases/..%2Fx"), { headers: H })).status).toBe(404);
    expect((await fetch(url("/api/releases/nope-1"), { headers: H })).status).toBe(404);
  });

  it("refuses a real release while another run is executing (the test step would crawl and time out), but still allows the dry run", async () => {
    fs.rmSync(path.join(repo, "dirty.txt"), { force: true });
    const real = started.manager.activeCount;
    started.manager.activeCount = () => 2;
    try {
      const before = calls.length;
      const r = await fetch(url("/api/projects/rp/release"), { method: "POST", headers: H, body: JSON.stringify({ dryRun: false }) });
      expect(r.status).toBe(409);
      const j = (await r.json()) as { error: string; message: string };
      expect(j.error).toBe("runs_active");
      expect(j.message).toContain("2 lần chạy");
      expect(calls.length).toBe(before);
      const dry = await fetch(url("/api/projects/rp/release"), { method: "POST", headers: H, body: JSON.stringify({ dryRun: true }) });
      expect(dry.status).toBe(200);
    } finally {
      started.manager.activeCount = real;
    }
  });
});
