import { describe, it, expect } from "vitest";
import { StreamParser } from "../../src/core/run/stream-parser.js";

function feed(info: Record<string, unknown>) {
  const parser = new StreamParser("t");
  const line = JSON.stringify({ type: "rate_limit_event", rate_limit_info: info });
  return parser.feedLine(line).filter((e) => e.type === "rate.limit");
}

describe("rate_limit_event percentages", () => {
  it("keeps one decimal", () => {
    const [ev] = feed({
      status: "allowed",
      unifiedWindows: {
        five_hour: { utilization: 0.034, resetsAt: 1800000000 },
        seven_day: { utilization: 0.1849, resetsAt: 1800500000 },
      },
    }) as any[];
    expect(ev.five_hour_pct).toBe(3.4);
    expect(ev.seven_day_pct).toBe(18.5);
    expect(ev.five_hour_resets_at).toBe(1800000000 * 1000);
  });

  it("null when seven_day missing", () => {
    const [ev] = feed({
      status: "allowed",
      unifiedWindows: { five_hour: { utilization: 0.2, resetsAt: 1800000000 } },
    }) as any[];
    expect(ev.five_hour_pct).toBe(20);
    expect(ev.seven_day_pct).toBeNull();
  });
});
