import { describe, expect, it } from "vitest";
import { dailyWarning, formatEstimate, formatRateLimit, formatUsd, liveQuotaLabel, localDayKey, runQuotaPct } from "../../ui/src/run/costEstimate.js";

describe("formatEstimate", () => {
  it("needs at least 3 samples", () => {
    expect(formatEstimate({ n: 0, median: 0, max: 0 })).toBe("chưa đủ dữ liệu");
    expect(formatEstimate({ n: 2, median: 0.4, max: 0.9 })).toBe("chưa đủ dữ liệu");
    expect(formatEstimate({ n: 3, median: 0.41, max: 1.2 })).toBe("Thường tốn khoảng 0,41 USD đến 1,20 USD (ước tính)");
  });
  it("formatUsd uses decimal comma", () => {
    expect(formatUsd(0.41)).toBe("0,41 USD");
  });
});

describe("dailyWarning", () => {
  it("warns only above a positive threshold", () => {
    expect(dailyWarning(6, 5)).toContain("vượt ngưỡng");
    expect(dailyWarning(4, 5)).toBeNull();
    expect(dailyWarning(5, 5)).toBeNull();
    expect(dailyWarning(100, null)).toBeNull();
    expect(dailyWarning(100, 0)).toBeNull();
    expect(dailyWarning(100, -1)).toBeNull();
  });
});

describe("localDayKey", () => {
  it("uses local date parts, zero padded", () => {
    expect(localDayKey(new Date(2026, 0, 5, 23, 59))).toBe("2026-01-05");
    expect(localDayKey(new Date(2026, 9, 27, 0, 1))).toBe("2026-10-27");
  });
});

describe("formatRateLimit", () => {
  it("takes a whole percent", () => {
    expect(formatRateLimit(42)).toBe("42.0%");
    expect(formatRateLimit(null)).toBe("");
    expect(formatRateLimit(undefined)).toBe("");
    expect(formatRateLimit(Number.NaN)).toBe("");
  });
});

describe("runQuotaPct / liveQuotaLabel", () => {
  it("computes per-run consumption", () => {
    expect(runQuotaPct(17, 15)).toBe(2);
    expect(runQuotaPct(3, 90)).toBe(3);
    expect(runQuotaPct(15, 15)).toBe(0);
    expect(runQuotaPct(null, 15)).toBeNull();
    expect(runQuotaPct(17, undefined)).toBeNull();
  });
  it("labels run scope vs account scope", () => {
    expect(liveQuotaLabel({ five_hour_pct: 17 }, [{ created_at: 1, quota_start: 15 }])).toEqual({ pct: "2.0%", scope: "run" });
    expect(liveQuotaLabel({ five_hour_pct: 17 }, [])).toEqual({ pct: "17.0%", scope: "account" });
    expect(liveQuotaLabel(null, [])).toEqual({ pct: "", scope: "account" });
    expect(liveQuotaLabel({ five_hour_pct: 17 }, [{ created_at: 5, quota_start: 16 }, { created_at: 1, quota_start: 15 }]).pct).toBe("2.0%");
  });
});
