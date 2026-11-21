/**
 * Server-side "run all" orchestrator for the planner queue. State lives in memory only (lost on restart; the queue
 * itself is persisted by QueueStore). Per project: a flag + a mutex-serialized tick() that starts the commands picked
 * by pickRunAll. tick() is called by the run-manager whenever ANY coding run ends, and by a fallback timer while the
 * flag is on (startQueuedCommand can throw when a slot is held by a coding run outside the queue).
 */
import type { QueueCommand } from "./queue-store.js";
import { blockedByFailure, pickRunAll } from "./queue-engine.js";

export interface RunAllSummary {
  active: boolean;
  running: string[];
  committed: string[];
  failed: string[];
  blocked: string[];
  lastError: string | null;
  /** Idea scope of the active run-all, null when unscoped or inactive. */
  sourceRef: string | null;
  /** Epoch ms until which run-all is paused (quota limit), null when not paused. */
  pausedUntil: number | null;
  pauseReason: string | null;
  pauseRunId: string | null;
}

export interface QueueRunAllDeps {
  /** Clock in epoch ms. Default Date.now. */
  now?(): number;
  list(project: string): QueueCommand[];
  /** Coding runs running in the whole controller. */
  codingRunningTotal(): number;
  start(project: string, commandId: string, sourceRef?: string): Promise<unknown>;
  hotspots?(): string[] | undefined;
  /** Parallel sessions allowed per project (queue.maxParallel). Absent = 2. */
  maxParallel?(): number | undefined;
  /** Move a failed command back to "đã duyệt" so run-all starts it again. Absent = no automatic retry. */
  requeue?(project: string, commandId: string): void;
  /** Automatic retries per failed command during one run-all pass. Default 2. */
  maxRetries?: number;
  /** Fallback timer period while a project is active; 0 disables the timer (tests). Default 7000. */
  retryMs?: number;
  /** Called once when run-all finishes naturally after starting at least one command. Errors are swallowed. */
  onFinish?(project: string, summary: { committed: string[]; failed: string[]; blocked: string[] }): unknown;
}

/** Run-all gives up after this many consecutive failed launches of the same command. */
const MAX_START_FAILURES = 3;

export class QueueRunAll {
  private readonly flags = new Set<string>();
  private readonly errors = new Map<string, string>();
  /** Per-project idea scope (sourceRef) while run-all is limited to one idea. */
  private readonly scopes = new Map<string, string>();
  private readonly chains = new Map<string, Promise<void>>();
  /** Projects where this run-all pass started at least one command. */
  private readonly startedIn = new Set<string>();
  /** Automatic retries used so far per `${project}\0${commandId}` in the current run-all pass. */
  private readonly retries = new Map<string, number>();
  /** Consecutive failed launches per project+command; run-all stops at MAX_START_FAILURES. */
  private readonly startFailures = new Map<string, number>();
  /** Per-project pause (quota limit): no autoRetry/requeue/start while now() < until. */
  private readonly pauses = new Map<string, { until: number; reason: string; runId: string }>();
  private timer: NodeJS.Timeout | null = null;
  private readonly now: () => number;

  constructor(private readonly deps: QueueRunAllDeps) {
    this.now = deps.now ? () => deps.now!() : Date.now;
  }

  /** Pause an active run-all until `until` (epoch ms). Returns false when the project is not active. */
  pauseUntil(project: string, until: number, reason: string, runId: string): boolean {
    if (!this.flags.has(project)) return false;
    this.pauses.set(project, { until, reason, runId });
    return true;
  }

  /** Clears the pause; true when there was one. */
  clearPause(project: string): boolean {
    return this.pauses.delete(project);
  }

  isActive(project: string): boolean {
    return this.flags.has(project);
  }

  /** Throws (Vietnamese message, `code` = "conflict") when already running or nothing is approved. */
  async start(project: string, sourceRef?: string, pause?: { until: number; reason: string; runId: string }): Promise<void> {
    if (this.flags.has(project)) throw Object.assign(new Error("Đang chạy tất cả lệnh hàng đợi."), { code: "conflict" });
    if (sourceRef) {
      if (!this.deps.list(project).some((c) => c.status === "đã duyệt" && c.sourceRef === sourceRef)) {
        throw Object.assign(new Error("Ý tưởng này không có task nào đã duyệt để chạy."), { code: "conflict" });
      }
    } else if (!this.deps.list(project).some((c) => c.status === "đã duyệt")) {
      throw Object.assign(new Error("Không có lệnh nào ở trạng thái đã duyệt để chạy."), { code: "conflict" });
    }
    this.flags.add(project);
    this.pauses.delete(project);
    if (pause) this.pauses.set(project, pause); // set before the first tick so nothing else starts before the quota resets
    if (sourceRef) this.scopes.set(project, sourceRef);
    else this.scopes.delete(project);
    this.errors.delete(project);
    this.startedIn.delete(project);
    for (const k of [...this.retries.keys()]) if (k.startsWith(`${project}\0`)) this.retries.delete(k);
    for (const k of [...this.startFailures.keys()]) if (k.startsWith(`${project}\u0000`)) this.startFailures.delete(k);
    this.ensureTimer();
    await this.tick(project);
  }

  /** Cancels the flag only; runs already started keep going. */
  stop(project: string): void {
    this.flags.delete(project);
    this.scopes.delete(project);
    this.pauses.delete(project);
    this.maybeStopTimer();
  }

  status(project: string): RunAllSummary {
    const all = this.deps.list(project);
    const ids = (s: QueueCommand["status"]) => all.filter((c) => c.status === s).map((c) => c.id);
    return {
      active: this.flags.has(project),
      running: ids("đang chạy"),
      committed: ids("đã commit"),
      failed: ids("lỗi"),
      blocked: blockedByFailure(all),
      lastError: this.errors.get(project) ?? null,
      sourceRef: this.flags.has(project) ? (this.scopes.get(project) ?? null) : null,
      pausedUntil: this.pauses.get(project)?.until ?? null,
      pauseReason: this.pauses.get(project)?.reason ?? null,
      pauseRunId: this.pauses.get(project)?.runId ?? null,
    };
  }

  /** Tick every active project (called when any coding run ends and by the timer). Never throws. */
  async tickAll(): Promise<void> {
    await Promise.all([...this.flags].map((p) => this.tick(p)));
  }

  /** Serialized per project (mutex via promise chain). Never throws. */
  tick(project: string): Promise<void> {
    const prev = this.chains.get(project) ?? Promise.resolve();
    const next = prev.then(() => this.doTick(project)).catch(() => undefined);
    this.chains.set(project, next);
    return next;
  }

  private async doTick(project: string): Promise<void> {
    if (!this.flags.has(project)) return;
    const pause = this.pauses.get(project);
    if (pause) {
      if (this.now() < pause.until) return;
      this.pauses.delete(project);
    }
    const scope = this.scopes.get(project);
    this.autoRetry(project, scope);
    const all = this.deps.list(project);
    // Idea scope: only that idea's tasks are candidates; independent ones run in parallel (own worktrees), dependent
    // ones wait for their dependencies. Finish only when nothing of the idea is running.
    const mine = scope ? all.filter((c) => c.sourceRef === scope) : all;
    const runningInProject = all.filter((c) => c.status === "đang chạy").length;
    const runningInScope = mine.filter((c) => c.status === "đang chạy").length;
    const picked = pickRunAll(all, this.deps.codingRunningTotal(), runningInProject, this.deps.maxParallel?.() ?? 2, this.deps.hotspots?.(), scope);
    if (picked.length === 0) {
      // Nothing startable now: finish when nothing is running and nothing approved remains startable.
      if (runningInScope === 0) this.finish(project);
      return;
    }
    for (const c of picked) {
      if (!this.flags.has(project)) return;
      try {
        await this.deps.start(project, c.id, scope);
        this.startedIn.add(project);
        this.errors.delete(project);
        this.startFailures.delete(`${project}\u0000${c.id}`);
      } catch (e) {
        this.errors.set(project, e instanceof Error ? e.message : String(e));
        const key = `${project}\u0000${c.id}`;
        const n = (this.startFailures.get(key) ?? 0) + 1;
        this.startFailures.set(key, n);
        if (n >= MAX_START_FAILURES) this.finish(project); // errors are kept so the UI shows the reason
        return; // otherwise retry on the next tick (run end or timer)
      }
    }
  }

  /** Failed commands (in scope) go back to "đã duyệt" up to maxRetries times, so one flaky run does not stall the queue. */
  private autoRetry(project: string, scope: string | undefined): void {
    if (!this.deps.requeue) return;
    const max = this.deps.maxRetries ?? 2;
    for (const c of this.deps.list(project)) {
      if (c.status !== "lỗi" || (scope && c.sourceRef !== scope)) continue;
      const key = `${project}\0${c.id}`;
      const used = this.retries.get(key) ?? 0;
      if (used >= max) continue;
      try {
        this.deps.requeue(project, c.id);
        this.retries.set(key, used + 1);
      } catch {
        /* a command that cannot be requeued stays failed */
      }
    }
  }

  private finish(project: string): void {
    this.flags.delete(project);
    this.scopes.delete(project);
    this.pauses.delete(project);
    this.maybeStopTimer();
    // Only report when this pass actually started a command (no fake zero summary); manual stop() never reports.
    if (!this.startedIn.delete(project)) return;
    try {
      const s = this.status(project);
      const r = this.deps.onFinish?.(project, { committed: s.committed, failed: s.failed, blocked: s.blocked });
      void Promise.resolve(r).catch(() => undefined);
    } catch {
      /* notification problems must never affect the queue */
    }
  }

  private ensureTimer(): void {
    const ms = this.deps.retryMs ?? 7000;
    if (this.timer || ms <= 0) return;
    this.timer = setInterval(() => void this.tickAll(), ms);
    this.timer.unref?.();
  }

  private maybeStopTimer(): void {
    if (this.flags.size === 0 && this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }
}
