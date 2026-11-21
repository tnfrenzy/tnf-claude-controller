import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

describe("App skill wiring", () => {
  const src = readFileSync("ui/src/App.tsx", "utf8");
  it("uses the skill floors hook and the add form", () => {
    expect(src).toContain("useSkillFloors");
    expect(src).toContain("AddSkillFloorForm");
    expect(src).toContain("onAddSkillFloor");
  });
  it("no longer has the old second-tower popup", () => {
    expect(src).not.toContain("tower2");
    expect(src).not.toContain("onTower2Click");
  });
  it("does not wrap CityScene in an extra .scene", () => {
    expect(src).not.toMatch(/className=["'{`][^"'}`]*\bscene\b/);
  });
});
