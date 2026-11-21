import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "m".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3mapi-"));
  const config: ControllerConfig = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }, { id: "claude-fable-5-2", label: "Fable 5.2" }],
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

describe("workshop3d model settings API", () => {
  const url = () => `${base}/api/settings/workshop3d-models`;
  it("requires the token", async () => {
    expect((await fetch(url())).status).toBe(401);
    expect((await fetch(url(), { method: "PUT", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
  });
  it("get, put, reject unknown id, clear", async () => {
    const g = (await (await fetch(url(), { headers: H })).json()) as { models: object; options: { id: string }[] };
    expect(g.models).toEqual({});
    expect(g.options.map((o) => o.id)).toEqual(["sonnet", "claude-fable-5-2"]);
    const put = await fetch(url(), { method: "PUT", headers: H, body: JSON.stringify({ main: "claude-fable-5-2", light: "" }) });
    expect(put.status).toBe(200);
    expect(((await put.json()) as { models: object }).models).toEqual({ main: "claude-fable-5-2" });
    const bad = await fetch(url(), { method: "PUT", headers: H, body: JSON.stringify({ light: "gpt-x" }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toMatch(/không có trong danh sách model/);
    const saved = JSON.parse(fs.readFileSync(path.join(root, "data", "app-settings.json"), "utf8"));
    expect(saved.workshop3d).toEqual({ models: { main: "claude-fable-5-2" } });
    await fetch(url(), { method: "PUT", headers: H, body: JSON.stringify({ main: "", light: "" }) });
    expect(((await (await fetch(url(), { headers: H })).json()) as { models: object }).models).toEqual({});
  });
});
