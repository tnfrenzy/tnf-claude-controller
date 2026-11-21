import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "o".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;

function makeWorktree(name: string): { dir: string; file: string } {
  const dir = path.join(root, "ws", "worktrees", "proj", name);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, "keep.txt");
  fs.writeFileSync(file, "data");
  return { dir, file };
}

function makeRun(id: string, status: "running" | "queued" | "done", worktreePath: string) {
  started.manager.store.createRun({
    id,
    status,
    prompt: "p",
    mode: "coding",
    model: "sonnet",
    session_id: null,
    parent_run_id: null,
    project: "default",
    claude_version: null,
    run_dir: root,
    kind: "coding",
    worktree_path: worktreePath,
    branch: `tnf/${id}`,
  });
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ops-"));
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
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" },
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

interface PreviewBody {
  plan: { candidates: Array<{ runIds?: string[] }>; skipped: Array<{ runId: string; reason: string }> };
  inboxRemoved: unknown[];
}

describe("cleanup preview", () => {
  it("rejects a missing token (401) and a bad olderThan (400 bad_request)", async () => {
    const r1 = await fetch(`${base}/api/cleanup/preview`);
    expect(r1.status).toBe(401);
    const r2 = await fetch(`${base}/api/cleanup/preview?olderThan=abc`, { headers: H });
    expect(r2.status).toBe(400);
    expect(((await r2.json()) as { error: string }).error).toBe("bad_request");
  });

  it("returns a plan without deleting an orphan worktree directory", async () => {
    const { dir, file } = makeWorktree("run-x");
    const r = await fetch(`${base}/api/cleanup/preview?olderThan=1`, { headers: H });
    expect(r.status).toBe(200);
    const j = (await r.json()) as PreviewBody;
    expect(Array.isArray(j.plan.candidates)).toBe(true);
    expect(Array.isArray(j.inboxRemoved)).toBe(true);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.readFileSync(file, "utf8")).toBe("data");
  });

  it("lists a running run as skipped:active, not as a candidate, and keeps its worktree", async () => {
    const { dir, file } = makeWorktree("run-active");
    const id = "20260101-000000-aaaaaa";
    makeRun(id, "running", dir);
    try {
      const r = await fetch(`${base}/api/cleanup/preview?olderThan=1`, { headers: H });
      expect(r.status).toBe(200);
      const j = (await r.json()) as PreviewBody;
      expect(j.plan.skipped).toEqual(expect.arrayContaining([expect.objectContaining({ runId: id, reason: "active" })]));
      expect(JSON.stringify(j.plan.candidates)).not.toContain(id);
      expect(fs.existsSync(dir)).toBe(true);
      expect(fs.existsSync(file)).toBe(true);
    } finally {
      started.manager.store.updateRun(id, { status: "done" });
    }
  });
});

describe("usage blocks", () => {
  let cfgDir: string;
  let saved: string | undefined;
  const rec = (ts: string, session: string, id: string, req: string): string =>
    JSON.stringify({
      timestamp: ts,
      sessionId: session,
      requestId: req,
      message: { id, model: "m1", usage: { input_tokens: 10, output_tokens: 20 } },
    });

  beforeAll(() => {
    saved = process.env["CLAUDE_CONFIG_DIR"];
    cfgDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ops-claude-"));
    process.env["CLAUDE_CONFIG_DIR"] = cfgDir;
    const dir = path.join(cfgDir, "projects", "p1");
    fs.mkdirSync(dir, { recursive: true });
    const t1 = new Date(Date.now() - 20 * 60_000).toISOString();
    const t2 = new Date(Date.now() - 10 * 60_000).toISOString();
    fs.writeFileSync(
      path.join(dir, "a.jsonl"),
      [rec(t1, "sess-A", "m-a", "r-a"), "{broken json", rec(t2, "sess-A", "m-b", "r-b")].join("\n") + "\n",
      "utf8",
    );
  });
  afterAll(() => {
    if (saved === undefined) delete process.env["CLAUDE_CONFIG_DIR"];
    else process.env["CLAUDE_CONFIG_DIR"] = saved;
    fs.rmSync(cfgDir, { recursive: true, force: true });
  });

  it("rejects a missing token (401)", async () => {
    const r = await fetch(`${base}/api/usage/blocks`);
    expect(r.status).toBe(401);
  });

  it("returns the UsageScan shape computed from the fake jsonl directory", async () => {
    const r = await fetch(`${base}/api/usage/blocks`, { headers: H });
    expect(r.status).toBe(200);
    const j = (await r.json()) as {
      byDay: Array<{ total: number }>;
      bySession: Array<{ sessionId: string; total: number }>;
      blocks: Array<{ entries: number; total: number }>;
      activeBlock: { entries: number; total: number } | null;
      remainingMs: number;
      skippedLines: number;
      skippedFiles: number;
      costIsEstimate: boolean;
    };
    expect(j.costIsEstimate).toBe(true);
    expect(j.byDay.length).toBeGreaterThanOrEqual(1);
    expect(j.byDay.reduce((s, d) => s + d.total, 0)).toBe(60);
    expect(j.bySession).toHaveLength(1);
    expect(j.bySession[0]?.sessionId).toBe("sess-A");
    expect(j.bySession[0]?.total).toBe(60);
    expect(j.blocks.reduce((s, b) => s + b.entries, 0)).toBe(2);
    expect(j.activeBlock).not.toBeNull();
    expect(j.activeBlock?.entries).toBe(2);
    expect(j.remainingMs).toBeGreaterThan(0);
    expect(j.skippedLines).toBe(1);
    expect(j.skippedFiles).toBe(0);
  });
});

describe("usage env restore", () => {
  it("restores CLAUDE_CONFIG_DIR after the usage blocks suite", () => {
    const cur = process.env["CLAUDE_CONFIG_DIR"];
    expect(cur === undefined || !cur.includes("tnf-ops-claude-")).toBe(true);
  });
});

describe("cleanup POST", () => {
  const post = (body: unknown) => fetch(`${base}/api/cleanup`, { method: "POST", headers: H, body: JSON.stringify(body) });

  it("rejects a missing token (401) and a missing/non-boolean confirm (400 confirm_required)", async () => {
    const r0 = await fetch(`${base}/api/cleanup`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ confirm: true }) });
    expect(r0.status).toBe(401);
    for (const body of [{}, { confirm: "true" }]) {
      const r = await post(body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("confirm_required");
    }
  });

  it("returns 200 with results and keeps the worktree of a just-finished (not expired) run", async () => {
    const { dir, file } = makeWorktree("run-done");
    const id = "20260101-000000-dddddd";
    makeRun(id, "running", dir);
    started.manager.store.updateRun(id, { status: "done" });
    const r = await post({ confirm: true });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { results: unknown[]; plan: { candidates: unknown[] } };
    expect(Array.isArray(j.results)).toBe(true);
    expect(j.plan).toBeTruthy();
    expect(JSON.stringify(j.plan.candidates)).not.toContain(id);
    expect(fs.existsSync(dir)).toBe(true);
    expect(fs.existsSync(file)).toBe(true);
    expect(started.manager.store.getRun(id)?.status).toBe("done");
  });

  for (const status of ["running", "queued"] as const) {
    it(`returns 409 still_running and deletes nothing while a ${status} run exists`, async () => {
      const { dir, file } = makeWorktree(`run-${status}`);
      const id = status === "running" ? "20260101-000000-bbbbbb" : "20260101-000000-cccccc";
      makeRun(id, status, dir);
      try {
        const r = await post({ confirm: true });
        expect(r.status).toBe(409);
        expect(((await r.json()) as { error: string }).error).toBe("still_running");
        expect(fs.existsSync(dir)).toBe(true);
        expect(fs.readFileSync(file, "utf8")).toBe("data");
        expect(started.manager.store.getRun(id)?.status).toBe(status);
      } finally {
        started.manager.store.updateRun(id, { status: "done" });
      }
    });
  }
});
