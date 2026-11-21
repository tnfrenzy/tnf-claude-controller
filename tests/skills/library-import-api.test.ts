import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

let started: StartedServer;
let base: string;
let root: string;
const TOKEN = "t".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

const AGENT_MD = [
  "---",
  "name: import-helper",
  "description: Giup doc va tom tat file",
  "tools: Read, Bash",
  "license: MIT",
  "---",
  "Ban la tro ly doc ma nguon va tom tat ngan gon.",
  "",
].join("\n");

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-libimp-"));
  const config: ControllerConfig = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }],
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
        allowedTools: ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)"],
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
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

async function listRoleIds(): Promise<string[]> {
  const r = await fetch(`${base}/api/library`, { headers: H });
  const j = (await r.json()) as { roles: { id: string }[] };
  return j.roles.map((x) => x.id);
}

function post(body: unknown, headers: Record<string, string> = H): Promise<Response> {
  return fetch(`${base}/api/library/import`, { method: "POST", headers, body: JSON.stringify(body) });
}

describe("POST /api/library/import", () => {
  it("dryRun returns a preview and creates nothing", async () => {
    const r = await post({ text: AGENT_MD, id: "dry-helper", dryRun: true });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { preview: { id: string }; role?: unknown };
    expect(j.preview.id).toBe("dry-helper");
    expect(j.role).toBeUndefined();
    expect(await listRoleIds()).not.toContain("dry-helper");
  });

  it("real import creates a role without Bash and reports the dropped tool", async () => {
    const r = await post({ text: AGENT_MD, id: "real-helper" });
    expect(r.status).toBe(201);
    const j = (await r.json()) as {
      preview: { droppedTools: string[]; warnings: string[] };
      role: { id: string; tools: string[] };
    };
    expect(j.role.id).toBe("real-helper");
    expect(j.role.tools).not.toContain("Bash");
    expect(j.role.tools).toContain("Read");
    expect(j.preview.droppedTools).toContain("Bash");
    expect(j.preview.warnings).toContain("tools_dropped");
    expect(await listRoleIds()).toContain("real-helper");
  });

  it("rejects a request without token with 401", async () => {
    const r = await post({ text: AGENT_MD, id: "no-token" }, { "content-type": "application/json" });
    expect(r.status).toBe(401);
    expect(await listRoleIds()).not.toContain("no-token");
  });

  it("rejects wrongly typed fields with 400 and a Vietnamese message", async () => {
    const bad: unknown[] = [
      { text: 123 },
      { text: AGENT_MD, as: "weird" },
      { text: AGENT_MD, dryRun: "yes" },
    ];
    for (const body of bad) {
      const r = await post(body);
      expect(r.status).toBe(400);
      const j = (await r.json()) as { message: string };
      expect(j.message).toMatch(/Trường .* phải là/);
    }
  });

  it("rejects a non-object body with 400", async () => {
    const r = await post([1, 2]);
    expect(r.status).toBe(400);
    const j = (await r.json()) as { message: string };
    expect(j.message).toMatch(/đối tượng JSON/);
  });
});
