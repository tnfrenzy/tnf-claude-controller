/** Planner queue engine: pure unlock / parallel-run checks (docs/PLANNER-QUEUE.md sections 3, 8). No I/O. */
import type { QueueCommand } from "./queue-store.js";
import { checkIndependence, type QueueCommand as PlanCommand } from "./queue-plan.js";
import { QUEUE_MAX_PARALLEL_CEILING, DEFAULT_QUEUE_HOTSPOTS } from "../app/config.js";

/** Clamp to 1..ceiling. NaN -> 2 (same default as parseQueue); +-Infinity clamp to the bounds. */
export function clampMaxParallel(n: number): number {
  if (Number.isNaN(n)) return 2;
  const f = Math.floor(n);
  return Math.min(QUEUE_MAX_PARALLEL_CEILING, Math.max(1, f));
}

export interface UnlockResult {
  unlocked: boolean;
  runnable: boolean;
  reasons: string[];
}

/** A command is unlocked when all deps are committed or merged; it is runnable only when all deps are merged. */
export function isUnlocked(cmd: QueueCommand, all: QueueCommand[]): UnlockResult {
  const byId = new Map(all.map((c) => [c.id, c]));
  const reasons: string[] = [];
  let unlocked = true;
  let runnable = true;
  for (const id of cmd.dependsOn) {
    const dep = byId.get(id);
    if (!dep) {
      unlocked = false;
      runnable = false;
      reasons.push(`phụ thuộc lệnh không tồn tại "${id}"`);
    } else if (dep.status === "bỏ qua") {
      unlocked = false;
      runnable = false;
      reasons.push(`phụ thuộc "${id}" đã bị bỏ qua nên lệnh này không bao giờ được mở`);
    } else if (dep.status === "lỗi") {
      unlocked = false;
      runnable = false;
      reasons.push(`phụ thuộc "${id}" bị lỗi nên lệnh này chưa thể mở`);
    } else if (dep.status === "đã commit") {
      runnable = false;
      reasons.push(`chờ gộp ${id}`);
    } else if (dep.status !== "đã gộp") {
      unlocked = false;
      runnable = false;
      reasons.push(`chờ ${id} (${dep.status})`);
    }
  }
  return { unlocked, runnable: unlocked && runnable, reasons };
}

export interface RunCheck {
  ok: boolean;
  /** Eligible but no free slot. Derived, never stored. */
  waiting: boolean;
  reasons: string[];
}

function toPlan(c: QueueCommand): PlanCommand {
  return { id: c.id, title: c.title, body: c.body, dependsOn: c.dependsOn, files: c.files, verify: "", size: 1 };
}

/**
 * Can `cmd` start now? `coderunsRunning` is the number of coding runs running in the whole controller; it already
 * includes running queue commands, so do not add `running.length` on top. Independence is only checked against
 * `running`; `all` is used for transitive dependencies.
 */
export function canRunParallel(
  cmd: QueueCommand,
  running: QueueCommand[],
  maxParallel: number,
  coderunsRunning: number,
  all: QueueCommand[],
  hotspots: string[] = DEFAULT_QUEUE_HOTSPOTS,
): RunCheck {
  const hard: string[] = [];
  if (cmd.status !== "đã duyệt") hard.push("chưa được duyệt");
  const u = isUnlocked(cmd, all);
  if (!u.runnable) hard.push(...u.reasons);
  const plans = all.map(toPlan);
  for (const r of running) {
    if (r.id === cmd.id || r.status !== "đang chạy") continue;
    const ind = checkIndependence(toPlan(cmd), toPlan(r), hotspots, plans);
    if (!ind.independent && ind.reason) hard.push(ind.reason);
  }
  const free = clampMaxParallel(maxParallel) - coderunsRunning;
  if (free <= 0) {
    const msg = `chờ chỗ: đã có ${coderunsRunning} run lập trình đang chạy (tối đa ${clampMaxParallel(maxParallel)})`;
    if (hard.length === 0) return { ok: false, waiting: true, reasons: [msg] };
    return { ok: false, waiting: false, reasons: [...hard, msg] };
  }
  if (hard.length) return { ok: false, waiting: false, reasons: hard };
  return { ok: true, waiting: false, reasons: [] };
}

/** Run-all unlock: every dependency must be committed or merged. Failed / skipped / missing deps block. */
export function isUnlockedForRunAll(cmd: QueueCommand, all: QueueCommand[]): boolean {
  const byId = new Map(all.map((c) => [c.id, c]));
  return cmd.dependsOn.every((id) => {
    const dep = byId.get(id);
    return !!dep && (dep.status === "đã commit" || dep.status === "đã gộp");
  });
}

/**
 * Sequential run-all picker for one idea (sourceRef): at most one command of the idea runs at a time. Returns the first
 * approved, unlocked command of the idea ordered by (batch, position, array order); null when sourceRef is empty, a
 * command of the idea is running, the global coding ceiling is reached, or nothing is runnable.
 */
export function pickIdeaNext(all: QueueCommand[], sourceRef: string, codingRunningTotal: number): QueueCommand | null {
  if (!sourceRef) return null;
  if (codingRunningTotal >= QUEUE_MAX_PARALLEL_CEILING) return null;
  const mine = all.map((c, i) => ({ c, i })).filter((x) => x.c.sourceRef === sourceRef);
  if (mine.some((x) => x.c.status === "đang chạy")) return null;
  const next = mine
    .filter((x) => x.c.status === "đã duyệt" && isUnlockedForRunAll(x.c, all))
    .sort((a, b) => a.c.batch - b.c.batch || a.c.position - b.c.position || a.i - b.i)[0];
  return next ? next.c : null;
}

/**
 * Run-all picker: approved commands, ordered by (batch, position), unlocked by committed/merged deps, independent of
 * running and already-picked ones. Count = min(clamp(maxParallel) - runningInProject,
 * QUEUE_MAX_PARALLEL_CEILING - codingRunningTotal), never negative. maxParallel defaults to 2. sourceRef limits the
 * candidates to one idea (independent tasks of the idea run in parallel, each in its own worktree).
 */
export function pickRunAll(
  all: QueueCommand[],
  codingRunningTotal: number,
  runningInProject: number,
  maxParallel: number = 2,
  hotspots: string[] = DEFAULT_QUEUE_HOTSPOTS,
  sourceRef?: string,
): QueueCommand[] {
  const slots = Math.max(
    0,
    Math.min(clampMaxParallel(maxParallel) - runningInProject, QUEUE_MAX_PARALLEL_CEILING - codingRunningTotal),
  );
  if (slots === 0) return [];
  const running = all.filter((c) => c.status === "đang chạy");
  const plans = all.map(toPlan);
  const candidates = all
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.status === "đã duyệt" && (!sourceRef || x.c.sourceRef === sourceRef))
    .sort((a, b) => a.c.batch - b.c.batch || a.c.position - b.c.position || a.i - b.i)
    .map((x) => x.c);
  const picked: QueueCommand[] = [];
  for (const c of candidates) {
    if (picked.length >= slots) break;
    if (!isUnlockedForRunAll(c, all)) continue;
    let ok = true;
    for (const r of [...running, ...picked]) {
      const ind = checkIndependence(toPlan(c), toPlan(r), hotspots, plans);
      if (!ind.independent) {
        ok = false;
        break;
      }
    }
    if (ok) picked.push(c);
  }
  return picked;
}

/**
 * Base ref for a run-all worktree: the branch of the last dependency (in dependsOn order) that is "đã commit" with a
 * non-empty branch. Merged deps / no deps -> undefined (use the project's base branch).
 */
export function resolveBaseRef(cmd: QueueCommand, all: QueueCommand[]): string | undefined {
  const byId = new Map(all.map((c) => [c.id, c]));
  let ref: string | undefined;
  for (const id of cmd.dependsOn) {
    const dep = byId.get(id);
    if (dep && dep.status === "đã commit" && dep.branch) ref = dep.branch;
  }
  return ref;
}

/** Ids of commands that can never run because a (transitive) dependency failed, was skipped, or is missing. */
export function blockedByFailure(all: QueueCommand[]): string[] {
  const byId = new Map(all.map((c) => [c.id, c]));
  const memo = new Map<string, boolean>();
  const bad = (id: string, seen: Set<string>): boolean => {
    const c = byId.get(id);
    if (!c) return true;
    if (c.status === "lỗi" || c.status === "bỏ qua") return true;
    const m = memo.get(id);
    if (m !== undefined) return m;
    if (seen.has(id)) return false;
    seen.add(id);
    const r = c.dependsOn.some((d) => bad(d, seen));
    memo.set(id, r);
    return r;
  };
  return all
    .filter((c) => c.status !== "lỗi" && c.status !== "bỏ qua" && c.status !== "đã commit" && c.status !== "đã gộp")
    .filter((c) => c.dependsOn.some((d) => bad(d, new Set([c.id]))))
    .map((c) => c.id);
}

/** Commands that should start now, ordered by (batch, position), never exceeding the clamped maxParallel. */
export function pickRunnable(
  all: QueueCommand[],
  coderunsRunning: number,
  maxParallel: number,
  hotspots: string[] = DEFAULT_QUEUE_HOTSPOTS,
): QueueCommand[] {
  const running = all.filter((c) => c.status === "đang chạy");
  const candidates = all
    .map((c, i) => ({ c, i }))
    .filter((x) => x.c.status === "đã duyệt")
    .sort((a, b) => a.c.batch - b.c.batch || a.c.position - b.c.position || a.i - b.i)
    .map((x) => x.c);
  const picked: QueueCommand[] = [];
  for (const c of candidates) {
    const used = coderunsRunning + picked.length;
    if (clampMaxParallel(maxParallel) - used <= 0) break;
    const chk = canRunParallel(c, [...running, ...picked.map((p) => ({ ...p, status: "đang chạy" as const }))], maxParallel, used, all, hotspots);
    if (chk.ok) picked.push(c);
  }
  return picked;
}
