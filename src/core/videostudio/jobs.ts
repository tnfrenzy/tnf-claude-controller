// src/core/videostudio/jobs.ts
// Long jobs of Video Studio: narration (voice synth) and final render (ffmpeg).
import type { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { VsCore } from "./core.js";
import { synthesizeVoice, type VsGenDeps } from "./gen.js";
import { VsError, planDuration } from "./plan.js";
import type { VsAudioClip, VsStyle } from "./plan-types.js";
import { buildFfmpegArgs, draftPlan, probeDuration, probeHasAudio, runFfmpeg, styleSamplePlan } from "./render.js";
import { slicePlan } from "./plan-slice.js";
import { findFfmpeg, findFfprobe } from "./settings.js";

export interface VsJobsDeps {
  spawn?: typeof nodeSpawn | undefined;
  gen?: VsGenDeps | undefined;
  synth?: typeof synthesizeVoice | undefined;
  probe?: ((file: string) => Promise<number | null>) | undefined;
  env?: NodeJS.ProcessEnv | undefined;
}

export interface VsJobs {
  narrate(slug: string): Promise<void>;
  render(slug: string): Promise<void>;
  /** Quick low-resolution draft (renders/preview.mp4) to watch before the final render. */
  preview(slug: string, range?: { start: number; end: number }): Promise<void>;
  /** A few seconds rendered with the given style, so the user sees what it does. Returns the sample file name. */
  previewStyle(style: VsStyle): Promise<{ file: string }>;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").replace("T", "_").replace("Z", "");
}

const clampDur = (n: number): number => Math.min(600, Math.max(0.1, n));

export function createVsJobs(core: VsCore, deps: VsJobsDeps = {}): VsJobs {
  const env = deps.env ?? process.env;
  const synth = deps.synth ?? synthesizeVoice;
  const { store } = core;

  // Video assets with keepAudio that really have an audio stream (ffprobe); empty when ffprobe is missing.
  async function audioAssets(plan: { video: { kind: string; asset?: string | undefined; keepAudio?: boolean | undefined }[] }, projectDir: string): Promise<Set<string>> {
    const out = new Set<string>();
    const ffprobe = findFfprobe(core.settings.read().ffmpegPath, env);
    if (!ffprobe) return out;
    for (const c of plan.video) {
      if (c.kind !== "video" || c.keepAudio !== true || !c.asset || out.has(c.asset)) continue;
      try {
        if (await probeHasAudio(ffprobe, path.join(projectDir, c.asset), deps.spawn ? { spawn: deps.spawn } : {})) out.add(c.asset);
      } catch {
        /* no sound kept for this clip */
      }
    }
    return out;
  }

  return {
    narrate(slug) {
      const plan0 = store.getPlan(slug);
      const settings0 = core.settings.read();
      if (!plan0.narration || plan0.narration.trim() === "") {
        throw new VsError("Kế hoạch chưa có lời đọc để tạo giọng.", 400);
      }
      if (settings0.voice.provider === "none") {
        throw new VsError("Chưa bật giọng đọc AI trong cài đặt.", 400);
      }
      return core.runExclusive(slug, "generating", async () => {
        const plan = store.getPlan(slug);
        const base = core.settings.read();
        // The project's own voice (chosen in the narration panel) wins over the settings voice.
        const settings = plan.voice ? { ...base, voice: { ...base.voice, ...(plan.voice.name !== undefined ? { voiceName: plan.voice.name } : {}), ...(plan.voice.rate !== undefined ? { rate: plan.voice.rate } : {}) } } : base;
        const st = stamp();
        const name = `voice-${st}.wav`;
        const tmpDir = path.join(store.dir(slug), "tmp");
        fs.mkdirSync(tmpDir, { recursive: true });
        const tmpFile = path.join(tmpDir, name);
        let data: Buffer;
        try {
          const r = await synth(plan.narration ?? "", tmpFile, settings, deps.gen ?? {});
          if (!r.ok) throw new VsError(`Không tạo được giọng đọc: ${r.error}`, 502);
          data = fs.readFileSync(r.file);
        } finally {
          fs.rmSync(tmpFile, { force: true });
        }
        const asset = store.addAsset(slug, name, data, { generated: true });
        const assetFile = store.filePath(slug, asset.rel);

        let probed: number | null = null;
        try {
          if (deps.probe) probed = await deps.probe(assetFile);
          else {
            const ffprobe = findFfprobe(settings.ffmpegPath, env);
            if (ffprobe) probed = await probeDuration(ffprobe, assetFile, deps.spawn ? { spawn: deps.spawn } : {});
          }
        } catch {
          probed = null;
        }
        const validProbe = typeof probed === "number" && Number.isFinite(probed) && probed > 0;

        const kept: VsAudioClip[] = plan.audio.filter((c) => c.kind !== "narration");
        // Fallback is the plan length, not the real speech length, but that is per spec.
        const duration = clampDur(validProbe ? (probed as number) : planDuration({ ...plan, audio: kept }));
        if (validProbe) store.setAssetDuration(slug, asset.rel, duration);
        const ids = new Set(kept.map((c) => c.id));
        let id = `narration-${st}`;
        for (let i = 2; ids.has(id); i++) id = `narration-${st}-${i}`;
        kept.push({ id, asset: asset.rel, start: 0, duration, volume: 1, kind: "narration" });
        store.savePlan(slug, { ...plan, audio: kept });
      });
    },

    async previewStyle(style) {
      const ffmpeg = findFfmpeg(core.settings.read().ffmpegPath, env);
      if (!ffmpeg) {
        throw new VsError("Không tìm thấy ffmpeg. Hãy khai đường dẫn ffmpeg trong cài đặt Video Studio hoặc thêm ffmpeg vào PATH.", 400);
      }
      const dir = path.join(core.dataDir, "videostudio", "_style-preview");
      fs.mkdirSync(dir, { recursive: true });
      // keep the folder small: samples older than an hour are dropped
      for (const n of fs.readdirSync(dir)) {
        try {
          const p = path.join(dir, n);
          if (Date.now() - fs.statSync(p).mtimeMs > 3600_000) fs.rmSync(p, { recursive: true, force: true });
        } catch {
          /* ignore */
        }
      }
      const file = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}.mp4`;
      const outFile = path.join(dir, file);
      const workDir = fs.mkdtempSync(path.join(dir, "tmp-"));
      try {
        const plan = styleSamplePlan(style);
        const build = buildFfmpegArgs(plan, style, { projectDir: workDir, outFile, workDir, draft: true });
        for (const t of build.textFiles) fs.writeFileSync(t.path, t.content, "utf8");
        const res = await runFfmpeg(ffmpeg, build.args, { totalSec: planDuration(plan) }, deps.spawn ? { spawn: deps.spawn } : {});
        if (!res.ok) throw new VsError(`Dựng thử phong cách thất bại: ${res.error ?? "không rõ lý do"}`, 500);
        return { file };
      } finally {
        fs.rmSync(workDir, { recursive: true, force: true });
      }
    },

    preview(slug, range) {
      const ffmpeg = findFfmpeg(core.settings.read().ffmpegPath, env);
      if (!ffmpeg) {
        throw new VsError(
          "Không tìm thấy ffmpeg. Hãy khai đường dẫn ffmpeg trong cài đặt Video Studio hoặc thêm ffmpeg vào PATH.",
          400,
        );
      }
      const before = store.get(slug).state;
      return core.runExclusive(slug, "rendering", async () => {
        const project = store.get(slug);
        const full = store.getPlan(slug);
        if (full.video.length === 0) throw new VsError("Kế hoạch chưa có cảnh nào để dựng bản xem trước.", 422);
        // With a range only that part is rendered, which is much faster than the whole video.
        const plan = range ? slicePlan(full, range.start, range.end) : full;
        if (!plan) throw new VsError("Đoạn được chọn quá ngắn hoặc nằm ngoài video.", 422);
        const list = core.styles.list();
        const style = list.find((s) => s.id === project.styleId) ?? list.find((s) => s.builtin) ?? list[0];
        if (!style) throw new VsError("Không tìm thấy phong cách để dựng video.", 422);
        const st = stamp();
        const projectDir = store.dir(slug);
        const rendersDir = path.join(projectDir, "renders");
        const outFile = path.join(rendersDir, "preview.mp4");
        const workDir = path.join(rendersDir, `tmp-preview-${st}`);
        fs.mkdirSync(workDir, { recursive: true });
        try {
          const small = draftPlan(plan);
          const has = await audioAssets(small, projectDir);
          const build = buildFfmpegArgs(small, style, { projectDir, outFile, workDir, draft: true, assetHasAudio: (r) => has.has(r) });
          for (const t of build.textFiles) fs.writeFileSync(t.path, t.content, "utf8");
          const res = await runFfmpeg(ffmpeg, build.args, { totalSec: planDuration(small) }, deps.spawn ? { spawn: deps.spawn } : {});
          if (!res.ok) throw new VsError(`Dựng bản xem trước thất bại: ${res.error ?? "không rõ lý do"}`, 500);
          // A finished final render stays "done"; the draft only adds the preview file.
          return { state: before === "done" ? "done" : "ready", lastPreview: "renders/preview.mp4" };
        } finally {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      });
    },

    render(slug) {
      const ffmpeg = findFfmpeg(core.settings.read().ffmpegPath, env);
      if (!ffmpeg) {
        throw new VsError(
          "Không tìm thấy ffmpeg. Hãy khai đường dẫn ffmpeg trong cài đặt Video Studio hoặc thêm ffmpeg vào PATH.",
          400,
        );
      }
      return core.runExclusive(slug, "rendering", async () => {
        const project = store.get(slug);
        const plan = store.getPlan(slug);
        const list = core.styles.list();
        const style = list.find((s) => s.id === project.styleId) ?? list.find((s) => s.builtin) ?? list[0];
        if (!style) throw new VsError("Không tìm thấy phong cách để dựng video.", 422);
        const st = stamp();
        const projectDir = store.dir(slug);
        const rendersDir = path.join(projectDir, "renders");
        const outFile = path.join(rendersDir, `${st}.mp4`);
        const workDir = path.join(rendersDir, `tmp-${st}`);
        fs.mkdirSync(workDir, { recursive: true });
        try {
          const has = await audioAssets(plan, projectDir);
          const build = buildFfmpegArgs(plan, style, { projectDir, outFile, workDir, assetHasAudio: (r) => has.has(r) });
          for (const t of build.textFiles) fs.writeFileSync(t.path, t.content, "utf8");
          const res = await runFfmpeg(
            ffmpeg,
            build.args,
            { totalSec: planDuration(plan) },
            deps.spawn ? { spawn: deps.spawn } : {},
          );
          if (!res.ok) throw new VsError(`Dựng video thất bại: ${res.error ?? "không rõ lý do"}`, 500);
          return { state: "done", lastRender: `renders/${st}.mp4` };
        } finally {
          fs.rmSync(workDir, { recursive: true, force: true });
        }
      });
    },
  };
}
