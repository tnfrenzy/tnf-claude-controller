import { describe, expect, it } from "vitest";
import { quotaResetFrom } from "../../src/core/workshop3d/index.js";

const NOW = 1_800_000_000_000;
const rl = (five: number | null, seven: number | null, f: number | null, s: number | null) => ({ five_hour_pct: five, seven_day_pct: seven, five_hour_resets_at: f, seven_day_resets_at: s });

describe("quotaResetFrom (percent 0..100)", () => {
  it("1.0% five-hour is not exhausted; 99% weekly gives the weekly reset", () => {
    expect(quotaResetFrom(rl(1.0, 99, NOW + 3_600_000, NOW + 86_400_000), NOW)).toBe(NOW + 86_400_000);
  });
  it("0.98% is not exhausted", () => {
    expect(quotaResetFrom(rl(0.98, 0.98, NOW + 1000, NOW + 2000), NOW)).toBeNull();
  });
  it("both below 98 gives null", () => {
    expect(quotaResetFrom(rl(97.9, 50, NOW + 1000, NOW + 2000), NOW)).toBeNull();
  });
  it("exactly 98 counts as exhausted", () => {
    expect(quotaResetFrom(rl(98, 10, NOW + 5000, null), NOW)).toBe(NOW + 5000);
  });
  it("exhausted window with a past reset gives null", () => {
    expect(quotaResetFrom(rl(100, 10, NOW - 1000, NOW + 1000), NOW)).toBeNull();
  });
  it("past reset is skipped in favour of the next future one", () => {
    expect(quotaResetFrom(rl(100, 100, NOW - 1000, NOW + 7000), NOW)).toBe(NOW + 7000);
  });
  it("picks the earliest future reset among exhausted windows", () => {
    expect(quotaResetFrom(rl(99, 99, NOW + 9000, NOW + 4000), NOW)).toBe(NOW + 4000);
  });
  it("accepts seconds and milliseconds", () => {
    expect(quotaResetFrom(rl(100, null, Math.floor((NOW + 60_000) / 1000), null), NOW)).toBe(Math.floor((NOW + 60_000) / 1000) * 1000);
    expect(quotaResetFrom(rl(100, null, NOW + 60_000, null), NOW)).toBe(NOW + 60_000);
  });
  it("null rate limit or null pct gives null", () => {
    expect(quotaResetFrom(null, NOW)).toBeNull();
    expect(quotaResetFrom(rl(null, null, NOW + 1000, NOW + 1000), NOW)).toBeNull();
  });
});
