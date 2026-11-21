import { describe, expect, it } from "vitest";
import { skillActions, validateGrade } from "../../ui/src/skills/skillActions.js";

const states = ["idle", "composing", "trial", "grading", "passed", "awaiting_approval", "failed_max_rounds", "stalled", "cost_cap", "stopped"];

describe("human grading", () => {
  it("validateGrade", () => {
    expect(validateGrade(100, "")).toBeNull();
    expect(validateGrade("80", "")).not.toBeNull();
    expect(validateGrade("80", "tốt")).toBeNull();
    expect(validateGrade(101, "x")).not.toBeNull();
  });
  it("awaiting_score: grade primary, no train/resume", () => {
    const a = skillActions("awaiting_score", false, true);
    expect(a.grade).toBe(true);
    expect(a.trainMore).toBe(false);
    expect(a.resume).toBe(false);
  });
});

describe("skillActions", () => {
  it("stop only while running and not paused", () => {
    for (const s of states) {
      for (const paused of [false, true]) {
        const running = ["composing", "trial", "grading"].includes(s);
        expect(skillActions(s, paused, true).stop).toBe(running && !paused);
      }
    }
  });
  it("resume when paused or resumable state (incl. failed_max_rounds)", () => {
    for (const s of ["stalled", "cost_cap", "stopped", "failed_max_rounds"]) expect(skillActions(s, false, true).resume).toBe(true);
    expect(skillActions("trial", true, true).resume).toBe(true);
    for (const s of ["idle", "trial", "passed", "awaiting_approval"]) expect(skillActions(s, false, true).resume).toBe(false);
  });
  it("trainMore only when not running", () => {
    for (const s of ["idle", "passed", "failed_max_rounds", "stopped", "stalled", "cost_cap"]) expect(skillActions(s, false, true).trainMore).toBe(true);
    for (const s of ["composing", "trial", "grading", "awaiting_approval"]) expect(skillActions(s, false, true).trainMore).toBe(false);
  });
  it("approve only awaiting_approval or passed", () => {
    for (const s of states) expect(skillActions(s, false, true).approve).toBe(s === "awaiting_approval" || s === "passed");
  });
  it("zip needs rounds or passed", () => {
    expect(skillActions("idle", false, false).zip).toBe(false);
    expect(skillActions("idle", false, true).zip).toBe(true);
    expect(skillActions("passed", false, false).zip).toBe(true);
  });
  it("restoreBest needs rounds and not running; allowed when paused", () => {
    expect(skillActions("trial", false, true).restoreBest).toBe(false);
    expect(skillActions("trial", true, true).restoreBest).toBe(true);
    expect(skillActions("stopped", false, false).restoreBest).toBe(false);
    expect(skillActions("stopped", false, true).restoreBest).toBe(true);
  });
  it("awaiting_user opens form", () => {
    expect(skillActions("awaiting_user", false, false).openForm).toBe(true);
    expect(skillActions("idle", false, false).openForm).toBe(false);
  });
  it("unknown state enables nothing dangerous", () => {
    const a = skillActions("weird", false, true);
    expect(a).toEqual({ grade: false, trainMore: false, stop: false, resume: false, approve: false, zip: true, restoreBest: false, openForm: false, delete: true });
  });
  it("delete locked only while running and not paused", () => {
    for (const s of ["composing", "trial", "grading"]) {
      expect(skillActions(s, false, true).delete).toBe(false);
      expect(skillActions(s, true, true).delete).toBe(true);
    }
    for (const s of [...states.filter((x) => !["composing", "trial", "grading"].includes(x)), "awaiting_score", "awaiting_user"]) {
      expect(skillActions(s, false, true).delete).toBe(true);
    }
  });
});
