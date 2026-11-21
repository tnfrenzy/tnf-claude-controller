// RunManager-backed runStep for the skill trainer: each step (compose, trial, grade) is its own research run.
import type { RunStep, StepResult } from "./runner.js";

export interface StepRunRecord {
  id: string;
  status?: string;
  cost_usd_est?: number | null;
  result_text?: string | null;
  error?: string | null;
}

/** Minimal slice of RunManager used here (lets tests pass a fake). */
export interface StepManager {
  startRun(input: { prompt: string; project?: string; kind?: "research" | "coding"; model?: string; accountId?: string; allowedTools?: string[]; maxBudgetUsd?: number; roles?: boolean }): Promise<StepRunRecord>;
  waitFor(runId: string): Promise<StepRunRecord | null>;
  cancel(runId: string): boolean;
  resolveRoleAssignment?: (role: string) => { accountId?: string; model?: string };
}

export const SKILL_WORKSHOP_PROJECT = "skill-workshop";

export interface ManagerRunStepOptions {
  /** Per-step budget ceiling (estimated USD); the manager still clamps it to its own ceiling. */
  maxBudgetUsd?: number;
}

/** Steps never get Bash or write tools: compose/trial/grade only produce text. */
export function createManagerRunStep(manager: StepManager, opts: ManagerRunStepOptions = {}): { runStep: RunStep; cancelActive: () => void } {
  const active = new Set<string>();
  const runStep: RunStep = async (role, prompt): Promise<StepResult> => {
    let runId = "";
    try {
      const ra = manager.resolveRoleAssignment?.(role);
      const started = await manager.startRun({
        prompt,
        project: SKILL_WORKSHOP_PROJECT,
        kind: "research",
        // Single-agent text run: without this the run gets the research coordinator prompt + searcher/analyzer/synthesizer
        // roles, and the coordinator is told to delegate through an Agent tool these steps do not have.
        roles: false,
        allowedTools: [],
        ...(ra?.accountId ? { accountId: ra.accountId } : {}),
        ...(ra?.model ? { model: ra.model } : {}),
        ...(opts.maxBudgetUsd ? { maxBudgetUsd: opts.maxBudgetUsd } : {})
      });
      runId = started.id;
      active.add(runId);
      const done = await manager.waitFor(runId);
      const ok = done?.status === "done";
      const cost = typeof done?.cost_usd_est === "number" && Number.isFinite(done.cost_usd_est) ? done.cost_usd_est : 0;
      const error = ok ? undefined : done?.error || "Run không hoàn tất.";
      return { runId, costUsd: cost, text: done?.result_text ?? "", ok, ...(error ? { error } : {}) };
    } catch (e) {
      return { runId, costUsd: 0, text: "", ok: false, error: e instanceof Error ? e.message : String(e) };
    } finally {
      if (runId) active.delete(runId);
    }
  };
  const cancelActive = (): void => {
    for (const id of [...active]) manager.cancel(id);
  };
  return { runStep, cancelActive };
}
