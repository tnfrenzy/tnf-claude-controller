export interface QueuePauseInfo {
  pausedUntil?: number | null;
  pauseReason?: string | null;
  pauseRunId?: string | null;
}

/** pausedUntil is epoch milliseconds. */
export function isQueuePaused(runAll: QueuePauseInfo | null | undefined, now: number): boolean {
  const p = runAll?.pausedUntil;
  return typeof p === "number" && Number.isFinite(p) && p > now;
}

export async function cancelQueuePause(
  api: { cancelQuotaResume: (id: string) => Promise<unknown> },
  runAll: QueuePauseInfo | null | undefined,
  reload: () => Promise<unknown> | unknown,
): Promise<void> {
  const id = runAll?.pauseRunId;
  if (!id) return;
  await api.cancelQuotaResume(id);
  await reload();
}
