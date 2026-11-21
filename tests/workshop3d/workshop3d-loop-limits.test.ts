import { describe, expect, it } from "vitest";
import { isTransientFailure, intakeMustAsk } from "../../src/core/workshop3d/runner-helpers.js";
import {
  afterReview, afterStepFailed, afterStepOk, AUTO_RESUME_DELAYS_MS, DEFAULT_MAX_NO_IMPROVE, initialSnapshot, MAX_AUTO_RESUMES, pause, quotaReady,
  resume, reviewTotal, shouldUseBest,
} from "../../src/core/workshop3d/state.js";
import type { W3DIssue, W3DSnapshot } from "../../src/core/workshop3d/types.js";

const geo: W3DIssue[] = [{ target: "geometry", text: "lệch" }];
const reviewing = (over: Partial<W3DSnapshot> = {}): W3DSnapshot => ({ ...initialSnapshot({ maxNoImprove: 2 }), state: "reviewing", ...over });
const sc = (beauty: number, likeness?: number) => ({ beauty, detail: 5, proportion: 5, ...(likeness !== undefined ? { likeness } : {}) });

describe("early stop without improvement", () => {
  it("defaults: ONE round without a better total (round 1 has always been the best in real runs)", () => {
    expect(DEFAULT_MAX_NO_IMPROVE).toBe(1);
    expect(initialSnapshot()).toMatchObject({ maxNoImprove: 1, bestScore: null, bestRound: null, noImprove: 0, autoResumes: 0, maxAutoResumes: 5 });
    expect(initialSnapshot(4).maxFixRounds).toBe(4);
    expect(initialSnapshot({ maxNoImprove: 3, maxAutoResumes: 99 })).toMatchObject({ maxNoImprove: 3, maxAutoResumes: MAX_AUTO_RESUMES });
  });
  it("tracks the best total and counts reviews that do not beat it", () => {
    let s = afterReview(reviewing(), { ok: false, issues: geo, scores: sc(6) }, 0);
    expect(s).toMatchObject({ state: "modeling", bestScore: 16, bestRound: 0, noImprove: 0, round: 1 });
    s = afterReview({ ...s, state: "reviewing" }, { ok: false, issues: geo, scores: sc(6) }, 0); // equal is not better
    expect(s).toMatchObject({ state: "modeling", bestScore: 16, bestRound: 0, noImprove: 1, round: 2 });
    s = afterReview({ ...s, state: "reviewing" }, { ok: false, issues: geo, scores: sc(4) }, 0);
    expect(s.state).toBe("optimizing");
    expect(s.note).toMatch(/Dừng sửa sớm: 2 vòng liên tiếp/);
    expect(s.issues).toEqual([]);
    expect(shouldUseBest(s)).toBe(true);
  });
  it("a better review resets the counter; ending on the best round needs no restore", () => {
    let s = afterReview(reviewing(), { ok: false, issues: geo, scores: sc(5) }, 0);
    s = afterReview({ ...s, state: "reviewing" }, { ok: false, issues: geo, scores: sc(5) }, 0);
    s = afterReview({ ...s, state: "reviewing" }, { ok: true, issues: [], scores: sc(8) }, 0);
    expect(s).toMatchObject({ state: "optimizing", bestScore: 18, bestRound: 2, noImprove: 0 });
    expect(shouldUseBest(s)).toBe(false);
  });
  it("likeness counts in the total when the reviewer gives it", () => {
    expect(reviewTotal(sc(5, 7))).toBe(22);
    expect(reviewTotal(sc(5))).toBe(15);
  });
  it("maxNoImprove 0 never stops early; old snapshots without the field use the default", () => {
    let s = reviewing({ maxNoImprove: 0, bestScore: 20, bestRound: 0, noImprove: 5 });
    s = afterReview(s, { ok: false, issues: geo, scores: sc(1) }, 0);
    expect(s.state).toBe("modeling");
    const old = reviewing({ bestScore: 20, bestRound: 0, noImprove: 1 });
    delete (old as Partial<W3DSnapshot>).maxNoImprove;
    expect(afterReview(old, { ok: false, issues: geo, scores: sc(1) }, 0).state).toBe("optimizing");
  });
  it("without scores (old callers) nothing is tracked and the round limit still applies", () => {
    const s = afterReview(reviewing({ fixRounds: 6 }), { ok: false, issues: geo }, 0);
    expect(s).toMatchObject({ state: "optimizing", bestScore: null });
    expect(s.note).toMatch(/tối đa/);
  });
});

describe("automatic resume (fake clock)", () => {
  const at = (over: Partial<W3DSnapshot> = {}): W3DSnapshot => ({ ...initialSnapshot(), state: "modeling", ...over });
  it("the first two failures only count; the third transient one waits AUTO_RESUME_DELAYS_MS[0]", () => {
    let s = afterStepFailed(at(), "cắt", { transient: true, now: 1000 });
    s = afterStepFailed(s, "cắt", { transient: true, now: 1000 });
    expect(s).toMatchObject({ state: "modeling", stepFailures: 2 });
    s = afterStepFailed(s, "Vai cad-modeler bị ngắt: timeout", { transient: true, now: 1000 });
    expect(s).toMatchObject({ state: "waiting_quota", waitReason: "retry", resumeState: "modeling", waitUntil: 1000 + 30_000, autoResumes: 1 });
    expect(s.note).toMatch(/tự tiếp tục sau 30 giây \(lần 1\/5\)/);
    const r = quotaReady(s);
    expect(r).toMatchObject({ state: "modeling", stepFailures: 0, waitReason: null, autoResumes: 1 });
  });
  it("delays grow (30 s, 2, 5, 10, 15 minutes); after 5 resumes the session fails", () => {
    expect(AUTO_RESUME_DELAYS_MS).toEqual([30_000, 120_000, 300_000, 600_000, 900_000]);
    let s = at();
    const waits: number[] = [];
    for (let i = 0; i < 6; i++) {
      s = afterStepFailed({ ...s, stepFailures: 2 }, "bị ngắt", { transient: true, now: 0 });
      if (s.state !== "waiting_quota") break;
      waits.push(s.waitUntil!);
      s = quotaReady(s);
    }
    expect(waits).toEqual([...AUTO_RESUME_DELAYS_MS]);
    expect(s.state).toBe("failed");
    expect(s.error).toMatch(/đã tự tiếp tục 5 lần/);
  });
  it("non-transient failures and missing clock fail as before", () => {
    expect(afterStepFailed(at({ stepFailures: 2 }), "JSON hỏng", { now: 0 }).state).toBe("failed");
    expect(afterStepFailed(at({ stepFailures: 2 }), "bị ngắt", { transient: true }).state).toBe("failed");
    expect(afterStepFailed(at({ stepFailures: 2, maxAutoResumes: 0 }), "bị ngắt", { transient: true, now: 0 }).state).toBe("failed");
  });
  it("a successful step, a manual resume and pause clear the retry bookkeeping", () => {
    expect(afterStepOk(at({ autoResumes: 3 }), 0).autoResumes).toBe(0);
    const w = afterStepFailed(at({ stepFailures: 2 }), "bị ngắt", { transient: true, now: 0 });
    const p = pause(w);
    expect(p).toMatchObject({ state: "paused", resumeState: "modeling", waitReason: null, waitUntil: null });
    expect(resume(p)).toMatchObject({ state: "modeling", autoResumes: 0, stepFailures: 0 });
  });
  it("classifies transient failures", () => {
    expect(isTransientFailure({ interrupted: true })).toBe(true);
    expect(isTransientFailure({ error: "read ECONNRESET" })).toBe(true);
    expect(isTransientFailure({ error: "API Error: 529 overloaded" })).toBe(true);
    expect(isTransientFailure({ error: "Run không hoàn tất." })).toBe(true);
    expect(isTransientFailure({ error: "Not logged in · Please run /login" })).toBe(false);
    expect(isTransientFailure({ error: "Khóa style phải là chuỗi không rỗng." })).toBe(false);
  });
});

describe("intakeMustAsk", () => {
  const brief = (params: Record<string, string | number>) => ({ title: "t", object: "o", params, detail: "high" as const, attachments: [] });
  it("asks when a first-round brief has unknown values or the request was cut", () => {
    expect(intakeMustAsk({ done: true, brief: brief({ cua: "chưa rõ" }) }, { answered: 0, truncated: false })).toMatch(/cua/);
    expect(intakeMustAsk({ done: true, brief: brief({ w: 1 }) }, { answered: 0, truncated: true })).toMatch(/bị cắt/);
  });
  it("accepts a complete brief, questions, or unknowns after the user answered once", () => {
    expect(intakeMustAsk({ done: true, brief: brief({ w: 1 }) }, { answered: 0, truncated: false })).toBeNull();
    expect(intakeMustAsk({ done: false }, { answered: 0, truncated: true })).toBeNull();
    expect(intakeMustAsk({ done: true, brief: brief({ cua: "chưa rõ" }) }, { answered: 1, truncated: false })).toBeNull();
  });
});

describe("controller.json workshop3d limits", () => {
  it("parseWorkshop3D keeps finite numbers; w3dLimitsFrom maps them to the snapshot limits", async () => {
    const { parseWorkshop3D } = await import("../../src/core/app/config.js");
    const { w3dLimitsFrom } = await import("../../src/core/workshop3d/index.js");
    expect(parseWorkshop3D(undefined)).toEqual({});
    expect(parseWorkshop3D({ maxNoImproveRounds: 3, maxAutoResumes: "x", maxFixRounds: 4 })).toEqual({ maxNoImproveRounds: 3, maxFixRounds: 4 });
    const limits = w3dLimitsFrom({ workshop3d: { maxNoImproveRounds: 3, maxAutoResumes: 2 } });
    expect(limits).toEqual({ maxNoImprove: 3, maxAutoResumes: 2 });
    expect(initialSnapshot(limits)).toMatchObject({ maxNoImprove: 3, maxAutoResumes: 2, maxFixRounds: 6 });
    expect(w3dLimitsFrom({})).toEqual({});
  });
});
