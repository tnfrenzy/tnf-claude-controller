import { describe, expect, it } from "vitest";
import { fmtQuotaRange } from "../../ui/src/run/quotaFormat.js";

describe("fmtQuotaRange", () => {
  it("formats ranges", () => {
    const a = fmtQuotaRange(0, 20, 20);
    expect(a).toContain("0% → 20%");
    expect(a).toContain("≈ 20%");
    expect(fmtQuotaRange(18, 20, 2)).toContain("18% → 20%");
    expect(fmtQuotaRange(6, 6, 0)).toContain("< 0.1%");
    expect(fmtQuotaRange(5.2, 7.4, 2.2)).toContain("5.2% → 7.4%");
  });
  it("returns a dash when unknown", () => {
    expect(fmtQuotaRange(null, 5, 0)).toBe("—");
    expect(fmtQuotaRange(5, null, 0)).toBe("—");
    expect(fmtQuotaRange(undefined, undefined, 0)).toBe("—");
  });
});
