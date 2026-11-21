import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";

describe("skillg_* i18n keys", () => {
  it("exist and are non-empty in vi and en", () => {
    const viKeys = Object.keys(dicts.vi).filter((k) => k.startsWith("skillg_"));
    const enKeys = Object.keys(dicts.en).filter((k) => k.startsWith("skillg_"));
    expect(viKeys.length).toBeGreaterThanOrEqual(25);
    expect(enKeys.sort()).toEqual(viKeys.sort());
    for (const k of viKeys) {
      expect((dicts.vi as Record<string, string>)[k].trim()).not.toBe("");
      expect((dicts.en as Record<string, string>)[k].trim()).not.toBe("");
    }
  });

  it("has the 12 validation error keys with placeholders", () => {
    const keys = [
      "name_required", "brief_required", "brief_max", "kw_max", "kw_empty", "kw_long",
      "kw_dup", "cost_range", "time_range", "rounds_range", "score_range", "feedback_required",
    ].map((k) => `skillg_err_${k}`);
    const need: Record<string, string[]> = {
      skillg_err_brief_max: ["{max}"],
      skillg_err_kw_max: ["{max}"],
      skillg_err_kw_long: ["{kw}", "{max}"],
      skillg_err_kw_dup: ["{kw}"],
      skillg_err_cost_range: ["{max}"],
      skillg_err_time_range: ["{max}"],
      skillg_err_rounds_range: ["{max}"],
    };
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const k of keys) {
        expect(d[k]?.trim(), `${lang}.${k}`).toBeTruthy();
        for (const p of need[k] ?? []) expect(d[k]).toContain(p);
      }
    }
  });

  it("maps session and finder statuses to labels", () => {
    const sessionMap: Record<string, string> = {
      awaiting_score: "skillg_status_awaiting_score",
      completed: "skillg_completed",
      exhausted: "skillg_exhausted",
      generating: "skillg_status_generating",
      paused: "skillg_status_paused",
    };
    const finderMap: Record<string, string> = {
      idle: "skillg_finder_idle",
      running: "skillg_finder_running",
      done: "skillg_finder_done",
      failed: "skillg_finder_failed",
    };
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const s of ["awaiting_score", "completed", "exhausted", "generating", "paused"]) expect(d[sessionMap[s]!]?.trim(), `${lang}.${s}`).toBeTruthy();
      for (const s of ["idle", "running", "done", "failed"]) expect(d[finderMap[s]!]?.trim(), `${lang}.finder.${s}`).toBeTruthy();
    }
  });
});
