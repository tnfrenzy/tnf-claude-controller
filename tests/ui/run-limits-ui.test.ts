import { describe, expect, it } from "vitest";
import { formatLimits, validateMaxRoleCalls } from "../../ui/src/run/runLimits";
import { dicts } from "../../ui/src/i18n";

const vi = dicts.vi;
const en = dicts.en;

describe("validateMaxRoleCalls", () => {
  it("rejects empty, 0, fractional, text, above ceiling", () => {
    for (const bad of ["", "  ", "0", "1.5", "abc", "31", "-3", 0, 1.5, 31]) {
      expect(validateMaxRoleCalls(bad, 30)).toEqual({ ok: false, error: "range" });
    }
  });
  it("accepts 20 and the ceiling 30", () => {
    expect(validateMaxRoleCalls("20", 30)).toEqual({ ok: true, value: 20 });
    expect(validateMaxRoleCalls("30", 30)).toEqual({ ok: true, value: 30 });
    expect(validateMaxRoleCalls(1, 30)).toEqual({ ok: true, value: 1 });
  });
});

describe("formatLimits", () => {
  it("returns null for missing limits", () => {
    expect(formatLimits(null)).toBeNull();
    expect(formatLimits(undefined)).toBeNull();
  });
  it("lists all four effective limits", () => {
    const rows = formatLimits({ maxTurns: 40, maxBudgetUsd: 3, maxRoleCalls: 20, callTimeoutMinutes: 20 })!;
    expect(rows.map((r) => r.key)).toEqual(["maxTurns", "maxBudgetUsd", "maxRoleCalls", "callTimeoutMinutes"]);
    expect(rows[1]!.value).toBe("$3");
  });
  it("skips null role calls / timeout (research runs)", () => {
    const rows = formatLimits({ maxTurns: 40, maxBudgetUsd: 3, maxRoleCalls: null, callTimeoutMinutes: null })!;
    expect(rows.map((r) => r.key)).toEqual(["maxTurns", "maxBudgetUsd"]);
  });
});

describe("i18n keys", () => {
  const keys = ["max_role_calls", "max_role_calls_hint", "max_role_calls_err", "limits_title", "limit_maxTurns", "limit_maxBudgetUsd", "limit_maxRoleCalls", "limit_callTimeoutMinutes"];
  it("exist in vi and en", () => {
    for (const k of keys) {
      expect((vi as Record<string, string>)[k], `vi ${k}`).toBeTruthy();
      expect((en as Record<string, string>)[k], `en ${k}`).toBeTruthy();
    }
  });
});
