import { describe, expect, it } from "vitest";
import { FIT_MAX_BOOST, FIT_MAX_STEP, FIT_MIN_BOOST, fitViewsFromDelta, planExposureBoosts, stopsForDelta } from "../../src/core/workshop3d/exposure-fit.js";

describe("exposure fit", () => {
  it("brightens a dark view in proportion, damped and limited per pass", () => {
    const b = planExposureBoosts([{ view: "door", dL: -13 }, { view: "wall", dL: -37 }]);
    expect(b["door"]).toBeGreaterThan(0.3);
    expect(b["door"]).toBeLessThan(1);
    expect(b["wall"]).toBe(FIT_MAX_STEP);
    expect(b["wall"]).toBeGreaterThan(b["door"]!);
  });
  it("leaves views inside the band alone", () => {
    expect(planExposureBoosts([{ view: "a", dL: -5 }, { view: "b", dL: 8 }, { view: "c", dL: 0 }])).toEqual({});
  });
  it("never goes over the total cap, accumulating passes", () => {
    const first = planExposureBoosts([{ view: "a", dL: -40 }]);
    const second = planExposureBoosts([{ view: "a", dL: -40 }], first);
    expect(second["a"]).toBe(FIT_MAX_BOOST);
    expect(planExposureBoosts([{ view: "a", dL: -40 }], { a: FIT_MAX_BOOST })).toEqual({});
  });
  it("does not brighten an image that is already clipping", () => {
    expect(planExposureBoosts([{ view: "a", dL: -30, clip: 0.2 }])).toEqual({});
  });
  it("darkens a too bright view but not under the floor", () => {
    const b = planExposureBoosts([{ view: "a", dL: 25 }]);
    expect(b["a"]).toBeLessThan(0);
    expect(b["a"]).toBeGreaterThanOrEqual(FIT_MIN_BOOST);
    expect(planExposureBoosts([{ view: "a", dL: 25 }], { a: FIT_MIN_BOOST })).toEqual({});
  });
  it("ignores non finite numbers and skips steps under 0.1 stop", () => {
    expect(planExposureBoosts([{ view: "a", dL: Number.NaN }])).toEqual({});
    expect(stopsForDelta(-1)).toBeLessThan(0.2);
  });
  it("reads whole-image rows of color-delta.json", () => {
    const d = { views: [{ view: "door", regions: { toan_anh: { dL: -13.2, clip: 0.01 }, san: { dL: -40 } } }, { view: "x", regions: {} }, { view: 5, regions: { toan_anh: { dL: 1 } } }] };
    expect(fitViewsFromDelta(d)).toEqual([{ view: "door", dL: -13.2, clip: 0.01 }]);
    expect(fitViewsFromDelta(null)).toEqual([]);
  });
});
