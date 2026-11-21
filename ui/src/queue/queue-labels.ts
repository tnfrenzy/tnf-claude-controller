import type { Dict } from "../i18n";
import type { QueueLabels } from "../components/queue/QueuePanel";

/** Queue status code (as the server sends it, Vietnamese) -> flat i18n key suffix. */
export const QUEUE_STATUS_KEYS: Record<string, string> = {
  "chờ duyệt": "pending",
  "đã duyệt": "approved",
  "đang chạy": "running",
  "đã commit": "committed",
  "đã gộp": "merged",
  "bỏ qua": "skipped",
  "lỗi": "failed",
};

/** Lock reason codes produced by queue.ts (the "server" code is shown verbatim, so it has no key). */
export const QUEUE_REASON_CODES = [
  "noSelection", "needTwo", "notRunnable", "diffBatch", "dependency", "fileOverlap",
  "hotspot", "noSlots", "ackWarnings", "alreadyRan", "mergedOrSkipped", "cancelRunFirst",
] as const;

export const QUEUE_LABEL_NAMES = [
  "title", "empty", "batch", "files", "dependsOn", "references", "warnings", "estimate", "pushedReason",
  "edit", "save", "cancel", "approveRun", "runParallel", "skip", "copy", "copied", "select",
  "parallelBar", "loadWarning", "ackWarnings", "loadError",
  "ideaTitle", "ideaPlaceholder", "ideaSend", "webSearch", "webSearchNote", "ideaConfirm",
  "ideaConfirmYes", "ideaCancel", "ideaRunning", "ideaDone", "ideaError", "ideaTooLong", "ideaNeedVi",
  "confirmMerged", "confirmDone", "confirmDoneTip", "retry", "retryTip", "markFailed", "unskip",
  "confirmMergedAsk", "confirmDoneAsk", "confirmDoneNoCommit", "markFailedAsk",
] as const;

/** Text for window.confirm before a manual recovery action. Null when the action needs no confirmation. */
export function recoveryConfirmText(
  action: string,
  labels: Pick<QueueLabels, "confirmMergedAsk" | "confirmDoneAsk" | "confirmDoneNoCommit" | "markFailedAsk">,
  runCommitCount?: number,
): string | null {
  if (action === "confirmMerged") return labels.confirmMergedAsk;
  if (action === "markFailed") return labels.markFailedAsk;
  if (action === "confirmDone") return runCommitCount === 0 ? `${labels.confirmDoneAsk}\n${labels.confirmDoneNoCommit}` : labels.confirmDoneAsk;
  return null;
}

export function buildQueueLabels(t: Dict): QueueLabels {
  const d = t as Record<string, string>;
  const out: Record<string, unknown> = {};
  for (const n of QUEUE_LABEL_NAMES) out[n] = d[`queue_${n}`] ?? n;
  const status: Record<string, string> = {};
  for (const [code, key] of Object.entries(QUEUE_STATUS_KEYS)) status[code] = d[`queue_status_${key}`] ?? code;
  const reasons: Record<string, string> = {};
  for (const code of QUEUE_REASON_CODES) reasons[code] = d[`queue_reason_${code}`] ?? code;
  out.status = status;
  out.reasons = reasons;
  return out as unknown as QueueLabels;
}
