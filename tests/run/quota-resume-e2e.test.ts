import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { parseAutoResume, type ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { quotaResumePrompt } from "../../src/core/run/quota-resume.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIXTURE = path.resolve(__dirname, "..", "..", "fixtures", "quota-rejected.stream.jsonl");

function tmpConfig(root: string, autoResume?: Record<string, unknown>): ControllerConfig {
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
      coding: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles-coding.json"), systemPromptFile: path.join(root, "coord-coding.md"), settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
    autoResume: parseAutoResume(autoResume),
  } as ControllerConfig;
}

describe("quota resume end to end (fake CLI replays fixtures/quota-rejected.stream.jsonl)", () => {
  let root: string;
  let store: RunStore;
  let mgr: RunManager;
  let env: NodeJS.ProcessEnv;
  let fixtureFile: string;

  /** The shipped fixture with `resetsAt` (epoch seconds) replaced, or removed when `null`. */
  function writeFixture(resetsAtSec: number | null): string {
    const lines = fs.readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l) as Record<string, any>);
    for (const l of lines) {
      if (l["type"] !== "rate_limit_event") continue;
      const info = l["rate_limit_info"];
      for (const holder of [info, info.unifiedWindows.five_hour]) {
        if (resetsAtSec === null) delete holder.resetsAt;
        else holder.resetsAt = resetsAtSec;
      }
    }
    const f = path.join(root, `fixture-${resetsAtSec ?? "none"}.jsonl`);
    fs.writeFileSync(f, lines.map((l) => JSON.stringify(l)).join("\n") + "\n");
    return f;
  }

  function build(autoResume?: Record<string, unknown>): void {
    mgr = new RunManager({ config: tmpConfig(root, autoResume), store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env });
  }
  async function runOnce(): Promise<string> {
    const run = await mgr.startRun({ prompt: "việc dài" });
    await mgr.waitFor(run.id);
    return run.id;
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qe2e-"));
    store = new RunStore(":memory:");
    fixtureFile = writeFixture(Math.floor(Date.now() / 1000) + 2 * 3600);
    env = { ...process.env, FAKE_CLAUDE_FIXTURE: fixtureFile };
    build();
  });
  afterEach(() => {
    vi.useRealTimers();
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("the shipped fixture holds no real session, e-mail or key", () => {
    const text = fs.readFileSync(FIXTURE, "utf8");
    expect(text).not.toMatch(/@|sk-ant|api[_-]?key"\s*:\s*"[^"]/i);
    expect(text).toContain('"status":"rejected"');
  });

  it("(1) resume_at = resetsAt + margin", async () => {
    const resetsAt = Math.floor(Date.now() / 1000) + 2 * 3600;
    env["FAKE_CLAUDE_FIXTURE"] = writeFixture(resetsAt);
    const id = await runOnce();
    expect(store.getRun(id)?.status).toBe("error");
    const row = store.getQuotaResume(id);
    expect(row?.status).toBe("pending");
    expect(row?.resume_at).toBe(resetsAt * 1000 + 60_000);
  });

  it("(2) no resetsAt in the event: fallback minutes from now", async () => {
    env["FAKE_CLAUDE_FIXTURE"] = writeFixture(null);
    const before = Date.now();
    const id = await runOnce();
    const row = store.getQuotaResume(id);
    expect(row?.status).toBe("pending");
    expect(row!.resume_at).toBeGreaterThanOrEqual(before + 60 * 60_000);
    expect(row!.resume_at).toBeLessThanOrEqual(Date.now() + 60 * 60_000);
  });

  it("(3) cancelling the run or the appointment never continues by mistake", async () => {
    const id = await runOnce();
    const follow = vi.spyOn(mgr, "followup").mockResolvedValue({} as never);
    expect(mgr.cancelQuotaResume(id)).toBe(true);
    await (mgr as any).fireQuotaResume(id);
    expect(follow).not.toHaveBeenCalled();
    expect(store.getQuotaResume(id)?.status).toBe("cancelled");

    const id2 = await runOnce();
    mgr.cancel(id2);
    await (mgr as any).fireQuotaResume(id2);
    expect(follow).not.toHaveBeenCalled();
    expect(store.getQuotaResume(id2)?.status).toBe("cancelled");
  });

  it("(4) the chain stops at maxAttempts", async () => {
    build({ maxAttempts: 2 });
    const id = await runOnce();
    expect(store.getQuotaResume(id)?.attempt).toBe(1);
    // A continuation (attempt 1/2) that is cut by the quota again: still allowed, attempt 2.
    store.createRun({ id: "c1", status: "error", prompt: quotaResumePrompt(1, 2), mode: "single", model: "sonnet", session_id: "s", parent_run_id: id, project: "default", claude_version: null, run_dir: root });
    (mgr as any).quotaResetAt.set("c1", Date.now() + 3_600_000);
    expect((mgr as any).maybeQuotaResume("c1")).toBe(true);
    expect(store.getQuotaResume("c1")?.attempt).toBe(2);
    // The next one (attempt 2/2) would be the third: refused.
    store.createRun({ id: "c2", status: "error", prompt: quotaResumePrompt(2, 2), mode: "single", model: "sonnet", session_id: "s", parent_run_id: "c1", project: "default", claude_version: null, run_dir: root });
    (mgr as any).quotaResetAt.set("c2", Date.now() + 3_600_000);
    expect((mgr as any).maybeQuotaResume("c2")).toBe(false);
    expect(store.getQuotaResume("c2")).toBeNull();
  });

  it("(5) the billing guard refusing the continuation turns the appointment into failed", async () => {
    const id = await runOnce();
    env["FAKE_CLAUDE_AUTH"] = "apiKey"; // `claude auth status` now reports API billing -> BillingGuardError
    await (mgr as any).fireQuotaResume(id);
    expect(store.getQuotaResume(id)?.status).toBe("failed");
    expect(mgr.getQuotaResume(id)?.status).toBe("error");
  });

  it("(6) a queue command is held, not failed or requeued, and becomes 'đã commit' after a good follow-up", async () => {
    mgr.queue.addCommands("proj", [{ id: "c1", title: "t1", body: "b1" }]);
    mgr.queue.transition("proj", "c1", "đã duyệt");
    mgr.queue.transition("proj", "c1", "đang chạy", { runId: "q1" });
    store.createRun({ id: "q1", status: "running", prompt: "việc", mode: "single+coding", model: "sonnet", session_id: "sess", parent_run_id: null, project: "proj", claude_version: null, run_dir: root });
    (mgr as any).queueRunAll.flags.add("proj");
    const requeue = vi.spyOn(mgr.queueRunAll as any, "tick");
    // The run ends rejected: the exit hook holds it (what handleExit does before syncQueueOnExit).
    store.updateRun("q1", { status: "error", error: "You've hit your limit" });
    (mgr as any).quotaResetAt.set("q1", Date.now() + 3_600_000);
    expect((mgr as any).tryQuotaResume("q1")).toBe(true);
    expect(mgr.queue.list("proj")[0]!.status).toBe("đang chạy");
    expect(mgr.queueRunAll.status("proj").pausedUntil).not.toBeNull();
    expect(mgr.queueRunAll.status("proj").failed).toEqual([]);
    // Fire: the follow-up (a new run in the same session) succeeds and commits.
    const follow = vi.spyOn(mgr, "followup").mockImplementation(async () => {
      store.createRun({ id: "q2", status: "done", prompt: "tiếp", mode: "single+coding", model: "sonnet", session_id: "sess", parent_run_id: "q1", project: "proj", claude_version: null, run_dir: root });
      store.updateRun("q2", { commits: [{ sha: "a".repeat(40), subject: "feat: x" }] } as never);
      (mgr as any).syncQueueOnExit("q2", "proj");
      return {} as never;
    });
    await (mgr as any).fireQuotaResume("q1");
    expect(follow).toHaveBeenCalledTimes(1);
    expect(mgr.queue.list("proj")[0]!.status).toBe("đã commit");
    expect(mgr.queueRunAll.status("proj").pausedUntil).toBeNull();
    expect(requeue).toBeDefined();
  });
});
