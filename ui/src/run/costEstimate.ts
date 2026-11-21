import { pick } from "../lib/lang";
/**
 * Cost estimate helpers (all values are client-side estimates, never an invoice).
 * Units: USD amounts are plain numbers; rate_limit is a percent with one decimal (42.5 means 42.5%).
 * Day keys are LOCAL dates, matching costByDay() in src/core/run/run-store.ts (which also uses local getFullYear/getMonth/getDate).
 * Money format: two decimals with a decimal comma plus " USD" (e.g. "0,41 USD").
 */

export interface CostStats {
  n: number;
  median: number;
  max: number;
}

export function formatUsd(v: number): string {
  return `${v.toFixed(2).replace(".", ",")} USD`;
}

export function formatEstimate(stats: CostStats): string {
  if (stats.n < 3) return pick("chưa đủ dữ liệu", "not enough data yet");
  return pick(`Thường tốn khoảng ${formatUsd(stats.median)} đến ${formatUsd(stats.max)} (ước tính)`, `Usually costs about ${formatUsd(stats.median)} to ${formatUsd(stats.max)} (estimate)`);
}

export function dailyWarning(todayCostUsd: number, thresholdUsd: number | null | undefined): string | null {
  if (typeof thresholdUsd !== "number" || !(thresholdUsd > 0)) return null;
  if (todayCostUsd <= thresholdUsd) return null;
  return pick(`Hôm nay đã tốn khoảng ${formatUsd(todayCostUsd)} (ước tính), vượt ngưỡng cảnh báo ${formatUsd(thresholdUsd)}.`, `Today's cost is about ${formatUsd(todayCostUsd)} (estimate), over the ${formatUsd(thresholdUsd)} warning threshold.`);
}

export function localDayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

export function formatRateLimit(pct: number | null | undefined): string {
  if (typeof pct !== "number" || !Number.isFinite(pct)) return "";
  return `${pct.toFixed(1)}%`;
}

/** Quota consumed by one run: current 5h account percent minus the percent recorded at run start. */
export function runQuotaPct(fiveHourPct: number | null | undefined, quotaStart: number | null | undefined): number | null {
  if (typeof fiveHourPct !== "number" || !Number.isFinite(fiveHourPct)) return null;
  if (typeof quotaStart !== "number" || !Number.isFinite(quotaStart)) return null;
  if (fiveHourPct < quotaStart) return fiveHourPct;
  return Math.max(0, fiveHourPct - quotaStart);
}

/** Notice text for the left panel: per-run consumption when a run is live, else the account level. */
export function quotaNoticeText(
  rl: { five_hour_pct?: number | null; seven_day_pct?: number | null },
  runningRuns: { created_at: number; quota_start?: number | null }[],
  t: { quota: string; quota_5h: string; quota_7d: string; quota_run: string; quota_account: string },
): string {
  const { pct, scope } = liveQuotaLabel(rl, runningRuns);
  const five = pct || "?";
  const seven = formatRateLimit(rl.seven_day_pct) || "?";
  const head = scope === "run" ? `${t.quota_run}: ${five}` : `${t.quota_account} ${t.quota_5h} ${five}`;
  return `${t.quota}: ${head} · ${t.quota_7d} ${seven}`;
}

export function liveQuotaLabel(
  rateLimit: { five_hour_pct?: number | null } | null | undefined,
  runningRuns: { created_at: number; quota_start?: number | null }[],
): { pct: string; scope: "run" | "account" } {
  const five = rateLimit?.five_hour_pct;
  const oldest = [...runningRuns]
    .filter((r) => typeof r.quota_start === "number")
    .sort((a, b) => a.created_at - b.created_at)[0];
  if (oldest) {
    const v = runQuotaPct(five, oldest.quota_start);
    if (v !== null) return { pct: formatRateLimit(v), scope: "run" };
  }
  return { pct: formatRateLimit(five), scope: "account" };
}
