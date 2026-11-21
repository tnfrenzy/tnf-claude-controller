import { describe, expect, it } from "vitest";
import { isDue, isQuiet, parseSchedule, type ScheduleSpec } from "../../src/core/queue/schedule-spec.js";

const at = (h: number, m = 0, d = 10) => Date.UTC(2026, 9, d, h, m);
const spec = (s: string): ScheduleSpec => {
  const r = parseSchedule(s);
  if (!r.ok) throw new Error(r.error);
  return r.spec;
};

describe("isQuiet", () => {
  const s = spec("every 15m quiet 22:00-06:00");
  it("handles midnight crossing", () => {
    expect(isQuiet(s, at(23))).toBe(true);
    expect(isQuiet(s, at(3))).toBe(true);
    expect(isQuiet(s, at(12))).toBe(false);
  });
  it("start inclusive, end exclusive", () => {
    expect(isQuiet(s, at(22, 0))).toBe(true);
    expect(isQuiet(s, at(21, 59))).toBe(false);
    expect(isQuiet(s, at(6, 0))).toBe(false);
    expect(isQuiet(s, at(5, 59))).toBe(true);
  });
  it("same-day window and no quiet", () => {
    const d = spec("every 15m quiet 01:00-02:00");
    expect(isQuiet(d, at(1, 30))).toBe(true);
    expect(isQuiet(d, at(2, 0))).toBe(false);
    expect(isQuiet(spec("every 15m"), at(3))).toBe(false);
  });
});

describe("isDue interval", () => {
  const s = spec("every 15m");
  it("null last run is due", () => expect(isDue(s, at(12), null)).toBe(true));
  it("not due before N minutes", () => expect(isDue(s, at(12, 14), at(12))).toBe(false));
  it("due at exactly N minutes", () => expect(isDue(s, at(12, 15), at(12))).toBe(true));
  it("quiet blocks", () => {
    const q = spec("every 15m quiet 22:00-06:00");
    expect(isDue(q, at(23), null)).toBe(false);
    expect(isDue(q, at(3), at(1))).toBe(false);
    expect(isDue(q, at(12), null)).toBe(true);
  });
  it("future lastRunAt is false", () => expect(isDue(s, at(12), at(13))).toBe(false));
});

describe("isDue daily", () => {
  const s = spec("at 08:30,17:00");
  it("before first slot, already ran yesterday", () => {
    expect(isDue(s, at(7), at(17, 5, 9))).toBe(false);
  });
  it("before first slot, missed yesterday slot", () => {
    expect(isDue(s, at(7), at(16, 0, 9))).toBe(true);
  });
  it("after 08:30 not yet run", () => expect(isDue(s, at(9), at(17, 5, 9))).toBe(true));
  it("after 08:30 already run", () => expect(isDue(s, at(9), at(8, 31))).toBe(false));
  it("17:00 due again", () => {
    expect(isDue(s, at(17, 0), at(8, 31))).toBe(true);
    expect(isDue(s, at(16, 59), at(8, 31))).toBe(false);
  });
  it("null last run is due", () => expect(isDue(s, at(9), null)).toBe(true));
  it("quiet blocks daily", () => {
    const q = spec("at 23:30,03:00 quiet 22:00-06:00");
    expect(isDue(q, at(23, 30), null)).toBe(false);
    expect(isDue(q, at(3), null)).toBe(false);
  });
  it("missed slot becomes due exactly when quiet ends", () => {
    const q = spec("at 03:00 quiet 22:00-06:00");
    const last = at(3, 0, 9);
    expect(isDue(q, at(5, 59), last)).toBe(false);
    expect(isDue(q, at(6, 0), last)).toBe(true);
  });
  it("future lastRunAt is false", () => expect(isDue(s, at(9), at(10))).toBe(false));
  it("utcOffsetMinutes=420 shifts local time", () => {
    // 01:30 UTC = 08:30 local at +07:00
    expect(isDue(s, at(1, 29), at(17, 5, 9), 420)).toBe(false);
    expect(isDue(s, at(1, 30), at(17, 5, 9), 420)).toBe(true);
    const q = spec("every 15m quiet 22:00-06:00");
    expect(isQuiet(q, at(16), 420)).toBe(true); // 23:00 local
    expect(isQuiet(q, at(16), 0)).toBe(false);
  });
});

describe("isDue invalid input", () => {
  const s = spec("every 15m");
  it("NaN and Infinity are false", () => {
    expect(isDue(s, NaN, null)).toBe(false);
    expect(isDue(s, Infinity, null)).toBe(false);
    expect(isDue(s, at(12), NaN)).toBe(false);
  });
  it("bad utcOffsetMinutes is false", () => {
    for (const o of [721 * -1, 841, 1.5, NaN, Infinity]) {
      expect(isDue(s, at(12), null, o), String(o)).toBe(false);
    }
    expect(isDue(s, at(12), null, -720)).toBe(true);
    expect(isDue(s, at(12), null, 840)).toBe(true);
  });
});

describe("parseSchedule", () => {
  it("parses every 15m", () => {
    expect(parseSchedule("every 15m")).toEqual({
      ok: true,
      spec: { kind: "interval", everyMinutes: 15 },
    });
  });

  it("sorts daily times ascending", () => {
    expect(parseSchedule("at 17:00,08:30")).toEqual({
      ok: true,
      spec: { kind: "daily", times: [510, 1020] },
    });
  });

  it("accepts spaces around commas in at", () => {
    expect(parseSchedule("at 08:30 , 17:00")).toEqual({
      ok: true,
      spec: { kind: "daily", times: [510, 1020] },
    });
    expect(parseSchedule("at 08:30, 17:00")).toMatchObject({ ok: true });
  });

  it("stores quiet window crossing midnight", () => {
    expect(parseSchedule("every 15m quiet 22:00-06:00")).toEqual({
      ok: true,
      spec: {
        kind: "interval",
        everyMinutes: 15,
        quiet: { startMinute: 1320, endMinute: 360 },
      },
    });
  });

  it("is case-insensitive and tolerates extra whitespace", () => {
    expect(parseSchedule("  EVERY   30M   Quiet  01:00 - 02:00  ")).toEqual({
      ok: true,
      spec: {
        kind: "interval",
        everyMinutes: 30,
        quiet: { startMinute: 60, endMinute: 120 },
      },
    });
  });

  it("rejects invalid input without throwing", () => {
    const bad = [
      "",
      "   ",
      "every 0m",
      "every 1441m",
      "at 25:00",
      "at 08:30,08:30",
      "at ",
      "quiet 10:00-10:00",
      "every 15m quiet 10:00-10:00",
      "every 15m quiet 25:00-06:00",
      "every 15m quiet",
      "every 15m quiet 22:00",
      "hello",
    ];
    for (const s of bad) {
      const r = parseSchedule(s);
      expect(r.ok, s).toBe(false);
      if (!r.ok) expect(r.error.length).toBeGreaterThan(0);
    }
  });

  it("rejects non-string input without throwing", () => {
    for (const v of [null, undefined, 42, {}, []]) {
      expect(parseSchedule(v as unknown as string).ok).toBe(false);
    }
  });
});
