import { describe, expect, it } from "vitest";
import { parseAutoResume } from "../../src/core/app/config";

const DEFAULTS = { enabled: true, maxAttempts: 3, delaySec: 15, quotaEnabled: true, quotaMarginSec: 60, quotaFallbackMin: 60 };

describe("parseAutoResume quota keys", () => {
  it("defaults", () => {
    expect(parseAutoResume(undefined)).toEqual(DEFAULTS);
    expect(parseAutoResume({})).toEqual(DEFAULTS);
  });

  it("explicit values", () => {
    expect(parseAutoResume({ quotaEnabled: false }).quotaEnabled).toBe(false);
    expect(parseAutoResume({ quotaEnabled: true }).quotaEnabled).toBe(true);
    const r = parseAutoResume({ enabled: false });
    expect(r.enabled).toBe(false);
    expect(r.quotaEnabled).toBe(true);
  });

  it("clamps", () => {
    const m = (v: number) => parseAutoResume({ quotaMarginSec: v }).quotaMarginSec;
    expect(m(-5)).toBe(0);
    expect(m(-0.5)).toBe(0);
    expect(m(99999)).toBe(1800);
    expect(m(12.9)).toBe(12);
    const f = (v: number) => parseAutoResume({ quotaFallbackMin: v }).quotaFallbackMin;
    expect(f(1)).toBe(5);
    expect(f(0)).toBe(5);
    expect(f(99999)).toBe(600);
    expect(f(90)).toBe(90);
  });

  it("bad types fall back to defaults without throwing", () => {
    for (const v of ["no", 0, null]) expect(parseAutoResume({ quotaEnabled: v }).quotaEnabled).toBe(true);
    for (const v of ["30", NaN, Infinity, null]) expect(parseAutoResume({ quotaMarginSec: v }).quotaMarginSec).toBe(60);
    for (const v of ["10", NaN, {}]) expect(parseAutoResume({ quotaFallbackMin: v }).quotaFallbackMin).toBe(60);
    for (const raw of ["str", [], null]) expect(parseAutoResume(raw)).toEqual(DEFAULTS);
  });

  it("keeps maxAttempts and delaySec clamping", () => {
    const r = parseAutoResume({ maxAttempts: 99, delaySec: -1 });
    expect(r.maxAttempts).toBe(10);
    expect(r.delaySec).toBe(0);
  });
});
