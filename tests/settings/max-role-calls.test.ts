import { describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { resolveMaxRoleCalls } from "../../src/core/run/run-manager.js";

const cfg = loadConfig();

describe("resolveMaxRoleCalls", () => {
  it("uses the effective default (>= 20) when no input is given", () => {
    expect(resolveMaxRoleCalls({}, cfg, "coding")).toBe(cfg.defaults.coding.maxRoleCalls);
    expect(cfg.defaults.coding.maxRoleCalls).toBeGreaterThanOrEqual(20);
  });
  it("accepts valid integers up to and including the ceiling", () => {
    expect(resolveMaxRoleCalls({ maxRoleCalls: 12 }, cfg, "coding")).toBe(12);
    expect(resolveMaxRoleCalls({ maxRoleCalls: 1 }, cfg, "coding")).toBe(1);
    expect(resolveMaxRoleCalls({ maxRoleCalls: 30 }, cfg, "coding")).toBe(30);
  });
  it.each([0, 1.5, "abc", NaN, -3, 31])("rejects %s with a Vietnamese message", (v) => {
    expect(() => resolveMaxRoleCalls({ maxRoleCalls: v }, cfg, "coding")).toThrow(/Số lượt gọi vai tối đa phải là số nguyên từ 1 đến 30\./);
  });
  it("honours a configured ceiling", () => {
    const c = { ...cfg, limits: { ...cfg.limits, maxRoleCallsCeiling: 40 } };
    expect(resolveMaxRoleCalls({ maxRoleCalls: 40 }, c, "coding")).toBe(40);
    expect(() => resolveMaxRoleCalls({ maxRoleCalls: 41 }, c, "coding")).toThrow(/1 đến 40/);
  });
  it("ignores the input for research runs", () => {
    expect(resolveMaxRoleCalls({ maxRoleCalls: 99 }, cfg, "research")).toBe(cfg.defaults.research.maxRoleCalls);
  });
});
