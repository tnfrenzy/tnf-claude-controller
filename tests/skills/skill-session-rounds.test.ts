import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import {
  attachSample,
  createSession,
  createSessionStore,
  currentRound,
  gradeRound,
  isOpen,
  markPaused,
  normalizeSession,
  resumeSession,
} from "../../src/core/roles/skill-session.js";

const T = (n: number) => `2026-01-01T00:00:0${n}.000Z`;
const sample = { files: [{ format: "docx" as const, name: "sample.docx" }], summary: "tóm tắt", costUsd: 0.1 };
const fresh = (maxRounds?: number) => createSession({ brief: "Làm skill", agents: [], maxRounds, now: T(0) });

describe("sample rounds", () => {
  it("create -> generating; grading without sample is refused", () => {
    const s = fresh();
    expect(s.status).toBe("generating");
    expect(() => gradeRound(s, { score: 100, feedback: "", now: T(1) })).toThrow(expect.objectContaining({ code: "session_no_sample", status: 400 }));
  });

  it("attachSample -> awaiting_score; 100 -> completed", () => {
    const a = attachSample(fresh(), { n: 1, sample, now: T(1) });
    expect(a.status).toBe("awaiting_score");
    expect(currentRound(a).sample?.summary).toBe("tóm tắt");
    expect(gradeRound(a, { score: 100, feedback: "", now: T(2) }).status).toBe("completed");
  });

  it("attachSample needs generating status", () => {
    const a = attachSample(fresh(), { n: 1, sample, now: T(1) });
    expect(() => attachSample(a, { n: 1, sample, now: T(2) })).toThrow(expect.objectContaining({ code: "session_not_generating" }));
  });

  it("60 needs feedback, then round 2 generating with feedbackIn", () => {
    const a = attachSample(fresh(), { n: 1, sample, now: T(1) });
    expect(() => gradeRound(a, { score: 60, feedback: " ", now: T(2) })).toThrow(expect.objectContaining({ code: "session_invalid" }));
    const g = gradeRound(a, { score: 60, feedback: "thiếu bảng", now: T(2) });
    expect(g.status).toBe("generating");
    expect(g.rounds[1]).toMatchObject({ n: 2, feedbackIn: "thiếu bảng" });
    expect(() => gradeRound(g, { score: 100, feedback: "", now: T(3) })).toThrow(expect.objectContaining({ code: "session_no_sample" }));
  });

  it("never exhausts beyond maxRounds", () => {
    let s = fresh(1);
    for (let i = 1; i <= 3; i++) {
      s = attachSample(s, { n: i, sample, now: T(i) });
      s = gradeRound(s, { score: 50, feedback: "x", now: T(i) });
      expect(s.status).toBe("generating");
    }
    expect(s.rounds).toHaveLength(4);
  });

  it("pause and resume", () => {
    const p = markPaused(fresh(), { reason: "hết ngân sách", now: T(1) });
    expect(p.status).toBe("paused");
    expect(currentRound(p).error).toBe("hết ngân sách");
    expect(isOpen(p)).toBe(true);
    expect(() => gradeRound(p, { score: 100, feedback: "", now: T(2) })).toThrow(expect.objectContaining({ code: "session_no_sample" }));
    expect(resumeSession(p, T(2)).status).toBe("generating");
    expect(() => resumeSession(fresh(), T(2))).toThrow(expect.objectContaining({ code: "session_not_paused" }));
  });

  it("reads legacy exhausted and legacy awaiting_score without sample", () => {
    const base = JSON.parse(JSON.stringify(fresh(1)));
    const ex = normalizeSession({ ...base, status: "exhausted", rounds: [{ n: 1, startedAt: "x", score: 50 }, { n: 2, startedAt: "x" }] });
    expect(ex.status).toBe("exhausted");
    expect(() => gradeRound(ex, { score: 100, feedback: "", now: T(1) })).toThrow(expect.objectContaining({ code: "session_closed" }));
    const old = normalizeSession({ ...base, status: "awaiting_score" });
    expect(gradeRound(old, { score: 100, feedback: "", now: T(1) }).status).toBe("completed");
  });
});

describe("store sample/pause/resume", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillrounds-"));
  });
  afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

  it("runs generating -> paused -> generating -> awaiting_score", async () => {
    const skills = createSkillStore(dir, { retryDelayMs: 1 });
    await skills.create({ slug: "demo", title: "Demo", goal: "G", files: { "SKILL.md": "v1" } });
    const s = createSessionStore(skills);
    expect((await s.start("demo", { brief: "b", agents: [] })).status).toBe("generating");
    expect((await s.pause("demo", "lỗi")).status).toBe("paused");
    expect((await s.resume("demo")).status).toBe("generating");
    const a = await s.attachSample("demo", { n: 1, sample });
    expect(a.status).toBe("awaiting_score");
    expect((await s.get("demo"))?.rounds[0].sample?.files[0].name).toBe("sample.docx");
  });
});
