/**
 * Cleanup of old coding worktrees (docs/IDEAS.md 2.4). `planCleanup` only reads; it never throws and never deletes.
 * Runs that are active, too recent, dirty or not merged are never put in the candidate list.
 */
import fs from "node:fs";
import path from "node:path";
import { isBranchMerged, removeWorktree, runGit, unlinkNodeModules } from "./git.js";
import { measureDir } from "./node-modules.js";
import type { RunRecord } from "../run/run-store.js";

export interface CleanupCandidate {
  /** Every run that shares this worktree. */
  runIds: string[];
  worktreePath: string;
  branch: string;
  repoPath: string;
  baseBranch: string;
  estimatedBytes: number;
}

export type CleanupSkipReason =
  | "active"
  | "no_worktree"
  | "no_branch"
  | "no_project"
  | "too_recent"
  | "shared_worktree"
  | "outside_worktrees_dir"
  | "missing"
  | "uncommitted"
  | "unmerged"
  | "status_unknown"
  | "error";

export interface CleanupSkip {
  runId: string;
  reason: CleanupSkipReason;
  severity: "info" | "warn";
  detail?: string;
}

export interface CleanupPlan {
  candidates: CleanupCandidate[];
  skipped: CleanupSkip[];
  totalBytes: number;
}

export interface WorktreeStatus {
  ok: boolean;
  /** True when the worktree has changes other than node_modules. */
  dirty: boolean;
  detail?: string;
}

export interface PlanDeps {
  worktreeStatus: (worktreePath: string) => WorktreeStatus;
  isBranchMerged: (repoPath: string, branch: string, base: string) => boolean;
  measureBytes: (dir: string) => number;
  exists: (p: string) => boolean;
}

/**
 * `git status --porcelain` of a worktree without node_modules (a copy or junction must not look like a change).
 * Same node_modules handling as commitAllInWorktree: plain pathspec when git already ignores it, `:!node_modules` otherwise.
 * A non-zero exit means the state is unknown.
 */
export function worktreeStatus(worktreePath: string): WorktreeStatus {
  const ignored = runGit(worktreePath, ["check-ignore", "-q", "node_modules"]).code === 0;
  const r = runGit(worktreePath, ignored ? ["status", "--porcelain", "--", "."] : ["status", "--porcelain", "--", ".", ":!node_modules"]);
  if (r.code !== 0) return { ok: false, dirty: false, detail: r.stderr.trim() || `git status mã ${r.code}` };
  return { ok: true, dirty: r.stdout.trim().length > 0 };
}

export const defaultPlanDeps: PlanDeps = {
  worktreeStatus,
  isBranchMerged,
  measureBytes: (dir) => measureDir(dir, Infinity).bytes,
  exists: (p) => fs.existsSync(p),
};

export interface PlanCleanupOptions {
  runs: RunRecord[];
  olderThanDays: number;
  now: number;
  activeRunIds?: Iterable<string>;
  worktreesDir: string;
  getRepoPath: (project: string) => { repoPath: string; baseBranch: string } | null | undefined;
  deps?: Partial<PlanDeps>;
}

const DAY_MS = 86_400_000;

const norm = (p: string): string => {
  const r = path.resolve(p);
  return process.platform === "win32" ? r.toLowerCase() : r;
};

function isInside(parent: string, child: string): boolean {
  const rel = path.relative(norm(parent), norm(child));
  return rel !== "" && !rel.startsWith("..") && !path.isAbsolute(rel);
}

export async function planCleanup(o: PlanCleanupOptions): Promise<CleanupPlan> {
  const deps: PlanDeps = { ...defaultPlanDeps, ...o.deps };
  const active = new Set(o.activeRunIds ?? []);
  const plan: CleanupPlan = { candidates: [], skipped: [], totalBytes: 0 };
  const skip = (runId: string, reason: CleanupSkipReason, severity: "info" | "warn" = "info", detail?: string) =>
    plan.skipped.push({ runId, reason, severity, ...(detail ? { detail } : {}) });
  const threshold = o.olderThanDays * DAY_MS;

  // Per-run eligibility; runs without a usable worktree/branch are skipped right away.
  const groups = new Map<string, RunRecord[]>();
  const eligible = new Set<string>();
  for (const run of o.runs) {
    try {
      if (run.status === "queued" || run.status === "running" || active.has(run.id)) {
        skip(run.id, "active");
        // An active run still blocks the others that share its worktree.
        if (run.worktree_path) groups.set(norm(run.worktree_path), [...(groups.get(norm(run.worktree_path)) ?? []), run]);
        continue;
      }
      if (!run.worktree_path) {
        skip(run.id, "no_worktree");
        continue;
      }
      const key = norm(run.worktree_path);
      groups.set(key, [...(groups.get(key) ?? []), run]);
      if (!run.branch) {
        skip(run.id, "no_branch");
        continue;
      }
      if (o.now - run.updated_at < threshold) {
        skip(run.id, "too_recent");
        continue;
      }
      eligible.add(run.id);
    } catch (e) {
      skip(run.id, "error", "warn", e instanceof Error ? e.message : String(e));
    }
  }

  for (const [, members] of groups) {
    const ready = members.filter((m) => eligible.has(m.id));
    if (ready.length === 0) continue;
    try {
      if (ready.length < members.length) {
        for (const m of ready) skip(m.id, "shared_worktree", "info", "Worktree dùng chung với run đang chạy, chưa đủ cũ hoặc không đủ điều kiện.");
        continue;
      }
      const first = ready[0]!;
      const wt = first.worktree_path!;
      const branch = first.branch!;
      const ids = ready.map((m) => m.id);
      const skipAll = (reason: CleanupSkipReason, severity: "info" | "warn", detail?: string) => ids.forEach((id) => skip(id, reason, severity, detail));
      if (!isInside(o.worktreesDir, wt)) {
        skipAll("outside_worktrees_dir", "warn", wt);
        continue;
      }
      const proj = o.getRepoPath(first.project);
      if (!proj) {
        skipAll("no_project", "info", first.project);
        continue;
      }
      if (!deps.exists(wt)) {
        skipAll("missing", "info", "Thư mục worktree không còn trên đĩa.");
        continue;
      }
      const st = deps.worktreeStatus(wt);
      if (!st.ok) {
        skipAll("status_unknown", "warn", st.detail);
        continue;
      }
      if (st.dirty) {
        skipAll("uncommitted", "warn", "Còn thay đổi chưa commit.");
        continue;
      }
      if (!deps.isBranchMerged(proj.repoPath, branch, proj.baseBranch)) {
        skipAll("unmerged", "warn", `Nhánh ${branch} chưa gộp vào ${proj.baseBranch}.`);
        continue;
      }
      const bytes = deps.measureBytes(wt);
      plan.candidates.push({ runIds: ids, worktreePath: wt, branch, repoPath: proj.repoPath, baseBranch: proj.baseBranch, estimatedBytes: bytes });
      plan.totalBytes += bytes;
    } catch (e) {
      for (const m of ready) skip(m.id, "error", "warn", e instanceof Error ? e.message : String(e));
    }
  }
  return plan;
}

export interface CleanupRunResult {
  /** Run id (a shared worktree yields one result per run id, all with the same outcome). */
  runId: string;
  worktreePath: string;
  status: "removed" | "dry-run" | "failed" | "skipped";
  error?: string;
  detail?: string;
  bytes: number;
}

export interface ExecuteDeps {
  worktreeStatus: (worktreePath: string) => WorktreeStatus;
  unlinkNodeModules: (worktreePath: string) => void;
  removeWorktree: typeof removeWorktree;
}

export const defaultExecuteDeps: ExecuteDeps = { worktreeStatus, unlinkNodeModules, removeWorktree };

export interface ExecuteCleanupOptions {
  plan: CleanupPlan;
  /** dryRun still re-checks active/uncommitted (so the report is accurate) but deletes nothing. */
  dryRun?: boolean;
  workspaceDir: string;
  olderThanDays: number;
  now: number;
  activeRunIds?: Iterable<string>;
  deps?: Partial<ExecuteDeps>;
}

export interface ExecuteCleanupResult {
  results: CleanupRunResult[];
  /** Abandoned inbox-staging dirs removed (dryRun: the ones that would be removed). */
  inboxRemoved: string[];
}

/**
 * Runs a plan: re-checks each worktree right before removal, unlinks the node_modules junction first,
 * then removes the worktree and keeps the tnf/<run-id> branch. Never throws; every failure is reported per run.
 */
export async function executeCleanup(o: ExecuteCleanupOptions): Promise<ExecuteCleanupResult> {
  const deps: ExecuteDeps = { ...defaultExecuteDeps, ...o.deps };
  const out: ExecuteCleanupResult = { results: [], inboxRemoved: [] };
  let active = new Set<string>();
  try {
    active = new Set(o.activeRunIds ?? []);
  } catch {
    /* keep empty */
  }
  for (const c of o.plan?.candidates ?? []) {
    const push = (status: CleanupRunResult["status"], extra: { error?: string; detail?: string } = {}) => {
      for (const id of c.runIds) out.results.push({ runId: id, worktreePath: c.worktreePath, status, bytes: c.estimatedBytes, ...extra });
    };
    try {
      if (c.runIds.some((id) => active.has(id))) {
        push("skipped", { detail: "active_now" });
        continue;
      }
      const st = deps.worktreeStatus(c.worktreePath);
      if (!st.ok) {
        push("skipped", { detail: "status_unknown_now", ...(st.detail ? { error: st.detail } : {}) });
        continue;
      }
      if (st.dirty) {
        push("skipped", { detail: "uncommitted_now" });
        continue;
      }
      if (o.dryRun) {
        push("dry-run");
        continue;
      }
      deps.unlinkNodeModules(c.worktreePath);
      deps.removeWorktree({ repoPath: c.repoPath, worktreePath: c.worktreePath, branch: c.branch, deleteBranch: false });
      push("removed");
    } catch (e) {
      push("failed", { error: e instanceof Error ? e.message : String(e) });
    }
  }

  try {
    const dir = path.join(o.workspaceDir, "inbox-staging");
    const threshold = o.olderThanDays * DAY_MS;
    for (const name of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
      try {
        if (active.has(name)) continue;
        const p = path.join(dir, name);
        const st = fs.lstatSync(p);
        if (!st.isDirectory() || o.now - st.mtimeMs < threshold) continue;
        if (!o.dryRun) fs.rmSync(p, { recursive: true, force: true });
        out.inboxRemoved.push(p);
      } catch {
        /* one bad entry must not stop the rest */
      }
    }
  } catch {
    /* ignore */
  }
  return out;
}
