import { describe, expect, it } from "vitest";
import { formatDuration, groupRoles, metaParts, projectHue, statusVisual } from "../../ui/src/run/runRow.js";

describe("statusVisual", () => {
  it("maps each known status to its own icon and tone, only running pulses", () => {
    expect(statusVisual("running")).toEqual({ icon: "▶", tone: "run", pulse: true });
    expect(statusVisual("done")).toEqual({ icon: "✓", tone: "ok", pulse: false });
    expect(statusVisual("error")).toEqual({ icon: "✕", tone: "err", pulse: false });
    expect(statusVisual("cancelled")).toEqual({ icon: "■", tone: "warn", pulse: false });
  });
  it("falls back for an unknown status", () => {
    expect(statusVisual("zzz")).toEqual({ icon: "•", tone: "muted", pulse: false });
  });
});

describe("groupRoles", () => {
  it("merges repeated roles and keeps first-appearance order", () => {
    const g = groupRoles(["implementer", "subagent", "implementer", "subagent", "subagent", "qa"]);
    expect(g.items).toEqual([
      { role: "implementer", count: 2 },
      { role: "subagent", count: 3 },
      { role: "qa", count: 1 },
    ]);
    expect(g.more).toBe(0);
  });
  it("cuts after max distinct roles and reports how many are hidden", () => {
    const g = groupRoles(["a", "b", "c", "d", "e", "a"], 3);
    expect(g.items.map((x) => x.role)).toEqual(["a", "b", "c"]);
    expect(g.items[0]!.count).toBe(2);
    expect(g.more).toBe(2);
  });
  it("handles an empty list", () => {
    expect(groupRoles([])).toEqual({ items: [], more: 0 });
  });
});

describe("formatDuration", () => {
  it("formats seconds, minutes and hours; empty when unknown", () => {
    expect(formatDuration(0)).toBe("");
    expect(formatDuration(-5)).toBe("");
    expect(formatDuration(32_000)).toBe("32 s");
    expect(formatDuration(245_000)).toBe("4 ph 05 s");
    expect(formatDuration(3_720_000)).toBe("1 g 02 ph");
  });
});

describe("metaParts", () => {
  const fmtCost = (n: number) => `$${n.toFixed(2)}`;
  const fmtWhen = () => "10:59 28/10";
  it("lists when, cost and duration in order", () => {
    expect(metaParts({ created_at: 1, cost_usd_est: 0.159, duration_ms: 32_000 }, fmtCost, fmtWhen)).toEqual(["10:59 28/10", "$0.16", "32 s"]);
  });
  it("drops cost and duration when they are zero", () => {
    expect(metaParts({ created_at: 1, cost_usd_est: 0, duration_ms: 0 }, fmtCost, fmtWhen)).toEqual(["10:59 28/10"]);
  });
});

describe("projectHue", () => {
  it("is stable per name, within 0..359, and differs for different names", () => {
    expect(projectHue("controller")).toBe(projectHue("controller"));
    const h = projectHue("Platform");
    expect(h).toBeGreaterThanOrEqual(0);
    expect(h).toBeLessThan(360);
    expect(projectHue("controller")).not.toBe(projectHue("Platform"));
  });
});
