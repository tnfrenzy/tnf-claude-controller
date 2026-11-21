import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { GymRoom } from "../../ui/src/components/office/GymRoom";
import { dicts } from "../../ui/src/i18n";
import { GYM_PERSON_SCALE, GYM_TRAINER_IDS, gymBusy, gymExercise, gymFreeChoices, gymPhase, gymScene, scorePercent } from "../../ui/src/office/gym";

describe("gym phases", () => {
  it("maps skill workshop and generative states", () => {
    expect(gymPhase("composing")).toBe("compose");
    expect(gymPhase("trial")).toBe("trial");
    expect(gymPhase("grading")).toBe("grade");
    expect(gymPhase("awaiting_user")).toBe("interview");
    expect(gymPhase("awaiting_score")).toBe("await_human");
    expect(gymScene("await_human").speaking).not.toContain("cham-diem");
    expect(gymPhase("generating")).toBe("samples");
    expect(gymPhase("passed")).toBe("passed");
    expect(gymPhase("completed")).toBe("passed");
    expect(gymPhase("stopped")).toBe("rest");
    expect(gymPhase("composing", true)).toBe("rest");
    expect(gymPhase("whatever")).toBe("idle");
    expect(gymPhase(null)).toBe("idle");
  });
  it("each working phase has an exercise and speaking trainers; passed cheers", () => {
    expect(gymScene("compose")).toMatchObject({ exercise: "dumbbell", skillAct: "walking" });
    expect(gymScene("trial").exercise).toBe("bench");
    expect(gymScene("grade").speaking).toEqual(["cham-diem", "phan-bien"]);
    expect(gymScene("passed")).toMatchObject({ cheering: true, skillAct: "happy" });
    expect(gymBusy("trial")).toBe(true);
    expect(gymBusy("rest")).toBe(false);
  });
  it("the discipline follows the phase and changes between rounds", () => {
    expect(gymExercise("compose", 0)).toBe("dumbbell");
    expect(gymExercise("compose", 1)).toBe("cable");
    expect(gymExercise("samples", 0)).toBe("treadmill");
    expect(gymExercise("samples", 1)).toBe("bike");
    expect(gymExercise("trial", 1)).toBe("pullup");
    expect(gymExercise("grade", 7)).toBe("bag");
    expect(gymExercise("passed", 3)).toBe("mat");
    expect(gymExercise("trial", Number.NaN)).toBe("bench");
    expect(gymScene("samples", 1).exercise).toBe("bike");
  });
  it("free time choices differ for the skill and the trainers", () => {
    expect(gymFreeChoices("rest", false)).toContain("sit");
    expect(gymFreeChoices("idle", false)).toContain("stretch");
    expect(gymFreeChoices("trial", true)).toContain("watch");
    expect(gymFreeChoices("trial", true)).toContain("board");
    expect(gymFreeChoices("passed", true)).toEqual(["cheer"]);
    for (const p of ["idle", "interview", "compose", "trial", "grade", "await_human", "samples", "passed", "rest"] as const) {
      expect(gymFreeChoices(p, false).length).toBeGreaterThan(0);
      expect(gymFreeChoices(p, true).length).toBeGreaterThan(0);
    }
  });
  it("score percent is clamped", () => {
    expect(scorePercent(null)).toBe(0);
    expect(scorePercent(140)).toBe(100);
    expect(scorePercent(72.4)).toBe(72);
  });
});

describe("GYM_PERSON_SCALE", () => {
  it("is 0.9", () => {
    expect(GYM_PERSON_SCALE).toBe(0.9);
  });
});

describe("GymRoom", () => {
  it("renders the room, the skill and all six trainers with Vietnamese labels", () => {
    const html = renderToStaticMarkup(createElement(GymRoom, { state: "grading", title: "Viết bài SEO", round: 2, maxRounds: 5, best: 76 }));
    expect(html).toContain("iso-gym");
    expect(html).toContain(dicts.vi.gym_phase_grade);
    expect(html).toContain(dicts.vi.gym_ex_bag);
    for (const id of GYM_TRAINER_IDS) expect(html).toContain(dicts.vi[`gym_role_${id}` as keyof typeof dicts.vi]);
    expect(html).toContain('aria-valuenow="76"');
  });
  it("draws the machines, the board and seven people (skill and six trainers)", () => {
    const html = renderToStaticMarkup(createElement(GymRoom, { state: "trial", title: "Viết bài SEO", round: 1, maxRounds: 5, best: 60 }));
    for (const m of ["treadmillA", "treadmillB", "cable", "bench", "pullup", "bag", "bikeA", "bikeB", "dumbbells", "lockers", "cooler", "restBench"]) expect(html).toContain(`data-equip="${m}"`);
    expect((html.match(/data-role=/g) ?? []).length).toBe(7);
    expect(html).toContain("Viết bài SEO");
    expect(html).toContain("00:00");
  });
  it("has vi and en strings for every phase, exercise, role and speech", () => {
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const p of ["idle", "interview", "compose", "trial", "grade", "await_human", "samples", "passed", "rest"]) expect(d[`gym_phase_${p}`]).toBeTruthy();
      for (const e of ["mat", "treadmill", "bench", "bag", "bike", "cable", "pullup", "dumbbell"]) expect(d[`gym_ex_${e}`]).toBeTruthy();
      for (const k of ["drink", "wipe", "rest", "phone", "chat", "stretch", "skill", "coach", "cheer", "write"]) expect(d[`gym_say_${k}`]).toBeTruthy();
      expect(d.gym_board_time).toBeTruthy();
      for (const id of GYM_TRAINER_IDS) { expect(d[`gym_role_${id}`]).toBeTruthy(); expect(d[`gym_say_${id}`]).toBeTruthy(); }
    }
  });
});
