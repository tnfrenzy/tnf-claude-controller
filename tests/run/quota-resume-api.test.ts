import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const TOKEN = "q".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;

function mkConfig(dir: string): ControllerConfig {
  return {
    repoRoot: dir,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(dir, "ws"),
    worktreesDir: path.join(dir, "ws", "worktrees"),
    dataDir: path.join(dir, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: ["Agent"],
      agentsFile: path.join(dir, "roles.json"),
      systemPromptFile: path.join(dir, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: path.join(dir, "roles.json"), systemPromptFile: path.join(dir, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent"],
        agentsFile: path.join(dir, "roles-coding.json"),
        systemPromptFile: path.join(dir, "coord-coding.md"),
        settingsFile: path.join(dir, "deny.json"),
        disallowedTools: [],
        extraArgs: [],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  } as ControllerConfig;
}

function seedPending(id: string): void {
  const store = started.manager.store;
  store.createRun({ id, status: "error", prompt: "p", mode: "single", model: "sonnet", session_id: "sess", parent_run_id: null, project: "default", claude_version: null, run_dir: root });
  const priv = started.manager as unknown as { quotaResetAt: Map<string, number>; maybeQuotaResume(id: string): boolean };
  priv.quotaResetAt.set(id, Date.now() + 3_600_000);
  expect(priv.maybeQuotaResume(id)).toBe(true);
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qapi-"));
  started = await startServer({ config: mkConfig(root), port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [], env: { ...process.env }, openDirectory: () => undefined });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("quota resume API", () => {
  it("GET returns resume null when there is no appointment, and the record with max_attempts when there is", async () => {
    started.manager.store.createRun({ id: "none1", status: "error", prompt: "p", mode: "single", model: "sonnet", session_id: "s", parent_run_id: null, project: "default", claude_version: null, run_dir: root });
    const none = await fetch(`${base}/api/runs/none1/quota-resume`, { headers: H });
    expect(none.status).toBe(200);
    expect(await none.json()).toEqual({ resume: null, max_attempts: 3 });

    seedPending("p1");
    const res = await fetch(`${base}/api/runs/p1/quota-resume`, { headers: H });
    const body = (await res.json()) as { resume: { runId: string; status: string; kind: string } | null; max_attempts: number };
    expect(body.resume).toMatchObject({ runId: "p1", status: "pending", kind: "run" });
    expect(body.max_attempts).toBe(3);
  });

  it("POST cancel flips the appointment to cancelled; a second call is 409 not_pending", async () => {
    seedPending("p2");
    const first = await fetch(`${base}/api/runs/p2/quota-resume/cancel`, { method: "POST", headers: H, body: "{}" });
    expect(first.status).toBe(200);
    expect(await first.json()).toEqual({ ok: true });
    expect(started.manager.getQuotaResume("p2")?.status).toBe("cancelled");
    const second = await fetch(`${base}/api/runs/p2/quota-resume/cancel`, { method: "POST", headers: H, body: "{}" });
    expect(second.status).toBe(409);
    expect(((await second.json()) as { error: string }).error).toBe("not_pending");
  });

  it("/api/status lists only pending appointments and the attempt cap", async () => {
    seedPending("p3");
    const res = await fetch(`${base}/api/status`, { headers: H });
    const body = (await res.json()) as { quota_resumes: Array<{ runId: string }>; quota_max_attempts: number };
    expect(body.quota_resumes.map((r) => r.runId)).toContain("p3");
    expect(body.quota_resumes.map((r) => r.runId)).not.toContain("p2");
    expect(body.quota_max_attempts).toBe(3);
  });

  it("rejects a missing token like the other routes", async () => {
    const get = await fetch(`${base}/api/runs/p1/quota-resume`);
    expect(get.status).toBe(401);
    const post = await fetch(`${base}/api/runs/p1/quota-resume/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: "{}" });
    expect(post.status).toBe(401);
  });
});
