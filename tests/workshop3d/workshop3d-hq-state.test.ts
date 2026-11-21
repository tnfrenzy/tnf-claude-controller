// Two-phase review with a Blender high-quality step: pure state machine (state.ts).
import { describe, expect, it } from "vitest";
import {
  afterFinalReview, afterHqRender, afterReview, afterStepOk, initialSnapshot, isRunning, pause, resume, reviewModeOf, shouldUseBestFinal,
} from "../../src/core/workshop3d/state.js";
import { isWorking } from "../../src/core/workshop3d/runner-helpers.js";
import type { W3DSnapshot } from "../../src/core/workshop3d/types.js";

const scores = (n: number) => ({ beauty: n, detail: n, proportion: n });
const at = (s: W3DSnapshot, state: W3DSnapshot["state"]): W3DSnapshot => ({ ...s, state });

describe("initialSnapshot hq fields", () => {
  it("old sessions (no hqMode) behave as before: off", () => {
    const s = initialSnapshot({});
    expect(s.hqMode ?? "off").toBe("off");
    expect(reviewModeOf(at(s, "reviewing"))).toBe("full");
  });
  it("keeps hqMode and clamps the final fix rounds", () => {
    const s = initialSnapshot({ hqMode: "final", maxHqFixRounds: 9 });
    expect(s.hqMode).toBe("final");
    expect(s.maxHqFixRounds).toBe(3);
    expect(initialSnapshot({ hqMode: "final" }).maxHqFixRounds).toBe(0);
  });
});

describe("phase 1 (geometry) review", () => {
  const s0 = at(initialSnapshot({ hqMode: "final", maxFixRounds: 2 }), "reviewing");
  it("review mode is geometry in two-phase sessions and full in loop / off", () => {
    expect(reviewModeOf(s0)).toBe("geometry");
    expect(reviewModeOf({ ...s0, hqMode: "loop" })).toBe("full");
    expect(reviewModeOf(at(s0, "hqreview"))).toBe("final");
  });
  it("approved geometry goes to hqrender, not optimizing", () => {
    const n = afterReview(s0, { ok: true, issues: [], scores: scores(7) }, 0.1);
    expect(n.state).toBe("hqrender");
    expect(n.hqRedo ?? null).toBeNull();
  });
  it("material / render complaints of the fast renderer never start a fix round", () => {
    const n = afterReview(s0, { ok: false, issues: [{ target: "material", text: "gương đục" }, { target: "render", text: "tối" }], scores: scores(5) }, 0);
    expect(n.state).toBe("hqrender");
    expect(n.fixRounds).toBe(0);
    expect(n.issues).toEqual([]);
  });
  it("geometry issues go back to modeling with only the geometry issues", () => {
    const n = afterReview(s0, { ok: false, issues: [{ target: "geometry", text: "thiếu tay vịn" }, { target: "material", text: "gương đục" }], scores: scores(5) }, 0);
    expect(n.state).toBe("modeling");
    expect(n.issues).toEqual([{ target: "geometry", text: "thiếu tay vịn" }]);
  });
  it("out of fix rounds goes to hqrender too", () => {
    const n = afterReview({ ...s0, fixRounds: 2 }, { ok: false, issues: [{ target: "geometry", text: "x" }] }, 0);
    expect(n.state).toBe("hqrender");
  });
  it("without Blender (off) the old single-phase flow is unchanged", () => {
    const off = at(initialSnapshot({ maxFixRounds: 2 }), "reviewing");
    expect(afterReview(off, { ok: true, issues: [] }, 0).state).toBe("optimizing");
    expect(afterReview(off, { ok: false, issues: [{ target: "material", text: "x" }] }, 0).state).toBe("materials");
  });
  it("loop mode: full review, approval goes straight to optimizing", () => {
    const loop = { ...s0, hqMode: "loop" as const };
    expect(afterReview(loop, { ok: true, issues: [] }, 0).state).toBe("optimizing");
    expect(afterReview(loop, { ok: false, issues: [{ target: "material", text: "x" }] }, 0).state).toBe("materials");
  });
});

describe("hqrender", () => {
  const s = at(initialSnapshot({ hqMode: "final" }), "hqrender");
  it("images -> hqreview; redo list cleared", () => {
    const n = afterHqRender({ ...s, hqRedo: ["cop"] }, { images: 4 });
    expect(n.state).toBe("hqreview");
    expect(n.hqRedo ?? null).toBeNull();
  });
  it("no image (Blender missing or every view failed) -> optimizing with a note, never failed", () => {
    const n = afterHqRender(s, { images: 0, note: "Không tìm thấy Blender" });
    expect(n.state).toBe("optimizing");
    expect(n.note).toContain("Không tìm thấy Blender");
    expect(n.error).toBeNull();
  });
  it("hq states are running states the loop works on (pause / resume / recover)", () => {
    for (const st of ["hqrender", "hqreview", "hqmaterials"] as const) {
      expect(isRunning(st)).toBe(true);
      expect(isWorking(st)).toBe(true);
      const p = pause(at(s, st));
      expect(resume(p).state).toBe(st);
    }
  });
});

describe("phase 2 (final) review", () => {
  const s = at(initialSnapshot({ hqMode: "final", maxHqFixRounds: 1 }), "hqreview");
  it("approved -> optimizing with finalScores", () => {
    const n = afterFinalReview(s, { ok: true, issues: [], scores: scores(8) }, 0.2);
    expect(n.state).toBe("optimizing");
    expect(n.finalScores).toEqual(scores(8));
    expect(n.bestFinalScore).toBe(24);
    expect(n.costUsd).toBeCloseTo(0.2);
  });
  it("material issues -> hqmaterials with the named views to re-render; geometry goes to the backlog", () => {
    const n = afterFinalReview(s, {
      ok: false, scores: scores(6),
      issues: [{ target: "material", text: "gương mờ", views: ["door", "wall_left"] }, { target: "geometry", text: "nẹp trần lệch" }],
    }, 0);
    expect(n.state).toBe("hqmaterials");
    expect(n.issues).toEqual([{ target: "material", text: "gương mờ", views: ["door", "wall_left"] }]);
    expect(n.hqRedo).toEqual(["door", "wall_left"]);
    expect(n.hqFixRounds).toBe(1);
    expect(n.backlog).toEqual([{ target: "geometry", text: "nẹp trần lệch" }]);
  });
  it("a material issue without views and without a recognisable place re-renders two default views, not all", () => {
    const n = afterFinalReview(s, { ok: false, issues: [{ target: "render", text: "tối" }], scores: scores(6) }, 0);
    expect(n.state).toBe("hqmaterials");
    expect(n.hqRedo).toEqual(["overview", "door"]);
  });
  it("views are inferred from the issue text when the reviewer gave none", () => {
    const n = afterFinalReview(s, {
      ok: false, scores: scores(6),
      issues: [
        { target: "material", text: "Sàn tôn nhám chỉ là mặt phẳng, thiếu gân caro" },
        { target: "material", text: "Vách trái quá tối" },
        { target: "render", text: "Đèn âm trần cháy sáng" },
        { target: "material", text: "Bảng COP thiếu nút" },
      ],
    }, 0);
    expect(n.hqRedo).toEqual(["floor", "door", "wall_left", "ceiling", "cop"]);
  });
  it("named views win; an unplaceable issue next to named ones adds nothing", () => {
    const n = afterFinalReview(s, {
      ok: false, scores: scores(6),
      issues: [{ target: "material", text: "gương mờ", views: ["wall_right"] }, { target: "render", text: "hơi tối" }],
    }, 0);
    expect(n.hqRedo).toEqual(["wall_right"]);
  });
  it("hqmaterials success -> hqrender keeping the redo list", () => {
    const m = { ...at(s, "hqmaterials"), hqRedo: ["door"], issues: [{ target: "material" as const, text: "x" }] };
    const n = afterStepOk(m, 0.1);
    expect(n.state).toBe("hqrender");
    expect(n.hqRedo).toEqual(["door"]);
    expect(n.issues).toEqual([]);
  });
  it("out of final fix rounds -> optimizing, issues kept as backlog, note says so", () => {
    const n = afterFinalReview({ ...s, hqFixRounds: 1 }, { ok: false, issues: [{ target: "material", text: "gương mờ" }], scores: scores(5) }, 0);
    expect(n.state).toBe("optimizing");
    expect(n.backlog).toEqual([{ target: "material", text: "gương mờ" }]);
    expect(n.note).toMatch(/lần cuối/);
  });
  it("geometry-only issues with finalFixRounds 1: no CAD round, backlog", () => {
    const n = afterFinalReview(s, { ok: false, issues: [{ target: "geometry", text: "thiếu COP" }], scores: scores(5) }, 0);
    expect(n.state).toBe("optimizing");
    expect(n.backlog).toEqual([{ target: "geometry", text: "thiếu COP" }]);
  });
  it("finalFixRounds >= 2 lets geometry issues go back to modeling", () => {
    const s2 = { ...s, maxHqFixRounds: 2, fixRounds: 6, maxFixRounds: 6 };
    const n = afterFinalReview(s2, { ok: false, issues: [{ target: "geometry", text: "thiếu COP" }], scores: scores(5) }, 0);
    expect(n.state).toBe("modeling");
    expect(n.issues).toEqual([{ target: "geometry", text: "thiếu COP" }]);
    expect(n.hqFixRounds).toBe(1);
    expect(n.round).toBe(s2.round + 1);
  });
  it("tracks the best final total; ending on a worse round asks for the best version", () => {
    let n = afterFinalReview(s, { ok: false, issues: [{ target: "material", text: "a" }], scores: scores(7) }, 0);
    expect(n.bestFinalScore).toBe(21);
    expect(n.bestFinalRound).toBe(0);
    n = afterStepOk(n, 0); // hqmaterials -> hqrender
    n = afterHqRender(n, { images: 6 });
    n = afterFinalReview(n, { ok: false, issues: [{ target: "material", text: "b" }], scores: scores(5) }, 0);
    expect(n.state).toBe("optimizing");
    expect(n.bestFinalScore).toBe(21);
    expect(shouldUseBestFinal(n)).toBe(true);
  });
  it("whole path hqrender -> hqreview -> hqmaterials -> hqrender -> hqreview -> optimizing", () => {
    let n = afterHqRender(at(s, "hqrender"), { images: 6 });
    expect(n.state).toBe("hqreview");
    n = afterFinalReview(n, { ok: false, issues: [{ target: "material", text: "gương", views: ["door"] }], scores: scores(6) }, 0);
    expect(n.state).toBe("hqmaterials");
    n = afterStepOk(n, 0);
    expect(n.state).toBe("hqrender");
    n = afterHqRender(n, { images: 6 });
    n = afterFinalReview(n, { ok: true, issues: [], scores: scores(8) }, 0);
    expect(n.state).toBe("optimizing");
    expect(shouldUseBestFinal(n)).toBe(false);
    expect(afterStepOk(n, 0).state).toBe("presenting");
  });
});
