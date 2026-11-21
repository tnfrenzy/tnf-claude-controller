import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { fmtQuotaRange } from "../../ui/src/run/quotaFormat.js";

describe("run quota display", () => {
  for (const lang of ["vi", "en"] as const) {
    it(`${lang} has quota keys`, () => {
      const d = dicts[lang] as Record<string, string>;
      for (const k of ["quota_5h", "quota_7d", "quota_week", "quota_note"]) {
        expect(d[k]).toBeTruthy();
      }
    });
  }

  it("vi quota_note says estimate", () => {
    expect((dicts.vi as Record<string, string>).quota_note.toLowerCase()).toContain("ước tính");
  });

  it("old runs without weekly columns show a dash", () => {
    expect(fmtQuotaRange(undefined, undefined, undefined)).toBe("—");
    expect(fmtQuotaRange(null, null, 0)).toBe("—");
  });
});
