import { describe, it, expect } from "vitest";
import {
  normalizeEpochMs,
  isQuotaStopError,
  computeResumeAt,
  QUOTA_RESUME_MARK,
  quotaResumePrompt,
  isResumePrompt,
} from "../../src/core/run/quota-resume.js";

const NOW = 1_800_000_000_000;
const DAY = 86400000;
const snap = (o: Partial<Record<string, number | null>> = {}) => ({
  five_hour_pct: null,
  seven_day_pct: null,
  five_hour_resets_at: null,
  seven_day_resets_at: null,
  ...o,
});
const base = { now: NOW, marginSec: 60, fallbackMin: 30 };

describe("normalizeEpochMs", () => {
  it("seconds are multiplied", () => expect(normalizeEpochMs(1_700_000_000)).toBe(1_700_000_000_000));
  it("ms kept", () => expect(normalizeEpochMs(1_700_000_000_000)).toBe(1_700_000_000_000));
  it("invalid -> null", () => {
    expect(normalizeEpochMs("abc")).toBeNull();
    expect(normalizeEpochMs(null)).toBeNull();
    expect(normalizeEpochMs(NaN)).toBeNull();
    expect(normalizeEpochMs(Infinity)).toBeNull();
  });
  it("<= 0 -> null", () => {
    expect(normalizeEpochMs(0)).toBeNull();
    expect(normalizeEpochMs(-5)).toBeNull();
  });
});

describe("isQuotaStopError", () => {
  it.each([
    "You've hit your limit · resets 3am",
    "usage limit reached",
    "rate limit",
    "Hết hạn mức",
    "limit reached",
  ])("true: %s", (s) => expect(isQuotaStopError(s)).toBe(true));
  it("accepts Error objects", () => expect(isQuotaStopError(new Error("usage limit"))).toBe(true));
  it.each(["timeout: no output", "subagent_interrupted", null, undefined, ""])("false: %s", (s) =>
    expect(isQuotaStopError(s)).toBe(false),
  );
});

describe("computeResumeAt", () => {
  it("event in seconds", () => {
    const at = Math.floor((NOW + 3600_000) / 1000);
    expect(computeResumeAt({ ...base, eventResetsAt: at, snapshot: null })).toEqual({
      resumeAt: at * 1000 + 60_000,
      source: "event",
    });
  });
  it("event in ms", () => {
    const at = NOW + 3600_000;
    expect(computeResumeAt({ ...base, eventResetsAt: at, snapshot: null })).toEqual({
      resumeAt: at + 60_000,
      source: "event",
    });
  });
  it("event past, equal now, or too far is ignored", () => {
    for (const at of [NOW - 1000, NOW, NOW + 8 * DAY + 1000]) {
      expect(computeResumeAt({ ...base, eventResetsAt: at, snapshot: null }).source).toBe("fallback");
    }
  });
  it("event exactly now+8d is accepted", () => {
    const at = NOW + 8 * DAY;
    expect(computeResumeAt({ ...base, eventResetsAt: at, snapshot: null })).toEqual({
      resumeAt: at + 60_000,
      source: "event",
    });
  });
  it("null event, 5h snapshot", () => {
    const at = NOW + 7200_000;
    expect(
      computeResumeAt({ ...base, eventResetsAt: null, snapshot: snap({ five_hour_pct: 96, five_hour_resets_at: at }) }),
    ).toEqual({ resumeAt: at + 60_000, source: "snapshot" });
  });
  it("pct exactly 95 counts", () => {
    const at = NOW + 7200_000;
    expect(
      computeResumeAt({ ...base, eventResetsAt: null, snapshot: snap({ five_hour_pct: 95, five_hour_resets_at: at }) })
        .source,
    ).toBe("snapshot");
  });
  it("5h below 95 ignored", () => {
    const r = computeResumeAt({
      ...base,
      eventResetsAt: null,
      snapshot: snap({ five_hour_pct: 94.9, five_hour_resets_at: NOW + 7200_000 }),
    });
    expect(r).toEqual({ resumeAt: NOW + 30 * 60000, source: "fallback" });
  });
  it("7-day window only", () => {
    const at = NOW + 3 * DAY;
    expect(
      computeResumeAt({
        ...base,
        eventResetsAt: null,
        snapshot: snap({ five_hour_pct: 10, five_hour_resets_at: NOW + 1000_000, seven_day_pct: 97, seven_day_resets_at: at }),
      }),
    ).toEqual({ resumeAt: at + 60_000, source: "snapshot" });
  });
  it("7-day past or too far -> fallback", () => {
    for (const at of [NOW - 1000, NOW + 9 * DAY]) {
      expect(
        computeResumeAt({ ...base, eventResetsAt: null, snapshot: snap({ seven_day_pct: 97, seven_day_resets_at: at }) })
          .source,
      ).toBe("fallback");
    }
  });
  it("both windows full picks larger", () => {
    const five = NOW + 3600_000;
    const seven = NOW + 2 * DAY;
    expect(
      computeResumeAt({
        ...base,
        eventResetsAt: null,
        snapshot: snap({ five_hour_pct: 99, five_hour_resets_at: five, seven_day_pct: 96, seven_day_resets_at: seven }),
      }),
    ).toEqual({ resumeAt: seven + 60_000, source: "snapshot" });
  });
  it("event beats snapshot", () => {
    const ev = NOW + 1000_000;
    const r = computeResumeAt({
      ...base,
      eventResetsAt: ev,
      snapshot: snap({ five_hour_pct: 99, five_hour_resets_at: NOW + 5000_000 }),
    });
    expect(r).toEqual({ resumeAt: ev + 60_000, source: "event" });
  });
  it("null snapshot and event -> fallback without margin", () => {
    expect(computeResumeAt({ ...base, eventResetsAt: null, snapshot: null })).toEqual({
      resumeAt: NOW + 1_800_000,
      source: "fallback",
    });
  });
});

describe("resume prompt", () => {
  it("contains required parts", () => {
    const p = quotaResumePrompt(2, 3);
    expect(p.startsWith(QUOTA_RESUME_MARK)).toBe(true);
    expect(p).toContain("2/3");
    expect(p).toContain("git status");
    expect(p).toContain("git log");
  });
  it("isResumePrompt", () => {
    expect(isResumePrompt(quotaResumePrompt(1, 2))).toBe(true);
    expect(isResumePrompt("  [Tự động tiếp tục lần 1/2]")).toBe(true);
    expect(isResumePrompt("Làm việc bình thường")).toBe(false);
    expect(isResumePrompt(null)).toBe(false);
  });
});
