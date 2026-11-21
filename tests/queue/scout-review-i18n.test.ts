import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";

const keysOf = (d: Record<string, string>) => Object.keys(d).filter((k) => k.startsWith("scoutReview_"));
const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;

describe("scoutReview i18n", () => {
  const vi = dicts.vi as Record<string, string>;
  const en = dicts.en as Record<string, string>;
  it("has the same non-empty keys in vi and en", () => {
    const kv = keysOf(vi).sort();
    const ke = keysOf(en).sort();
    expect(kv.length).toBeGreaterThan(20);
    expect(ke).toEqual(kv);
    for (const k of kv) {
      expect(vi[k].trim()).not.toBe("");
      expect(en[k].trim()).not.toBe("");
    }
  });
  it("vi strings have Vietnamese diacritics (except short ones)", () => {
    for (const k of keysOf(vi)) if (vi[k].length > 12) expect(vi[k], k).toMatch(VI_DIACRITICS);
  });
  it("cost strings say estimate", () => {
    for (const k of ["scoutReview_costEach", "scoutReview_costTotal", "scoutReview_confirm"]) {
      expect(vi[k]).toContain("ước tính");
      expect(en[k]).toContain("estimate");
    }
    expect(vi.scoutReview_finished).toContain("chờ duyệt");
    expect(vi.scoutReview_finished).toContain("không tự chạy");
  });
  it("keeps old scout keys", () => {
    for (const k of ["env_scout", "env_scout_busy", "env_scout_tip", "env_scout_need_repo"]) {
      expect(vi[k]).toBeTruthy();
      expect(en[k]).toBeTruthy();
    }
  });
});
