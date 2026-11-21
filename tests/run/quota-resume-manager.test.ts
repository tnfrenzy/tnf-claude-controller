import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import type { QuotaResumeRecord } from "../../src/core/shared-types.js";

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qresume-"));
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

describe("quota resume scheduling", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  let events: QuotaResumeRecord[];
  const T0 = new Date("2026-11-18T10:00:00Z").getTime();
  const RESET = T0 + 3_600_000;

  const priv = () => mgr as any;
  function mk(id: string, project = "default"): void {
    store.createRun({ id, status: "error", prompt: "p", mode: "single", model: "sonnet", session_id: "sess", parent_run_id: null, project, claude_version: null, run_dir: cfg.repoRoot });
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

  it("schedules a pending run-kind resume and emits quota.resume", () => {
    mk("r1");
    priv().quotaResetAt.set("r1", RESET);
    expect(priv().maybeQuotaResume("r1")).toBe(true);
    const rec = priv().quotaResumes.get("r1");
    expect(rec.kind).toBe("run");
    expect(rec.status).toBe("pending");
    expect(events.map((e) => e.status)).toEqual(["pending"]);
  });

  it("returns false without a record when the run is still active", () => {
    mk("r1");
    priv().quotaResetAt.set("r1", RESET);
    priv().active.set("r1", {} as never);
    expect(priv().maybeQuotaResume("r1")).toBe(false);
    expect(priv().quotaResumes.size).toBe(0);
    expect(events).toHaveLength(0);
  });

  it("a reset time in the past falls back to now + quotaFallbackMin", () => {
    mk("r1");
    priv().quotaResetAt.set("r1", T0 - 1);
    expect(priv().maybeQuotaResume("r1")).toBe(true);
    expect(priv().quotaResumes.get("r1").resumeAt).toBe(new Date(T0 + 60 * 60000).toISOString());
  });

  it("returns false for a run kind without session_id", () => {
    store.createRun({ id: "r2", status: "error", prompt: "p", mode: "single", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: cfg.repoRoot });
    priv().quotaResetAt.set("r2", RESET);
    expect(priv().maybeQuotaResume("r2")).toBe(false);
    expect(priv().quotaResumes.size).toBe(0);
  });

  it("fires a follow-up once the reset time passes, and records an error when it rejects", async () => {
    mk("r1");
    priv().quotaResetAt.set("r1", RESET);
    const spy = vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    priv().maybeQuotaResume("r1");
    await vi.advanceTimersByTimeAsync(3_660_001); // reset + default 60 s margin
    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy).toHaveBeenCalledWith("r1", expect.any(String), {});
    expect(priv().quotaResumes.get("r1").status).toBe("fired");

    mk("r3");
    priv().quotaResetAt.set("r3", RESET + 10_000_000);
    spy.mockRejectedValue(new Error("boom"));
    priv().maybeQuotaResume("r3");
    await vi.advanceTimersByTimeAsync(20_000_000);
    const rec = priv().quotaResumes.get("r3");
    expect(rec.status).toBe("error");
    expect(rec.error).toBe("boom");
  });

  it("queue command while run-all is not active: kind run (nothing to pause), no pause set", () => {
    mgr.queue.addCommands("proj", [{ id: "c1", title: "t", body: "b" }]);
    mk("r1", "proj");
    mgr.queue.transition("proj", "c1", "đã duyệt");
    mgr.queue.transition("proj", "c1", "đang chạy", { runId: "r1" });
    priv().quotaResetAt.set("r1", RESET);
    expect(priv().maybeQuotaResume("r1")).toBe(true);
    expect(priv().quotaResumes.get("r1").kind).toBe("run");
    expect(mgr.queueRunAll.status("proj").pausedUntil).toBeNull();
  });

  it("cancelQuotaResume (run kind) cancels, lists nothing, and the timer never fires", async () => {
    mk("r1");
    priv().quotaResetAt.set("r1", RESET);
    const spy = vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    priv().maybeQuotaResume("r1");
    expect(mgr.listQuotaResumes()).toHaveLength(1);
    expect(mgr.cancelQuotaResume("r1")).toBe(true);
    expect(mgr.getQuotaResume("r1")?.status).toBe("cancelled");
    expect(mgr.listQuotaResumes()).toEqual([]);
    expect(mgr.cancelQuotaResume("r1")).toBe(false);
    expect(mgr.cancelQuotaResume("nope")).toBe(false);
    await vi.advanceTimersByTimeAsync(4_000_000);
    expect(spy).not.toHaveBeenCalled();
    expect(events.map((e) => e.status)).toEqual(["pending", "cancelled"]);
  });

  it("cancelQuotaResume (queue kind) fails the command and stops run-all without clearPause", () => {
    mgr.queue.addCommands("proj", [{ id: "c1", title: "t", body: "b" }]);
    mk("r1", "proj");
    mgr.queue.transition("proj", "c1", "đã duyệt");
    mgr.queue.transition("proj", "c1", "đang chạy", { runId: "r1" });
    priv().queueRunAll.flags.add("proj");
    const clear = vi.spyOn(mgr.queueRunAll, "clearPause");
    priv().quotaResetAt.set("r1", RESET);
    priv().maybeQuotaResume("r1");
    expect(mgr.cancelQuotaResume("r1")).toBe(true);
    expect(mgr.queue.list("proj")[0]!.status).toBe("lỗi");
    expect(mgr.queueRunAll.isActive("proj")).toBe(false);
    expect(clear).not.toHaveBeenCalled();
  });

  it("cancel(runId) of a finished run cancels its pending resume", () => {
    mk("r1");
    priv().quotaResetAt.set("r1", RESET);
    priv().maybeQuotaResume("r1");
    mgr.cancel("r1");
    expect(mgr.getQuotaResume("r1")?.status).toBe("cancelled");
  });

  it("queue kind with active run-all: pauses, then clearPause on fire", async () => {
    mgr.queue.addCommands("proj", [{ id: "c1", title: "t", body: "b" }]);
    mk("r1", "proj");
    mgr.queue.transition("proj", "c1", "đã duyệt");
    mgr.queue.transition("proj", "c1", "đang chạy", { runId: "r1" });
    priv().queueRunAll.flags.add("proj");
    const clear = vi.spyOn(mgr.queueRunAll, "clearPause");
    const follow = vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    priv().quotaResetAt.set("r1", RESET);
    expect(priv().maybeQuotaResume("r1")).toBe(true);
    expect(priv().quotaResumes.get("r1").kind).toBe("queue");
    await vi.advanceTimersByTimeAsync(3_660_001);
    expect(follow).toHaveBeenCalledTimes(1); // the held command continues in its own session
    expect(clear).toHaveBeenCalledWith("proj");
    expect(priv().quotaResumes.get("r1").status).toBe("fired");
  });
});
