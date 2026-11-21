import type { NormalizedEvent } from "../run/events.js";

export type RateLimitEvent = Extract<NormalizedEvent, { type: "rate.limit" }>;
export type RateLimitSnapshot = RateLimitEvent & { observed_at: number };

export interface QuotaFields {
  quota_start?: number | null;
  quota_end?: number | null;
  quota7_start?: number | null;
  quota7_end?: number | null;
}

export interface BaseResets {
  five?: number;
  seven?: number;
}

export interface QuotaPatch {
  quota_start?: number;
  quota_end?: number;
  quota7_start?: number;
  quota7_end?: number;
}

/** Five-hour window length; also the max age of a usable baseline snapshot. */
export const BASELINE_MAX_AGE_MS = 5 * 60 * 60 * 1000;

export function resetsMs(v: number): number {
  // resets_at may be seconds or milliseconds
  return v < 1e11 ? v * 1000 : v;
}

/**
 * Pick the run start baseline from the last known account usage.
 * The 5h age limit applies to the 5h window only; the weekly window only needs resets_at in the future.
 */
export function pickBaseline(last: RateLimitSnapshot | null, now: number): { patch: QuotaPatch; resets: BaseResets } {
  const patch: QuotaPatch = {};
  const resets: BaseResets = {};
  if (!last) return { patch, resets };
  const fresh = now - last.observed_at <= BASELINE_MAX_AGE_MS;
  if (fresh && last.five_hour_pct != null && (last.five_hour_resets_at == null || resetsMs(last.five_hour_resets_at) > now)) {
    patch.quota_start = last.five_hour_pct;
    if (last.five_hour_resets_at != null) resets.five = last.five_hour_resets_at;
  }
  if (last.seven_day_pct != null && (last.seven_day_resets_at == null || resetsMs(last.seven_day_resets_at) > now)) {
    patch.quota7_start = last.seven_day_pct;
    if (last.seven_day_resets_at != null) resets.seven = last.seven_day_resets_at;
  }
  return { patch, resets };
}

/** Patch for a run given a new rate.limit event. Pure, no store access. */
export function applyRateLimit(cur: QuotaFields, ev: RateLimitEvent, baseResets?: BaseResets): QuotaPatch {
  const patch: QuotaPatch = {};
  if (ev.five_hour_pct != null) {
    const changed = baseResets?.five != null && ev.five_hour_resets_at != null && ev.five_hour_resets_at !== baseResets.five;
    if (cur.quota_start == null || changed) patch.quota_start = ev.five_hour_pct;
    patch.quota_end = ev.five_hour_pct;
  }
  if (ev.seven_day_pct != null) {
    const changed = baseResets?.seven != null && ev.seven_day_resets_at != null && ev.seven_day_resets_at !== baseResets.seven;
    if (cur.quota7_start == null || changed) patch.quota7_start = ev.seven_day_pct;
    patch.quota7_end = ev.seven_day_pct;
  }
  return patch;
}
