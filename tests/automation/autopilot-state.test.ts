import { describe, expect, it } from "vitest";
import { AUTOPILOT_SCHEDULE_MAX_LEN, AutopilotState } from "../../src/core/queue/autopilot-state.js";

const cfg = (over: Record<string, unknown> = {}) => ({ enabled: false, maxRetries: 0, schedule: null, webhooks: [], ...over }) as any;

describe("AutopilotState", () => {
  it("initialises from config.automation", () => {
    const s = new AutopilotState(cfg({ enabled: true, webhooks: ["https://example.com/a"] }), () => Date.parse("2026-01-01T00:00:00Z"));
    expect(s.snapshot()).toEqual({
      enabled: true,
      schedule: null,
      scheduleSpec: null,
      webhooks: ["https://example.com/a"],
      updatedAt: "2026-01-01T00:00:00.000Z",
    });
  });

  it("does not throw for a cron schedule in config, schedule stays null", () => {
    const s = new AutopilotState(cfg({ schedule: "*/5 * * * *" }));
    expect(s.snapshot().schedule).toBeNull();
    expect(s.snapshot().scheduleSpec).toBeNull();
  });

  it("enable/disable are idempotent and update updatedAt only on change", () => {
    let t = 1000;
    const s = new AutopilotState(cfg(), () => t);
    t = 2000;
    s.disable();
    expect(s.snapshot().enabled).toBe(false);
    expect(Date.parse(s.snapshot().updatedAt)).toBe(1000);
    s.enable();
    expect(Date.parse(s.snapshot().updatedAt)).toBe(2000);
    t = 3000;
    s.enable();
    expect(s.snapshot().enabled).toBe(true);
    expect(Date.parse(s.snapshot().updatedAt)).toBe(2000);
    s.disable();
    s.disable();
    expect(s.snapshot().enabled).toBe(false);
  });

  it("sets valid schedules", () => {
    const s = new AutopilotState(cfg());
    s.setSchedule("every 15m");
    expect(s.snapshot().schedule).toBe("every 15m");
    expect(s.snapshot().scheduleSpec).toMatchObject({ kind: "interval", everyMinutes: 15 });
    s.setSchedule("at 09:30");
    expect(s.snapshot().scheduleSpec).toMatchObject({ kind: "daily", times: [570] });
  });

  it("rejects invalid schedules and keeps the old one", () => {
    const s = new AutopilotState(cfg());
    s.setSchedule("every 15m");
    expect(() => s.setSchedule("every 0m")).toThrow();
    expect(() => s.setSchedule("abc")).toThrow();
    expect(() => s.setSchedule("a".repeat(AUTOPILOT_SCHEDULE_MAX_LEN + 1))).toThrow(/120/);
    expect(s.snapshot().schedule).toBe("every 15m");
  });

  it("clears the schedule with null or empty string", () => {
    const s = new AutopilotState(cfg());
    s.setSchedule("every 15m");
    s.setSchedule(null);
    expect(s.snapshot().schedule).toBeNull();
    s.setSchedule("every 15m");
    s.setSchedule("  ");
    expect(s.snapshot().schedule).toBeNull();
    expect(s.snapshot().scheduleSpec).toBeNull();
  });

  it("validates webhooks", () => {
    const s = new AutopilotState(cfg());
    s.setWebhooks(["https://example.com/a", "https://example.com/a"]);
    expect(s.snapshot().webhooks).toEqual(["https://example.com/a"]);
    expect(() => s.setWebhooks(["http://example.com/a"])).toThrow();
    expect(() => s.setWebhooks(["https://localhost/a"])).toThrow();
    expect(s.snapshot().webhooks).toEqual(["https://example.com/a"]);
  });
});
