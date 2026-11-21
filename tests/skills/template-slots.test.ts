import { describe, expect, it } from "vitest";
import { extractSlots, fillTemplate, missingSlots, slotLabel } from "../../ui/src/skills/library";

describe("template slots", () => {
  it("no slots", () => {
    expect(extractSlots("khong co o nao")).toEqual([]);
    expect(fillTemplate("abc", {})).toBe("abc");
  });
  it("repeated name is unique and filled everywhere", () => {
    const c = "Sửa {{tên_file}} rồi kiểm {{tên_file}} và {{lỗi}}";
    expect(extractSlots(c)).toEqual(["tên_file", "lỗi"]);
    expect(fillTemplate(c, { tên_file: "a.ts", lỗi: "x" })).toBe("Sửa a.ts rồi kiểm a.ts và x");
  });
  it("{{{{ escapes to literal {{ and is not a slot", () => {
    expect(extractSlots("dùng {{{{ để thoát {{a}}")).toEqual(["a"]);
    expect(fillTemplate("dùng {{{{ để thoát {{a}}", { a: "1" })).toBe("dùng {{ để thoát 1");
  });
  it("values with $& and $' stay literal", () => {
    expect(fillTemplate("x {{a}} y", { a: "$& $' $$" })).toBe("x $& $' $$ y");
  });
  it("missingSlots flags empty and blank", () => {
    expect(missingSlots("{{a}} {{b}} {{c}}", { a: "ok", b: "  " })).toEqual(["b", "c"]);
  });
  it("accented slot names", () => {
    expect(extractSlots("{{mô_tả_lỗi}} {{Đường dẫn}}")).toEqual(["mô_tả_lỗi"]);
    expect(extractSlots("{{mô_tả_lỗi}} {{tên_mới}}")).toEqual(["mô_tả_lỗi", "tên_mới"]);
  });
  it("slotLabel", () => {
    expect(slotLabel("mô_tả_lỗi")).toBe("mô tả lỗi");
  });
});
