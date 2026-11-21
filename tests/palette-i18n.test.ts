import { describe, expect, it } from "vitest";
import { dicts } from "../ui/src/i18n.js";

const expected = [
  "palette_title",
  "palette_placeholder",
  "palette_empty",
  "palette_loading",
  "palette_group_runs",
  "palette_group_envs",
  "palette_group_pages",
  "palette_open_hint",
];

describe("palette i18n keys", () => {
  for (const lang of ["vi", "en"] as const) {
    it(`has all palette_* keys non-empty in ${lang}`, () => {
      const d = dicts[lang] as Record<string, string>;
      for (const k of expected) {
        expect(typeof d[k]).toBe("string");
        expect(d[k].trim().length).toBeGreaterThan(0);
      }
      const found = Object.keys(d).filter((k) => k.startsWith("palette_"));
      expect(found.sort()).toEqual([...expected].sort());
    });
  }
});
