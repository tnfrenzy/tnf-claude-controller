import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { GymRoom } from "../../ui/src/components/office/GymRoom.js";
import { SkillFloorView } from "../../ui/src/components/skills/SkillFloorPopup.js";
import { I18nContext, dicts } from "../../ui/src/i18n.js";

const wrap = (el: ReturnType<typeof createElement>) =>
  renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, el));

describe("GymRoom in the built popup", () => {
  it.each(["idle", "awaiting_user", "composing", "trial", "grading", "stopped", "awaiting_approval", "weird_state"])("state %s draws the room, equipment and all seven characters", (state) => {
    const h = wrap(createElement(GymRoom, { state, title: "Viết bài SEO", round: 1, best: 4.5 }));
    expect(h).toContain("iso-gym");
    expect(h).not.toContain("NaN");
    expect((h.match(/class="p[ "]/g) ?? []).length).toBeGreaterThanOrEqual(7);
    expect(h).toContain("Viết bài SEO");
  });

  it("library avatar suit wins over the GYM_* fallback look", () => {
    const store: Record<string, string> = {};
    vi.stubGlobal("localStorage", {
      getItem: (k: string) => store[k] ?? null,
      setItem: (k: string, v: string) => { store[k] = v; },
      removeItem: (k: string) => { delete store[k]; },
    });
    try {
      const h0 = wrap(createElement(GymRoom, { state: "trial", title: "x" }));
      expect(h0).toContain("#14b8a6");
      expect(h0).not.toContain("#e8e8ee");
      store["tnf.avatars"] = '{"skill":"astronaut"}';
      const h1 = wrap(createElement(GymRoom, { state: "trial", title: "x" }));
      expect(h1).toContain("#e8e8ee");
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it("puts the action buttons right under the gym, before the chart and round list", () => {
    const h = wrap(createElement(SkillFloorView, { slug: "s", state: "composing", paused: false, rounds: [{ n: 1, score: 5, errors: [], costUsdEstimate: 0.1 }], costUsdEstimate: 0.1 }));
    const gym = h.indexOf("gym-room");
    const actions = h.indexOf("skill-actions");
    expect(gym).toBeGreaterThanOrEqual(0);
    expect(actions).toBeGreaterThan(gym);
    expect(actions).toBeLessThan(h.indexOf("skill-pass-line"));
  });

  it("css keeps the gym at least 360 px tall on wide screens", () => {
    const css = readFileSync("ui/src/office/city.css", "utf8");
    expect(css).toMatch(/\.gym-room \.iso-gym \{ min-height: 360px; \}/);
    expect(css).toContain("max-height: max(360px, 72vh)");
  });
});
