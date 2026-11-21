import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";
import { elapsedRatio, formatCost, formatRemaining, recentBlocks, tokenRatio } from "../../ui/src/run/usageBlocks";

describe("formatRemaining", () => {
  it("handles edge values", () => {
    expect(formatRemaining(0)).toEqual({ h: 0, m: 0 });
    expect(formatRemaining(59_999)).toEqual({ h: 0, m: 0 });
    expect(formatRemaining(3_600_000)).toEqual({ h: 1, m: 0 });
    expect(formatRemaining((5 * 60 + 59) * 60000)).toEqual({ h: 5, m: 59 });
    expect(formatRemaining(-5)).toEqual({ h: 0, m: 0 });
    expect(formatRemaining(NaN)).toEqual({ h: 0, m: 0 });
  });
});

describe("elapsedRatio", () => {
  const b = { start: "2026-01-01T00:00:00Z", end: "2026-01-01T05:00:00Z" };
  const s = Date.parse(b.start);
  it("computes and clamps", () => {
    expect(elapsedRatio(b, s)).toBe(0);
    expect(elapsedRatio(b, s + 2.5 * 3600_000)).toBeCloseTo(0.5);
    expect(elapsedRatio(b, s + 9 * 3600_000)).toBe(1);
    expect(elapsedRatio({ start: b.start, end: b.start }, s)).toBe(0);
  });
});

describe("tokenRatio", () => {
  it("clamps", () => {
    expect(tokenRatio(10, 0)).toBe(0);
    expect(tokenRatio(200, 100)).toBe(1);
    expect(tokenRatio(25, 100)).toBe(0.25);
  });
});

describe("recentBlocks", () => {
  it("returns newest first without mutating", () => {
    const arr = [1, 2, 3, 4, 5, 6, 7, 8];
    expect(recentBlocks(arr, 5)).toEqual([8, 7, 6, 5, 4]);
    expect(arr).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(recentBlocks([1, 2], 5)).toEqual([2, 1]);
  });
});

describe("formatCost", () => {
  it("formats", () => {
    expect(formatCost(undefined)).toBe("—");
    expect(formatCost(NaN)).toBe("—");
    expect(formatCost(1.234)).toBe("$1.23");
    expect(formatCost(0.004)).toBe("$0.0040");
  });
});

describe("i18n keys", () => {
  it("has new usage_blocks keys in vi and en", () => {
    for (const k of ["usage_blocks_recent", "usage_blocks_refresh", "usage_blocks_estimate", "usage_blocks_empty", "usage_blocks_loading"]) {
      expect((dicts.vi as Record<string, string>)[k]?.length, k).toBeGreaterThan(0);
      expect((dicts.en as Record<string, string>)[k]?.length, k).toBeGreaterThan(0);
    }
  });
});

describe("UsageBlocksPanel source", () => {
  const src = readFileSync("ui/src/components/settings/UsageBlocksPanel.tsx", "utf8");
  it("uses api, estimate label, recentBlocks and progressbar without polling", () => {
    expect(src).toContain("getUsageBlocks");
    expect(src).toContain("usage_blocks_estimate");
    expect(src).toContain("recentBlocks");
    expect(src).toContain("role=\"progressbar\"");
    expect(src).not.toMatch(/setInterval|setTimeout/);
  });
  it("styles.css has .usage-bar", () => {
    expect(readFileSync("ui/src/styles.css", "utf8")).toContain(".usage-bar");
  });
});
