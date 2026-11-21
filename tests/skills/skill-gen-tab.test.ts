import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { AddSkillFloorForm } from "../../ui/src/pages/AddSkillFloorForm.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";

const SRC = readFileSync(new URL("../../ui/src/pages/AddSkillFloorForm.tsx", import.meta.url), "utf8");
const html = renderToStaticMarkup(
  createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, createElement(AddSkillFloorForm, { onDone: () => {} })),
);

describe("AddSkillFloorForm tabs", () => {
  it("renders two tabs with pairs selected and the old form", () => {
    expect(html).toContain('role="tablist"');
    expect(html).toContain("Tạo mới");
    expect(html).toContain("Cặp đầu vào/đầu ra");
    expect(html).toMatch(/aria-selected="true"[^>]*>Cặp đầu vào\/đầu ra|class="active"[^>]*>Cặp/);
    expect(html).toContain("<form");
    expect(html).not.toContain('id="skillg-title"');
  });
  it("source wires the tab state", () => {
    expect(SRC).toContain("GenerativeTrainForm");
    expect(SRC).toContain('className="tabs"');
    expect(SRC).toContain('useState<"pairs" | "gen">("pairs")');
  });
});
