import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import type { QuotaResumeRecord } from "../../src/core/shared-types.js";

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qcancel-"));
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

describe("quota resume cancel", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  let events: QuotaResumeRecord[];
  const T0 = new Date("2026-11-18T10:00:00Z").getTime();
  const RESET = T0 + 3_600_000;
  const MARGIN_MS = 60_000; // default quotaMarginSec
  const RESUME_AT = RESET + MARGIN_MS;

  const priv = () => mgr as any;
  function mk(id: string, project = "default"): void {
    store.createRun({ id, status: "error", prompt: "p", mode: "single", model: "sonnet", session_id: "sess", parent_run_id: null, project, claude_version: null, run_dir: cfg.repoRoot });
  }
  function schedule(id: string, resetAt = RESET): boolean {
    priv().quotaResetAt.set(id, resetAt);
    return priv().maybeQuotaResume(id);
  }

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(T0);
    cfg = tmpConfig();
    store = new RunStore(":memory:");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [], env: { ...process.env } });
    events = [];
    mgr.on("quota.resume", (r: QuotaResumeRecord) => events.push(r));
  });
  afterEach(() => {
    vi.useRealTimers();
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  it("run kind: cancel marks cancelled, lists nothing, and followup never fires", async () => {
    mk("r1");
    const follow = vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    expect(schedule("r1")).toBe(true);
    expect(mgr.listQuotaResumes().map((r) => r.runId)).toEqual(["r1"]);
    expect(mgr.cancelQuotaResume("r1")).toBe(true);
    expect(mgr.getQuotaResume("r1")?.status).toBe("cancelled");
    expect(mgr.listQuotaResumes()).toEqual([]);
    await vi.advanceTimersByTimeAsync(10_000_000);
    expect(follow).not.toHaveBeenCalled();
    expect(mgr.getQuotaResume("r1")?.status).toBe("cancelled");
  });

  it("queue kind: cancel marks the command failed, stops run-all, no clearPause, no further start", async () => {
    mgr.queue.addCommands("proj", [
      { id: "c1", title: "t1", body: "b1" },
      { id: "c2", title: "t2", body: "b2" },
    ]);
    mk("r1", "proj");
    mgr.queue.transition("proj", "c1", "đã duyệt");
    mgr.queue.transition("proj", "c2", "đã duyệt");
    mgr.queue.transition("proj", "c1", "đang chạy", { runId: "r1" });
    const start = vi.spyOn(mgr, "startQueuedCommand").mockResolvedValue(undefined as never);
    priv().queueRunAll.flags.add("proj");
    const clear = vi.spyOn(mgr.queueRunAll, "clearPause");
    expect(schedule("r1")).toBe(true);
    expect(mgr.queueRunAll.status("proj").pausedUntil).not.toBeNull();

    expect(mgr.cancelQuotaResume("r1")).toBe(true);
    const c1 = mgr.queue.list("proj").find((c) => c.id === "c1")!;
    expect(c1.status).toBe("lỗi");
    expect(mgr.queueRunAll.isActive("proj")).toBe(false);
    expect(mgr.queueRunAll.status("proj").active).toBe(false);
    expect(clear).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(10_000_000);
    await mgr.queueRunAll.tick("proj");
    expect(start).not.toHaveBeenCalled();
    expect(mgr.queue.list("proj").find((c) => c.id === "c2")!.status).toBe("đã duyệt");
  });

  it("second cancel, unknown run and already-fired resume all return false", async () => {
    mk("r1");
    vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    schedule("r1");
    expect(mgr.cancelQuotaResume("r1")).toBe(true);
    expect(mgr.cancelQuotaResume("r1")).toBe(false);
    expect(mgr.cancelQuotaResume("missing")).toBe(false);

    mk("r2");
    schedule("r2");
    await vi.advanceTimersByTimeAsync(MARGIN_MS + 3_600_001);
    expect(mgr.getQuotaResume("r2")?.status).toBe("fired");
    expect(mgr.cancelQuotaResume("r2")).toBe(false);
    expect(mgr.getQuotaResume("r2")?.status).toBe("fired");
  });

  it("user cancel(runId) of a finished run cancels its pending resume and the timer", async () => {
    mk("r1");
    const follow = vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    schedule("r1");
    mgr.cancel("r1");
    expect(mgr.getQuotaResume("r1")?.status).toBe("cancelled");
    await vi.advanceTimersByTimeAsync(4_000_000);
    expect(follow).not.toHaveBeenCalled();
  });

  it("emits pending then cancelled payloads and lists only the remaining pending resume", () => {
    mk("r1");
    mk("r2");
    schedule("r1");
    mgr.cancelQuotaResume("r1");
    expect(events).toHaveLength(2);
    expect(events[0]).toMatchObject({ runId: "r1", kind: "run", status: "pending", resumeAt: new Date(RESUME_AT).toISOString() });
    expect(events[1]).toMatchObject({ runId: "r1", kind: "run", status: "cancelled", resumeAt: new Date(RESUME_AT).toISOString() });
    expect(typeof events[0]!.reason).toBe("string");

    schedule("r2", RESET + 1000);
    expect(mgr.listQuotaResumes().map((r) => r.runId)).toEqual(["r2"]);
    mgr.cancelQuotaResume("r1");
    expect(mgr.listQuotaResumes().map((r) => r.runId)).toEqual(["r2"]);
    expect(mgr.getQuotaResume("r1")?.status).toBe("cancelled");
  });
});
