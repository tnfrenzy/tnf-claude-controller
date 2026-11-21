import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { LeftPanel } from "../../ui/src/components/LeftPanel.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";

function panel(view: "city" | "office"): string {
  return renderToStaticMarkup(
    createElement(
      I18nContext.Provider,
      { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
      createElement(LeftPanel, { status: null, statusErr: null, towerName: "TNF Tower", env: "", pickEnv: () => {}, onOpen: () => {}, view, onToggleView: () => {} }),
    ),
  );
}

describe("app main view", () => {
  it("LeftPanel toggle label follows the view", () => {
    expect(panel("city")).toContain("Xem văn phòng");
    expect(panel("office")).toContain("Xem toàn cảnh");
    expect(panel("city")).toContain('aria-label="Xem văn phòng"');
  });

  it("nav is three icon buttons (history, view, settings) with title and aria-label, no library entry", () => {
    const html = panel("city");
    const nav = html.slice(html.indexOf('<nav class="nav">'), html.indexOf("</nav>"));
    expect(nav.match(/<button/g)?.length).toBe(3);
    expect(nav.match(/title="/g)?.length).toBe(3);
    expect(nav.match(/aria-label="/g)?.length).toBe(3);
    expect(nav).not.toContain("▶");
    expect(nav).not.toContain("⌘");
    expect(nav).not.toContain("Thư viện");
    const src = readFileSync(new URL("../../ui/src/components/LeftPanel.tsx", import.meta.url), "utf8");
    expect(src).not.toContain('onOpen("library")');
  });

  it("App wires the city scene, floor popup and view pref", () => {
    const src = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
    for (const s of ["PREF_VIEW", 'size="large"', "floorTitle", "onAddSkillFloor"]) expect(src).toContain(s);
    expect(src).not.toContain('<div className="scene"');
  });

  it("clicking a floor switches to the office view instead of a popup", () => {
    const src = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
    const start = src.indexOf("onFloorClick");
    const block = src.slice(start, src.indexOf("onAddFloor", start));
    expect(block).toContain("pickEnv(id)");
    expect(block).toContain('view: "office"');
    expect(block).not.toContain('onOpen("floor"');
  });
});
