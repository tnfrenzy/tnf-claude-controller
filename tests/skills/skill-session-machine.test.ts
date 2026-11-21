import { describe, expect, it } from "vitest";
import { attachSample, bestScore, createSession, currentRound, gradeRound, isOpen } from "../../src/core/roles/skill-session.js";
import type { SkillSession } from "../../src/core/roles/skill-session.js";
import type { SkillAgent } from "../../src/core/roles/skill-agent-set.js";

const agents: SkillAgent[] = [{ id: "a", description: "d", tools: ["Read"], source: "existing" }];
const T = (n: number) => `2026-01-01T00:00:0${n}.000Z`;
const sample = { files: [{ format: "docx" as const, name: "sample.docx" }], summary: "s", costUsd: 0 };
const bare = (maxRounds?: number) => createSession({ brief: "  Làm skill  ", agents, maxRounds, now: T(0) });
const withSample = (s: SkillSession, now = T(0)) => attachSample(s, { n: currentRound(s).n, sample, now });
const mk = (maxRounds?: number) => withSample(bare(maxRounds));
/** grade, then give the newly opened round a sample so it can be graded again. */
const gradeNext = (s: SkillSession, score: number, feedback: string, now: string) => {
  const g = gradeRound(s, { score, feedback, now });
  return g.status === "generating" ? withSample(g, now) : g;
};

describe("createSession", () => {
  it("creates round 1 generating with default 5", () => {
    const s = bare();
    expect(s.status).toBe("generating");
    expect(s.maxRounds).toBe(5);
    expect(s.brief).toBe("Làm skill");
    expect(s.rounds).toEqual([{ n: 1, startedAt: T(0) }]);
    expect(currentRound(s).n).toBe(1);
    expect(isOpen(s)).toBe(true);
  });
  it("rejects bad input", () => {
    expect(() => createSession({ brief: "  ", agents, now: T(0) })).toThrow(/Brief/);
    for (const m of [0, 21, 1.5]) expect(() => bare(m)).toThrow(/Số vòng/);
  });
});

describe("gradeRound", () => {
  it("70 opens round 2 with feedbackIn", () => {
    const s = gradeRound(mk(), { score: 70, feedback: " thiếu ví dụ ", now: T(1) });
    expect(s.status).toBe("generating");
    expect(s.rounds).toHaveLength(2);
    expect(s.rounds[0]).toMatchObject({ score: 70, feedback: "thiếu ví dụ", gradedAt: T(1) });
    expect(s.rounds[1]).toEqual({ n: 2, startedAt: T(1), feedbackIn: "thiếu ví dụ" });
  });
  it("100 completes without a new round", () => {
    const s = gradeRound(mk(), { score: 100, feedback: "", now: T(1) });
    expect(s.status).toBe("completed");
    expect(s.rounds).toHaveLength(1);
    expect(isOpen(s)).toBe(false);
  });
  it("100 at round 3 after 70, 80", () => {
    let s = gradeNext(mk(), 70, "a", T(1));
    s = gradeNext(s, 80, "b", T(2));
    s = gradeRound(s, { score: 100, feedback: "", now: T(3) });
    expect(s.status).toBe("completed");
    expect(s.rounds).toHaveLength(3);
    expect(s.rounds[2].feedbackIn).toBe("b");
    expect(bestScore(s)).toBe(100);
  });
  it("rejects grading after completion", () => {
    const s = gradeRound(mk(), { score: 100, feedback: "", now: T(1) });
    expect(() => gradeRound(s, { score: 50, feedback: "x", now: T(2) })).toThrow(expect.objectContaining({ code: "session_closed", status: 400 }));
  });
  it("rejects invalid scores", () => {
    for (const score of [-1, 101, 99.5, NaN, "90" as any]) {
      expect(() => gradeRound(mk(), { score, feedback: "x", now: T(1) })).toThrow(expect.objectContaining({ code: "session_invalid" }));
    }
  });
  it("requires feedback under 100", () => {
    expect(() => gradeRound(mk(), { score: 99, feedback: "  ", now: T(1) })).toThrow(expect.objectContaining({ code: "session_invalid" }));
  });
  it("truncates feedback to 4000", () => {
    const s = gradeRound(mk(), { score: 10, feedback: "x".repeat(5000), now: T(1) });
    expect(s.rounds[0].feedback).toHaveLength(4000);
  });
  it("goes past maxRounds=2 without exhausting", () => {
    let s = gradeNext(mk(2), 50, "a", T(1));
    s = gradeRound(s, { score: 60, feedback: "b", now: T(2) });
    expect(s.status).toBe("generating");
    expect(s.rounds).toHaveLength(3);
    expect(bestScore(s)).toBe(60);
  });
  it("maxRounds=1 with 99 opens round 2", () => {
    const s = gradeRound(mk(1), { score: 99, feedback: "gần", now: T(1) });
    expect(s.status).toBe("generating");
    expect(s.rounds).toHaveLength(2);
  });
  it("does not mutate input", () => {
    const s = mk();
    const before = JSON.stringify(s);
    gradeRound(s, { score: 40, feedback: "x", now: T(1) });
    expect(JSON.stringify(s)).toBe(before);
  });
  it("bestScore is null before grading", () => {
    expect(bestScore(mk())).toBeNull();
  });
});
