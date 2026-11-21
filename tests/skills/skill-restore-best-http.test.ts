import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "r".repeat(48);
let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rb-"));
  fs.writeFileSync(path.join(root, "roles.json"), "{}");
  fs.writeFileSync(path.join(root, "coord.md"), "coordinator");
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
        agentsFile: path.join(root, "roles.json"),
        systemPromptFile: path.join(root, "coord.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: [],
        extraArgs: [],
        maxRoleCalls: 8
      }
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 }
  };
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" } });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = H) =>
  fetch(`${base}${url}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

function patchMeta(slug: string, patch: Record<string, unknown>) {
  const f = path.join(root, "data", "skills", slug, "meta.json");
  const m = JSON.parse(fs.readFileSync(f, "utf8"));
  fs.writeFileSync(f, JSON.stringify({ ...m, ...patch }));
}

async function setup(slug: string) {
  expect((await call("POST", "/api/skills", { slug, title: slug, goal: "g", files: { "SKILL.md": "# one" } })).status).toBe(201);
  expect((await call("PUT", `/api/skills/${slug}`, { files: { "SKILL.md": "# two" } })).status).toBe(200);
  fs.writeFileSync(path.join(root, "data", "skills", slug, "rounds.json"), JSON.stringify({ version: 1, rounds: [{ n: 1, score: 80, skillVersion: 1, errors: [] }] }));
}

describe("POST /api/skills/:slug/restore-best", () => {
  it("requires a token", async () => {
    expect((await call("POST", "/api/skills/x/restore-best", {}, { "content-type": "application/json" })).status).toBe(401);
  });
  it("404 for unknown slug", async () => {
    expect((await call("POST", "/api/skills/khong-co/restore-best", {})).status).toBe(404);
  });
  it("restores the best round when stopped", async () => {
    await setup("rb-ok");
    patchMeta("rb-ok", { state: "stopped", bestRound: 1, bestScore: 80 });
    const r = await call("POST", "/api/skills/rb-ok/restore-best", {});
    expect(r.status).toBe(200);
    const j = (await r.json()) as { ok: boolean; restoredRound: number; version: number };
    expect(j.ok).toBe(true);
    expect(j.restoredRound).toBe(1);
    const rec = (await (await call("GET", "/api/skills/rb-ok")).json()) as { files: Record<string, string> };
    expect(rec.files["SKILL.md"]).toBe("# one");
  });
  it("allows when paused while running", async () => {
    await setup("rb-paused");
    patchMeta("rb-paused", { state: "trial", paused: true, bestRound: 1, bestScore: 80 });
    expect((await call("POST", "/api/skills/rb-paused/restore-best", {})).status).toBe(200);
  });
  it("409 when running and not paused", async () => {
    await setup("rb-run");
    patchMeta("rb-run", { state: "trial", paused: false, bestRound: 1, bestScore: 80 });
    expect((await call("POST", "/api/skills/rb-run/restore-best", {})).status).toBe(409);
  });
  it("409 when there is no best round", async () => {
    await setup("rb-none");
    patchMeta("rb-none", { state: "idle", bestRound: null, bestScore: null });
    const r = await call("POST", "/api/skills/rb-none/restore-best", {});
    expect(r.status).toBe(409);
    expect(((await r.json()) as { error: string }).error).toBe("no_best_round");
  });
});
