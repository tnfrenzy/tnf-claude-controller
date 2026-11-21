/**
 * Regression for "Undefined constant or missing '(' in 'STARTPTS'": the filter graph once said PTS-STARTPS.
 * The args test always runs; the real ffmpeg test runs only on a machine that has ffmpeg.
 */
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { buildFfmpegArgs, draftPlan } from "../../src/core/videostudio/render.js";
import { findFfmpeg, findFfprobe } from "../../src/core/videostudio/settings.js";
import { createVsCore } from "../../src/core/videostudio/core.js";
import { createVsJobs } from "../../src/core/videostudio/jobs.js";
import type { VsPlan, VsStyle } from "../../src/core/videostudio/plan-types.js";

const style = { id: "s", name: "S", builtin: true, transition: "fade", transitionSec: 0.5, shotSec: 3, font: "Arial", textColor: "#ffffff", textBox: true, visualPrompt: "x" } as VsStyle;
const plan: VsPlan = {
  version: 1,
  width: 640,
  height: 360,
  fps: 15,
  video: [
    { id: "a", kind: "card", srcIn: 0, duration: 1, color: "#222222", cardText: "Thang máy" },
    { id: "b", kind: "card", srcIn: 0, duration: 1, color: "#003366", cardText: "Gia đình" },
  ],
  audio: [],
  texts: [{ id: "t", text: "Êm ái\nAn toàn", start: 0, duration: 1.5 }],
};

describe("ffmpeg filter graph", () => {
  it("uses the real setpts/asetpts constant STARTPTS", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-args-"));
    try {
      const { args } = buildFfmpegArgs(plan, style, { projectDir: dir, outFile: path.join(dir, "o.mp4"), workDir: dir });
      const graph = args[args.indexOf("-filter_complex") + 1]!;
      expect(graph).toContain("setpts=PTS-STARTPTS");
      expect(graph).not.toContain("STARTPS");
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});

const ffmpeg = findFfmpeg(null, process.env);
const tmps: string[] = [];
afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true });
});

describe.skipIf(!ffmpeg)("real ffmpeg", () => {
  const manager = { startRun: async () => ({ id: "r" }), waitFor: async () => ({ status: "done", result_text: "", cost_usd_est: 0 }), cancel: () => true, store: { getProject: () => ({}), upsertProject: () => ({}) } };

  function setup() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-realff-"));
    tmps.push(dir);
    const core = createVsCore({ manager: manager as never, dataDir: dir, env: process.env });
    core.settings.update({ ffmpegPath: ffmpeg });
    const p = core.store.create({ title: "Real", brief: "", styleId: "news", aspect: "16:9" });
    core.store.savePlan(p.slug, { ...core.store.getPlan(p.slug), video: plan.video, texts: plan.texts } as never);
    return { core, slug: p.slug, jobs: createVsJobs(core, { env: process.env }) };
  }

  const probe = (file: string) => {
    const r = spawnSync(findFfprobe(ffmpeg, process.env) ?? "ffprobe", ["-v", "error", "-show_entries", "stream=width,height:format=duration", "-of", "default=nw=1", file], { encoding: "utf8" });
    return r.stdout;
  };

  it("renders the preview (small, quick) and the full video from cards and Vietnamese text", async () => {
    const { core, slug, jobs } = setup();
    await jobs.preview(slug);
    let got = core.store.get(slug);
    expect(got.error ?? "").toBe("");
    expect(got.lastPreview).toBe("renders/preview.mp4");
    expect(fs.statSync(core.store.filePath(slug, "renders/preview.mp4")).size).toBeGreaterThan(1000);
    expect(probe(core.store.filePath(slug, "renders/preview.mp4"))).toMatch(/duration=2\./);

    await jobs.render(slug);
    got = core.store.get(slug);
    expect(got.error ?? "").toBe("");
    expect(got.state).toBe("done");
    expect(probe(core.store.filePath(slug, got.lastRender as string))).toMatch(/width=1920\s+height=1080|width=1920/);
  }, 120_000);

  it("draftPlan output is accepted by ffmpeg too", () => {
    const small = draftPlan({ ...plan, width: 1920, height: 1080, fps: 30 });
    expect([small.width, small.height, small.fps]).toEqual([640, 360, 15]);
  });
});
