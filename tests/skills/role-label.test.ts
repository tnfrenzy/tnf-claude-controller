import { describe, expect, it } from "vitest";
import { dicts, roleLabel } from "../../ui/src/i18n.js";

const CODING = ["coordinator", "analyst", "planner", "critic", "implementer", "qa", "debug"];

describe("roleLabel", () => {
  it("returns a Vietnamese name for coding roles", () => {
    for (const r of CODING) {
      const s = roleLabel(r, "vi");
      expect(s).not.toBe("");
      expect(s).not.toBe(r);
    }
  });
  it("returns a non-empty English name for coding roles", () => {
    for (const r of CODING) expect(roleLabel(r, "en")).not.toBe("");
  });
  it("returns unknown ids unchanged", () => {
    for (const lang of ["vi", "en"] as const) {
      expect(roleLabel("frontend-dev", lang)).toBe("frontend-dev");
      expect(roleLabel("", lang)).toBe("");
    }
  });
  it("ignores prototype keys", () => {
    for (const lang of ["vi", "en"] as const) {
      expect(roleLabel("constructor", lang)).toBe("constructor");
      expect(roleLabel("toString", lang)).toBe("toString");
    }
  });
  it("distinguishes analyst from analyzer in vi", () => {
    expect(roleLabel("analyst", "vi")).not.toBe(roleLabel("analyzer", "vi"));
    expect(dicts.vi.role_analyst).toBe("Phân tích viên");
  });
});
