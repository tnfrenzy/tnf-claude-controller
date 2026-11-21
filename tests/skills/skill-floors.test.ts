import { describe, it, expect } from "vitest";
import { skillsToFloors, skillBadge, canAddSkillFloor, projectsToFloors, canAddFloor, MAX_SKILL_FLOORS } from "../../ui/src/office/floors";

describe("skillBadge", () => {
  it("maps states", () => {
    for (const s of ["interviewing", "composing", "trial", "grading"]) expect(skillBadge(s)).toBe("training");
    expect(skillBadge("awaiting_user")).toBe("waiting");
    expect(skillBadge("passed")).toBe("passed");
    expect(skillBadge("awaiting_approval")).toBe("passed");
    for (const s of ["failed_max_rounds", "stalled", "cost_cap", "stopped"]) expect(skillBadge(s)).toBe("failed");
    expect(skillBadge("idle")).toBe("idle");
    expect(skillBadge("weird")).toBe("idle");
  });
});

describe("skillsToFloors", () => {
  it("drops broken, maps fields", () => {
    const f = skillsToFloors([
      { slug: "a", title: "Alpha", state: "trial", bestScore: 72 },
      { slug: "bad", broken: true },
      { slug: "b", title: "Beta", state: "idle", bestScore: 0 }
    ]);
    expect(f.map((x) => x.id)).toEqual(["a", "b"]);
    expect(f[0]).toMatchObject({ name: "Alpha", badge: "training", running: true, score: 72 });
    expect(f[1]).toMatchObject({ badge: "idle", running: false, score: null });
  });
  it("null score, unknown state, pending approval", () => {
    const f = skillsToFloors([
      { slug: "x", title: "X", state: "zzz", bestScore: null },
      { slug: "y", title: "Y", state: "awaiting_approval", bestScore: 95 }
    ]);
    expect(f[0]).toMatchObject({ badge: "idle", score: null });
    expect(f[1]).toMatchObject({ badge: "passed", sub: "chờ duyệt" });
  });
  it("caps at 5", () => {
    const many = Array.from({ length: 8 }, (_, i) => ({ slug: `s${i}`, title: `S${i}`, state: "idle" }));
    expect(skillsToFloors(many)).toHaveLength(MAX_SKILL_FLOORS);
  });
});

describe("canAddSkillFloor and old helpers", () => {
  it("limits", () => {
    expect(canAddSkillFloor(4)).toBe(true);
    expect(canAddSkillFloor(5)).toBe(false);
    expect(canAddFloor(4)).toBe(true);
    expect(projectsToFloors([])[0]?.id).toBe("default");
  });
});
