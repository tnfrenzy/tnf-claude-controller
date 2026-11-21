import { describe, expect, it } from "vitest";
import { fitView, panBy, pinchView, wheelView, zoomCenter } from "../../ui/src/office/viewport.js";
import { ZOOM_MAX, ZOOM_MIN, clampPan, fitScale } from "../../ui/src/office/zoom.js";

const content = { w: 800, h: 600 };
const vp = { w: 400, h: 300 };

describe("viewport helpers", () => {
  it("fitView uses fitScale and centers within bounds", () => {
    const v = fitView(content, vp);
    expect(v.scale).toBe(fitScale(content, vp));
    expect(v.pan).toEqual(clampPan(v.pan, v.scale, content, vp));
    expect(v.pan.x).toBeCloseTo(0);
  });

  it("zoomCenter in then out returns near the old scale and stays clamped", () => {
    const start = { scale: 1, pan: { x: -100, y: -80 } };
    const back = zoomCenter(zoomCenter(start, 1, content, vp), -1, content, vp);
    expect(back.scale).toBeCloseTo(1);
    let v = start;
    for (let i = 0; i < 30; i++) v = zoomCenter(v, 1, content, vp);
    expect(v.scale).toBe(ZOOM_MAX);
    for (let i = 0; i < 60; i++) v = zoomCenter(v, -1, content, vp);
    expect(v.scale).toBe(ZOOM_MIN);
  });

  it("panBy never leaves clampPan bounds", () => {
    const v = panBy({ scale: 2, pan: { x: 0, y: 0 } }, 5000, 5000, content, vp);
    expect(v.pan).toEqual(clampPan(v.pan, 2, content, vp));
    const w = panBy({ scale: 2, pan: { x: 0, y: 0 } }, -5000, -5000, content, vp);
    expect(w.pan.x).toBe(vp.w - content.w * 2);
    expect(w.pan.y).toBe(vp.h - content.h * 2);
  });

  it("pinchView grows scale with distance and follows the finger midpoint", () => {
    const start = { scale: 1, pan: { x: 0, y: 0 } };
    const c = { x: 200, y: 150 };
    expect(pinchView(start, 100, 150, c, content, vp).scale).toBeCloseTo(1.5);
    expect(pinchView(start, 100, 60, c, content, vp).scale).toBeLessThan(1);
    const still = pinchView(start, 100, 100, c, content, vp, c);
    const moved = pinchView(start, 100, 100, { x: 180, y: 150 }, content, vp, c);
    expect(moved.pan.x).toBeCloseTo(still.pan.x - 20);
  });

  it("wheelView zooms in on negative delta at the pointer", () => {
    const start = { scale: 1, pan: { x: 0, y: 0 } };
    expect(wheelView(start, -100, { x: 100, y: 100 }, content, vp).scale).toBeGreaterThan(1);
    expect(wheelView(start, 100, { x: 100, y: 100 }, content, vp).scale).toBeLessThan(1);
  });
});
