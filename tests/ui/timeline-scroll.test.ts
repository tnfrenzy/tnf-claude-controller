import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { isNearBottom, liveLength } from "../../ui/src/run/timelineScroll";

describe("timelineScroll", () => {
  it("isNearBottom thresholds", () => {
    expect(isNearBottom({ scrollTop: 600, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollTop: 561, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollTop: 560, scrollHeight: 1000, clientHeight: 400 })).toBe(true);
    expect(isNearBottom({ scrollTop: 559, scrollHeight: 1000, clientHeight: 400 })).toBe(false);
    expect(isNearBottom({ scrollTop: 0, scrollHeight: 200, clientHeight: 400 })).toBe(true);
  });
  it("liveLength sums text", () => {
    expect(liveLength({ a: "ab", b: "cde" })).toBe(5);
    expect(liveLength({})).toBe(0);
  });
  it("Timeline has no scrollIntoView and RunPage keeps it mounted", () => {
    expect(readFileSync("ui/src/components/run/Timeline.tsx", "utf8")).not.toContain("scrollIntoView");
    const run = readFileSync("ui/src/pages/RunPage.tsx", "utf8");
    expect(run).not.toContain('curTab === "timeline" && <Timeline');
    expect(run).toContain("hidden={curTab");
  });
});
