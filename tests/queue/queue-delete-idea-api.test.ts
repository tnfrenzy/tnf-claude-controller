import { describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { startServer } from "../../src/server/index.js";
import type { ControllerConfig } from "../../src/core/app/config.js";

const TOKEN = "b".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

describe("queue delete-idea API", () => {
  it("deletes an approved idea (route is reachable) but removes it with all its commands", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-delidea-"));
    const config = {
      repoRoot: root, claudePath: null, models: [{ id: "sonnet", label: "sonnet" }],
      workspaceDir: path.join(root, "workspace"), worktreesDir: path.join(root, "workspace", "worktrees"), dataDir: path.join(root, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
      defaults: { authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: [], agentsFile: "", systemPromptFile: "", maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [], research: { allowedTools: [], agentsFile: "", systemPromptFile: "", disallowedTools: [], extraArgs: [], maxRoleCalls: 8 }, coding: { allowedTools: [], agentsFile: "", systemPromptFile: "", settingsFile: "", disallowedTools: [], extraArgs: [], maxRoleCalls: 8 } },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
      queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [] },
    } as unknown as ControllerConfig;
    const started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [] });
    try {
      const base = `http://127.0.0.1:${started.policy.port}/api/projects/dl/queue`;
      started.manager.store.upsertProject({ name: "dl", repo_path: root, base_branch: "main", allowed_commands: [] } as never);
      started.manager.queue.addCommands("dl", [{ id: "c1", title: "c1", body: "x", files: [], sourceRef: "idea-X" }, { id: "c2", title: "c2", body: "y", files: [], sourceRef: "idea-X" }], { hasRepo: true });
      const post = (p: string, b: unknown) => fetch(base + p, { method: "POST", headers: H, body: JSON.stringify(b) });
      started.manager.queue.transition("dl", "c1", "đã duyệt"); started.manager.queue.transition("dl", "c2", "đã duyệt");
      const r = await post("/delete-idea", { sourceRef: "idea-X" });
      expect(r.status).toBe(200);
      expect(started.manager.queue.list("dl").length).toBe(0);
      expect((await post("/delete-idea", {})).status).toBe(400);
    } finally {
      await started.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
