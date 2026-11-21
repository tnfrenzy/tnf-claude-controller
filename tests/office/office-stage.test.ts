import { describe, expect, it } from "vitest";
import { latestDoneCodingRun, pickStageFloor } from "../../ui/src/office/stage.js";
import { MAX_FLOORS, projectsToFloors } from "../../ui/src/office/floors.js";

describe("pickStageFloor", () => {
  const floors = [{ name: "default" }, { name: "a" }, { name: "b" }];
  it("keeps the saved floor when it exists", () => {
    expect(pickStageFloor(floors, "b")).toBe("b");
  });
  it("empty saved means default", () => {
    expect(pickStageFloor(floors, "")).toBe("default");
  });
  it("falls back to the first floor when the saved one is gone", () => {
    expect(pickStageFloor([{ name: "a" }, { name: "b" }], "zzz")).toBe("a");
  });
  it("returns default when there are no floors", () => {
    expect(pickStageFloor([], "x")).toBe("default");
  });
  it("the ground floor is picked by its project id, not by its display name", () => {
    const real = projectsToFloors([{ name: "a", repo_path: null, running: 0 } as never]);
    expect(real[0]!.name).not.toBe("default");
    expect(pickStageFloor(real, "")).toBe("default");
    expect(pickStageFloor(real, "default")).toBe("default");
    expect(pickStageFloor(real, "a")).toBe("a");
  });
});

describe("floors cap", () => {
  it("projectsToFloors still cuts at MAX_FLOORS", () => {
    const ps = Array.from({ length: 8 }, (_, i) => ({ name: `p${i}`, running: 0 }));
    expect(MAX_FLOORS).toBe(5);
    expect(projectsToFloors(ps)).toHaveLength(MAX_FLOORS + 1); // + ground floor
  });
});

describe("latestDoneCodingRun", () => {
  it("picks the newest finished coding run", () => {
    expect(
      latestDoneCodingRun([
        { id: "r1", kind: "coding", status: "done", created_at: 1 },
        { id: "r2", kind: "coding", status: "done", created_at: 5 },
        { id: "r3", kind: "research", status: "done", created_at: 9 },
        { id: "r4", kind: "coding", status: "error", created_at: 10 },
      ]),
    ).toBe("r2");
    expect(latestDoneCodingRun([])).toBeNull();
  });
});
