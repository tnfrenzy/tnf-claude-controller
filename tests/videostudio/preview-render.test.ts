import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { EventEmitter } from "node:events";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createVsCore } from "../../src/core/videostudio/core.js";
import { createVsJobs } from "../../src/core/videostudio/jobs.js";
import { buildFfmpegArgs, draftPlan } from "../../src/core/videostudio/render.js";
import { findFfmpeg, knownFfmpegDirs } from "../../src/core/videostudio/settings.js";
import type { VsStepManager } from "../../src/core/videostudio/agent.js";
import type { VsPlan, VsStyle } from "../../src/core/videostudio/plan-types.js";
import { VideoStudioRoomBody } from "../../ui/src/components/videostudio/VideoStudioRoomBody";
import { readLastPreview } from "../../ui/src/components/videostudio/studio-room-logic";
import { dicts } from "../../ui/src/i18n";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-preview-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const env: NodeJS.ProcessEnv = { PATH: "" };
const manager: VsStepManager = {
  startRun: async () => ({ id: "r1" }),
  waitFor: async () => ({ status: "done", result_text: "", cost_usd_est: 0 }),
  cancel: () => true,
  store: { getProject: () => ({}), upsertProject: () => ({}) },
};
const input = { title: "Demo", brief: "b", styleId: "news", aspect: "16:9" as const };
const card = { id: "c1", kind: "card", srcIn: 0, duration: 3, color: "#000000", cardText: "x" };

function setup(withFfmpeg: boolean, video: unknown[] = [card]) {
  const core = createVsCore({ manager, dataDir: dir, env });
  if (withFfmpeg) {
    const exe = path.join(dir, "ffmpeg.exe");
    fs.writeFileSync(exe, "");
    core.settings.update({ ffmpegPath: exe });
  }
  const p = core.store.create(input);
  core.store.savePlan(p.slug, { ...core.store.getPlan(p.slug), video } as never);
  return { core, slug: p.slug };
}

function fakeSpawn(code: number, calls: string[][] = []) {
  return ((_cmd: string, args: string[]) => {
    calls.push(args);
    const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter; stderr: EventEmitter; kill: () => void };
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    child.kill = () => undefined;
    setImmediate(() => {
      if (code === 0) fs.writeFileSync(args[args.length - 1]!, "mp4");
      child.emit("close", code);
    });
    return child;
  }) as never;
}

const style = { id: "s", name: "S", builtin: true, transition: "fade", transitionSec: 0.5, shotSec: 3, font: "Arial", textColor: "#ffffff", textBox: false, visualPrompt: "x" } as VsStyle;
const bigPlan: VsPlan = {
  version: 1,
  width: 1920,
  height: 1080,
  fps: 30,
  video: [{ id: "c1", kind: "card", srcIn: 0, duration: 3, color: "#000000", cardText: "x" }],
  audio: [],
  texts: [{ id: "t1", text: "Hi", start: 0, duration: 2, size: 90 }, { id: "t2", text: "Yo", start: 0, duration: 2 }],
};

describe("draftPlan", () => {
  it("shrinks the longer side to 640 with even sizes, caps fps at 15 and scales explicit text sizes", () => {
    const d = draftPlan(bigPlan);
    expect([d.width, d.height]).toEqual([640, 360]);
    expect(d.fps).toBe(15);
    expect(d.texts[0]!.size).toBe(30);
    expect(d.texts[1]!.size).toBeUndefined();
    // the plan itself is untouched
    expect(bigPlan.width).toBe(1920);
    expect(bigPlan.fps).toBe(30);
  });
  it("handles vertical and already small plans", () => {
    expect([draftPlan({ ...bigPlan, width: 1080, height: 1920 }).width, draftPlan({ ...bigPlan, width: 1080, height: 1920 }).height]).toEqual([360, 640]);
    const small = draftPlan({ ...bigPlan, width: 320, height: 180, fps: 10 });
    expect([small.width, small.height, small.fps]).toEqual([320, 180, 10]);
  });
});

describe("buildFfmpegArgs draft option", () => {
  it("adds the fast x264 preset only for a draft", () => {
    const o = { projectDir: dir, outFile: path.join(dir, "o.mp4"), workDir: dir };
    const full = buildFfmpegArgs(bigPlan, style, o).args;
    const draft = buildFfmpegArgs(bigPlan, style, { ...o, draft: true }).args;
    expect(full).not.toContain("ultrafast");
    expect(draft).toContain("ultrafast");
    expect(draft[draft.indexOf("-crf") + 1]).toBe("32");
  });
});

describe("preview job", () => {
  it("renders renders/preview.mp4 with the small plan, sets lastPreview and leaves the project ready", async () => {
    const { core, slug } = setup(true);
    const calls: string[][] = [];
    const jobs = createVsJobs(core, { spawn: fakeSpawn(0, calls), env });
    await jobs.preview(slug);
    const got = core.store.get(slug);
    expect(got.state).toBe("ready");
    expect(got.lastPreview).toBe("renders/preview.mp4");
    expect(got.lastRender ?? null).toBeNull();
    expect(fs.existsSync(core.store.filePath(slug, "renders/preview.mp4"))).toBe(true);
    expect(calls[0]).toContain("ultrafast");
    const rendersDir = path.dirname(core.store.filePath(slug, "renders/preview.mp4"));
    expect(fs.readdirSync(rendersDir).filter((n) => n.startsWith("tmp-"))).toEqual([]);
  });

  it("keeps a finished project 'done' after a new preview", async () => {
    const { core, slug } = setup(true);
    core.store.update(slug, { state: "done", lastRender: "renders/x.mp4" });
    const jobs = createVsJobs(core, { spawn: fakeSpawn(0), env });
    await jobs.preview(slug);
    expect(core.store.get(slug)).toMatchObject({ state: "done", lastPreview: "renders/preview.mp4", lastRender: "renders/x.mp4" });
  });

  it("fails with a Vietnamese message when ffmpeg is missing or the plan has no clips, and when ffmpeg fails", async () => {
    const none = setup(false);
    expect(() => createVsJobs(none.core, { env }).preview(none.slug)).toThrow(/ffmpeg/);
    const empty = setup(true, []);
    await createVsJobs(empty.core, { spawn: fakeSpawn(0), env }).preview(empty.slug);
    expect(empty.core.store.get(empty.slug)).toMatchObject({ state: "failed" });
    expect(String(empty.core.store.get(empty.slug).error)).toContain("cảnh");
    const bad = setup(true);
    await createVsJobs(bad.core, { spawn: fakeSpawn(1), env }).preview(bad.slug);
    expect(bad.core.store.get(bad.slug)).toMatchObject({ state: "failed" });
  });
});

describe("ffmpeg lookup outside PATH", () => {
  it("finds ffmpeg in a winget Links folder and in a winget package folder", () => {
    const local = path.join(dir, "Local");
    const links = path.join(local, "Microsoft", "WinGet", "Links");
    fs.mkdirSync(links, { recursive: true });
    fs.writeFileSync(path.join(links, "ffmpeg.exe"), "");
    expect(findFfmpeg(null, { PATH: "", LOCALAPPDATA: local })).toBe(path.join(links, "ffmpeg.exe"));

    const local2 = path.join(dir, "Local2");
    const bin = path.join(local2, "Microsoft", "WinGet", "Packages", "Gyan.FFmpeg_x", "ffmpeg-7.1-full_build", "bin");
    fs.mkdirSync(bin, { recursive: true });
    fs.writeFileSync(path.join(bin, "ffmpeg.exe"), "");
    expect(findFfmpeg(null, { PATH: "", LOCALAPPDATA: local2 })).toBe(path.join(bin, "ffmpeg.exe"));
  });
  it("lists the usual folders, and PATH still wins", () => {
    expect(knownFfmpegDirs({ ProgramData: "C:\\PD" }).join("|")).toContain("chocolatey");
    const bin = path.join(dir, "onpath");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "ffmpeg.exe"), "");
    expect(findFfmpeg(null, { PATH: bin })).toBe(path.join(bin, "ffmpeg.exe"));
  });
});

describe("preview in the room", () => {
  const detail = (project: Record<string, unknown>, planVideo = 1) =>
    ({
      project: { slug: "p", title: "P", brief: "", styleId: "s", aspect: "16:9", state: "ready", createdAt: "", updatedAt: "t1", ...project },
      plan: { version: 1, width: 1920, height: 1080, fps: 30, video: Array.from({ length: planVideo }, (_, i) => ({ id: `c${i}`, kind: "card", srcIn: 0, duration: 2 })), audio: [], texts: [] },
      assets: [],
    }) as never;
  const body = (d: never, ffmpegFound: boolean | null = true) =>
    renderToStaticMarkup(
      createElement(VideoStudioRoomBody, {
        detail: d, styles: [], time: 0, playing: false, busy: false, uploading: false, ffmpegFound,
        onUpload() {}, onPlayToggle() {}, onTime() {}, onEnded() {}, onSeek() {}, onPlanChange() {}, onEditSegment() {},
        onGeneratePlan() {}, onNarrate() {}, onRender() {}, onPreview() {}, onDownload() {}, onDelete() {},
      }),
    );

  it("shows the preview section with its button and note, and the empty hint when there is no preview", () => {
    const html = body(detail({}));
    expect(html).toContain(dicts.vi.vs_pv_title);
    expect(html).toContain(dicts.vi.vs_pv_btn);
    expect(html).toContain(dicts.vi.vs_pv_empty);
  });
  it("shows the player area when a preview exists and the finished-video box when a render exists", () => {
    const html = body(detail({ lastPreview: "renders/preview.mp4", lastRender: "renders/final.mp4" }));
    expect(html).toContain(dicts.vi.vs_pv_loading);
    expect(html).not.toContain(dicts.vi.vs_pv_empty);
    expect(html).toContain(dicts.vi.vs_pv_final);
    expect(html).toContain(dicts.vi.vs_pv_watch);
    expect(readLastPreview({ lastPreview: "x.mp4" } as never)).toBe("x.mp4");
    expect(readLastPreview({ lastPreview: "" } as never)).toBeNull();
  });
  it("warns when ffmpeg is missing and disables the preview button without a plan", () => {
    expect(body(detail({}), false)).toContain("Không tìm thấy ffmpeg");
    expect(body(detail({}), true)).not.toContain("Không tìm thấy ffmpeg");
    const html = body(detail({}, 0));
    expect(html).toMatch(/<button[^>]*disabled[^>]*>Dựng bản xem trước/);
  });
});

import { resolveFontFile } from "../../src/core/videostudio/render.js";
import fsx from "node:fs";
import osx from "node:os";
import pathx from "node:path";

describe("resolveFontFile", () => {
  it("maps a font name to a file in the fonts folder, falls back, and returns null when none exists", () => {
    const dir = fsx.mkdtempSync(pathx.join(osx.tmpdir(), "tnf-fonts-"));
    try {
      expect(resolveFontFile("Segoe UI", dir)).toBeNull();
      fsx.writeFileSync(pathx.join(dir, "arial.ttf"), "x");
      expect(resolveFontFile("Arial", dir)).toBe(pathx.join(dir, "arial.ttf"));
      expect(resolveFontFile("Unknown Font", dir)).toBe(pathx.join(dir, "arial.ttf"));
      fsx.writeFileSync(pathx.join(dir, "segoeui.ttf"), "x");
      expect(resolveFontFile("Segoe UI", dir)).toBe(pathx.join(dir, "segoeui.ttf"));
    } finally {
      fsx.rmSync(dir, { recursive: true, force: true });
    }
  });
});
