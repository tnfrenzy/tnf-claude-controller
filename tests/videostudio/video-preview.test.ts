import { describe, expect, it, vi } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { I18nContext, dicts } from "../../ui/src/i18n.js";
import { VideoPreview, previewFilterCss } from "../../ui/src/components/videostudio/VideoPreview.js";
import type { VsPlan, VsStyle } from "../../src/core/videostudio/plan-types.js";

// Note: renderToStaticMarkup does not run effects, so no asset fetching,
// video sync or rAF loop is exercised here; only the static markup.
function render(el: ReturnType<typeof createElement>): string {
  return renderToStaticMarkup(createElement(I18nContext.Provider, { value: { lang: "vi", t: dicts.vi, setLang: () => {} } }, el));
}

const plan: VsPlan = {
  version: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  video: [{ id: "c1", kind: "card", srcIn: 0, duration: 5, color: "#123456", cardText: "Xin chao" }],
  audio: [],
  texts: [{ id: "t1", text: "Phu de", start: 0, duration: 5, x: 0.5, y: 0.8 }],
};

const style: VsStyle = {
  id: "s", name: "S", builtin: false, transition: "none", transitionSec: 0, shotSec: 3,
  font: "Arial", textColor: "#ffffff", textBox: true, brightness: 0.1, contrast: 1.2, saturation: 1, visualPrompt: "",
};

describe("VideoPreview", () => {
  it("renders card, text overlay and aspect ratio", () => {
    const html = render(
      createElement(VideoPreview, { slug: "p", plan, style: null, time: 1, playing: false, onTime: () => {}, onEnded: () => {} }),
    );
    expect(html).toContain("Xin chao");
    expect(html).toContain("Phu de");
    expect(html).toContain("1920 / 1080");
    expect(html).toContain("#123456");
    expect(html).not.toContain("filter");
  });

  it("applies filter when style is given", () => {
    const html = render(
      createElement(VideoPreview, { slug: "p", plan, style, time: 1, playing: false, onTime: () => {}, onEnded: () => {} }),
    );
    expect(html).toContain("brightness(1.1)");
  });
});

const props = (p: VsPlan, time: number, st: VsStyle | null = null) =>
  createElement(VideoPreview, { slug: "p", plan: p, style: st, time, playing: false, onTime: () => {}, onEnded: () => {} });

describe("VideoPreview extra cases", () => {
  const timed: VsPlan = {
    ...plan,
    video: [{ id: "c1", kind: "card", srcIn: 0, duration: 6, color: "#123456", cardText: "X" }],
    texts: [
      { id: "ta", text: "AAA", start: 0, duration: 2, x: 0.5, y: 0.8 },
      { id: "tb", text: "BBB", start: 4, duration: 2, x: 0.5, y: 0.8 },
    ],
  };

  it("shows text according to time", () => {
    expect(render(props(timed, 1))).toContain("AAA");
    const h2 = render(props(timed, 2));
    expect(h2).not.toContain("AAA");
    expect(h2).not.toContain("BBB");
    expect(render(props(timed, 5))).toContain("BBB");
  });

  it("does not call the network for a card-only plan (static render check)", async () => {
    const { api } = await import("../../ui/src/api.js");
    const spy = vi.spyOn(api, "videoStudioFile");
    render(props(plan, 1));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("shows the prompt for a prompt-only clip", () => {
    const p: VsPlan = {
      ...plan,
      video: [{ id: "c2", kind: "video", srcIn: 0, duration: 5, prompt: "Canh bien luc hoang hon" }],
      texts: [],
    };
    expect(render(props(p, 1))).toContain("Canh bien luc hoang hon");
  });

  it("never emits NaN in the filter", () => {
    const bad = { ...style, brightness: NaN, contrast: Number.NaN, saturation: undefined as unknown as number };
    expect(previewFilterCss(bad)).not.toContain("NaN");
    expect(render(props(plan, 1, bad))).not.toContain("NaN");
  });
});

describe("previewFilterCss", () => {
  it("returns none for null or neutral style", () => {
    expect(previewFilterCss(null)).toBe("none");
    expect(previewFilterCss({ ...style, brightness: 0, contrast: 1, saturation: 1 })).toBe("none");
  });
  it("maps brightness/contrast/saturation", () => {
    expect(previewFilterCss({ ...style, brightness: 0.1, contrast: 1.2, saturation: 0.5 })).toBe(
      "brightness(1.1) contrast(1.2) saturate(0.5)",
    );
  });
});
