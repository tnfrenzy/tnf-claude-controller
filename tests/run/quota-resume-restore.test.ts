import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qrestore-"));
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

describe("restoreQuotaResumes", () => {
  const T0 = new Date("2026-11-18T10:00:00Z").getTime();
  const RESUME = T0 + 3_600_000;
  let cfg: ControllerConfig;
  let store: RunStore;
  const managers: RunManager[] = [];

  const newManager = (): RunManager => {
    const m = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [], env: { ...process.env } });
    managers.push(m);
    return m;
  };
  function mk(id: string, project = "default", status = "error"): void {
    store.createRun({ id, status, prompt: "p", mode: "single", model: "sonnet", session_id: "sess", parent_run_id: null, project, claude_version: null, run_dir: cfg.repoRoot });
  }
  function row(id: string, over: Partial<{ project: string; kind: "run" | "queue"; scope: string | null; resume_at: number; status: "pending" | "fired" | "cancelled" | "failed" }> = {}): void {
    store.upsertQuotaResume({ run_id: id, project: "default", kind: "run", scope: null, resume_at: RESUME, attempt: 1, status: "pending", reason: "test", ...over });
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    cfg = tmpConfig();
    store = new RunStore(":memory:");
  });
  afterEach(() => {
    vi.useRealTimers();
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  it("a pending appointment fires exactly once after the manager is rebuilt on the same store", async () => {
    mk("r1");
    row("r1");
    const m = newManager(); // constructor restores
    const follow = vi.spyOn(m, "followup").mockResolvedValue({} as never);
    expect(m.getQuotaResume("r1")?.status).toBe("pending");
    await vi.advanceTimersByTimeAsync(3_600_001);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(follow.mock.calls[0]![0]).toBe("r1");
    expect(m.getQuotaResume("r1")?.status).toBe("fired");
    expect(store.getQuotaResume("r1")?.status).toBe("fired");
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it("an overdue appointment fires after delaySec instead of immediately", async () => {
    mk("r1");
    row("r1", { resume_at: T0 - 10_000 });
    const m = newManager();
    const follow = vi.spyOn(m, "followup").mockResolvedValue({} as never);
    await vi.advanceTimersByTimeAsync(14_000);
    expect(follow).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000); // default delaySec = 15
    expect(follow).toHaveBeenCalledTimes(1);
  });

  it("a cancelled run, a missing run and a run that already has a child become cancelled and never fire", async () => {
    mk("gone-cancelled", "default", "cancelled");
    row("gone-cancelled");
    row("missing-run");
    mk("parent");
    store.createRun({ id: "child", status: "done", prompt: "next", mode: "single", model: "sonnet", session_id: "sess", parent_run_id: "parent", project: "default", claude_version: null, run_dir: cfg.repoRoot });
    row("parent");
    const m = newManager();
    const follow = vi.spyOn(m, "followup").mockResolvedValue({} as never);
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(follow).not.toHaveBeenCalled();
    for (const id of ["gone-cancelled", "missing-run", "parent"]) expect(store.getQuotaResume(id)?.status).toBe("cancelled");
  });

  it("fired, cancelled and failed rows are never re-armed", async () => {
    for (const [id, status] of [["a", "fired"], ["b", "cancelled"], ["c", "failed"]] as const) {
      mk(id);
      row(id, { status });
    }
    const m = newManager();
    const follow = vi.spyOn(m, "followup").mockResolvedValue({} as never);
    expect(m.restoreQuotaResumes()).toBe(0);
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(follow).not.toHaveBeenCalled();
    expect(store.getQuotaResume("a")?.status).toBe("fired");
  });

  it("a queue appointment restarts run-all in a paused state, and the pause is cleared when it fires", async () => {
    const seed = newManager();
    seed.queue.addCommands("proj", [
      { id: "c1", title: "t1", body: "b1" },
      { id: "c2", title: "t2", body: "b2" },
    ]);
    mk("r1", "proj");
    seed.queue.transition("proj", "c1", "đã duyệt");
    seed.queue.transition("proj", "c2", "đã duyệt");
    seed.queue.transition("proj", "c1", "đang chạy", { runId: "r1" });
    row("r1", { project: "proj", kind: "queue", scope: null });

    const m = newManager();
    const follow = vi.spyOn(m, "followup").mockResolvedValue({} as never);
    const start = vi.spyOn(m, "startQueuedCommand").mockResolvedValue(undefined as never);
    expect(m.queueRunAll.isActive("proj")).toBe(true);
    expect(m.queueRunAll.status("proj").pausedUntil).toBe(RESUME);
    await m.queueRunAll.tick("proj");
    expect(start).not.toHaveBeenCalled(); // paused: c2 must not start before the reset
    await vi.advanceTimersByTimeAsync(3_600_001);
    expect(follow).toHaveBeenCalledTimes(1);
    expect(m.queueRunAll.status("proj").pausedUntil).toBeNull();
  });
});
