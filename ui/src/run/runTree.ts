/**
 * Pure helpers that group a flat run list into threads: a root run plus every follow-up / "continue from commit"
 * run below it (any depth), shown as one row that expands. No React, no storage.
 */

export interface TreeRun {
  id: string;
  created_at: number;
  status: string;
  parent_run_id: string | null;
  /** "Continue from commit" (resumeFrom): a fresh run that starts from another run's commit. */
  forked_from_run_id?: string | null;
  cost_usd_est: number;
}

export interface RunThread<T extends TreeRun = TreeRun> {
  root: T;
  /** Every descendant of the root present in the list, oldest first ("Phản hồi 1" = replies[0]). */
  replies: T[];
  /** Estimated cost of root + replies (client-side estimate, same as each run's). */
  totalCost: number;
}

/** The run this one continues: follow-up parent first, else the run it was forked from. */
export function parentOf(r: TreeRun): string | null {
  return r.parent_run_id || r.forked_from_run_id || null;
}

/**
 * Group runs into threads. A run whose parent is not in the list is a root (its own replies stay with it);
 * parent cycles never loop: the oldest member of a cycle becomes the root. Threads keep the order in which
 * their first member appears in the input (the API lists newest first, so a thread with a new reply moves up).
 */
export function buildRunTree<T extends TreeRun>(runs: readonly T[]): RunThread<T>[] {
  const byId = new Map<string, T>();
  for (const r of runs) if (!byId.has(r.id)) byId.set(r.id, r);
  const rootMemo = new Map<string, string>();

  const older = (a: T, b: T) => (a.created_at !== b.created_at ? a.created_at < b.created_at : a.id < b.id);

  const rootOf = (id: string): string => {
    const path: string[] = [];
    let cur = id;
    let root: string;
    for (;;) {
      const memo = rootMemo.get(cur);
      if (memo !== undefined) {
        root = memo;
        break;
      }
      const at = path.indexOf(cur);
      if (at >= 0) {
        let best = byId.get(path[at]!)!;
        for (const m of path.slice(at + 1)) {
          const run = byId.get(m)!;
          if (older(run, best)) best = run;
        }
        root = best.id;
        break;
      }
      path.push(cur);
      const p = parentOf(byId.get(cur)!);
      if (!p || p === cur || !byId.has(p)) {
        root = cur;
        break;
      }
      cur = p;
    }
    for (const n of path) rootMemo.set(n, root);
    return root;
  };

  const threads = new Map<string, RunThread<T>>();
  for (const r of byId.values()) {
    const rootId = rootOf(r.id);
    let th = threads.get(rootId);
    if (!th) {
      th = { root: byId.get(rootId)!, replies: [], totalCost: 0 };
      threads.set(rootId, th);
    }
    if (r.id !== rootId) th.replies.push(r);
    th.totalCost += Number.isFinite(r.cost_usd_est) ? r.cost_usd_est : 0;
  }
  for (const th of threads.values()) th.replies.sort((a, b) => (older(a, b) ? -1 : 1));
  return [...threads.values()];
}

const LIVE = new Set(["running", "queued"]);

/** True when the root or any reply is running or waiting for a slot. */
export function threadIsLive(th: RunThread): boolean {
  return LIVE.has(th.root.status) || th.replies.some((r) => LIVE.has(r.status));
}

/** Expanded? The user's saved choice wins; otherwise collapsed, except a live thread with replies opens itself. */
export function threadIsOpen(th: RunThread, saved: Readonly<Record<string, boolean>>): boolean {
  const v = saved[th.root.id];
  if (typeof v === "boolean") return v;
  return th.replies.length > 0 && threadIsLive(th);
}

/** Sanitize a stored open-state map: booleans only, at most `max` entries (newest insertions kept). */
export function pruneOpenState(raw: unknown, max: number): Record<string, boolean> {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
  const entries = Object.entries(raw as Record<string, unknown>).filter((e): e is [string, boolean] => typeof e[1] === "boolean");
  return Object.fromEntries(entries.slice(Math.max(0, entries.length - max)));
}
