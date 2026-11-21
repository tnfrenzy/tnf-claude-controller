import type { Dict } from "../i18n";
import type { CleanupPlan, CleanupSkipReason } from "../types";

/** Whole number of days, 0 or more; anything else gives null. */
export function parseDays(input: string): number | null {
  const s = input.trim();
  if (!/^\d+$/.test(s)) return null;
  const n = Number(s);
  return Number.isSafeInteger(n) ? n : null;
}

const REASONS: Record<CleanupSkipReason, keyof Dict> = {
  active: "cleanup_skip_active",
  no_worktree: "cleanup_skip_no_worktree",
  no_branch: "cleanup_skip_no_branch",
  no_project: "cleanup_skip_no_project",
  too_recent: "cleanup_skip_too_recent",
  shared_worktree: "cleanup_skip_shared_worktree",
  outside_worktrees_dir: "cleanup_skip_outside_worktrees_dir",
  missing: "cleanup_skip_missing",
  uncommitted: "cleanup_skip_uncommitted",
  unmerged: "cleanup_skip_unmerged",
  status_unknown: "cleanup_skip_status_unknown",
  error: "cleanup_skip_error",
};

export function skipReasonKey(reason: string): keyof Dict {
  return Object.prototype.hasOwnProperty.call(REASONS, reason) ? REASONS[reason as CleanupSkipReason] : "cleanup_skip_other";
}

/** n counts runs (a shared worktree carries several runIds), not candidates. */
export function summarize(plan: CleanupPlan): { n: number; totalBytes: number } {
  return { n: plan.candidates.reduce((s, c) => s + c.runIds.length, 0), totalBytes: plan.totalBytes };
}
