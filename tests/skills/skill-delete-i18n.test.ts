import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const KEYS = [
  "skill_floor_delete",
  "skill_floor_delete_confirm",
  "skill_floor_delete_locked",
  "skill_floor_delete_err",
  "skill_tab_results",
  "skill_results_best",
  "skill_results_empty"
];

describe("skill delete and results i18n keys", () => {
  for (const lang of ["vi", "en"] as const) {
    for (const key of KEYS) {
      it(`${lang} has non-empty ${key}`, () => {
        const v = (dicts as Record<string, Record<string, unknown>>)[lang][key];
        expect(typeof v).toBe("string");
        expect((v as string).length).toBeGreaterThan(0);
      });
    }
  }
});
