import { describe, expect, it } from "vitest";
import { MAX_FLOORS, canAddFloor, projectsToFloors } from "../../ui/src/office/floors.js";

const mk = (n: number) => Array.from({ length: n }, (_, i) => ({ name: `p${i}`, running: 0 }));

describe("floors", () => {
  it("empty list gives only the ground floor", () => {
    expect(projectsToFloors([])).toEqual([{ id: "default", name: "Tầng trệt", running: false }]);
    expect(canAddFloor(0)).toBe(true);
  });
  it("ground floor first, project floors cut at 5 (ground not counted)", () => {
    expect(MAX_FLOORS).toBe(5);
    const f = projectsToFloors(mk(8));
    expect(f).toHaveLength(6);
    expect(f[0]?.id).toBe("default");
    expect(f[1]?.id).toBe("p0");
  });
  it("a project named default is not duplicated", () => {
    const f = projectsToFloors([{ name: "default", running: 1 }, ...mk(2)], [{ project: "default", prompt: "hi" }]);
    expect(f.filter((x) => x.id === "default")).toHaveLength(1);
    expect(f).toHaveLength(3);
    expect(f[0]).toMatchObject({ running: true, sub: "hi" });
  });
  it("running project is marked running and shows its goal", () => {
    const f = projectsToFloors([{ name: "a", running: 1 }, { name: "b", running: 0 }], [{ project: "a", prompt: "fix   bug" }]);
    expect(f[1]).toMatchObject({ id: "a", running: true, sub: "fix bug" });
    expect(f[2]).toMatchObject({ id: "b", running: false });
    expect(f[2]?.sub).toBeUndefined();
  });
  it("canAddFloor is false at 5", () => {
    expect(canAddFloor(4)).toBe(true);
    expect(canAddFloor(5)).toBe(false);
    expect(canAddFloor(9)).toBe(false);
  });
});
