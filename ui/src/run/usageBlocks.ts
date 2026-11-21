// Pure helpers for the 5-hour usage window panel.

export interface BlockRange {
  start: string;
  end: string;
}

const clamp01 = (n: number): number => (Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);

export function formatRemaining(ms: number): { h: number; m: number } {
  if (!Number.isFinite(ms) || ms < 0) return { h: 0, m: 0 };
  const totalMin = Math.floor(ms / 60000);
  return { h: Math.floor(totalMin / 60), m: totalMin % 60 };
}

export function elapsedRatio(block: BlockRange, now: number): number {
  const start = Date.parse(block.start);
  const end = Date.parse(block.end);
  const span = end - start;
  if (!Number.isFinite(span) || span <= 0) return 0;
  return clamp01((now - start) / span);
}

export function tokenRatio(total: number, max: number): number {
  if (!(max > 0)) return 0;
  return clamp01(total / max);
}

export function recentBlocks<T>(blocks: T[], n = 5): T[] {
  return blocks.slice(-n).reverse();
}

export function formatCost(usd?: number): string {
  if (usd === undefined || usd === null || !Number.isFinite(usd)) return "—";
  return "$" + usd.toFixed(usd < 0.01 ? 4 : 2);
}
