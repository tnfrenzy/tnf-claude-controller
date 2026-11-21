import { describe, expect, it } from "vitest";
import type { W3DMaterial, W3DPlan } from "../../src/core/workshop3d/role-output.js";
import { addNote, applyStepResult, COST_NOTE_PREFIX, crossCheckMaterials, isValidSnapshot, isWorking, mergeBrief, promptCtx, withCostWarning } from "../../src/core/workshop3d/runner-helpers.js";
import { initialSnapshot } from "../../src/core/workshop3d/state.js";

const plan: W3DPlan = { bbox_mm: [1, 1, 1], tolerance_mm: 1, parts: [{ id: "floor", name: "Sàn", material: "đá" }, { id: "wall", name: "Vách", material: "inox" }] };
const m: W3DMaterial = { color: [0.5, 0.5, 0.5], metallic: 1, roughness: 0.2 };

describe("crossCheckMaterials", () => {
  it("accepts an exact match without a note", () => {
    const r = crossCheckMaterials(plan, { floor: m, wall: m });
    expect(r).toEqual({ ok: true, value: { materials: { floor: m, wall: m } } });
  });
  it("fails and lists every missing part id", () => {
    const r = crossCheckMaterials(plan, { floor: m });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/wall/);
  });
  it("drops unknown ids with a note", () => {
    const r = crossCheckMaterials(plan, { floor: m, wall: m, ghost: m, extra_2: m });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(Object.keys(r.value.materials).sort()).toEqual(["floor", "wall"]);
      expect(r.value.note).toMatch(/ghost/);
      expect(r.value.note).toMatch(/extra_2/);
    }
  });
});

describe("mergeBrief slots", () => {
  const b = { title: "T", object: "o", params: {}, detail: "high" as const, attachments: [] };
  it("keeps the slots of the request sheet when intake returns none, and lets intake slots win", () => {
    const slots = [{ id: "handrail", name: "Tay vịn", type: "part" as const }];
    expect(mergeBrief({ ...b, slots }, b).slots).toEqual(slots);
    const other = [{ id: "stone", name: "Đá", type: "material" as const }];
    expect(mergeBrief({ ...b, slots }, { ...b, slots: other }).slots).toEqual(other);
  });
});

describe("mergeBrief", () => {
  it("takes the intake brief, merges params and keeps the staged attachments", () => {
    const old = { title: "x", object: "y", params: { w: 1, h: 2 }, material: "inox", detail: "standard" as const, attachments: ["a.dxf"] };
    const nb = { title: "Cabin", object: "cabin khách", params: { h: 3, d: 4 }, detail: "high" as const, attachments: [] };
    expect(mergeBrief(old, nb)).toEqual({ title: "Cabin", object: "cabin khách", params: { w: 1, h: 3, d: 4 }, material: "inox", detail: "high", attachments: ["a.dxf"] });
  });
});

describe("promptCtx", () => {
  const brief = { title: "x", object: "y", params: {}, detail: "standard" as const, attachments: [] };
  it("drops missing pieces and maps the current script to files", () => {
    expect(promptCtx({ brief, plan: undefined, art: undefined, script: null, buildStats: null })).toEqual({ brief });
    const c = promptCtx({ brief, plan, script: "print(1)", buildStats: "{}", renders: ["a.png"], issues: [], answers: [] });
    expect(c).toEqual({ brief, plan, files: { "model.py": "print(1)" }, buildStats: "{}", renders: ["a.png"], issues: [], answers: [] });
  });
});

describe("notes", () => {
  it("addNote appends without duplicating", () => {
    expect(addNote(null, "a")).toBe("a");
    expect(addNote("a", "b")).toBe("a\nb");
    expect(addNote("a\nb", "b")).toBe("a\nb");
    expect(addNote("a", null)).toBe("a");
  });
  it("withCostWarning adds the note once when the cost passes the threshold", () => {
    const s = { ...initialSnapshot(), costUsd: 19 };
    expect(withCostWarning(s, 20)).toBe(s);
    const over = withCostWarning({ ...s, costUsd: 21, note: "x" }, 20);
    expect(over.note).toContain(COST_NOTE_PREFIX);
    expect(over.note!.startsWith("x\n")).toBe(true);
    expect(over.state).toBe(s.state);
    const again = withCostWarning({ ...over, costUsd: 40 }, 20);
    expect(again.note!.split(COST_NOTE_PREFIX).length).toBe(2);
  });
});

describe("applyStepResult", () => {
  const run = { ...initialSnapshot(), state: "planning" as const, costUsd: 1 };
  const next = (s: typeof run) => ({ ...s, state: "modeling" as const, costUsd: s.costUsd + 0.5 });
  it("applies when still at the step", () => {
    expect(applyStepResult(run, "planning", 0.5, next)).toEqual({ applied: true, next: { ...run, state: "modeling", costUsd: 1.5 } });
  });
  it("keeps the result under pause and stays paused at the next step", () => {
    const paused = { ...run, state: "paused" as const, resumeState: "planning" as const };
    const r = applyStepResult(paused, "planning", 0.5, next);
    expect(r.applied).toBe(true);
    expect(r.next).toMatchObject({ state: "paused", resumeState: "modeling", costUsd: 1.5 });
    const q = applyStepResult(paused, "planning", 0.5, (s) => ({ ...s, state: "waiting_quota", waitUntil: 9, costUsd: s.costUsd + 0.5 }));
    expect(q.next).toMatchObject({ state: "paused", resumeState: "planning", costUsd: 1.5, waitUntil: null });
    const f = applyStepResult(paused, "planning", 0, (s) => ({ ...s, state: "failed", resumeState: "planning" }));
    expect(f.next).toMatchObject({ state: "failed", resumeState: "planning" });
  });
  it("drops the result after stop (or any other state), counting only the cost", () => {
    const stopped = { ...run, state: "stopped" as const, resumeState: "planning" as const };
    expect(applyStepResult(stopped, "planning", 0.5, next)).toEqual({ applied: false, next: { ...stopped, costUsd: 1.5 } });
    expect(applyStepResult(stopped, "planning", 0, next)).toEqual({ applied: false, next: stopped });
    expect(applyStepResult({ ...run, state: "art" }, "planning", 0, next).applied).toBe(false);
  });
});

describe("snapshot validity", () => {
  it("isValidSnapshot needs an object with a known state and numeric counters", () => {
    expect(isValidSnapshot(initialSnapshot())).toBe(true);
    for (const bad of [null, [], {}, { ...initialSnapshot(), state: "bogus" }, { ...initialSnapshot(), round: "1" }, { ...initialSnapshot(), costUsd: Number.NaN }]) {
      expect(isValidSnapshot(bad)).toBe(false);
    }
  });
  it("isWorking is true only for pipeline steps before done and waiting_quota", () => {
    expect(["intake", "art", "building", "presenting", "waiting_quota"].every((s) => isWorking(s))).toBe(true);
    expect(["done", "paused", "stopped", "failed", "awaiting_user", "bogus", undefined].some((s) => isWorking(s))).toBe(false);
  });
});
