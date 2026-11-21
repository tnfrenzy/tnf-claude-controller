import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
const TOKEN = "d".repeat(48);
const TUNNEL_HOST = "tnf-pc.example.ts.net";

function req(port: number, method: string, p: string, headers: Record<string, string>, body?: unknown): Promise<{ status: number; json: any }> {
  return new Promise((resolve, reject) => {
    const data = body === undefined ? undefined : JSON.stringify(body);
    const r = http.request(
      { host: "127.0.0.1", port, method, path: p, headers: { "x-controller-token": TOKEN, "content-type": "application/json", ...headers, ...(data ? { "content-length": String(Buffer.byteLength(data)) } : {}) } },
      (res) => {
        let s = "";
        res.on("data", (c) => (s += c));
        res.on("end", () => {
          let json: any = null;
          try { json = JSON.parse(s); } catch { /* not json */ }
          resolve({ status: res.statusCode ?? 0, json });
        });
      },
    );
    r.on("error", reject);
    if (data) r.write(data);
    r.end();
  });
}

describe("release HTTP: background run, allowRemote, tunnel detection", () => {
  const servers: StartedServer[] = [];
  let root: string;
  let repo: string;
  const calls: string[][] = [];

  async function boot(sub: string, allowRemote: boolean): Promise<StartedServer> {
    const dir = path.join(root, sub);
    const cfg = {
      repoRoot: dir, claudePath: null, models: [{ id: "sonnet", label: "sonnet" }],
      workspaceDir: path.join(dir, "ws"), worktreesDir: path.join(dir, "ws", "worktrees"), dataDir: path.join(dir, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [`https://${TUNNEL_HOST}`] },
      defaults: {
        authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: ["Agent"],
        agentsFile: path.join(dir, "roles.json"), systemPromptFile: path.join(dir, "coord.md"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
        research: { allowedTools: ["Agent"], agentsFile: path.join(dir, "roles.json"), systemPromptFile: path.join(dir, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
        coding: { allowedTools: ["Agent"], agentsFile: path.join(dir, "rc.json"), systemPromptFile: path.join(dir, "cc.md"), settingsFile: path.join(dir, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
      release: { allowRemote },
    } as unknown as ControllerConfig;
    const s = await startServer({
      config: cfg, port: 0, token: TOKEN,
      releaseDeps: { runner: async (argv) => { calls.push(argv); return { exitCode: 0, output: "ok" }; }, fetch: async () => ({ status: 200 }) },
    });
    servers.push(s);
    const store = new RunStore(path.join(dir, "data", "controller.db"));
    store.upsertProject({ name: "rp", repo_path: repo, base_branch: "main", allowed_commands: [] });
    store.close();
    return s;
  }

  beforeAll(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-async-"));
    repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    G(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "package.json"), '{\n  "name": "x",\n  "version": "1.0.0",\n  "scripts": { "test": "echo t" }\n}\n');
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "init"]);
  });
  afterAll(async () => {
    for (const s of servers) await s.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  async function setup(s: StartedServer) {
    const r = await req(s.policy.port, "PUT", "/api/projects/rp/release-config", {}, { config: { steps: [{ type: "bump" }, { type: "build", script: "test" }] } });
    expect(r.status).toBe(200);
  }
  async function waitDone(s: StartedServer, id: string) {
    for (let n = 0; n < 200; n++) {
      const g = await req(s.policy.port, "GET", `/api/releases/${id}`, {});
      if (g.status === 200 && g.json.status !== "running") return g.json;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error("timeout");
  }

  it("status reports local vs tunnel; X-Forwarded-* never makes a request look local", async () => {
    const s = await boot("a", false);
    const local = await req(s.policy.port, "GET", "/api/status", {});
    expect(local.json.release).toEqual({ viaTunnel: false, allowed: true });
    const viaHost = await req(s.policy.port, "GET", "/api/status", { host: TUNNEL_HOST });
    expect(viaHost.json.release).toEqual({ viaTunnel: true, allowed: false });
    const viaOrigin = await req(s.policy.port, "GET", "/api/status", { origin: `https://${TUNNEL_HOST}` });
    expect(viaOrigin.json.release.viaTunnel).toBe(true);
    const fwd = await req(s.policy.port, "GET", "/api/status", { "x-forwarded-for": "100.64.0.1" });
    expect(fwd.json.release.viaTunnel).toBe(true);
    const fakeLocal = await req(s.policy.port, "GET", "/api/status", { host: TUNNEL_HOST, "x-forwarded-host": "127.0.0.1" });
    expect(fakeLocal.json.release.viaTunnel).toBe(true);
  });

  it("dry-run is synchronous; real run returns an id at once and finishes in background", async () => {
    const s = await boot("b", false);
    await setup(s);
    const dry = await req(s.policy.port, "POST", "/api/projects/rp/release", {}, {});
    expect(dry.status).toBe(200);
    expect(dry.json.dryRun).toBe(true);
    const before = calls.length;
    const real = await req(s.policy.port, "POST", "/api/projects/rp/release", {}, { dryRun: false });
    expect(real.status).toBe(202);
    expect(typeof real.json.releaseId).toBe("string");
    const fin = await waitDone(s, real.json.releaseId);
    expect(fin.status).toBe("success");
    expect(calls.length).toBeGreaterThan(before);
  });

  it("403 for a real run through the tunnel unless release.allowRemote is on; dry-run still allowed", async () => {
    const s = await boot("c", false);
    await setup(s);
    const blocked = await req(s.policy.port, "POST", "/api/projects/rp/release", { host: TUNNEL_HOST }, { dryRun: false });
    expect(blocked.status).toBe(403);
    expect(blocked.json.message).toMatch(/đường hầm/);
    const dry = await req(s.policy.port, "POST", "/api/projects/rp/release", { host: TUNNEL_HOST }, {});
    expect(dry.status).toBe(200);
    const s2 = await boot("d", true);
    await setup(s2);
    const st = await req(s2.policy.port, "GET", "/api/status", { host: TUNNEL_HOST });
    expect(st.json.release).toEqual({ viaTunnel: true, allowed: true });
    const ok = await req(s2.policy.port, "POST", "/api/projects/rp/release", { host: TUNNEL_HOST }, { dryRun: false });
    expect(ok.status).toBe(202);
    await waitDone(s2, ok.json.releaseId);
  });
});
