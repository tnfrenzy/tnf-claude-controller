import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { InfoPanel, ParamsPanel, PartsPanel, RenderGallery } from "../../ui/src/components/workshop3d/Panels.js";
import { dicts, I18nContext } from "../../ui/src/i18n.js";
import type { W3DApi, W3DSnapshotView } from "../../ui/src/components/workshop3d/types.js";

const wrap = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, el));
const snap = (state: W3DSnapshotView["state"], extra: Partial<W3DSnapshotView> = {}): W3DSnapshotView =>
  ({ state, round: 1, fixRounds: 0, costUsd: 0, note: null, error: null, questions: [], issues: [], ...extra });
const api: W3DApi = { detail: () => Promise.reject(new Error("x")), file: () => Promise.reject(new Error("x")), rebuild: () => Promise.resolve() };

describe("workshop3d viewer panels (SSR)", () => {
  it("info panel shows faces, size, box in mm and materials", () => {
    const html = wrap(createElement(InfoPanel, {
      info: { triangles: 1084, materials: ["inox", "kính"], nodes: [], bytes: 66968 },
      size: { x: 1.15, y: 2.4, z: 1.525 }, bytes: 66968,
    }));
    expect(html).toContain("1150 × 1525 × 2400 mm");
    expect(html).toContain("65,4 KB");
    expect(html).toContain("inox");
    expect(html).toContain("kính");
  });
  it("info panel without data shows dashes", () => {
    expect(wrap(createElement(InfoPanel, { info: null, size: null, bytes: null }))).toContain("—");
  });
  it("parts panel: checkbox checked unless hidden", () => {
    const html = wrap(createElement(PartsPanel, { nodes: ["floor", "ceiling"], hidden: new Set(["ceiling"]), onToggle: () => {}, onAll: () => {} }));
    expect(html).toMatch(/checked=""[^>]*\/> floor|checked="" \/> floor/);
    expect(html).not.toMatch(/checked="" \/> ceiling/);
  });
  it("parts panel empty message", () => {
    expect(wrap(createElement(PartsPanel, { nodes: [], hidden: new Set(), onToggle: () => {}, onAll: () => {} }))).toContain(dicts.vi.w3v_parts_none);
  });
  it("params panel: rebuild disabled with no change, busy state shows spinner and disables inputs", () => {
    const idle = wrap(createElement(ParamsPanel, { params: { width_mm: 1400, material: "inox" }, snapshot: snap("done"), onRebuild: () => {}, error: null }));
    expect(idle).toContain("width_mm (mm)");
    expect(idle).toMatch(/<button[^>]*disabled=""[^>]*>Dựng lại/);
    const busy = wrap(createElement(ParamsPanel, { params: { width_mm: 1400 }, snapshot: snap("building", { note: "đang chạy" }), onRebuild: () => {}, error: null }));
    expect(busy).toContain("w3v-spin");
    expect(busy).toContain(dicts.vi.w3v_state_building);
    expect(busy).toMatch(/<input[^>]*disabled=""/);
  });
  it("gallery empty message and loading placeholders", () => {
    expect(wrap(createElement(RenderGallery, { api, renders: [], rev: 0 }))).toContain(dicts.vi.w3v_renders_none);
    const html = wrap(createElement(RenderGallery, { api, renders: ["renders/front.png", "renders/iso_left.png"], rev: 0 }));
    expect(html).toContain("front");
    expect(html).toContain("iso left");
  });
});
