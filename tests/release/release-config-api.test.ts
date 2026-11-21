import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

describe("release-config API", () => {
  let started: StartedServer;
  let root: string;
  const TOKEN = "e".repeat(48);
  const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-relcfg-api-"));
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
    const store = new RunStore(path.join(root, "data", "controller.db"));
    store.upsertProject({ name: "rp", repo_path: null, base_branch: null, allowed_commands: [] } as never);
    store.close();
  });
  afterAll(async () => {
    await started.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  const url = (name: string) => `http://127.0.0.1:${started.policy.port}/api/projects/${name}/release-config`;

  it("GET null, PUT template, GET back", async () => {
    const g0 = (await (await fetch(url("rp"), { headers: H })).json()) as { config: unknown; templates: Record<string, unknown> };
    expect(g0.config).toBeNull();
    expect(Object.keys(g0.templates).sort()).toEqual(["web-vps", "windows-installer"]);
    const put = await fetch(url("rp"), { method: "PUT", headers: H, body: JSON.stringify({ template: "windows-installer" }) });
    expect(put.status).toBe(200);
    const g1 = (await (await fetch(url("rp"), { headers: H })).json()) as { config: { template: string; steps: unknown[] } };
    expect(g1.config.template).toBe("windows-installer");
    expect(g1.config.steps).toHaveLength(4);
  });

  it("400 on bad config, bad template, missing body (Vietnamese)", async () => {
    const bad = await fetch(url("rp"), { method: "PUT", headers: H, body: JSON.stringify({ config: { extraScripts: [], steps: [{ type: "build", script: "rm" }] } }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toMatch(/không nằm trong danh sách/);
    const tpl = await fetch(url("rp"), { method: "PUT", headers: H, body: JSON.stringify({ template: "nope" }) });
    expect(tpl.status).toBe(400);
    const empty = await fetch(url("rp"), { method: "PUT", headers: H, body: "{}" });
    expect(empty.status).toBe(400);
  });

  it("404 for unknown project, 401 without token", async () => {
    const r = await fetch(url("zz"), { headers: H });
    expect(r.status).toBe(404);
    expect(((await r.json()) as { error: string }).error).toBe("project_not_found");
    expect((await fetch(url("rp"))).status).toBe(401);
  });
});
