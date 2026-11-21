import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const FIXED = [
  "placeholder", "kind_auto", "kind_label", "id_label",
  "f_kind", "f_id", "f_desc", "f_tools", "f_model", "f_license", "f_prompt",
  "err_too_big", "err_bad_name", "err_read",
].map((k) => `lib_imp_ui_${k}`);

const keys = (lang: "vi" | "en") => Object.keys(dicts[lang]).filter((k) => k.startsWith("lib_imp_ui_")).sort();
const get = (lang: "vi" | "en", k: string) => (dicts[lang] as Record<string, string>)[k];

describe("lib_imp_ui_ i18n keys", () => {
  it("every fixed key exists in vi and en and is non-empty", () => {
    for (const lang of ["vi", "en"] as const)
      for (const k of FIXED) expect((get(lang, k) ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("vi and en have the same lib_imp_ui_ key set", () => {
    expect(keys("vi")).toEqual(keys("en"));
    expect(keys("vi")).toEqual([...FIXED].sort());
  });
});
