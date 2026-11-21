import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { CityScene } from "../../ui/src/office/CityScene.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";

// Regression: the scene SVG is absolutely positioned inside `.scene`, so `.scene` must be the
// grid cell itself. A second `.scene` wrapper collapses the inner one to the hint's height
// (36 px) and the towers vanish on wide screens.
describe("city scene shell", () => {
  it("CityScene renders main.scene as its root with the city svg inside", () => {
    const html = renderToStaticMarkup(
      createElement(
        I18nContext.Provider,
        { value: { lang: "vi", t: dicts.vi, setLang: () => {} } },
        createElement(CityScene, { towers: ["TNF Tower", "Tower 2"], floors: [{ id: "default", name: "default", running: false }] }),
      ),
    );
    expect(html.startsWith('<main class="scene">')).toBe(true);
    expect(html).toContain('<svg class="city"');
  });

  it("App renders CityScene directly without a .scene wrapper", () => {
    const src = readFileSync(new URL("../../ui/src/App.tsx", import.meta.url), "utf8");
    expect(src).toContain('import { CityScene }');
    expect(src).toContain("<CityScene");
    expect(src).not.toMatch(/className="scene"[^]*?<(CityScene|OfficeStage)/);
  });

  it("training tower keeps a single main.scene root", () => {
    const html = renderToStaticMarkup(
      createElement(CityScene, { towers: ["TNF Tower", "Huấn luyện AI"], floors: [], skillFloors: [{ id: "a", name: "a", state: "trial", badge: "training", score: 80, running: true }] }),
    );
    expect(html.match(/class="scene"/g)).toHaveLength(1);
    expect(html).toContain("Đang huấn luyện");
  });

  it("OfficeStage root is main.scene", () => {
    const src = readFileSync(new URL("../../ui/src/office/OfficeStage.tsx", import.meta.url), "utf8");
    expect(src).toMatch(/<main className="scene office-stage">/);
  });
});
