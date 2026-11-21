import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const KEYS = [
  "dc_add_line", "dc_input_placeholder", "dc_save", "dc_delete", "dc_edit", "dc_cancel",
  "dc_list_title", "dc_counter", "dc_too_long", "dc_diff_changed", "dc_confirm_diff_changed",
  "dc_send_fix", "dc_sent", "dc_err_invalid", "dc_err_empty", "dc_err_too_many",
  "dc_err_not_coding", "dc_err_generic",
];

describe("diff comment i18n keys", () => {
  it("exist and are non-empty in vi and en", () => {
    for (const lang of ["vi", "en"] as const) {
      for (const k of KEYS) {
        expect(((dicts[lang] as Record<string, string>)[k] ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
      }
    }
  });
});
