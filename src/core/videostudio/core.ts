// src/core/videostudio/core.ts
import type { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  applySegmentEdit,
  buildDirectorPrompt,
  buildSegmentEditPrompt,
  createVsAgentRunner,
  parsePlanFromText,
  parseSegmentFromText,
  type VsAgentRunner,
  type VsStepManager,
} from "./agent.js";
import { generateMedia, type VsGenDeps } from "./gen.js";
import { VsError, emptyPlan, planDuration } from "./plan.js";
import type { VsAsset, VsProject, VsState, VsStyle, VsVideoClip } from "./plan-types.js";
import { probeDuration } from "./render.js";
import { createVsSettingsStore, findFfprobe, type VsSettingsStore } from "./settings.js";
import { createVsLibrary, type VsLibrary } from "./library.js";
import { createVsStore, type VsStore } from "./store.js";
import { createStyleStore, type StyleStore } from "./styles.js";

export interface VsCoreOptions {
  manager: VsStepManager;
  dataDir: string;
  env?: NodeJS.ProcessEnv;
  log?: (msg: string) => void;
  gen?: VsGenDeps;
  spawn?: typeof nodeSpawn;
}

export interface VsCore {
  store: VsStore;
  styles: StyleStore;
  settings: VsSettingsStore;
  /** Shared images/videos the user provides once and attaches to new videos. */
  library: VsLibrary;
  /** Data folder (used for the style sample files). */
  dataDir: string;
  isBusy(slug: string): boolean;
  generatePlan(slug: string): Promise<void>;
  editSegment(slug: string, input: { start: number; end: number; instruction: string }): Promise<void>;
  addAsset(slug: string, name: string, data: Buffer, opts?: { generated?: boolean }): Promise<VsAsset>;
  recover(): number;
  remove(slug: string): void;
  runExclusive(slug: string, state: VsState, fn: () => Promise<Partial<VsProject> | void>): Promise<void>;
}

export const GENERIC_ERROR = "Thao tác thất bại, xem nhật ký server.";
const STUCK: readonly VsState[] = ["planning", "generating", "editing", "rendering"];

export function createVsCore(opts: VsCoreOptions): VsCore {
  const env = opts.env ?? process.env;
  const log = opts.log ?? (() => {});
  const store = createVsStore(opts.dataDir);
  const styles = createStyleStore(opts.dataDir);
  const settings = createVsSettingsStore(opts.dataDir, env);
  const library = createVsLibrary(opts.dataDir);
  const runner: VsAgentRunner = createVsAgentRunner(opts.manager);
  const busy = new Set<string>();

  function addCost(slug: string, cost: number): void {
    if (!(cost > 0)) return;
    try {
      store.update(slug, { costUsd: (store.get(slug).costUsd ?? 0) + cost });
    } catch {
      /* project may be gone */
    }
  }

  function toCard(c: VsVideoClip): VsVideoClip {
    const text = (c.prompt ?? "").slice(0, 200);
    return { id: c.id, kind: "card", srcIn: 0, duration: c.duration, color: "#222222", cardText: text };
  }

  async function resolvePrompts(slug: string, clips: VsVideoClip[], style: VsStyle): Promise<VsVideoClip[]> {
    const out: VsVideoClip[] = [];
    let handled = 0;
    for (const c of clips) {
      if (!c.prompt || c.asset) {
        out.push(c);
        continue;
      }
      handled++;
      const s = settings.read();
      if (handled > 12 || s.media.provider !== "http") {
        out.push(toCard(c));
        continue;
      }
      const base = path.join(store.dir(slug), "tmp", c.id);
      let file: string | null = null;
      try {
        const r = await generateMedia(
          { prompt: c.prompt, kind: c.kind === "video" ? "video" : "image", style },
          base,
          s,
          opts.gen ?? {},
        );
        if (!r.ok) throw new Error(r.error);
        file = r.file;
        const asset = store.addAsset(slug, `gen-${c.id}.${r.ext}`, fs.readFileSync(r.file), { generated: true });
        out.push({ ...c, kind: r.ext === "mp4" || r.ext === "webm" ? "video" : "image", asset: asset.rel, prompt: undefined });
      } catch (e) {
        log(`videostudio ${slug}: tạo media cho ${c.id} lỗi: ${e instanceof Error ? e.message : String(e)}`);
        out.push(toCard(c));
      } finally {
        if (file) {
          try {
            fs.rmSync(file, { force: true });
          } catch {
            /* ignore */
          }
        }
      }
    }
    return out;
  }

  function runExclusive(
    slug: string,
    state: VsState,
    fn: () => Promise<Partial<VsProject> | void>,
  ): Promise<void> {
    if (busy.has(slug)) throw new VsError("Dự án đang bận, thử lại sau.", 409);
    store.get(slug);
    busy.add(slug);
    store.update(slug, { state, error: null });
    return (async () => {
      try {
        const patch = await fn();
        store.update(slug, { state: "ready", error: null, ...(patch ?? {}) });
      } catch (e) {
        let msg = GENERIC_ERROR;
        if (e instanceof VsError) msg = e.message;
        else log(`videostudio ${slug}: ${e instanceof Error ? (e.stack ?? e.message) : String(e)}`);
        try {
          store.update(slug, { state: "failed", error: msg });
        } catch {
          /* project may be gone */
        }
      } finally {
        busy.delete(slug);
      }
    })();
  }

  return {
    store,
    styles,
    settings,
    library,
    dataDir: opts.dataDir,
    isBusy: (slug) => busy.has(slug),
    runExclusive,
    generatePlan(slug) {
      const project = store.get(slug);
      return runExclusive(slug, "planning", async () => {
        const style = styles.list().find((s) => s.id === project.styleId);
        if (!style) throw new VsError("Không tìm thấy phong cách của dự án.", 422);
        const base = emptyPlan(project.styleId, project.aspect);
        const assets = store.listAssets(slug).map((a) => ({
          path: a.rel,
          kind: a.kind,
          ...(typeof a.duration === "number" ? { durationSec: a.duration } : {}),
        }));
        const prompt = buildDirectorPrompt({
          description: project.brief,
          profile: settings.read().profile,
          width: base.width,
          height: base.height,
          style,
          assets,
        });
        const res = await runner("video-director", prompt, store.dir(slug));
        addCost(slug, res.costUsd);
        if (!res.ok) throw new VsError(`Agent đạo diễn thất bại: ${res.error ?? "không rõ lý do"}`, 502);
        const plan = parsePlanFromText(res.text, base, assets.map((a) => a.path), style.shotSec);
        store.update(slug, { state: "generating" });
        plan.video = await resolvePrompts(slug, plan.video, style);
        store.savePlan(slug, plan);
      });
    },
    editSegment(slug, input) {
      const instruction = String(input.instruction ?? "").trim();
      if (instruction.length < 1 || instruction.length > 1000) {
        throw new VsError("Câu lệnh sửa phải dài từ 1 đến 1000 ký tự.", 400);
      }
      const project = store.get(slug);
      const plan = store.getPlan(slug);
      const { start, end } = input;
      if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || start >= end || end > planDuration(plan)) {
        throw new VsError("Khoảng sửa không hợp lệ (cần 0 <= start < end <= độ dài kế hoạch).", 400);
      }
      return runExclusive(slug, "editing", async () => {
        const style = styles.list().find((s) => s.id === project.styleId);
        if (!style) throw new VsError("Không tìm thấy phong cách của dự án.", 422);
        const res = await runner("video-editor", buildSegmentEditPrompt({ plan, start, end, instruction }), store.dir(slug));
        addCost(slug, res.costUsd);
        if (!res.ok) throw new VsError(`Agent biên tập thất bại: ${res.error ?? "không rõ lý do"}`, 502);
        const seg = parseSegmentFromText(res.text, plan, store.listAssets(slug).map((a) => a.rel));
        const next = applySegmentEdit(plan, start, end, seg);
        next.video = await resolvePrompts(slug, next.video, style);
        store.savePlan(slug, next);
      });
    },
    async addAsset(slug, name, data, o) {
      const asset = store.addAsset(slug, name, data, o);
      const ffprobe = findFfprobe(settings.read().ffmpegPath, env);
      if (!ffprobe) return asset;
      let dur: number | null = null;
      try {
        dur = await probeDuration(ffprobe, store.filePath(slug, asset.rel), opts.spawn ? { spawn: opts.spawn } : {});
      } catch {
        dur = null;
      }
      if (typeof dur === "number" && Number.isFinite(dur)) {
        store.setAssetDuration(slug, asset.rel, dur);
        return { ...asset, duration: dur };
      }
      return asset;
    },
    recover() {
      let n = 0;
      for (const item of store.list()) {
        if (STUCK.includes(item.state)) {
          store.update(item.slug, { state: "failed", error: "Bị ngắt khi server khởi động lại." });
          n++;
        }
      }
      return n;
    },
    remove(slug) {
      if (busy.has(slug)) throw new VsError("Dự án đang bận, thử lại sau.", 409);
      store.remove(slug);
    },
  };
}
