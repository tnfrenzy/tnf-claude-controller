/** Format a percentage with at most one decimal, dropping a trailing ".0". */
function num(v: number): string {
  const r = Math.round(v * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** "<start>% → <end>% (≈ <pct>%)"; "—" when either end is unknown. */
export function fmtQuotaRange(start: number | null | undefined, end: number | null | undefined, pct: number | null | undefined): string {
  if (start == null || end == null) return "—";
  const head = `${num(start)}% → ${num(end)}%`;
  const d = pct ?? 0;
  if (d < 0.05) return `${head} (< 0.1%)`;
  return `${head} (≈ ${num(d)}%)`;
}
