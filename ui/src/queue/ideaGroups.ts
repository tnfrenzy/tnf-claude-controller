import type { QueueCommand, QueueRunAllState, QueueStatus } from "../types";
import { curLang, pick } from "../lib/lang";

/** Statuses shown only in the per-idea history modal, never in the shared table. */
export const HISTORY_STATUSES: readonly QueueStatus[] = ["đã commit", "đã gộp", "bỏ qua"];

export function isHistoryStatus(s: QueueStatus): boolean {
  return HISTORY_STATUSES.includes(s);
}

/** Commands still shown in the shared table (keeps "lỗi"), original order. */
export function activeCommands<T extends QueueCommand>(group: IdeaGroup<T>): T[] {
  return group.commands.filter((c) => !isHistoryStatus(c.status));
}

/** Commands for the history modal: finished ones plus any command that has run at least once (e.g. "lỗi"). */
export function historyCommands<T extends QueueCommand>(group: IdeaGroup<T>): T[] {
  return group.commands.filter((c) => isHistoryStatus(c.status) || (c.runIds?.length ?? 0) > 0);
}

export interface IdeaActions {
  approveAll: { disabled: boolean };
  runAll: { mode: "run" | "stop" | "busy"; disabled: boolean };
  historyCount: number;
}

/** Button states for one idea group. The "Khác" group cannot approve/run all. */
export function ideaActions(group: IdeaGroup<QueueCommand>, runAll?: QueueRunAllState | null): IdeaActions {
  const historyCount = historyCommands(group).length;
  if (group.other) {
    return { approveAll: { disabled: true }, runAll: { mode: "run", disabled: true }, historyCount };
  }
  const hasPending = group.commands.some((c) => c.status === "chờ duyệt");
  const hasApproved = group.commands.some((c) => c.status === "đã duyệt");
  let run: IdeaActions["runAll"];
  if (runAll?.active && runAll.sourceRef === group.key) run = { mode: "stop", disabled: false };
  else if (runAll?.active) run = { mode: "busy", disabled: true };
  else run = { mode: "run", disabled: !hasApproved };
  return { approveAll: { disabled: !hasPending }, runAll: run, historyCount };
}

export interface IdeaGroup<T extends QueueCommand = QueueCommand> {
  key: string;
  title: string;
  project: string;
  commands: T[];
  counts: Partial<Record<QueueStatus, number>>;
  /** True for the catch-all group of commands without sourceRef. */
  other: boolean;
  /** 1-based order among non-"Khác" groups (0 for "Khác"). */
  ordinal: number;
}

/** Group commands by (project, sourceRef), in order of first appearance. Commands without sourceRef go to "Khác". */
export function groupByIdea<T extends QueueCommand>(commands: T[]): IdeaGroup<T>[] {
  const groups: IdeaGroup<T>[] = [];
  const index = new Map<string, IdeaGroup<T>>();
  let n = 0;
  for (const c of commands) {
    const other = !c.sourceRef;
    const id = `${c.project}\u0000${other ? "" : c.sourceRef}`;
    let g = index.get(id);
    if (!g) {
      if (!other) n++;
      g = {
        key: other ? "" : c.sourceRef,
        title: other ? pick("Khác", "Other") : (c.ideaTitle ?? "").trim() || pick(`Ý tưởng ${n}`, `Idea ${n}`),
        project: c.project,
        commands: [],
        counts: {},
        other,
        ordinal: other ? 0 : n,
      };
      index.set(id, g);
      groups.push(g);
    }
    g.commands.push(c);
    g.counts[c.status] = (g.counts[c.status] ?? 0) + 1;
  }
  return groups;
}

/**
 * Newest idea first (by the newest command it holds); the catch-all "Khác" group stays last. Idea numbers (`ordinal`)
 * keep the order of creation, so "Ý tưởng 7" is still 7 when it is shown at the top.
 */
export function ideasNewestFirst<T extends QueueCommand>(groups: IdeaGroup<T>[]): IdeaGroup<T>[] {
  const newest = (g: IdeaGroup<T>) => g.commands.reduce((n, c) => Math.max(n, c.createdAt ?? 0), 0);
  return groups
    .map((g, i) => ({ g, i, at: newest(g) }))
    .sort((a, b) => (a.g.other === b.g.other ? b.at - a.at || b.g.ordinal - a.g.ordinal || b.i - a.i : a.g.other ? 1 : -1))
    .map((x) => x.g);
}

/** "Ý tưởng N - <môi trường>" (N counts groups excluding "Khác"); "Khác - <môi trường>" for the catch-all. */
export function ideaHeading(group: IdeaGroup<QueueCommand>, index: number): string {
  if (group.other) return `${pick("Khác", "Other")} - ${group.project}`;
  return `${pick("Ý tưởng", "Idea")} ${group.ordinal || index + 1} - ${group.project}`;
}

const QUEUE_STATUS_EN: Record<string, string> = { "chờ duyệt": "pending", "đã duyệt": "approved", "đang chạy": "running", "đã gộp": "merged", "bỏ qua": "skipped", "lỗi": "failed" };

/** Task rows no longer say "đã commit" (every task commits on its own); that state reads "hoàn tất". */
export function taskStatusLabel(status: QueueStatus): string {
  return status === "đã commit" ? pick("hoàn tất", "done") : (curLang() === "en" ? (QUEUE_STATUS_EN[status] ?? status) : status);
}

/** Run to release when the user commits a whole idea: the newest finished task of the group (all share one branch). */
export function ideaCommitRunId(group: IdeaGroup<QueueCommand>): string | null {
  if (group.other) return null;
  const done = group.commands.filter((c) => c.status === "đã commit" && c.runId);
  const last = done.sort((a, b) => a.position - b.position).pop();
  return last?.runId ?? null;
}
