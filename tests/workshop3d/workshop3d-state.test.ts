import { describe, expect, it } from "vitest";
import {
  DEFAULT_MAX_FIX_ROUNDS, MAX_BUILD_RETRIES, MAX_STEP_FAILURES, W3DError, afterBuild, afterIntake, afterReview, afterStepFailed,
  afterStepOk, answered, initialSnapshot, isRunning, pause, quotaReady, resume, stop, waitQuota,
} from "../../src/core/workshop3d/state.js";
import type { W3DSnapshot, W3DState } from "../../src/core/workshop3d/types.js";

const at = (state: W3DState, extra: Partial<W3DSnapshot> = {}): W3DSnapshot => ({ ...initialSnapshot(), state, ...extra });

describe("pipeline", () => {
  it("starts at intake and walks the linear steps adding cost", () => {
    let s = initialSnapshot();
    expect(s.state).toBe("intake");
    expect(s.maxFixRounds).toBe(DEFAULT_MAX_FIX_ROUNDS);
    s = afterIntake(s, { done: true, questions: [] }, 0.1);
    expect(s.state).toBe("art");
    for (let i = 0; i < 3; i++) s = afterStepOk(s, 0.2);
    expect(s.state).toBe("building");
    expect(s.costUsd).toBeCloseTo(0.1 + 0.6);
  });
  it("intake with questions waits for the user, answer returns to intake", () => {
    let s = afterIntake(initialSnapshot(), { done: false, questions: ["Kích thước?"] }, 0);
    expect(s.state).toBe("awaiting_user");
    expect(s.questions).toEqual(["Kích thước?"]);
    s = answered(s);
    expect(s.state).toBe("intake");
    expect(s.questions).toEqual([]);
    expect(() => answered(s)).toThrow(W3DError);
  });
});

describe("build", () => {
  it("success goes to materials and clears retries", () => {
    const s = afterBuild(at("building", { buildRetries: 2 }), { ok: true });
    expect(s.state).toBe("materials");
    expect(s.buildRetries).toBe(0);
  });
  it("failure goes back to modeling with the error as an issue", () => {
    const s = afterBuild(at("building"), { ok: false, error: "SyntaxError" });
    expect(s.state).toBe("modeling");
    expect(s.buildRetries).toBe(1);
    expect(s.issues[0]).toEqual({ target: "geometry", text: "SyntaxError" });
  });
  it("material/render issues of a mixed review survive modeling and the build (failed or ok) until the material step", () => {
    const mixed = [{ target: "geometry" as const, text: "thiếu đèn" }, { target: "material" as const, text: "quá tối" }];
    const m = afterStepOk(at("modeling", { issues: mixed }), 0);
    expect(m.issues).toEqual([{ target: "material", text: "quá tối" }]);
    const bad = afterBuild(m, { ok: false, error: "NameError" });
    expect(bad.issues).toEqual([{ target: "material", text: "quá tối" }, { target: "geometry", text: "NameError" }]);
    const good = afterBuild({ ...bad, state: "building" }, { ok: true });
    expect(good.issues).toEqual([{ target: "material", text: "quá tối" }]);
    expect(afterStepOk(good, 0).issues).toEqual([]);
  });
  it("fails after MAX_BUILD_RETRIES", () => {
    const s = afterBuild(at("building", { buildRetries: MAX_BUILD_RETRIES - 1 }), { ok: false, error: "x" });
    expect(s.state).toBe("failed");
    expect(s.error).toMatch(/[Ss]cript/);
  });
});

describe("review", () => {
  it("ok goes to optimizing", () => {
    const s = afterReview(at("reviewing"), { ok: true, issues: [] }, 0.3);
    expect(s.state).toBe("optimizing");
    expect(s.issues).toEqual([]);
  });
  it("not ok loops to modeling for geometry issues and to materials for material issues", () => {
    const geo = afterReview(at("reviewing"), { ok: false, issues: [{ target: "geometry", text: "thiếu đèn" }] }, 0);
    expect(geo.state).toBe("modeling");
    expect(geo.fixRounds).toBe(1);
    const mat = afterReview(at("reviewing"), { ok: false, issues: [{ target: "material", text: "inox phẳng" }] }, 0);
    expect(mat.state).toBe("materials");
  });
  it("after maxFixRounds it moves on instead of failing", () => {
    const s = afterReview(at("reviewing", { fixRounds: DEFAULT_MAX_FIX_ROUNDS }), { ok: false, issues: [{ target: "geometry", text: "x" }] }, 0);
    expect(s.state).toBe("optimizing");
    expect(s.note).toMatch(/tối đa/);
  });
});

describe("failures, pause, stop, quota", () => {
  it("retries the same state then fails at MAX_STEP_FAILURES", () => {
    let s = at("art");
    for (let i = 1; i < MAX_STEP_FAILURES; i++) {
      s = afterStepFailed(s, "timeout");
      expect(s.state).toBe("art");
      expect(s.stepFailures).toBe(i);
    }
    s = afterStepFailed(s, "timeout");
    expect(s.state).toBe("failed");
    expect(s.error).toBe("timeout");
  });
  it("success resets stepFailures", () => {
    const s = afterStepOk(at("art", { stepFailures: 2 }), 0);
    expect(s.stepFailures).toBe(0);
  });
  it("pause remembers the state and resume restores it", () => {
    const p = pause(at("modeling"));
    expect(p.state).toBe("paused");
    expect(p.resumeState).toBe("modeling");
    expect(resume(p).state).toBe("modeling");
  });
  it("stop is resumable: resume of stopped/failed restarts the last working state", () => {
    const st = stop(at("materials"));
    expect(st.state).toBe("stopped");
    expect(resume(st).state).toBe("materials");
    const f = afterStepFailed(at("art", { stepFailures: MAX_STEP_FAILURES - 1 }), "boom");
    expect(resume(f).state).toBe("art");
    expect(resume(f).stepFailures).toBe(0);
  });
  it("done cannot be paused", () => {
    expect(() => pause(at("done"))).toThrow(W3DError);
  });
  it("waiting_quota keeps the state to come back to", () => {
    const w = waitQuota(at("rendering"), 1234);
    expect(w.state).toBe("waiting_quota");
    expect(w.waitUntil).toBe(1234);
    const r = quotaReady(w);
    expect(r.state).toBe("rendering");
    expect(r.waitUntil).toBeNull();
  });
  it("build retries reset on resume: a failed build can be resumed with a fresh retry budget", () => {
    let s = afterBuild(at("building", { buildRetries: MAX_BUILD_RETRIES - 2 }), { ok: false, error: "x" });
    expect(s.state).toBe("modeling");
    expect(s.buildRetries).toBe(MAX_BUILD_RETRIES - 1);
    s = afterBuild(at("building", { buildRetries: MAX_BUILD_RETRIES - 1 }), { ok: false, error: "x" });
    expect(s.state).toBe("failed");
    s = resume(s);
    expect(s.state).toBe("modeling");
    expect(s.buildRetries).toBe(0);
    s = afterBuild(at("building", { buildRetries: s.buildRetries }), { ok: false, error: "y" });
    expect(s.state).toBe("modeling");
    expect(s.buildRetries).toBe(1);
  });
  it("resume from waiting_quota (via pause or stop) returns to the working state with waitUntil cleared", () => {
    const p = resume(pause(waitQuota(at("rendering"), 99)));
    expect(p.state).toBe("rendering");
    expect(p.waitUntil).toBeNull();
    const st = resume(stop(waitQuota(at("rendering"), 99)));
    expect(st.state).toBe("rendering");
    expect(st.waitUntil).toBeNull();
  });
  it("isRunning", () => {
    expect(isRunning("modeling")).toBe(true);
    expect(isRunning("waiting_quota")).toBe(true);
    for (const s of ["awaiting_user", "paused", "stopped", "failed", "done"] as const) expect(isRunning(s)).toBe(false);
  });
});
