import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { HINT_KEYS } from "../../ui/src/run/runHints.js";

const LABELS = [
  "hint.action.rerun", "hint.action.resume", "hint.action.raise_budget", "hint.action.contact_support", "hint.technical",
  "summary.title", "summary.pass", "summary.fail", "summary.none", "summary.commits", "summary.files",
  "summary.test_pass", "summary.test_fail", "summary.test_unknown", "summary.cost", "summary.btn_commit", "summary.btn_diff",
];

describe("run page i18n keys", () => {
  for (const lang of ["vi", "en"] as const) {
    it(`has every hint and summary key in ${lang}`, () => {
      const d = dicts[lang] as unknown as Record<string, string>;
      for (const k of [...HINT_KEYS, ...LABELS]) {
        expect(typeof d[k], k).toBe("string");
        expect(d[k]!.trim().length, k).toBeGreaterThan(0);
      }
    });
  }
});
