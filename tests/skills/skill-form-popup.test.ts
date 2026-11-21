import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { SkillFormView } from "../../ui/src/components/skills/SkillFormPopup.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";
import { firstMissingKey, validateAnswers, type InputsSchema } from "../../ui/src/skills/skillForm.js";

const SCHEMA: InputsSchema = {
  version: 2,
  fields: [
    { id: "ten", label: "Tên khách", kind: "text", required: true, reason: "Để ghi báo giá", group: "Khách hàng" },
    { id: "tai", label: "Tải trọng", kind: "number", unit: "kg", required: false, reason: "Chọn động cơ", suggested: 1000, group: "Kỹ thuật" },
    { id: "bang", label: "Bảng giá", kind: "file", required: false, reason: "Tính giá", group: "Kỹ thuật" },
  ],
};

const render = (schema: InputsSchema) =>
  renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, createElement(SkillFormView, { schema })));

describe("SkillFormPopup", () => {
  it("renders groups, reasons, suggestions and a disabled submit when a required field is empty", () => {
    const html = render(SCHEMA);
    expect(html).toContain("Khách hàng");
    expect(html).toContain("Kỹ thuật");
    expect(html).toContain("Lý do cần: Để ghi báo giá");
    expect(html).toContain("Gợi ý từ mẫu");
    expect(html).toContain("1000");
    expect(html).toContain("Dùng gợi ý");
    expect(html).toContain("Còn trường bắt buộc chưa điền.");
    expect(html).not.toMatch(/<button type="submit" disabled=""/);
    expect(html).toContain("bắt buộc");
    expect(html).toContain('aria-required="true"');
    expect(html).toContain('id="skillform-ten"');
    expect(html.match(/aria-required/g)?.length).toBe(1);
  });

  it("firstMissingKey follows displayed order and ignores valid fields", () => {
    expect(firstMissingKey(SCHEMA, {})).toBeUndefined();
    expect(firstMissingKey(SCHEMA, { tai: "x", ten: "y" })).toBe("ten");
    expect(firstMissingKey(SCHEMA, { bang: "x" })).toBe("bang");
    const r = validateAnswers(SCHEMA, {});
    expect(firstMissingKey(SCHEMA, r.errors)).toBe("ten");
  });

  it("enables submit when no required field is missing", () => {
    const html = render({ version: 2, fields: [{ id: "a", label: "A", kind: "number", required: true, reason: "r", suggested: 3, group: "G" }] });
    expect(html).not.toMatch(/<button type="submit" disabled/);
    expect(html).not.toContain("Còn trường bắt buộc chưa điền.");
  });

  it("uses AttachBox + stageInbox and no fixed width above 375px", () => {
    const src = readFileSync(new URL("../../ui/src/components/skills/SkillFormPopup.tsx", import.meta.url), "utf8");
    expect(src).toContain("AttachBox");
    expect(src).toContain("stageInbox");
    expect(src).toContain("<Modal");
    const widths = [...src.matchAll(/width:\s*["']?(\d+)(?:px)?/g)].map((m) => Number(m[1]));
    expect(widths.every((w) => w <= 375)).toBe(true);
  });

  it("every skill_form_* key exists in both vi and en", () => {
    const keys = Object.keys(dicts.vi).filter((k) => k.startsWith("skill_form_"));
    expect(keys.length).toBeGreaterThanOrEqual(10);
    for (const k of keys) expect((dicts.en as Record<string, string>)[k], k).toBeTruthy();
    for (const k of Object.keys(dicts.en).filter((x) => x.startsWith("skill_form_"))) expect((dicts.vi as Record<string, string>)[k], k).toBeTruthy();
    const src = readFileSync(new URL("../../ui/src/components/skills/SkillFormPopup.tsx", import.meta.url), "utf8");
    for (const m of src.matchAll(/t\.(skill_form_\w+)/g)) expect(keys).toContain(m[1]);
  });
});
