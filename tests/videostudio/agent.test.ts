import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { loadVsRoles, buildDirectorPrompt, buildSegmentEditPrompt, parsePlanFromText, parseSegmentFromText, applySegmentEdit, createVsAgentRunner } from "../../src/core/videostudio/agent.js";
import type { VsPlan } from "../../src/core/videostudio/plan-types.js";

describe("prompts", () => {
  it("director prompt has assets, size, style", () => {
    const p = buildDirectorPrompt({
      description: "quảng cáo cà phê",
      width: 1920,
      height: 1080,
      style: { shotSec: 3.5, transition: "fade", visualPrompt: "ấm áp" },
      assets: [{ path: "assets/cup.mp4", kind: "video", durationSec: 8 }],
    });
    expect(p).toContain("assets/cup.mp4");
    expect(p).toContain("1920x1080");
    expect(p).toContain("shotSec");
    expect(p).toContain("không tin cậy");
    expect(p).toContain("json");
  });
  it("segment prompt has range and instruction", () => {
    const plan: VsPlan = { version: 1, width: 1280, height: 720, fps: 30, video: [], audio: [], texts: [] };
    const p = buildSegmentEditPrompt({ plan, start: 2, end: 6, instruction: "làm cảnh tối hơn" });
    expect(p).toContain("[2, 6]");
    expect(p).toContain("làm cảnh tối hơn");
    expect(p).toContain("không tin cậy");
    expect(p).toContain("json");
  });
});

const basePlan: VsPlan = {
  version: 1,
  width: 1280,
  height: 720,
  fps: 25,
  styleId: "s1",
  video: [],
  audio: [],
  texts: [],
};
const fence = (o: unknown): string => "```json\n" + JSON.stringify(o) + "\n```";

describe("parse", () => {
  it("takes the last json block and keeps base size/fps/styleId", () => {
    const first = { version: 1, width: 640, height: 360, fps: 10, video: [{ id: "x", kind: "card", duration: 1 }], audio: [], texts: [] };
    const last = { version: 1, width: 640, height: 360, fps: 10, styleId: "zz", video: [{ id: "y", kind: "card", duration: 2 }], audio: [], texts: [] };
    const p = parsePlanFromText(`a ${fence(first)} b ${fence(last)}`, basePlan);
    expect(p.video[0]?.id).toBe("y");
    expect([p.width, p.height, p.fps, p.styleId]).toEqual([1280, 720, 25, "s1"]);
  });
  it("throws without block, with broken json or invalid plan", () => {
    expect(() => parsePlanFromText("không có", basePlan)).toThrow();
    expect(() => parsePlanFromText("```json\n{oops\n```", basePlan)).toThrow();
    // A missing duration is repaired now; a plan that is structurally too big is still refused.
    const bad = { version: 1, video: Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, kind: "card", duration: 1 })), audio: [], texts: [] };
    expect(() => parsePlanFromText(fence(bad), basePlan)).toThrow();
  });
  it("parses a valid segment and rejects invalid ones", () => {
    const seg = { video: [{ id: "a", kind: "card", duration: 2 }], texts: [{ id: "t", text: "hi", start: 0, duration: 1 }] };
    const r = parseSegmentFromText(fence(seg), basePlan);
    expect(r.video).toHaveLength(1);
    expect(r.video[0]?.duration).toBe(2);
    expect(r.texts[0]?.text).toBe("hi");
    expect(() => parseSegmentFromText(fence({ video: Array.from({ length: 201 }, (_, i) => ({ id: `c${i}`, kind: "card", duration: 1 })), texts: [] }), basePlan)).toThrow();
    expect(() => parseSegmentFromText(fence({ video: [] }), basePlan)).toThrow();
  });
});

describe("applySegmentEdit", () => {
  const plan: VsPlan = {
    ...basePlan,
    video: [
      { id: "c1", kind: "video", asset: "a.mp4", srcIn: 0, duration: 4 },
      { id: "c2", kind: "video", asset: "b.mp4", srcIn: 0, duration: 4 },
      { id: "c3", kind: "video", asset: "c.mp4", srcIn: 1, duration: 4 },
    ],
    audio: [{ id: "m", asset: "m.mp3", start: 0, duration: 12, volume: 0.5 }],
    texts: [
      { id: "t0", text: "ngoài", start: 0, duration: 1 },
      { id: "t1", text: "trong", start: 3, duration: 1 },
      { id: "t2", text: "sau", start: 9, duration: 1 },
    ],
    narration: "nd",
  };
  const seg = {
    video: [{ id: "n1", kind: "card" as const, srcIn: 0, duration: 4 }],
    texts: [{ id: "tn", text: "mới", start: 1, duration: 1 }],
  };
  it("replaces the range, splits boundary clips, shifts texts, keeps the rest", () => {
    const snapshot = JSON.stringify(plan);
    const r = applySegmentEdit(plan, 2, 6, seg);
    expect(JSON.stringify(plan)).toBe(snapshot);
    expect(r.video.map((c) => c.id)).toEqual(["c1", "n1", "c2", "c3"]);
    expect(r.video[0]).toMatchObject({ srcIn: 0, duration: 2 });
    expect(r.video[2]).toMatchObject({ srcIn: 2, duration: 2, asset: "b.mp4" });
    expect(r.video[3]).toEqual(plan.video[2]);
    expect(r.audio).toEqual(plan.audio);
    expect(r.narration).toBe("nd");
    expect(r.texts.map((t) => [t.id, t.start])).toEqual([["t0", 0], ["t2", 9], ["tn", 3]]);
  });
  it("gives split tails unique ids within 40 chars", () => {
    const longId = "x".repeat(40);
    const p: VsPlan = { ...basePlan, video: [{ id: longId, kind: "video", asset: "a.mp4", srcIn: 0, duration: 6 }] };
    const r = applySegmentEdit(p, 2, 3, { video: [{ id: "n1", kind: "card", srcIn: 0, duration: 1 }], texts: [] });
    expect(r.video).toHaveLength(3);
    expect(new Set(r.video.map((c) => c.id)).size).toBe(3);
    expect(r.video[2]).toMatchObject({ srcIn: 3, duration: 3 });
    for (const c of r.video) expect(c.id.length).toBeLessThanOrEqual(40);
  });
  it("throws on a bad range", () => {
    expect(() => applySegmentEdit(plan, -1, 2, seg)).toThrow();
    expect(() => applySegmentEdit(plan, 3, 3, seg)).toThrow();
    expect(() => applySegmentEdit(plan, 5, 2, seg)).toThrow();
  });
});

describe("createVsAgentRunner", () => {
  const roles = {
    "video-director": { description: "d", systemPrompt: "SP-D", model: "opus" },
    "video-editor": { description: "e", systemPrompt: "SP-E" },
  };
  function fake(hasProject: boolean, status = "done") {
    const calls: any[] = [];
    const upserts: any[] = [];
    const m = {
      calls,
      upserts,
      store: {
        getProject: () => (hasProject ? { name: "videostudio" } : undefined),
        upsertProject: (p: unknown) => void upserts.push(p),
      },
      startRun: async (i: unknown) => (calls.push(i), { id: "r1" }),
      waitFor: async () => ({ status, cost_usd_est: 0.5, result_text: "kq" }),
      cancel: () => true,
    };
    return m;
  }
  it("creates the internal project when missing and runs read-only", async () => {
    const m = fake(false);
    const run = createVsAgentRunner(m, roles);
    const r = await run("video-director", "P", "/proj");
    expect(m.upserts).toEqual([{ name: "videostudio", repo_path: null, base_branch: null, allowed_commands: [] }]);
    expect(m.calls[0]).toMatchObject({
      prompt: "P",
      project: "videostudio",
      model: "opus",
      readOnly: { systemPrompt: "SP-D", allowedTools: ["Read"], addDirs: ["/proj"] },
    });
    expect(r).toMatchObject({ text: "kq", costUsd: 0.5, ok: true });
  });
  it("does not recreate an existing project; ok false when not done", async () => {
    const m = fake(true, "failed");
    const run = createVsAgentRunner(m, roles);
    const r = await run("video-editor", "P", "/proj");
    expect(m.upserts).toHaveLength(0);
    expect(m.calls[0].model).toBeUndefined();
    expect(r.ok).toBe(false);
  });
  it("returns ok false with error when startRun throws", async () => {
    const m = fake(true);
    m.startRun = async () => {
      throw new Error("boom");
    };
    const r = await createVsAgentRunner(m, roles)("video-editor", "P", "/proj");
    expect(r).toMatchObject({ ok: false, error: "boom", text: "", costUsd: 0 });
  });
  it("returns ok false when waitFor rejects", async () => {
    const m = fake(true);
    m.waitFor = async () => {
      throw new Error("wait failed");
    };
    const r = await createVsAgentRunner(m, roles)("video-editor", "P", "/proj");
    expect(r).toMatchObject({ ok: false, error: "wait failed", runId: "r1" });
  });
  it("passes maxBudgetUsd to startRun when given", async () => {
    const m = fake(true);
    await createVsAgentRunner(m, roles, { maxBudgetUsd: 2 })("video-editor", "P", "/proj");
    expect(m.calls[0].maxBudgetUsd).toBe(2);
    const m2 = fake(true);
    await createVsAgentRunner(m2, roles)("video-editor", "P", "/proj");
    expect(m2.calls[0].maxBudgetUsd).toBeUndefined();
  });
});

describe("loadVsRoles", () => {
  it("loads both roles from the default file", () => {
    const r = loadVsRoles();
    expect(r["video-director"].systemPrompt.length).toBeGreaterThan(0);
    expect(r["video-editor"].systemPrompt.length).toBeGreaterThan(0);
  });
  it("throws on missing role or systemPrompt", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vsroles-"));
    const a = path.join(dir, "a.json");
    fs.writeFileSync(a, JSON.stringify({ "video-director": { description: "x", systemPrompt: "y" } }));
    expect(() => loadVsRoles(a)).toThrow();
    const b = path.join(dir, "b.json");
    fs.writeFileSync(
      b,
      JSON.stringify({ "video-director": { systemPrompt: "y" }, "video-editor": { systemPrompt: "" } }),
    );
    expect(() => loadVsRoles(b)).toThrow();
  });
});
