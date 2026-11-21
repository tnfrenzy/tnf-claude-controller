import { describe, expect, it } from "vitest";
import { ZOOM_MIN, clampPan, clampZoom, fitScale, stepZoom, zoomAt } from "../../ui/src/office/zoom.js";

describe("clampZoom", () => {
  it("clamps to range", () => {
    expect(clampZoom(0.01)).toBe(ZOOM_MIN);
    expect(clampZoom(10)).toBe(3);
    expect(clampZoom(1.7)).toBe(1.7);
  });
  it("falls back to 1 for non-finite values", () => {
    expect(clampZoom(NaN)).toBe(1);
    expect(clampZoom(Infinity)).toBe(1);
    expect(clampZoom(-Infinity)).toBe(1);
  });
});

describe("stepZoom", () => {
  it("steps up and down", () => {
    expect(stepZoom(1, 1)).toBeCloseTo(1.25);
    expect(stepZoom(1, -1)).toBeCloseTo(0.8);
  });
  it("stays within bounds", () => {
    expect(stepZoom(3, 1)).toBe(3);
    expect(stepZoom(ZOOM_MIN, -1)).toBe(ZOOM_MIN);
  });
});

describe("zoomAt", () => {
  it("keeps the world point under the anchor fixed", () => {
    const view = { scale: 1.5, pan: { x: -40, y: 25 } };
    const anchor = { x: 200, y: 120 };
    const before = { x: (anchor.x - view.pan.x) / view.scale, y: (anchor.y - view.pan.y) / view.scale };
    const out = zoomAt(view, anchor, 2.4);
    expect(out.scale).toBeCloseTo(2.4);
    expect((anchor.x - out.pan.x) / out.scale).toBeCloseTo(before.x);
    expect((anchor.y - out.pan.y) / out.scale).toBeCloseTo(before.y);
  });
  it("clamps nextScale", () => {
    const view = { scale: 1, pan: { x: 0, y: 0 } };
    expect(zoomAt(view, { x: 10, y: 10 }, 99).scale).toBe(3);
    expect(zoomAt(view, { x: 10, y: 10 }, 0.01).scale).toBe(ZOOM_MIN);
  });
  it("keeps pan when scale is unchanged", () => {
    const view = { scale: 2, pan: { x: -30, y: -12 } };
    const out = zoomAt(view, { x: 77, y: 33 }, 2);
    expect(out.pan.x).toBeCloseTo(-30);
    expect(out.pan.y).toBeCloseTo(-12);
  });
  it("uses a clamped current scale and never divides by zero", () => {
    const out = zoomAt({ scale: 0, pan: { x: 5, y: 5 } }, { x: 10, y: 10 }, 1);
    expect(Number.isFinite(out.pan.x)).toBe(true);
    expect(Number.isFinite(out.pan.y)).toBe(true);
  });
});

describe("clampPan", () => {
  const content = { w: 1000, h: 800 };
  const viewport = { w: 400, h: 300 };
  it("clamps when content is larger than the viewport", () => {
    expect(clampPan({ x: 50, y: 50 }, 1, content, viewport)).toEqual({ x: 0, y: 0 });
    expect(clampPan({ x: -9999, y: -9999 }, 1, content, viewport)).toEqual({ x: -600, y: -500 });
    expect(clampPan({ x: -100, y: -200 }, 1, content, viewport)).toEqual({ x: -100, y: -200 });
  });
  it("centers per axis when scaled content is smaller", () => {
    expect(clampPan({ x: 99, y: 99 }, 0.25, content, viewport)).toEqual({ x: 75, y: 50 });
    // x smaller, y larger
    const out = clampPan({ x: 0, y: 10 }, 0.3, { w: 1000, h: 2000 }, { w: 400, h: 300 });
    expect(out.x).toBeCloseTo(50);
    expect(out.y).toBeCloseTo(0);
  });
});

describe("fitScale", () => {
  it("uses the tighter axis", () => {
    expect(fitScale({ w: 1000, h: 500 }, { w: 500, h: 500 })).toBeCloseTo(0.5);
  });
  it("clamps to the zoom range", () => {
    expect(fitScale({ w: 10, h: 10 }, { w: 1000, h: 1000 })).toBe(3);
    expect(fitScale({ w: 10000, h: 10000 }, { w: 100, h: 100 })).toBe(ZOOM_MIN);
  });
  it("returns 1 for invalid sizes", () => {
    expect(fitScale({ w: 0, h: 10 }, { w: 100, h: 100 })).toBe(1);
    expect(fitScale({ w: 10, h: 10 }, { w: -5, h: 100 })).toBe(1);
  });
});
