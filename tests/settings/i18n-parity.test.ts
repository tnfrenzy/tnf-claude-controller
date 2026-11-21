import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

describe("i18n parity", () => {
  it("vi and en have the same keys", () => {
    expect(Object.keys(dicts.en).sort()).toEqual(Object.keys(dicts.vi).sort());
  });
  it("example attachment keys exist in both languages", () => {
    const keys = ["skillf_add_file", "skillf_files_input", "skillf_files_expected", "skillf_drop_hint", "skillf_remove_file", "skillf_binary_warn", "skillf_err_file_big", "skillf_err_file_name", "skillf_err_file_total", "skillf_err_file_count", "skillf_err_either"];
    for (const lang of ["vi", "en"] as const) {
      for (const k of keys) expect(((dicts[lang] as Record<string, string>)[k] ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
    }
    expect(dicts.vi.skillf_binary_warn).toBe("Agent chỉ đọc được văn bản/JSON/CSV; hãy trích sang dạng đó trước, tệp này chỉ được ghi nhận tên");
  });
  it("every value is a non-empty string", () => {
    for (const lang of ["vi", "en"] as const) {
      for (const [k, v] of Object.entries(dicts[lang])) {
        expect(typeof v, `${lang}.${k}`).toBe("string");
        expect((v as string).trim().length, `${lang}.${k}`).toBeGreaterThan(0);
      }
    }
  });
});
