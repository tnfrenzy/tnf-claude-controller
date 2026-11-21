// Pure helpers for the "max role calls" field and the effective-limits display.

export type RunLimits = { maxTurns: number; maxBudgetUsd: number; maxRoleCalls: number | null; callTimeoutMinutes: number | null };

export const DEFAULT_MAX_ROLE_CALLS = 20;
export const DEFAULT_MAX_ROLE_CALLS_CEILING = 30;

export type MaxRoleCallsResult = { ok: true; value: number } | { ok: false; error: "range" };

/** Integer from 1 to ceiling. Empty / non-numeric / 0 / fractional / above ceiling -> error "range". */
export function validateMaxRoleCalls(raw: string | number, ceiling: number = DEFAULT_MAX_ROLE_CALLS_CEILING): MaxRoleCallsResult {
  const text = typeof raw === "number" ? String(raw) : raw.trim();
  if (!/^\d+$/.test(text)) return { ok: false, error: "range" };
  const n = Number(text);
  if (!Number.isInteger(n) || n < 1 || n > ceiling) return { ok: false, error: "range" };
  return { ok: true, value: n };
}

export type LimitRow = { key: "maxTurns" | "maxBudgetUsd" | "maxRoleCalls" | "callTimeoutMinutes"; value: string };

/** Rows to display for a run's effective limits; null when the run has none recorded; null values are skipped. */
export function formatLimits(limits: RunLimits | null | undefined): LimitRow[] | null {
  if (!limits) return null;
  const rows: LimitRow[] = [
    { key: "maxTurns", value: String(limits.maxTurns) },
    { key: "maxBudgetUsd", value: `$${limits.maxBudgetUsd}` },
  ];
  if (limits.maxRoleCalls !== null) rows.push({ key: "maxRoleCalls", value: String(limits.maxRoleCalls) });
  if (limits.callTimeoutMinutes !== null) rows.push({ key: "callTimeoutMinutes", value: String(limits.callTimeoutMinutes) });
  return rows;
}
