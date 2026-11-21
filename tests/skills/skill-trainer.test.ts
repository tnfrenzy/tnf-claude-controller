import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRAINER_CONFIG,
  afterGrading,
  checkCostCap,
  initialSnapshot,
  resolveConfig,
  approve,
  isRunning,
  requestPause,
  resume,
  stop,
  applyHumanGrade,
  type TrainerSnapshot,
} from "../../src/core/skill-workshop/trainer.js";

describe("applyHumanGrade", () => {
  const waiting = (round = 1, maxRounds = 5): TrainerSnapshot => ({ ...initialSnapshot({ maxRounds }), state: "awaiting_score", round });
  it("100 goes to awaiting_approval", () => {
    const s = applyHumanGrade(waiting(), { score: 100, feedback: "" });
    expect(s.state).toBe("awaiting_approval");
    expect(s.bestScore).toBe(100);
  });
  it("70 with feedback composes round 2", () => {
    const s = applyHumanGrade(waiting(), { score: 70, feedback: " làm lại " }, 0.1);
    expect(s.state).toBe("composing");
    expect(s.round).toBe(2);
    expect(s.rounds).toEqual([{ n: 1, score: 70, costUsd: 0.1 }]);
  });
  it("rejects missing feedback and bad scores", () => {
    expect(() => applyHumanGrade(waiting(), { score: 70, feedback: "  " })).toThrow(/nhận xét/);
    expect(() => applyHumanGrade(waiting(), { score: 101, feedback: "x" })).toThrow(/số nguyên/);
    expect(() => applyHumanGrade(waiting(), { score: 2.5, feedback: "x" })).toThrow(/số nguyên/);
  });
  it("rejects when not awaiting_score", () => {
    expect(() => applyHumanGrade(initialSnapshot(), { score: 80, feedback: "x" })).toThrow(/chưa có đầu ra/);
  });
  it("round 6 with maxRounds 5 still composes", () => {
    expect(applyHumanGrade(waiting(6, 5), { score: 50, feedback: "x" }).state).toBe("composing");
  });
  it("stop works from awaiting_score and it is not running", () => {
    expect(isRunning("awaiting_score")).toBe(false);
    expect(stop(waiting()).state).toBe("stopped");
  });
});

function run(scores: number[], overrides?: Record<string, unknown>): TrainerSnapshot {
  let snap = initialSnapshot(overrides);
  for (const s of scores) {
    if (snap.state !== "composing") break;
    snap = afterGrading(snap, s);
  }
  return snap;
}

describe("skill trainer control transitions", () => {
  it("approve at awaiting_approval records approvedAt; 95 alone does not", () => {
    const snap = run([95]);
    expect(snap.state).toBe("awaiting_approval");
    expect(snap.approvedAt).toBeUndefined();
    const done = approve(snap, "2026-10-27T00:00:00.000Z");
    expect(done.approvedAt).toBe("2026-10-27T00:00:00.000Z");
    expect(done.state).toBe("awaiting_approval");
  });

  it("approve outside awaiting_approval is rejected", () => {
    expect(() => approve(initialSnapshot(), "x")).toThrow(/duyệt/);
  });

  it("resume from cost_cap raises the cap and goes back to composing", () => {
    let snap = initialSnapshot();
    snap = afterGrading(snap, 50, 3);
    snap = checkCostCap(snap);
    expect(snap.state).toBe("cost_cap");
    const next = resume(snap, { costCapUsd: 6 });
    expect(next.state).toBe("composing");
    expect(next.round).toBe(2);
    expect(next.config.costCapUsd).toBe(6);
    expect(next.config.maxRounds).toBe(5);
  });

  it("stop from trial gives stopped; approved snapshot is not stopped", () => {
    const trial = { ...initialSnapshot(), state: "trial" as const };
    expect(stop(trial).state).toBe("stopped");
    const approved = approve(run([95]), "t");
    expect(stop(approved).state).toBe("awaiting_approval");
  });

  it("pause sets flag only while running; resume clears it", () => {
    const paused = requestPause(initialSnapshot());
    expect(paused.paused).toBe(true);
    expect(paused.state).toBe("composing");
    expect(resume(paused).paused).toBe(false);
    expect(requestPause(run([95])).paused).toBe(false);
    expect(isRunning("trial")).toBe(true);
    expect(isRunning("stopped")).toBe(false);
  });
});

describe("skill trainer state machine", () => {
  it("passes on 62 -> 81 -> 93 and awaits approval with best round 3", () => {
    const snap = run([62, 81, 93]);
    expect(snap.state).toBe("awaiting_approval");
    expect(snap.rounds.map((r) => r.score)).toEqual([62, 81, 93]);
    expect(snap.bestScore).toBe(93);
    expect(snap.bestRound).toBe(3);
  });

  it("treats exactly the pass score as passing", () => {
    expect(run([90]).state).toBe("awaiting_approval");
  });

  it("prefers passing over failed_max_rounds on the last round", () => {
    const snap = run([50, 60, 70, 80, 91]);
    expect(snap.state).toBe("awaiting_approval");
    expect(snap.rounds).toHaveLength(5);
  });

  it("stalls from round 3 when two rounds do not beat the earlier best", () => {
    const snap = run([80, 70, 75]);
    expect(snap.state).toBe("stalled");
    expect(snap.bestScore).toBe(80);
    expect(snap.bestRound).toBe(1);
  });

  it("does not stall on rounds 1-2 even with equal scores", () => {
    const snap = run([60, 60]);
    expect(snap.state).toBe("composing");
    expect(snap.round).toBe(3);
  });

  it("does not stall when the latest round improves", () => {
    expect(run([80, 70, 85]).state).toBe("composing");
  });

  it("fails after max rounds with slowly rising scores", () => {
    const snap = run([50, 55, 60, 65, 70]);
    expect(snap.state).toBe("failed_max_rounds");
    expect(snap.rounds).toHaveLength(5);
    expect(snap.bestRound).toBe(5);
  });

  it("respects a maxRounds override", () => {
    const snap = run([50, 60], { maxRounds: 2 });
    expect(snap.state).toBe("failed_max_rounds");
    expect(snap.config.maxRounds).toBe(2);
  });

  it("stops on cost cap, including exactly equal to the cap", () => {
    let snap = initialSnapshot();
    snap = afterGrading(snap, 50, 1.5);
    expect(checkCostCap(snap).state).toBe("composing");
    snap = afterGrading(snap, 60, 1.5);
    expect(snap.totalCostUsd).toBe(3);
    expect(checkCostCap(snap).state).toBe("cost_cap");
  });

  it("keeps the earlier round on a tie for best", () => {
    const snap = run([70, 60, 70, 65]);
    expect(snap.bestScore).toBe(70);
    expect(snap.bestRound).toBe(1);
  });

  it("resolveConfig ignores invalid values and unknown keys", () => {
    const cfg = resolveConfig({ passScore: NaN, maxRounds: -1, costCapUsd: 0, stallRounds: 9 });
    expect(cfg).toEqual(DEFAULT_TRAINER_CONFIG);
    expect(resolveConfig({ passScore: 80, costCapUsd: 5 })).toEqual({ passScore: 80, maxRounds: 5, costCapUsd: 5 });
  });

  it("does not mutate frozen inputs", () => {
    const snap = initialSnapshot();
    Object.freeze(snap);
    Object.freeze(snap.rounds);
    Object.freeze(snap.config);
    const next = afterGrading(snap, 62, 0.5);
    expect(next).not.toBe(snap);
    expect(snap.rounds).toHaveLength(0);
    expect(checkCostCap(snap)).toBe(snap);
  });
});
