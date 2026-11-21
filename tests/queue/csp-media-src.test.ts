import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { startServer } from "../../src/server/index.js";
import type { ControllerConfig } from "../../src/core/app/config.js";

describe("Content-Security-Policy", () => {
  it("allows blob: media so the Video Studio players can play downloaded files", async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-csp-"));
    const config = {
      repoRoot: root, claudePath: null, models: [{ id: "sonnet", label: "sonnet" }],
      workspaceDir: path.join(root, "workspace"), worktreesDir: path.join(root, "workspace", "worktrees"), dataDir: path.join(root, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
      defaults: { authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: [], agentsFile: "", systemPromptFile: "", maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [], research: { allowedTools: [], agentsFile: "", systemPromptFile: "", disallowedTools: [], extraArgs: [], maxRoleCalls: 8 }, coding: { allowedTools: [], agentsFile: "", systemPromptFile: "", settingsFile: "", disallowedTools: [], extraArgs: [], maxRoleCalls: 8 } },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
      queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [] },
    } as unknown as ControllerConfig;
    const started = await startServer({ config, port: 0, token: "c".repeat(48), claudePath: process.execPath, claudeArgsPrefix: [] });
    try {
      const r = await fetch(`http://127.0.0.1:${started.policy.port}/`);
      expect(r.headers.get("content-security-policy")).toContain("media-src 'self' blob:");
    } finally {
      await started.close();
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
