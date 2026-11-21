/**
 * Pure helpers for the command queue screen (docs/PLANNER-QUEUE.md sections 3, 4, 8). No React, no DOM.
 * Lock reasons are structured codes; the panel maps them to text via labels (server reasons are kept verbatim).
 * Limit: the UI cannot read the server's configured `queue.hotspots` unless passed in; the server decides last.
 */
import type { DescribedCommand, QueueStatus, QueueView } from "../types";

export type LockReason = { code: string; params?: Record<string, string | number>; text?: string };

/** Copy of DEFAULT_QUEUE_HOTSPOTS in src/core/app/config.ts (a test keeps them equal). */
export const DEFAULT_HOTSPOTS: string[] = [
  "ui/src/i18n.ts", "ui/src/api.ts", "ui/src/types.ts", "ui/src/App.tsx",
  "src/server/http.ts", "docs/PROGRESS.md", "package.json", "package-lock.json",
];

export interface LockState {
  locked: boolean;
  reasons: LockReason[];
}

export interface QueueBatch {
  batch: number;
  commands: DescribedCommand[];
}

/** Group by `batch` ascending; inside a batch keep the original order. */
export function groupByBatch(commands: DescribedCommand[]): QueueBatch[] {
  const map = new Map<number, DescribedCommand[]>();
  for (const c of commands) {
    const list = map.get(c.batch);
    if (list) list.push(c);
    else map.set(c.batch, [c]);
  }
  return [...map.keys()].sort((a, b) => a - b).map((batch) => ({ batch, commands: map.get(batch)! }));
}

/** Same normalization as the server (queue-plan.ts normPath): `\` to `/`, drop `./`, lowercase. */
export function normalizeFile(path: string): string {
  let s = path.trim().replace(/\\/g, "/").toLowerCase();
  while (s.startsWith("./")) s = s.slice(2);
  return s;
}

/** Equal after normalization, or one is a directory (ends with "/") containing the other. "src" without "/" is a file. */
export function filesOverlap(a: string, b: string): boolean {
  const x = normalizeFile(a);
  const y = normalizeFile(b);
  if (x === y) return true;
  if (x.endsWith("/") && y.startsWith(x)) return true;
  if (y.endsWith("/") && x.startsWith(y)) return true;
  return false;
}

function globToRegex(glob: string): RegExp {
  const g = normalizeFile(glob);
  let re = "";
  for (let i = 0; i < g.length; i++) {
    const ch = g[i]!;
    if (ch === "*") {
      if (g[i + 1] === "*") {
        re += ".*";
        i++;
      } else re += "[^/]*";
    } else re += ch.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

/** Hotspot patterns (as given) that the file matches. `*` stays inside one segment, `**` spans segments. */
function hotspotsHit(file: string, hotspots: string[]): string[] {
  const f = normalizeFile(file);
  return hotspots.filter((h) => globToRegex(h).test(f));
}

export function matchesHotspot(file: string, hotspots: string[] = DEFAULT_HOTSPOTS): boolean {
  return hotspotsHit(file, hotspots).length > 0;
}

function ancestors(id: string, byId: Map<string, DescribedCommand>): Set<string> {
  const seen = new Set<string>();
  const stack = [...(byId.get(id)?.dependsOn ?? [])];
  while (stack.length) {
    const d = stack.pop()!;
    if (seen.has(d)) continue;
    seen.add(d);
    stack.push(...(byId.get(d)?.dependsOn ?? []));
  }
  return seen;
}

/** A command may join a parallel run only when approved and every dependency is merged. */
export function isSelectable(cmd: DescribedCommand, commands: DescribedCommand[]): boolean {
  if (cmd.status !== "đã duyệt") return false;
  return cmd.dependsOn.every((d) => commands.find((c) => c.id === d)?.status === "đã gộp");
}

/**
 * Can the selection run in parallel? Needs >= 2 commands (one command uses "Duyệt và chạy"), all approved with
 * merged dependencies, same batch, no transitive dependency (graph over ALL commands), no file overlap,
 * no shared hotspot, and selected + codingRunning <= maxParallel.
 */
export function parallelCheck(
  selectedIds: string[],
  commands: DescribedCommand[],
  view: Pick<QueueView, "maxParallel" | "codingRunning">,
  hotspots: string[] = DEFAULT_HOTSPOTS,
): { ok: boolean; reasons: LockReason[] } {
  const reasons: LockReason[] = [];
  const ids = [...new Set(selectedIds)];
  if (ids.length === 0) return { ok: false, reasons: [{ code: "noSelection" }] };
  if (ids.length < 2) return { ok: false, reasons: [{ code: "needTwo" }] };
  const byId = new Map(commands.map((c) => [c.id, c]));
  const sel: DescribedCommand[] = [];
  for (const id of ids) {
    const c = byId.get(id);
    if (!c || !isSelectable(c, commands)) reasons.push({ code: "notRunnable", params: { id } });
    if (c) sel.push(c); // pair checks run on every known selected command, so a dependency is named even when not runnable
  }
  const batches = new Set(sel.map((c) => c.batch));
  if (batches.size > 1) reasons.push({ code: "diffBatch", params: { batches: [...batches].sort((a, b) => a - b).join(", ") } });
  for (let i = 0; i < sel.length; i++) {
    for (let j = i + 1; j < sel.length; j++) {
      const a = sel[i]!;
      const b = sel[j]!;
      if (ancestors(a.id, byId).has(b.id) || ancestors(b.id, byId).has(a.id)) {
        reasons.push({ code: "dependency", params: { a: a.id, b: b.id } });
        continue;
      }
      let overlapped = false;
      for (const f of a.files) {
        for (const g of b.files) {
          if (!overlapped && filesOverlap(f, g)) {
            overlapped = true;
            reasons.push({ code: "fileOverlap", params: { a: a.id, b: b.id, file: normalizeFile(f) } });
          }
        }
      }
      if (overlapped) continue;
      const ha = new Set(a.files.flatMap((f) => hotspotsHit(f, hotspots)));
      const shared = [...new Set(b.files.flatMap((f) => hotspotsHit(f, hotspots)))].find((h) => ha.has(h));
      if (shared !== undefined) reasons.push({ code: "hotspot", params: { a: a.id, b: b.id, file: shared } });
    }
  }
  const free = Math.max(0, view.maxParallel - view.codingRunning);
  if (ids.length > free) reasons.push({ code: "noSlots", params: { n: free } });
  return { ok: reasons.length === 0, reasons };
}

export interface ButtonCtx {
  selectedIds: string[];
  /** Per-command warning acknowledgement. */
  acknowledged?: Record<string, boolean>;
  /** Overrides `acknowledged[cmd.id]` for the card's own approve button. */
  warningsAcknowledged?: boolean;
  hotspots?: string[];
}

const hasWarnings = (c: DescribedCommand): boolean => Array.isArray(c.warnings) && c.warnings.length > 0;
const serverReasons = (reasons: string[]): LockReason[] => reasons.map((text) => ({ code: "server", text }));

/**
 * Total gate for the "Run in parallel" bar: parallelCheck plus unacknowledged warnings (`ackWarnings`, params id)
 * and server `locks.approveRun` (verbatim).
 */
export function parallelGate(
  selectedIds: string[],
  commands: DescribedCommand[],
  view: Pick<QueueView, "maxParallel" | "codingRunning">,
  ctx: { acknowledged?: Record<string, boolean>; hotspots?: string[] | undefined } = {},
): { ok: boolean; reasons: LockReason[] } {
  const base = parallelCheck(selectedIds, commands, view, ctx.hotspots);
  const reasons = [...base.reasons];
  for (const id of [...new Set(selectedIds)]) {
    const c = commands.find((x) => x.id === id);
    if (!c) continue;
    if (hasWarnings(c) && !ctx.acknowledged?.[id]) reasons.push({ code: "ackWarnings", params: { id } });
    if (c.locks?.approveRun?.locked) reasons.push(...serverReasons(c.locks.approveRun.reasons));
  }
  return { ok: reasons.length === 0, reasons };
}

/** Lock state of the 4 card buttons (section 8 table). */
export function buttonStates(
  cmd: DescribedCommand,
  view: QueueView,
  ctx: ButtonCtx,
): { edit: LockState; approveRun: LockState; runParallel: LockState; skip: LockState } {
  const acked = ctx.warningsAcknowledged ?? !!ctx.acknowledged?.[cmd.id];
  const ran = cmd.status === "đang chạy" || cmd.status === "đã commit" || cmd.status === "đã gộp";

  const edit: LockReason[] = serverReasons(cmd.locks?.edit?.locked ? cmd.locks.edit.reasons : []);
  if (ran) edit.push({ code: "alreadyRan" });

  const approve: LockReason[] = serverReasons(cmd.locks?.approveRun?.locked ? cmd.locks.approveRun.reasons : []);
  if (hasWarnings(cmd) && !acked) approve.push({ code: "ackWarnings", params: { id: cmd.id } });

  const skip: LockReason[] = serverReasons(cmd.locks?.skip?.locked ? cmd.locks.skip.reasons : []);
  if (cmd.status === "đã gộp" || cmd.status === "bỏ qua") skip.push({ code: "mergedOrSkipped" });
  if (cmd.status === "đang chạy") skip.push({ code: "cancelRunFirst" });

  let par: LockReason[];
  if (!isSelectable(cmd, view.commands)) {
    par = [{ code: "notRunnable", params: { id: cmd.id } }];
  } else {
    // An unselected card is judged on selectedIds + itself: pressing it would add it to the selection.
    const ids = [...new Set([...ctx.selectedIds, cmd.id])];
    par = parallelGate(ids, view.commands, view, {
      acknowledged: { ...ctx.acknowledged, ...(ctx.warningsAcknowledged !== undefined ? { [cmd.id]: ctx.warningsAcknowledged } : {}) },
      hotspots: ctx.hotspots,
    }).reasons;
  }

  const st = (reasons: LockReason[]): LockState => ({ locked: reasons.length > 0, reasons });
  return { edit: st(edit), approveRun: st(approve), runParallel: st(par), skip: st(skip) };
}

/** State of the "Run all" button in the task list: stop while active, otherwise run (disabled when nothing to run). */
export function runAllButtonState(active: boolean, groupCount: number): { mode: "run" | "stop"; disabled: boolean } {
  if (active) return { mode: "stop", disabled: false };
  return { mode: "run", disabled: groupCount <= 0 };
}

export type RecoveryAction ="confirmDone" | "confirmMerged" | "retry" | "markFailed" | "unskip";

/** Manual recovery buttons per status. An orphan "đang chạy" (runLive=false) needs the two-step path. */
export function recoveryActions(cmd: Pick<DescribedCommand, "status">, runLive: boolean): RecoveryAction[] {
  switch (cmd.status) {
    case "đã commit": return ["confirmMerged"];
    case "lỗi": return ["retry", "confirmDone"];
    case "đang chạy": return runLive ? [] : ["confirmDone", "markFailed"];
    case "bỏ qua": return ["unskip"];
    default: return [];
  }
}

export interface GroupEstimate {
  totalUsd: number;
  label: string;
  isEstimate: true;
}

/** Sum of estimatedCostUsd (missing values skipped). Always flagged as an estimate. */
export function groupEstimate(commands: Pick<DescribedCommand, "estimatedCostUsd">[]): GroupEstimate {
  let total = 0;
  for (const c of commands) if (typeof c.estimatedCostUsd === "number" && Number.isFinite(c.estimatedCostUsd)) total += c.estimatedCostUsd;
  return { totalUsd: total, label: `~$${total.toFixed(2)}`, isEstimate: true };
}

export type Tone = "ok" | "warn" | "bad" | "info" | "muted";

const VISUALS: Record<QueueStatus, { icon: string; tone: Tone }> = {
  "chờ duyệt": { icon: "⏸", tone: "warn" },
  "đã duyệt": { icon: "✔", tone: "info" },
  "đang chạy": { icon: "▶", tone: "info" },
  "đã commit": { icon: "●", tone: "ok" },
  "đã gộp": { icon: "✔✔", tone: "ok" },
  "bỏ qua": { icon: "∅", tone: "muted" },
  "lỗi": { icon: "✖", tone: "bad" },
};

export function statusVisual(status: QueueStatus): { icon: string; tone: Tone } {
  return VISUALS[status] ?? { icon: "?", tone: "muted" };
}
