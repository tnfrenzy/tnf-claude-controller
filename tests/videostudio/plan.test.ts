import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";
import { VsError, emptyPlan, planDuration, safeVsRel, validatePlan } from "../../src/core/videostudio/plan.js";

function base(): Record<string, unknown> {
  return { version: 1, width: 1920, height: 1080, fps: 30, video: [], audio: [], texts: [] };
}
function errs(raw: unknown): string[] {
  const r = validatePlan(raw);
  if (r.ok) throw new Error("expected failure");
  return r.errors;
}
const VI = /[À-ỹ]/;

describe("validatePlan", () => {
  it("accepts all clip kinds and normalizes assets", () => {
    const r = validatePlan({
      ...base(),
      video: [
        { id: "a", kind: "video", asset: "a\\b.mp4", srcIn: 0, duration: 3 },
        { id: "b", kind: "image", prompt: "cat", srcIn: 0, duration: 2 },
        { id: "c", kind: "card", color: "#112233", cardText: "hi", srcIn: 0, duration: 1 },
      ],
      audio: [{ id: "m", asset: "m.mp3", start: 0, duration: 5, volume: 1 }],
      texts: [{ id: "t", text: "xin chào", start: 0, duration: 2 }],
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.video[0]?.asset).toBe("a/b.mp4");
  });

  it("card without color gets black and needs no asset", () => {
    const r = validatePlan({ ...base(), video: [{ id: "c", kind: "card", srcIn: 0, duration: 1 }] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.plan.video[0]?.color).toBe("#000000");
  });

  it("rejects bad card color", () => {
    expect(errs({ ...base(), video: [{ id: "c", kind: "card", color: "red", srcIn: 0, duration: 1 }] }).length).toBeGreaterThan(0);
  });

  it.each(["../x", "/abs", "C:/a"])("rejects asset %s", (asset) => {
    const e = errs({ ...base(), video: [{ id: "a", kind: "video", asset, srcIn: 0, duration: 1 }] });
    expect(e.length).toBeGreaterThan(0);
  });

  it("rejects duplicate ids in the same array but not across arrays", () => {
    const dup = errs({
      ...base(),
      video: [
        { id: "a", kind: "card", duration: 1 },
        { id: "a", kind: "card", duration: 1 },
      ],
    });
    expect(dup.length).toBeGreaterThan(0);
    const ok = validatePlan({
      ...base(),
      video: [{ id: "a", kind: "card", duration: 1 }],
      texts: [{ id: "a", text: "x", start: 0, duration: 1 }],
    });
    expect(ok.ok).toBe(true);
  });

  it("rejects bad id characters", () => {
    expect(errs({ ...base(), video: [{ id: "a b", kind: "card", duration: 1 }] }).length).toBeGreaterThan(0);
  });

  it.each([-1, 0, 601])("rejects duration %s with Vietnamese message", (d) => {
    const e = errs({ ...base(), video: [{ id: "a", kind: "card", duration: d }] });
    expect(e.length).toBeGreaterThan(0);
    expect(e.join(" ")).toMatch(VI);
  });

  it("rejects odd width and fps 61", () => {
    expect(errs({ ...base(), width: 1921 }).length).toBeGreaterThan(0);
    expect(errs({ ...base(), fps: 61 }).length).toBeGreaterThan(0);
  });

  it("rejects 201 video clips", () => {
    const video = Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, kind: "card", duration: 1 }));
    expect(errs({ ...base(), video }).length).toBeGreaterThan(0);
  });

  it("rejects video without asset and prompt", () => {
    expect(errs({ ...base(), video: [{ id: "a", kind: "video", duration: 1 }] }).length).toBeGreaterThan(0);
  });

  it("does not throw on garbage", () => {
    expect(validatePlan(null).ok).toBe(false);
    expect(validatePlan("x").ok).toBe(false);
    expect(validatePlan([]).ok).toBe(false);
    expect(validatePlan({ version: 1 }).ok).toBe(false);
  });
});

describe("emptyPlan / planDuration", () => {
  it("sizes by aspect", () => {
    const p = emptyPlan("x", "9:16");
    expect([p.width, p.height, p.fps, p.styleId]).toEqual([1080, 1920, 30, "x"]);
    expect(emptyPlan("x", "16:9").width).toBe(1920);
    expect(emptyPlan("x", "1:1").height).toBe(1080);
  });

  it("computes duration", () => {
    const p = emptyPlan("x", "16:9");
    expect(planDuration(p)).toBe(0);
    p.video.push({ id: "a", kind: "card", srcIn: 0, duration: 3 }, { id: "b", kind: "card", srcIn: 0, duration: 2 });
    expect(planDuration(p)).toBe(5);
    p.audio.push({ id: "m", asset: "m.mp3", start: 4, duration: 3, volume: 1 });
    expect(planDuration(p)).toBe(7);
    p.texts.push({ id: "t", text: "x", start: 8, duration: 2 });
    expect(planDuration(p)).toBe(10);
  });
});

describe("safeVsRel", () => {
  it.each(["C:/a", "/a", "a/../b", "", "a//b", "a/", "a/./b", "."])("throws VsError 400 for %j", (r) => {
    try {
      safeVsRel(r);
      throw new Error("no throw");
    } catch (e) {
      expect(e).toBeInstanceOf(VsError);
      expect((e as VsError).status).toBe(400);
    }
  });
  it("normalizes backslashes", () => {
    expect(safeVsRel("a\\b\\c.png")).toBe("a/b/c.png");
  });
});

describe("plan-types.ts", () => {
  it("has no import, export-from or require", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "src", "core", "videostudio", "plan-types.ts"), "utf8");
    expect(src).not.toMatch(/^\s*import\s/m);
    expect(src).not.toMatch(/\bexport\s.*\sfrom\s/);
    expect(src).not.toMatch(/\brequire\(/);
  });
});
