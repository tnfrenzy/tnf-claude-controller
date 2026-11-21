// src/core/workshop3d/step-adapter.ts
// Runs one workshop role as its own read-only run (Read tool limited to the session dir).
import type { ReadOnlySpec } from "../run/run-manager.js";
import { loadW3DRoles } from "./roles.js";
import type { Workshop3DRole } from "./types.js";
import { slashes } from "../app/util.js";
export { slashes };

export interface W3DStepResult {
  runId: string;
  costUsd: number;
  text: string;
  ok: boolean;
  interrupted: boolean;
  rateLimited: boolean;
  /** True when cancelActive killed this run (or it was refused after a cancel): not a failure of the role. */
  cancelled: boolean;
  error?: string;
}
export type W3DRunStep = (role: Workshop3DRole, prompt: string, sessionDir: string) => Promise<W3DStepResult>;

/** Minimal slice of RunManager used here (tests pass a fake). */
export interface W3DStepManager {
  startRun(input: { prompt: string; project: string; model?: string; accountId?: string; maxBudgetUsd?: number; threadWith?: string; resumeSessionOf?: string; readOnly: ReadOnlySpec }): Promise<{ id: string }>;
  waitFor(runId: string): Promise<{ status?: string; cost_usd_est?: number | null; result_text?: string | null; error?: string | null } | null>;
  cancel(runId: string): boolean;
  resolveRoleAssignment?: (role: string) => { accountId?: string; model?: string };
}

export const WORKSHOP3D_PROJECT = "workshop3d";

// Same shape as AUTO_RESUME_ERRORS in run-manager.ts, plus the Vietnamese "cut off" message.
const INTERRUPTED = /^(timeout|subagent_interrupted)(?![A-Za-z_])|bị cắt/i;
// Subscription messages look like "You've hit your limit · resets …" or "5-hour limit reached". A bare "quota" or
// "hạn mức" elsewhere in an error text (a file name, a variable) is not a limit: those words count only with exceeded/reached/hết.
const RATE_LIMITED = /hit your limit|limit reached|rate.?limit|usage limit|quota (?:exceeded|reached)|hết hạn mức|hạn mức (?:đã )?hết/i;

// Same normalisation as `slashes` in permissions.ts (not exported there).
/** A modeler session is continued at most this many times in a row, then a fresh one starts (context and cost keep growing). */
export const MODELER_MAX_CHAIN = 3;

export function createW3DRunStep(
  manager: W3DStepManager,
  roles = loadW3DRoles(),
  opts: {
    maxBudgetUsd?: number;
    /** Called at every role call (a change in Settings applies to the next call); returns the model to use. */
    modelFor?: (role: Workshop3DRole, fileModel: string | undefined) => string | undefined;
    /** Read at every call: true = the cad-modeler continues its own earlier session (fix rounds); other roles never do. */
    resumeModeler?: () => boolean;
  } = {},
): { runStep: W3DRunStep; cancelActive: () => void; resetCancel: () => void } {
  const active = new Set<string>();
  /** First role-call run of each session dir: later calls of that session share its history thread. */
  const firstRun = new Map<string, string>();
  const cancelledIds = new Set<string>();
  /** Last successful cad-modeler run of each session dir and how many times its session was already continued. */
  const modeler = new Map<string, { id: string; chain: number }>();
  let cancelRequested = false;
  const runStep: W3DRunStep = async (role, prompt, sessionDir) => {
    if (cancelRequested) {
      return { runId: "", costUsd: 0, text: "", ok: false, interrupted: false, rateLimited: false, cancelled: true, error: "Đã hủy." };
    }
    let runId = "";
    try {
      const def = roles[role];
      const ra = manager.resolveRoleAssignment?.(role);
      const model = ra?.model ?? (opts.modelFor ? opts.modelFor(role, def.model) : def.model);
      const prior = role === "cad-modeler" && opts.resumeModeler?.() === true ? modeler.get(sessionDir) : undefined;
      const resumeFrom = prior && prior.chain < MODELER_MAX_CHAIN ? prior : undefined;
      const started = await manager.startRun({
        prompt,
        project: WORKSHOP3D_PROJECT,
        ...(model ? { model } : {}),
        ...(ra?.accountId ? { accountId: ra.accountId } : {}),
        ...(opts.maxBudgetUsd ? { maxBudgetUsd: opts.maxBudgetUsd } : {}),
        ...(firstRun.has(sessionDir) ? { threadWith: firstRun.get(sessionDir)! } : {}),
        ...(resumeFrom ? { resumeSessionOf: resumeFrom.id } : {}),
        readOnly: { systemPrompt: def.prompt, allowedTools: [`Read(${slashes(sessionDir)}/**)`], addDirs: [sessionDir] },
      });
      runId = started.id;
      if (!firstRun.has(sessionDir)) firstRun.set(sessionDir, runId);
      active.add(runId);
      // cancelActive may have fired while startRun was in flight: kill the run that just appeared.
      if (cancelRequested) {
        cancelledIds.add(runId);
        manager.cancel(runId);
      }
      const done = await manager.waitFor(runId);
      const ok = done?.status === "done";
      if (role === "cad-modeler") {
        if (ok) modeler.set(sessionDir, { id: runId, chain: resumeFrom ? resumeFrom.chain + 1 : 0 });
        else modeler.delete(sessionDir);
      }
      const costUsd = typeof done?.cost_usd_est === "number" && Number.isFinite(done.cost_usd_est) ? done.cost_usd_est : 0;
      const error = done?.error || (ok ? undefined : "Run không hoàn tất.");
      const cancelled = cancelledIds.has(runId);
      return {
        runId,
        costUsd,
        text: done?.result_text ?? "",
        ok,
        interrupted: !cancelled && !!error && INTERRUPTED.test(error),
        rateLimited: !cancelled && !!error && RATE_LIMITED.test(error),
        cancelled,
        ...(error ? { error } : {}),
      };
    } catch (e) {
      return { runId, costUsd: 0, text: "", ok: false, interrupted: false, rateLimited: false, cancelled: cancelledIds.has(runId), error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (runId) {
        active.delete(runId);
        cancelledIds.delete(runId);
      }
    }
  };
  const cancelActive = (): void => {
    cancelRequested = true;
    for (const id of [...active]) {
      cancelledIds.add(id);
      manager.cancel(id);
    }
  };
  /**
   * `cancelRequested` is sticky: after `cancelActive()` every `runStep` is refused (ok:false, cancelled:true) until this is called.
   * The runner must call `resetCancel()` before starting steps after a stop/resume, and must check `result.cancelled`
   * before treating `ok:false` as a failure of the role.
   */
  const resetCancel = (): void => {
    cancelRequested = false;
  };
  return { runStep, cancelActive, resetCancel };
}
