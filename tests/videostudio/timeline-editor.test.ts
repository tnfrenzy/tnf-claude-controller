import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToString } from "react-dom/server";
import { TimelineEditor, selectionFromClip, dropIndexFromX, rangeFromDrag } from "../../ui/src/components/videostudio/TimelineEditor";
import type { VsPlan } from "../../src/core/videostudio/plan-types";

const plan: VsPlan = {
  version: 1, width: 1080, height: 1920, fps: 30,
  video: [
    { id: "a", kind: "video", asset: "clips/one.mp4", srcIn: 0, duration: 2 },
    { id: "b", kind: "card", srcIn: 0, duration: 3, cardText: "Hello" },
    { id: "c", kind: "image", asset: "img.png", srcIn: 0, duration: 4 },
  ],
  audio: [{ id: "m", asset: "music.mp3", start: 0, duration: 8, volume: 0.5, kind: "music" }],
  texts: [
    { id: "t1", text: "One", start: 0, duration: 2 },
    { id: "t2", text: "Two", start: 3, duration: 2 },
  ],
};

const count = (html: string, needle: string) => html.split(needle).length - 1;

describe("TimelineEditor static render", () => {
  it("renders one block per item", () => {
    const html = renderToString(createElement(TimelineEditor, {
      plan, time: 1, busy: false, onSeek: () => {}, onChange: () => {}, onEditSegment: () => {},
    }));
    expect(count(html, 'data-testid="vs-tl-clip"')).toBe(3);
    expect(count(html, 'data-testid="vs-tl-audio"')).toBe(1);
    expect(count(html, 'data-testid="vs-tl-text"')).toBe(2);
  });
});

describe("pure drag helpers", () => {
  it("dropIndexFromX maps drop position to index", () => {
    expect(dropIndexFromX(plan, 0, 8)).toBe(2);
    expect(dropIndexFromX(plan, 2, 0)).toBe(0);
    expect(dropIndexFromX(plan, 1, 3.5)).toBe(1);
    expect(dropIndexFromX(plan, 0, -5)).toBe(0);
  });
  it("rangeFromDrag sorts and clamps", () => {
    expect(rangeFromDrag(5, 2)).toEqual({ start: 2, end: 5 });
    expect(rangeFromDrag(-3, 2)).toEqual({ start: 0, end: 2 });
    expect(rangeFromDrag(2, 2)).toBeNull();
  });
  it("busy render has is-busy", () => {
    const html = renderToString(createElement(TimelineEditor, {
      plan, time: 0, busy: true, onSeek: () => {}, onChange: () => {}, onEditSegment: () => {},
    }));
    expect(html).toContain("is-busy");
  });
});

describe("action bar", () => {
  const render = (busy: boolean) => renderToString(createElement(TimelineEditor, {
    plan, time: 1, busy, onSeek: () => {}, onChange: () => {}, onEditSegment: () => {},
  }));
  const tag = (html: string, cls: string) => {
    const m = html.match(new RegExp("<(?:button|input)[^>]*" + cls + "[^>]*>"));
    return m ? m[0] : "";
  };
  it("has controls, enabled when not busy", () => {
    const html = render(false);
    for (const c of ["vs-tl-btn-split", "vs-tl-btn-delete", "vs-tl-btn-addtext", "vs-tl-segment-input"]) {
      expect(tag(html, c)).not.toBe("");
      expect(tag(html, c)).not.toContain("disabled");
    }
  });
  it("disables controls when busy", () => {
    const html = render(true);
    for (const c of ["vs-tl-btn-split", "vs-tl-btn-delete", "vs-tl-btn-addtext", "vs-tl-segment-input"]) {
      expect(tag(html, c)).toContain("disabled");
    }
  });
});

describe("selectionFromClip", () => {
  it("returns cumulative ranges", () => {
    expect(selectionFromClip(plan, 0)).toEqual({ start: 0, end: 2 });
    expect(selectionFromClip(plan, 1)).toEqual({ start: 2, end: 5 });
    expect(selectionFromClip(plan, 2)).toEqual({ start: 5, end: 9 });
  });
  it("returns null out of range", () => {
    expect(selectionFromClip(plan, -1)).toBeNull();
    expect(selectionFromClip(plan, 3)).toBeNull();
  });
});
