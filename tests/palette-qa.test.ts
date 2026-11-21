import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { buildPaletteItems, filterPaletteItems, foldText } from "../ui/src/palette";
import { isPaletteKey } from "../ui/src/shortcuts";
import { CommandPalette } from "../ui/src/components/CommandPalette";
import { I18nContext, dicts } from "../ui/src/i18n";
import { fold } from "../src/core/app/util";

const t = dicts.vi;

describe("palette QA edge cases", () => {
  it("many projects filter quickly", () => {
    const projects = Array.from({ length: 1000 }, (_, i) => ({ name: `du-an-${i}` }));
    const start = Date.now();
    const items = buildPaletteItems({ data: { projects } as never, t });
    const hit = filterPaletteItems(items, "du an");
    expect(hit.length).toBe(1000);
    expect(filterPaletteItems(items, "du-an-99").length).toBeGreaterThan(0);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it("matches without diacritics, including uppercase D-stroke, like fold()", () => {
    const name = "Đang chạy dịch vụ";
    const items = buildPaletteItems({ data: { projects: [{ name }] } as never, t });
    expect(filterPaletteItems(items, "dang chay").map((i) => i.id)).toContain(`env:${name}`);
    expect(filterPaletteItems(items, "ĐANG CHẠY").map((i) => i.id)).toContain(`env:${name}`);
    for (const s of ["Đang chạy", "ĐÃ XONG", "Việt Nam đẹp", "plain"]) expect(foldText(s)).toBe(fold(s));
  });

  it("renders script/img project names as escaped text", () => {
    const data = { projects: [{ name: "<script>alert(1)</script>" }, { name: "<img src=x onerror=1>" }] } as never;
    const html = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { lang: "vi", t, setLang: () => {} } },
        createElement(CommandPalette, { open: true, onClose: () => {}, onAction: () => {}, initialData: data }),
      ),
    );
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
  });

  it("isPaletteKey ignores Ctrl+Shift+K and composing input", () => {
    const base = { key: "k", ctrlKey: true, metaKey: false, altKey: false };
    expect(isPaletteKey(base)).toBe(true);
    expect(isPaletteKey({ ...base, key: "K", shiftKey: true })).toBe(false);
    expect(isPaletteKey({ ...base, isComposing: true })).toBe(false);
  });

  it("palette sources have no fetch( or dangerouslySetInnerHTML", () => {
    const root = path.resolve(__dirname, "..");
    for (const f of ["ui/src/palette.ts", "ui/src/paletteData.ts", "ui/src/paletteActions.ts", "ui/src/components/CommandPalette.tsx"]) {
      const src = readFileSync(path.join(root, f), "utf8");
      expect(src, f).not.toContain("fetch(");
      expect(src, f).not.toContain("dangerouslySetInnerHTML");
    }
  });
});
