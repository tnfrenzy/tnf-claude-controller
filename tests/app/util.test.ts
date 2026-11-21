import { describe, expect, it } from "vitest";
import { fold, isObj, slashes } from "../../src/core/app/util.js";

// Verbatim copies of the implementations this module replaced; the merged helpers must behave identically.
const oldSlashes = (p: string): string => p.replace(/\\/g, "/").replace(/\/+$/, "");
const foldCatalog = (s: string): string =>
  s.normalize("NFD").replace(new RegExp("[\\u0300-\\u036f]", "g"), "").toLowerCase().replace(new RegExp("\\u0111", "g"), "d");
const foldMatch = (s: string): string => s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/gi, "d").toLowerCase();
const foldVariants = (s: string): string =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
const isObjA = (v: unknown): boolean => typeof v === "object" && v !== null && !Array.isArray(v);
const isObjB = (v: unknown): boolean => !!v && typeof v === "object" && !Array.isArray(v);

const TEXTS = ["", "Đường dẫn Đặng đệ", "Thiết kế ĐỒ THỊ", "Crème Brûlée İstanbul", "ABC xyz 123", "ﬁ ǅ ǆ", "Tiếng Việt: ươ ơ ă â ê ô ư", "đĐdD"];
const PATHS = ["", "C:\\a\\b\\", "a/b//", "/", "\\\\", "x\\y/z", "a/b", "D:/x/"];
const VALUES: unknown[] = [null, undefined, 0, "", "x", 1, true, [], [1], {}, { a: 1 }, new Date(), () => 1];

describe("shared helpers equal the removed copies", () => {
  it("slashes", () => {
    for (const p of PATHS) expect(slashes(p)).toBe(oldSlashes(p));
  });
  it("fold equals catalog, match and variants versions", () => {
    for (const t of TEXTS) {
      expect(fold(t)).toBe(foldCatalog(t));
      expect(fold(t)).toBe(foldMatch(t));
      expect(fold(t)).toBe(foldVariants(t));
    }
  });
  it("isObj equals both old predicates", () => {
    for (const v of VALUES) {
      expect(isObj(v)).toBe(isObjA(v));
      expect(isObj(v)).toBe(isObjB(v));
    }
  });
});
