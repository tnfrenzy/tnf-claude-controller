import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

describe("CAD API", () => {
  let started: StartedServer;
  let root: string;
  const TOKEN = "c".repeat(48);
  const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
  const url = (s: string) => `http://127.0.0.1:${started.policy.port}${s}`;
  const post = (s: string, body: unknown) => fetch(url(s), { method: "POST", headers: H, body: JSON.stringify(body) });

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cad-api-"));
    const cfg = {
      repoRoot: root,
      claudePath: null,
      models: [{ id: "sonnet", label: "sonnet" }],
      workspaceDir: path.join(root, "ws"),
      worktreesDir: path.join(root, "ws", "worktrees"),
      dataDir: path.join(root, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
      // a python.exe that cannot exist: the API must answer with a clear status, never crash
      tools: { cad: { python: path.join(root, "no-such-python.exe") } },
      defaults: {
        authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: ["Agent"],
        agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
        research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
        coding: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles-coding.json"), systemPromptFile: path.join(root, "coord-coding.md"), settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
    } as unknown as ControllerConfig;
    started = await startServer({ config: cfg, port: 0, token: TOKEN });
  });

  afterAll(async () => {
    await started.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("GET /api/cad/status needs the token and returns a status object", async () => {
    expect((await fetch(url("/api/cad/status"))).status).toBe(401);
    const r = await fetch(url("/api/cad/status"), { headers: H });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { available: boolean; python: string | null; message: string };
    expect(typeof j.available).toBe("boolean");
    expect(typeof j.message).toBe("string");
  });

  it("POST /api/cad/inspect validates its input", async () => {
    expect((await post("/api/cad/inspect", {})).status).toBe(400);
    expect((await post("/api/cad/inspect", { stageId: "..", name: "a.dxf" })).status).toBe(400);
    expect((await post("/api/cad/inspect", { stageId: "abc", name: "../x.dxf" })).status).toBe(400);
  });

  it("an attachment that is not there, or not a CAD file, is a 422 with a Vietnamese message", async () => {
    const missing = await post("/api/cad/inspect", { stageId: "abc", name: "a.dxf" });
    expect(missing.status).toBe(422);
    expect(((await missing.json()) as { message: string }).message).toBe("Không thấy tệp CAD.");
    const wrong = await post("/api/cad/inspect", { stageId: "abc", name: "a.txt" });
    expect(wrong.status).toBe(422);
    expect(((await wrong.json()) as { message: string }).message).toContain(".dxf");
  });
});
