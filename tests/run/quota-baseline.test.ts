import { describe, it, expect } from "vitest";
import { pickBaseline, applyRateLimit, type RateLimitSnapshot, type RateLimitEvent } from "../../src/core/usage/quota-baseline.js";
import { quotaDelta } from "../../src/core/run/run-store.js";

const NOW = 1_800_000_000_000;
const FUT = Math.floor(NOW / 1000) + 3600;
const PAST = Math.floor(NOW / 1000) - 60;

function snap(o: Partial<RateLimitSnapshot> = {}): RateLimitSnapshot {
  return {
    type: "rate.limit", status: "allowed", five_hour_pct: 10, seven_day_pct: 18,
    five_hour_resets_at: FUT, seven_day_resets_at: FUT + 86400, using_overage: false,
    observed_at: NOW - 1000, ...o,
  };
}
function ev(o: Partial<RateLimitEvent> = {}): RateLimitEvent {
  const { observed_at: _o, ...rest } = snap();
  return { ...rest, ...o };
}

describe("pickBaseline", () => {
  it("valid baseline", () => {
    const r = pickBaseline(snap(), NOW);
    expect(r.patch).toEqual({ quota_start: 10, quota7_start: 18 });
    expect(r.resets).toEqual({ five: FUT, seven: FUT + 86400 });
    expect("quota_end" in r.patch).toBe(false);
    expect("quota7_end" in r.patch).toBe(false);
  });
  it("older than 5h drops only the 5h window", () => {
    const r = pickBaseline(snap({ observed_at: NOW - 5 * 3600_000 - 1 }), NOW);
    expect(r.patch).toEqual({ quota7_start: 18 });
  });
  it("past five_hour_resets_at drops 5h, keeps week", () => {
    const r = pickBaseline(snap({ five_hour_resets_at: PAST }), NOW);
    expect(r.patch).toEqual({ quota7_start: 18 });
  });
  it("null gives empty", () => {
    expect(pickBaseline(null, NOW)).toEqual({ patch: {}, resets: {} });
  });
});

describe("applyRateLimit", () => {
  it("no baseline: first sets start=end, then only end", () => {
    const p1 = applyRateLimit({}, ev({ five_hour_pct: 5, seven_day_pct: 20 }));
    expect(p1).toEqual({ quota_start: 5, quota_end: 5, quota7_start: 20, quota7_end: 20 });
    const p2 = applyRateLimit({ quota_start: 5, quota7_start: 20 }, ev({ five_hour_pct: 7, seven_day_pct: 21 }));
    expect(p2).toEqual({ quota_end: 7, quota7_end: 21 });
  });
  it("baseline same resets_at keeps start", () => {
    const p = applyRateLimit({ quota_start: 10, quota7_start: 18 }, ev({ five_hour_pct: 12, seven_day_pct: 19 }), { five: FUT, seven: FUT + 86400 });
    expect(p).toEqual({ quota_end: 12, quota7_end: 19 });
  });
  it("baseline different resets_at resets start", () => {
    const p = applyRateLimit({ quota_start: 10, quota7_start: 18 }, ev({ five_hour_pct: 2, seven_day_pct: 19 }), { five: FUT - 100, seven: FUT + 86400 });
    expect(p).toEqual({ quota_start: 2, quota_end: 2, quota7_end: 19 });
  });
  it("null pct is not set", () => {
    expect(applyRateLimit({}, ev({ five_hour_pct: null, seven_day_pct: null }))).toEqual({});
  });
  it("case 082403: baseline 3, last event 6", () => {
    const p = applyRateLimit({ quota_start: 3 }, ev({ five_hour_pct: 6, seven_day_pct: null }), { five: FUT });
    expect(p).toEqual({ quota_end: 6 });
    expect(quotaDelta(3, 6)).toBe(3);
  });
});
