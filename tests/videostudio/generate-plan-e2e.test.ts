/** The planning flow end to end with the answer shape that used to fail ("Kế hoạch không hợp lệ: video[0].id ..."). */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createVsCore } from "../../src/core/videostudio/core.js";
import type { VsStepManager } from "../../src/core/videostudio/agent.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-plan-e2e-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const ANSWER = {
  version: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  video: [
    { start: 0, duration: 3, transition: "fade", prompt: "Close-up of a hand on a handrail, soft light." },
    { asset: "assets/product-front.png", start: 3, duration: 3, transition: "fade" },
    { asset: "assets/Cabin_Demo.MP4", start: 6, duration: 3, transition: "fade" },
    { asset: "assets/not-uploaded.jpg", start: 9, duration: 3, transition: "fade" },
  ],
  audio: [],
  texts: [{ text: "Nhà nhiều tầng?", start: 0, duration: 3 }, { text: "Thang máy gia đình", start: 3, duration: 3 }],
  narration: ["Đi lại có dễ?", "Đã có giải pháp."],
};

function managerReturning(text: string): VsStepManager {
  return {
    startRun: async () => ({ id: "r1" }),
    waitFor: async () => ({ status: "done", result_text: text, cost_usd_est: 0.15 }),
    cancel: () => true,
    store: { getProject: () => ({}), upsertProject: () => ({}) },
  };
}

describe("generatePlan with a sloppy director answer", () => {
  it("ends 'ready' with a valid plan: ids, kinds, real asset names, one narration string", async () => {
    const text = `Tôi đã lập kế hoạch.\n\`\`\`json\n${JSON.stringify(ANSWER)}\n\`\`\``;
    const core = createVsCore({ manager: managerReturning(text), dataDir: dir, env: { PATH: "" } });
    const p = core.store.create({ title: "Demo", brief: "Giới thiệu", styleId: "product-showcase", aspect: "16:9" });
    await core.addAsset(p.slug, "product-front.png", Buffer.from([137, 80, 78, 71]));
    await core.addAsset(p.slug, "cabin_demo.mp4", Buffer.from([0, 0, 0, 24]));

    await core.generatePlan(p.slug);

    const project = core.store.get(p.slug);
    expect(project.error ?? null).toBeNull();
    expect(project.state).toBe("ready");
    const plan = core.store.getPlan(p.slug);
    expect(plan.video).toHaveLength(4);
    expect(plan.video.map((c) => c.id)).toEqual(["v1", "v2", "v3", "v4"]);
    // prompt-only scene -> card (no media provider is configured), real assets keep their stored names
    expect(plan.video[0]).toMatchObject({ kind: "card" });
    expect(plan.video[1]).toMatchObject({ kind: "image", asset: "assets/product-front.png" });
    expect(plan.video[2]).toMatchObject({ kind: "video", asset: "assets/cabin_demo.mp4" });
    // the file that was never uploaded does not fail the plan: the scene falls back to a card
    expect(plan.video[3]!.asset).toBeUndefined();
    expect(plan.texts.map((t) => t.id)).toEqual(["t1", "t2"]);
    expect(plan.narration).toBe("Đi lại có dễ? Đã có giải pháp.");
  });

  it("an answer without any json block fails with a Vietnamese message, not a crash", async () => {
    const core = createVsCore({ manager: managerReturning("Xin lỗi, tôi không làm được."), dataDir: dir, env: { PATH: "" } });
    const p = core.store.create({ title: "Demo", brief: "", styleId: "product-showcase", aspect: "16:9" });
    await core.generatePlan(p.slug);
    const project = core.store.get(p.slug);
    expect(project.state).toBe("failed");
    expect(String(project.error)).toContain("json");
  });
});
