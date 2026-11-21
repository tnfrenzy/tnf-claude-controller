import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import type { NormalizedEvent } from "../../src/core/run/events.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-quota-"));
  return {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "workspace"),
    worktreesDir: path.join(root, "workspace", "worktrees"),
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
        allowedTools: ["Agent"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: [],
        extraArgs: [],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  } as ControllerConfig;
}

describe("RunManager quota wiring", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  const FUT = Math.floor(Date.now() / 1000) + 3600;
  const rl = (five: number | null, seven: number | null, f = FUT, s = FUT + 86400): NormalizedEvent => ({
    type: "rate.limit", status: "allowed", five_hour_pct: five, seven_day_pct: seven, five_hour_resets_at: f, seven_day_resets_at: s, using_overage: false,
  });
  const started = { type: "run.started", session_id: "s", model: "sonnet", claude_version: "1" } as unknown as NormalizedEvent;

  function mk(id: string): void {
    store.createRun({ id, status: "running", prompt: "p", mode: "single", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: cfg.repoRoot });
  }
  const fire = (id: string, ev: NormalizedEvent) => mgr.onEvent(id, { parser: { totalUsage: {}, agents: new Map() } } as never, ev, null);

  beforeEach(() => {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [], env: { ...process.env } });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  it("takes baseline from lastRateLimit, then sets end", () => {
    mgr.lastRateLimit = { ...(rl(10, 18) as never), observed_at: Date.now() };
    mk("r1");
    fire("r1", started);
    let r = store.getRun("r1")!;
    expect(r.quota_start).toBe(10);
    expect(r.quota_end).toBeNull();
    expect(r.quota7_start).toBe(18);
    fire("r1", rl(12, 19));
    r = store.getRun("r1")!;
    expect(r.quota_start).toBe(10);
    expect(r.quota_end).toBe(12);
    expect(r.quota7_start).toBe(18);
    expect(r.quota7_end).toBe(19);
  });

  it("without lastRateLimit the first event gives start = end", () => {
    mgr.lastRateLimit = null;
    mk("r2");
    fire("r2", started);
    fire("r2", rl(12, 19));
    const r = store.getRun("r2")!;
    expect(r.quota_start).toBe(12);
    expect(r.quota_end).toBe(12);
    expect(r.quota7_start).toBe(19);
  });

  it("different resets_at drops the baseline", () => {
    mgr.lastRateLimit = { ...(rl(10, 18) as never), observed_at: Date.now() };
    mk("r3");
    fire("r3", started);
    fire("r3", rl(2, 19, FUT + 18000));
    const r = store.getRun("r3")!;
    expect(r.quota_start).toBe(2);
    expect(r.quota_end).toBe(2);
    expect(r.quota7_start).toBe(18);
    expect(r.quota7_end).toBe(19);
  });
});
