/** Shared cleanup planning for the CLI and the HTTP server (no deletion happens here). */
import type { ControllerConfig } from "../app/config.js";
import type { RunRecord, RunStore } from "../run/run-store.js";
import { planCleanup, type CleanupPlan, type ExecuteCleanupOptions, type PlanDeps } from "./worktree-cleanup.js";

export const DEFAULT_CLEANUP_DAYS = 14;

/** Positive integer days; undefined -> default; anything else invalid -> null. */
export function parseOlderThan(v: unknown): number | null {
  if (v === undefined) return DEFAULT_CLEANUP_DAYS;
  if (typeof v !== "string" || !/^\d+$/.test(v.trim())) return null;
  const n = Number(v.trim());
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

export interface BuildCleanupPlanOptions {
  config: Pick<ControllerConfig, "workspaceDir" | "worktreesDir">;
  store: Pick<RunStore, "listRuns" | "getProject">;
  days: number;
  now: number;
  planDeps?: Partial<PlanDeps> | undefined;
}

export interface BuiltCleanupPlan {
  plan: CleanupPlan;
  runs: RunRecord[];
  activeRunIds: string[];
  executeOpts: Omit<ExecuteCleanupOptions, "dryRun" | "deps">;
}

export async function buildCleanupPlan(o: BuildCleanupPlanOptions): Promise<BuiltCleanupPlan> {
  const runs = o.store.listRuns({ limit: 100000 });
  const activeRunIds = runs.filter((r) => r.status === "queued" || r.status === "running").map((r) => r.id);
  const plan = await planCleanup({
    runs,
    olderThanDays: o.days,
    now: o.now,
    activeRunIds,
    worktreesDir: o.config.worktreesDir,
    getRepoPath: (project) => {
      const p = o.store.getProject(project);
      return p && p.repo_path ? { repoPath: p.repo_path, baseBranch: p.base_branch ?? "main" } : null;
    },
    ...(o.planDeps ? { deps: o.planDeps } : {}),
  });
  return {
    plan,
    runs,
    activeRunIds,
    executeOpts: { plan, workspaceDir: o.config.workspaceDir, olderThanDays: o.days, now: o.now, activeRunIds },
  };
}
