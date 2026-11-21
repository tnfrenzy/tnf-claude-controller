import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

describe("project preview column", () => {
  it("defaults to none, round-trips, clears on null", () => {
    const store = new RunStore(":memory:");
    store.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(store.getProjectPreview("p")).toEqual({ kind: "none" });
    const c = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/"], readyTimeoutSec: 60 } as const;
    store.setProjectPreview("p", c);
    expect(store.getProjectPreview("p")).toEqual(c);
    store.setProjectPreview("p", null);
    expect(store.getProjectPreview("p")).toEqual({ kind: "none" });
  });

  it("returns none for an unknown project", () => {
    const store = new RunStore(":memory:");
    expect(store.getProjectPreview("ghost")).toEqual({ kind: "none" });
  });

  it("migrates an old DB that lacks the column", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prevmig-"));
    const file = path.join(dir, "old.db");
    const old = new DatabaseSync(file);
    old.exec(
      "CREATE TABLE projects (name TEXT PRIMARY KEY, repo_path TEXT, base_branch TEXT, allowed_commands TEXT NOT NULL DEFAULT '[]', created_at INTEGER NOT NULL);" +
        "INSERT INTO projects (name, allowed_commands, created_at) VALUES ('old', '[]', 1);",
    );
    old.close();
    const store = new RunStore(file);
    expect(store.getProjectPreview("old")).toEqual({ kind: "none" });
    store.setProjectPreview("old", { kind: "web", startCommand: "npm run dev", url: "http://localhost:3000", pages: ["/"], readyTimeoutSec: 30 });
    expect(store.getProjectPreview("old").kind).toBe("web");
  });
});

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "p".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prevapi-"));
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
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("preview config routes", () => {
  it("requires the token", async () => {
    expect((await fetch(`${base}/api/projects/envP/preview`)).status).toBe(401);
  });

  it("GET none, PUT valid, PUT invalid -> 400, unknown project -> 404", async () => {
    started.manager.store.upsertProject({ name: "envP", repo_path: null, base_branch: null, allowed_commands: [] });
    const g0 = await fetch(`${base}/api/projects/envP/preview`, { headers: H });
    expect(g0.status).toBe(200);
    expect(((await g0.json()) as { preview: unknown }).preview).toEqual({ kind: "none" });

    const web = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173/", pages: ["/", "/about"], readyTimeoutSec: 45 };
    const put = await fetch(`${base}/api/projects/envP/preview`, { method: "PUT", headers: H, body: JSON.stringify({ preview: web }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { preview: unknown }).preview).toEqual({ ...web, url: "http://localhost:5173" });
    const g1 = (await (await fetch(`${base}/api/projects/envP/preview`, { headers: H })).json()) as { preview: { kind: string } };
    expect(g1.preview.kind).toBe("web");

    const bad = await fetch(`${base}/api/projects/envP/preview`, { method: "PUT", headers: H, body: JSON.stringify({ preview: { kind: "web", startCommand: "x", url: "http://example.com" } }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain("localhost");

    const clear = await fetch(`${base}/api/projects/envP/preview`, { method: "PUT", headers: H, body: JSON.stringify({ preview: { kind: "none" } }) });
    expect(clear.status).toBe(200);
    expect(started.manager.store.getProjectPreview("envP")).toEqual({ kind: "none" });

    expect((await fetch(`${base}/api/projects/ghost/preview`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/projects/ghost/preview`, { method: "PUT", headers: H, body: JSON.stringify({ preview: { kind: "none" } }) })).status).toBe(404);
  });
});
