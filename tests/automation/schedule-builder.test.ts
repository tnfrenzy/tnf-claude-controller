import { describe, expect, it } from "vitest";
import { buildSchedule, parseScheduleForm, type ScheduleForm } from "../../ui/src/settings/scheduleBuilder.js";
import { dicts } from "../../ui/src/i18n.js";

const base: ScheduleForm = { mode: "weekly", days: [], dayOfMonth: 1, time: "08:30", quiet: "" };

describe("buildSchedule", () => {
  it("builds weekly with sorted days", () => {
    expect(buildSchedule({ ...base, days: [4, 1] })).toEqual({ ok: true, text: "weekly mon,thu at 08:30" });
  });
  it("builds monthly with quiet", () => {
    expect(buildSchedule({ ...base, mode: "monthly", dayOfMonth: 15, quiet: "22:00-06:00" })).toEqual({ ok: true, text: "monthly 15 at 08:30 quiet 22:00-06:00" });
  });
  it("rejects bad input", () => {
    expect(buildSchedule({ ...base, days: [] }).ok).toBe(false);
    expect(buildSchedule({ ...base, mode: "monthly", dayOfMonth: 0 }).ok).toBe(false);
    expect(buildSchedule({ ...base, days: [1], time: "8:3" }).ok).toBe(false);
    expect(buildSchedule({ ...base, days: [1], quiet: "22-06" }).ok).toBe(false);
  });
});

describe("parseScheduleForm", () => {
  it("round-trips weekly and monthly", () => {
    for (const text of ["weekly mon,thu at 08:30", "monthly 15 at 08:30 quiet 22:00-06:00"]) {
      const form = parseScheduleForm(text);
      expect(form).not.toBeNull();
      expect(buildSchedule(form!)).toEqual({ ok: true, text });
    }
  });
  it("returns null for other schedules", () => {
    expect(parseScheduleForm("every 15m")).toBeNull();
    expect(parseScheduleForm("at 08:30")).toBeNull();
    expect(parseScheduleForm(null)).toBeNull();
  });
});

describe("automation i18n keys", () => {
  const keys = ["auto_mode_weekly", "auto_mode_monthly", "auto_days", "auto_day_of_month", "auto_time", "auto_quiet", "auto_current", "auto_legacy", "auto_ideas_title",
    ...[0, 1, 2, 3, 4, 5, 6].map((i) => `auto_wd_${i}`), ...[1, 2, 3, 4, 5].map((i) => `auto_idea_${i}`)];
  it("exist in vi and en", () => {
    for (const k of keys) {
      expect((dicts.vi as Record<string, string>)[k], k).toBeTruthy();
      expect((dicts.en as Record<string, string>)[k], k).toBeTruthy();
    }
  });
  it("placeholder no longer shows cron", () => {
    expect(dicts.vi.auto_schedule_ph).not.toContain("* *");
  });
});
