import { describe, expect, it } from "vitest";
import { buildSkillChart } from "../../ui/src/skills/skillChart.js";

const o = { width: 300, height: 100 };

describe("buildSkillChart", () => {
  it("empty", () => {
    const c = buildSkillChart([], o);
    expect(c.empty).toBe(true);
    expect(c.bestRound).toBeNull();
    expect(c.polyline).toBe("");
  });
  it("skips rounds without score", () => {
    const c = buildSkillChart([{ n: 1 }, { n: 2, score: 50 }], o);
    expect(c.points).toHaveLength(1);
    expect(buildSkillChart([{ n: 1 }], o).empty).toBe(true);
  });
  it("single point is centered", () => {
    const c = buildSkillChart([{ n: 1, score: 40 }], o);
    expect(c.points[0]!.x).toBe(150);
    expect(Number.isFinite(c.points[0]!.y)).toBe(true);
  });
  it("many points: x increasing, y inverted", () => {
    const c = buildSkillChart([{ n: 1, score: 30 }, { n: 2, score: 60 }, { n: 3, score: 95 }], o);
    const [a, b, d] = c.points;
    expect(a!.x).toBeLessThan(b!.x);
    expect(b!.x).toBeLessThan(d!.x);
    expect(a!.y).toBeGreaterThan(b!.y);
    expect(b!.y).toBeGreaterThan(d!.y);
    expect(c.polyline.split(" ")).toHaveLength(3);
  });
  it("pass line at 90", () => {
    const c = buildSkillChart([{ n: 1, score: 90 }], o);
    expect(c.passY).toBeCloseTo(c.points[0]!.y, 5);
    expect(buildSkillChart([], o).passY).toBeGreaterThan(0);
  });
  it("best ties pick earliest round", () => {
    const c = buildSkillChart([{ n: 1, score: 70 }, { n: 2, score: 85 }, { n: 3, score: 85 }], o);
    expect(c.bestRound).toBe(2);
    expect(c.bestScore).toBe(85);
  });
  it("all coords inside frame", () => {
    const c = buildSkillChart([{ n: 1, score: 0 }, { n: 2, score: 100 }, { n: 3, score: 150 }], o);
    for (const p of [...c.points, { x: 0, y: c.passY }]) {
      expect(p.x).toBeGreaterThanOrEqual(0);
      expect(p.x).toBeLessThanOrEqual(300);
      expect(p.y).toBeGreaterThanOrEqual(0);
      expect(p.y).toBeLessThanOrEqual(100);
    }
  });
});
