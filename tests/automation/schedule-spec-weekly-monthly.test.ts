import { describe, expect, it } from "vitest";
import { isDue, parseSchedule } from "../../src/core/queue/schedule-spec.js";

describe("parse", () => {
  it("parses weekly schedules", () => {
    expect(parseSchedule("weekly mon,thu at 08:30")).toEqual({
      ok: true,
      spec: { kind: "weekly", days: [1, 4], times: [510] },
    });
    const r = parseSchedule("WEEKLY  Thu , Mon at 17:00,08:30");
    expect(r).toEqual({ ok: true, spec: { kind: "weekly", days: [1, 4], times: [510, 1020] } });
  });

  it("parses monthly schedules with quiet window", () => {
    const r = parseSchedule("monthly 15 at 08:30 quiet 22:00-06:00");
    expect(r).toEqual({
      ok: true,
      spec: {
        kind: "monthly",
        dayOfMonth: 15,
        times: [510],
        quiet: { startMinute: 1320, endMinute: 360 },
      },
    });
  });

  it("rejects invalid weekly/monthly input", () => {
    for (const bad of [
      "weekly xyz at 08:30",
      "weekly mon,mon at 08:30",
      "weekly mon",
      "monthly 0 at 08:30",
      "monthly 32 at 08:30",
      "monthly 15 at 25:00",
    ]) {
      const r = parseSchedule(bad);
      expect(r.ok, bad).toBe(false);
    }
  });

  it("lists all four forms in the syntax error", () => {
    const r = parseSchedule("sometimes");
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toContain("every 15m");
      expect(r.error).toContain("at 08:30");
      expect(r.error).toContain("weekly mon,thu at 08:30");
      expect(r.error).toContain("monthly 15 at 08:30");
    }
  });

  it("keeps legacy every/at parsing", () => {
    expect(parseSchedule("every 15m")).toEqual({ ok: true, spec: { kind: "interval", everyMinutes: 15 } });
  });
});

const OFF = 420; // UTC+7
// Vietnam local wall-clock time -> UTC epoch ms.
function vn(y: number, mo: number, d: number, h: number, mi: number): number {
  return Date.UTC(y, mo - 1, d, h, mi) - OFF * 60000;
}
function spec(text: string) {
  const r = parseSchedule(text);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
}

describe("isDue", () => {
  it("weekly mon at 08:30", () => {
    const s = spec("weekly mon at 08:30");
    expect(new Date(Date.UTC(2026, 10, 2)).getUTCDay()).toBe(1); // 2026-11-02 is Monday
    const lastWeek = vn(2026, 10, 26, 8, 30);
    expect(isDue(s, vn(2026, 11, 2, 8, 29), lastWeek, OFF)).toBe(false);
    expect(isDue(s, vn(2026, 11, 2, 8, 30), lastWeek, OFF)).toBe(true);
    const ranMonday = vn(2026, 11, 2, 8, 30);
    expect(isDue(s, vn(2026, 11, 3, 10, 0), ranMonday, OFF)).toBe(false);
    expect(isDue(s, vn(2026, 11, 9, 8, 30), ranMonday, OFF)).toBe(true);
  });

  it("monthly 31 clamps to the last day of short months", () => {
    const s = spec("monthly 31 at 09:00");
    const ranMarch = vn(2026, 3, 31, 9, 0);
    expect(isDue(s, vn(2026, 4, 30, 9, 0), ranMarch, OFF)).toBe(true);
    expect(isDue(s, vn(2026, 4, 29, 9, 0), ranMarch, OFF)).toBe(false);
    // Leap year: 29/2; common year: 28/2.
    expect(isDue(s, vn(2028, 2, 29, 9, 0), vn(2028, 1, 31, 9, 0), OFF)).toBe(true);
    expect(isDue(s, vn(2028, 2, 28, 9, 0), vn(2028, 1, 31, 9, 0), OFF)).toBe(false);
    expect(isDue(s, vn(2027, 2, 28, 9, 0), vn(2027, 1, 31, 9, 0), OFF)).toBe(true);
  });

  it("monthly 15 honours the UTC offset", () => {
    const s = spec("monthly 15 at 08:30");
    const now = Date.UTC(2026, 0, 15, 1, 30); // 15/1 08:30 VN
    expect(now).toBe(vn(2026, 1, 15, 8, 30));
    expect(isDue(s, now, vn(2025, 12, 15, 8, 30), OFF)).toBe(true);
    expect(isDue(s, now - 60000, vn(2025, 12, 15, 8, 30), OFF)).toBe(false);
    // Same instant with offset 0 is 14/1 01:30 UTC -> not the 15th yet.
    expect(isDue(s, now, Date.UTC(2025, 11, 15, 8, 30), 0)).toBe(false);
  });

  it("quiet window containing the marker blocks the run", () => {
    const s = spec("weekly mon at 23:00 quiet 22:00-06:00");
    expect(isDue(s, vn(2026, 11, 2, 23, 0), vn(2026, 10, 26, 23, 0), OFF)).toBe(false);
  });
});

describe("parse (legacy daily)", () => {
  it("keeps legacy at parsing", () => {
    expect(parseSchedule("every 15m")).toEqual({ ok: true, spec: { kind: "interval", everyMinutes: 15 } });
    expect(parseSchedule("at 08:30")).toEqual({ ok: true, spec: { kind: "daily", times: [510] } });
  });
});
