import type { MergePrecheck } from "../types";

export function shouldShowQueueMergePrecheck(
  cmd: { status?: string; mergePrecheck?: MergePrecheck | null } | null | undefined,
): boolean {
  if (!cmd) return false;
  return cmd.status === "đã commit" && cmd.mergePrecheck != null;
}

export function shouldShowMergePrecheck(
  run: { kind?: string; branch?: string | null; merged?: boolean | undefined } | null | undefined,
): boolean {
  if (!run) return false;
  return run.kind === "coding" && !!run.branch && run.merged === false;
}
