// The 3D workshop must never stop the app: a broken engine (bad config/roles-design3d.json) answers 503 on its routes only,
// and a missing CAD python is reported before a session is created (preflight).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { CAD_PYTHON_MISSING_MSG } from "../../src/core/design3d/cad-tools.js";
import { makeWorkshop3DEngine, tryCreateWorkshop3D } from "../../src/core/workshop3d/index.js";
import type { W3DRunner } from "../../src/core/workshop3d/runner.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = "f".repeat(48);
const H = { "x-controller-token": TOKEN };
const J = { ...H, "content-type": "application/json" };

function configFor(root: string): ControllerConfig {
  return {
    repoRoot: REPO,
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
  } as ControllerConfig;
}

const roots: string[] = [];
const servers: StartedServer[] = [];
async function start(extra: Parameters<typeof startServer>[0]): Promise<string> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-down-"));
  roots.push(root);
  const s = await startServer({ config: configFor(root), port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" }, automationIntervalMs: 0, ...extra });
  servers.push(s);
  return `http://127.0.0.1:${s.policy.port}`;
}

afterAll(async () => {
  for (const s of servers) await s.close();
  for (const r of roots) fs.rmSync(r, { recursive: true, force: true });
});

describe("tryCreateWorkshop3D", () => {
  it("returns null and logs instead of throwing", () => {
    const logs: string[] = [];
    const r = tryCreateWorkshop3D(() => {
      throw new Error("config/roles-design3d.json: thiếu vai art-director");
    }, (m) => logs.push(m));
    expect(r.engine).toBeNull();
    expect(r.error).toContain("art-director");
    expect(logs.join("\n")).toContain("art-director");
  });
});

describe("server with a broken 3D engine", () => {
  let base: string;
  beforeAll(async () => {
    base = await start({
      workshop3dFactory: () => {
        throw new Error("Unexpected token } in JSON (roles-design3d.json)");
      },
    });
  });
  it("still starts: other routes work", async () => {
    const r = await fetch(`${base}/api/projects`, { headers: H });
    expect(r.status).toBe(200);
  });
  it("every /api/workshop3d route answers 503 with a Vietnamese message", async () => {
    const list = await fetch(`${base}/api/workshop3d`, { headers: H });
    expect(list.status).toBe(503);
    const body = (await list.json()) as { error: string; message: string };
    expect(body.error).toBe("w3d_unavailable");
    expect(body.message).toMatch(/Xưởng dựng 3D/);
    expect(body.message).toContain("roles-design3d.json");
    expect((await fetch(`${base}/api/workshop3d`, { method: "POST", headers: J, body: JSON.stringify({ prompt: "hop" }) })).status).toBe(503);
    expect((await fetch(`${base}/api/workshop3d/20200101-000000-abcdef`, { headers: H })).status).toBe(503);
    expect((await fetch(`${base}/api/workshop3d/20200101-000000-abcdef/pause`, { method: "POST", headers: J, body: "{}" })).status).toBe(503);
  });
  it("still requires the token on those routes", async () => {
    expect((await fetch(`${base}/api/workshop3d`)).status).toBe(401);
  });
});

describe("preflight: no CAD python", () => {
  let base: string;
  const started: string[] = [];
  beforeAll(async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-pre-"));
    roots.push(root);
    const store = createW3DStore(path.join(root, "data"));
    const runner = {
      start: (b: { title: string }) => {
        started.push(b.title);
        return store.create(b as never);
      },
      recover: () => [],
    } as unknown as W3DRunner;
    base = await start({ workshop3d: makeWorkshop3DEngine({ store, runner, preflight: () => CAD_PYTHON_MISSING_MSG }) });
  });
  it("POST /api/workshop3d answers 503 with the setup message and creates no session", async () => {
    const r = await fetch(`${base}/api/workshop3d`, { method: "POST", headers: J, body: JSON.stringify({ prompt: "hop go" }) });
    expect(r.status).toBe(503);
    const body = (await r.json()) as { error: string; message: string };
    expect(body.error).toBe("cad_unavailable");
    expect(body.message).toBe(CAD_PYTHON_MISSING_MSG);
    expect(started).toEqual([]);
    // the list still works
    expect((await fetch(`${base}/api/workshop3d`, { headers: H })).status).toBe(200);
  });
});
