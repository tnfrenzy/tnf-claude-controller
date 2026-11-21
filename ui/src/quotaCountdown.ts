/** Format milliseconds left as H:MM:SS (hours not wrapped). Invalid or <= 0 gives 0:00:00. */
export function formatCountdown(msLeft: number): string {
  if (!Number.isFinite(msLeft) || msLeft <= 0) return "0:00:00";
  const total = Math.floor(msLeft / 1000);
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

/** Start a repeating timer; returns the cleanup function that clears it. */
export function startCountdownTimer(onTick: () => void, intervalMs = 1000): () => void {
  const id = setInterval(onTick, intervalMs);
  return () => clearInterval(id);
}
