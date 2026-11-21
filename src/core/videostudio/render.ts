// src/core/videostudio/render.ts
// Build ffmpeg arguments for a Video Studio plan. Pure: no disk access.
// User text never goes into args; it is returned in textFiles for the caller
// to write into workDir (drawtext reads it through textfile=).

import { spawn as nodeSpawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { VsPlan, VsStyle, VsVideoClip } from "./plan-types.js";
import { VsError, safeVsRel } from "./plan.js";

export const TEXT_Y_TOP = 0.1;
export const TEXT_Y_CENTER = 0.5;
export const TEXT_Y_BOTTOM = 0.92;

export interface FfmpegBuildOptions {
  projectDir: string;
  outFile: string;
  workDir: string;
  /** Quick draft: fastest x264 preset and a low quality factor. */
  draft?: boolean;
  /** Folder with the font files (default: the Windows Fonts folder); tests point it at a temp folder. */
  fontsDir?: string;
  /** Tells whether a video asset has an audio stream; only such clips can keep their own sound (keepAudio). */
  assetHasAudio?: (rel: string) => boolean;
}

const XFADE: Record<string, string> = {
  fade: "fade",
  dissolve: "dissolve",
  wipeleft: "wipeleft",
  slideleft: "slideleft",
  zoomin: "zoomin",
  circleopen: "circleopen",
};
/** xfade needs a duration above 0, so a hard cut inside a mix of transitions is a 1-frame fade. */
const CUT_SEC = 0.04;

/** atempo accepts 0.5 to 2 per filter, so other speeds are chained. */
function tempoChain(speed: number): string {
  if (!(speed > 0) || speed === 1) return "";
  const parts: string[] = [];
  let v = speed;
  while (v > 2) {
    parts.push("atempo=2");
    v /= 2;
  }
  while (v < 0.5) {
    parts.push("atempo=0.5");
    v /= 0.5;
  }
  parts.push(`atempo=${Number(v.toFixed(4))}`);
  return parts.join(",") + ",";
}

const even = (n: number): number => Math.max(16, Math.round(n / 2) * 2);

/**
 * A small, low-frame-rate copy of the plan for the quick preview: the longer side becomes at most `maxSide` px,
 * the frame rate at most 15, and explicit text sizes shrink by the same factor. The plan itself is not changed.
 */
/**
 * A tiny sample that shows what a style does: two colour cards of the style's shot length (the grade, transition and
 * clip timing apply) with a sample caption in the style's font, colour and box.
 */
export function styleSamplePlan(style: VsStyle): VsPlan {
  const shot = Math.min(3, Math.max(1.5, style.shotSec));
  return {
    version: 1,
    width: 640,
    height: 360,
    fps: 15,
    video: [
      { id: "s1", kind: "card", srcIn: 0, duration: shot, color: "#2d6cdf", cardText: "" },
      { id: "s2", kind: "card", srcIn: 0, duration: shot, color: "#d9534f", cardText: "" },
    ],
    audio: [],
    texts: [
      { id: "t1", text: "Thang máy gia đình\nÊm ái, an toàn", start: 0.2, duration: Math.max(0.5, shot - 0.4) },
      { id: "t2", text: "Liên hệ ngay", start: shot + 0.2, duration: Math.max(0.5, shot - 0.4) },
    ],
  };
}

export function draftPlan(plan: VsPlan, maxSide = 640): VsPlan {
  const f = Math.min(1, maxSide / Math.max(plan.width, plan.height));
  return {
    ...plan,
    width: even(plan.width * f),
    height: even(plan.height * f),
    fps: Math.min(plan.fps, 15),
    texts: plan.texts.map((t) => (typeof t.size === "number" && t.size > 0 ? { ...t, size: Math.max(8, Math.round(t.size * f)) } : t)),
  };
}

export interface FfmpegTextFile {
  path: string;
  content: string;
}

export type FfmpegBuild = {
  args: string[];
  textFiles: FfmpegTextFile[];
};

const num = (n: number): string => String(Math.round(n * 1000) / 1000);

function posNum(v: unknown, label: string): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) {
    throw new VsError(`${label} phải là số dương.`);
  }
  return v;
}

function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

// Escape a value placed inside single quotes in a filter option.
/** Windows font names -> font files in %WINDIR%\\Fonts (all of them cover Vietnamese except the decorative ones). */
const WIN_FONT_FILES: Record<string, string[]> = {
  "segoe ui": ["segoeui.ttf"],
  arial: ["arial.ttf"],
  "arial black": ["ariblk.ttf"],
  georgia: ["georgia.ttf"],
  verdana: ["verdana.ttf"],
  tahoma: ["tahoma.ttf"],
  "times new roman": ["times.ttf"],
  "courier new": ["cour.ttf"],
  calibri: ["calibri.ttf"],
  cambria: ["cambria.ttc"],
  "comic sans ms": ["comic.ttf"],
  "trebuchet ms": ["trebuc.ttf"],
  impact: ["impact.ttf"],
  consolas: ["consola.ttf"],
};
const FALLBACK_FONT_FILES = ["segoeui.ttf", "arial.ttf", "tahoma.ttf", "verdana.ttf"];

export function defaultFontsDir(): string {
  return path.join(process.env["WINDIR"] ?? process.env["SystemRoot"] ?? "C:\\Windows", "Fonts");
}

/**
 * The font FILE for a font name, or null when none is found. drawtext is given this file (fontfile=) so ffmpeg never goes
 * through fontconfig, which on a Windows build without a fontconfig setup prints "Cannot load default config file" and can
 * crash (exit code 0xC0000005). An unknown name falls back to Segoe UI / Arial / Tahoma / Verdana.
 */
export function resolveFontFile(name: string, fontsDir: string = defaultFontsDir()): string | null {
  const key = String(name ?? "").trim().toLowerCase();
  const guesses = [...(WIN_FONT_FILES[key] ?? []), `${key.replace(/[^a-z0-9]/g, "")}.ttf`, ...FALLBACK_FONT_FILES];
  for (const g of guesses) {
    if (g === ".ttf") continue;
    const p = path.join(fontsDir, g);
    try {
      if (fs.statSync(p).isFile()) return p;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function escQuoted(s: string): string {
  return s.replace(/\\/g, "/").replace(/:/g, "\\:").replace(/'/g, "\\'");
}

export function buildFfmpegArgs(
  plan: VsPlan,
  style: VsStyle,
  opts: FfmpegBuildOptions,
): FfmpegBuild {
  const clips = plan.video;
  if (!Array.isArray(clips) || clips.length === 0) {
    throw new VsError("Kế hoạch chưa có clip video.");
  }
  const W = Math.round(posNum(plan.width, "Chiều rộng"));
  const H = Math.round(posNum(plan.height, "Chiều cao"));
  const F = posNum(plan.fps, "Số khung hình/giây");
  const N = clips.length;
  const durs = clips.map((c, i) => posNum(c.duration, `Thời lượng clip ${i + 1}`));
  const total = durs.reduce((a, b) => a + b, 0);

  // Starts on the output timeline: S_i = sum_{k<i} d_k.
  const starts: number[] = [];
  durs.reduce((acc, d) => {
    starts.push(acc);
    return acc + d;
  }, 0);

  // Transition at each boundary i (between clip i and i+1): the clip's own, else the style's. T_i = min(sec, shorter clip / 2).
  const bT: number[] = [];
  const bName: string[] = [];
  for (let i = 0; i < N - 1; i++) {
    const c = clips[i] as VsVideoClip;
    const kind = c.transition ?? (style.transition === "fade" ? "fade" : "none");
    const sec = typeof c.transitionSec === "number" && c.transitionSec > 0 ? c.transitionSec : style.transitionSec;
    let t = 0;
    if (kind !== "none" && XFADE[kind]) {
      t = Math.min(sec, Math.min(durs[i]!, durs[i + 1]!) / 2);
      if (!(t > 0)) t = 0;
    }
    bT.push(t);
    bName.push(XFADE[kind] ?? "fade");
  }
  const anyT = bT.some((x) => x > 0);
  if (anyT) {
    for (let i = 0; i < bT.length; i++) if (!(bT[i]! > 0)) bT[i] = Math.min(CUT_SEC, Math.min(durs[i]!, durs[i + 1]!) / 2);
  }
  // Every clip but the last is stretched by its own T_i. After xfade i the result is sum_{k<=i} d_k + T_{i+1} long, and
  // xfade i has offset S_{i+1} whatever the T values are, so the total is sum d_k = planDuration and clip i+1 starts at
  // S_{i+1}: text (between) and audio (adelay) stay in sync. If a source is shorter than srcIn+d+T the extension is cut short.
  const tIn = (i: number): number => (anyT && i < N - 1 ? durs[i]! + bT[i]! : durs[i]!);

  const args: string[] = ["-nostdin"];
  const textFiles: FfmpegTextFile[] = [];
  const filters: string[] = [];
  const dir = (rel: string): string => path.join(opts.projectDir, safeVsRel(rel));

  const cardTexts: (string | undefined)[] = [];
  const keptAudio: { input: number; start: number; dur: number; speed: number; volume: number }[] = [];
  clips.forEach((c: VsVideoClip, i) => {
    const t = num(tIn(i));
    const sp = c.kind === "video" && typeof c.speed === "number" && c.speed >= 0.25 && c.speed <= 4 ? c.speed : 1;
    const hasAsset = typeof c.asset === "string" && c.asset !== "";
    const lavfi = c.kind === "card" || !hasAsset;
    if (lavfi) {
      const color = c.kind === "card" && c.color ? c.color : "black";
      args.push("-f", "lavfi", "-i", `color=c=${color}:s=${W}x${H}:r=${num(F)}:d=${t}`);
      let text = c.cardText;
      if (!text && !hasAsset && c.prompt) text = c.prompt;
      cardTexts.push(text);
    } else if (c.kind === "image") {
      args.push("-loop", "1", "-framerate", num(F), "-t", t, "-i", dir(c.asset!));
      cardTexts.push(undefined);
    } else {
      // Original audio of video clips is dropped unless the clip asks to keep it (and the file has an audio stream).
      args.push("-ss", num(Math.max(0, c.srcIn || 0)), "-t", num(tIn(i) * sp), "-i", dir(c.asset!));
      cardTexts.push(undefined);
      if (c.keepAudio === true && opts.assetHasAudio?.(c.asset!) === true) {
        keptAudio.push({ input: i, start: starts[i]!, dur: durs[i]!, speed: sp, volume: 1 });
      }
    }
    const fit = lavfi ? "contain" : (c.fit ?? plan.fit ?? "blur");
    // Ken Burns on pictures: slow zoom or pan over the clip (the frame is enlarged 2x first so the motion stays sharp).
    const frames = Math.max(1, Math.round(tIn(i) * F));
    const motion = c.kind === "image" && !lavfi ? c.motion : undefined;
    const kb = (z: string, x: string, y: string): string =>
      `scale=${W * 2}:${H * 2},zoompan=z='${z}':x='${x}':y='${y}':d=1:s=${W}x${H}:fps=${num(F)},`;
    const cx = "iw/2-(iw/zoom/2)";
    const cy = "ih/2-(ih/zoom/2)";
    let motionPart = "";
    if (motion === "zoomin") motionPart = kb(`1+0.25*on/${frames}`, cx, cy);
    else if (motion === "zoomout") motionPart = kb(`1.25-0.25*on/${frames}`, cx, cy);
    else if (motion === "panright") motionPart = kb("1.2", `(iw-iw/zoom)*on/${frames}`, cy);
    else if (motion === "panleft") motionPart = kb("1.2", `(iw-iw/zoom)*(1-on/${frames})`, cy);
    const speedPart = sp !== 1 ? `setpts=(PTS-STARTPTS)/${num(sp)},` : "";
    const tail = `${motionPart}setsar=1,${speedPart}fps=${num(F)},format=yuv420p,setpts=PTS-STARTPTS[v${i}]`;
    if (fit === "cover") {
      filters.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},${tail}`);
    } else if (fit === "blur") {
      filters.push(
        `[${i}:v]split=2[bg${i}][fg${i}]`,
        `[bg${i}]scale=${W}:${H}:force_original_aspect_ratio=increase,crop=${W}:${H},boxblur=20:5[bb${i}]`,
        `[fg${i}]scale=${W}:${H}:force_original_aspect_ratio=decrease[ff${i}]`,
        `[bb${i}][ff${i}]overlay=(W-w)/2:(H-h)/2,${tail}`,
      );
    } else {
      filters.push(`[${i}:v]scale=${W}:${H}:force_original_aspect_ratio=decrease,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2,${tail}`);
    }
  });

  // Join
  if (anyT) {
    let prev = "[v0]";
    for (let i = 0; i < N - 1; i++) {
      const off = num(starts[i + 1]!);
      const lab = i === N - 2 ? "[vj]" : `[x${i + 1}]`;
      filters.push(
        `${prev}[v${i + 1}]xfade=transition=${bName[i]}:duration=${num(bT[i]!)}:offset=${off}${lab}`,
      );
      prev = lab;
    }
  } else {
    const ins = clips.map((_, i) => `[v${i}]`).join("");
    filters.push(`${ins}concat=n=${N}:v=1:a=0[vj]`);
  }

  // Post: eq, drawtext
  const post: string[] = [];
  const eq: string[] = [];
  if (style.brightness !== undefined) eq.push(`brightness=${num(style.brightness)}`);
  if (style.contrast !== undefined) eq.push(`contrast=${num(style.contrast)}`);
  if (style.saturation !== undefined) eq.push(`saturation=${num(style.saturation)}`);
  if (style.gamma !== undefined) eq.push(`gamma=${num(style.gamma)}`);
  if (eq.length > 0) post.push(`eq=${eq.join(":")}`);

  const drawtext = (
    text: string,
    a: number,
    b: number,
    size: number,
    xExpr: string,
    yExpr: string,
    color?: string,
  ): string => {
    const file = path.join(opts.workDir, `text-${textFiles.length}.txt`);
    textFiles.push({ path: file, content: text });
    // A font FILE avoids fontconfig (see resolveFontFile). Only when no file is found do we fall back to font=.
    const parts = [`textfile='${escQuoted(file)}'`];
    const fontFile = process.platform === "win32" || opts.fontsDir ? resolveFontFile(style.font, opts.fontsDir) : null;
    if (fontFile) parts.push(`fontfile='${escQuoted(fontFile)}'`);
    else if (style.font) parts.push(`font='${escQuoted(style.font)}'`);
    parts.push(`fontsize=${num(size)}`, `fontcolor=${color && /^#[0-9a-fA-F]{6}$/.test(color) ? color : style.textColor}`);
    if (style.textBox) parts.push("box=1", "boxcolor=black@0.5", "boxborderw=12");
    parts.push(`x=${xExpr}`, `y=${yExpr}`, `enable='between(t,${num(a)},${num(b)})'`);
    return `drawtext=${parts.join(":")}`;
  };

  for (const item of plan.showTexts === false ? [] : (plan.texts ?? [])) {
    if (typeof item.text !== "string" || item.text === "") continue;
    const start = Math.max(0, item.start);
    const dur = posNum(item.duration, "Thời lượng chữ");
    const xExpr =
      typeof item.x === "number" && Number.isFinite(item.x)
        ? `w*${num(clamp01(item.x))}-tw/2`
        : "(w-tw)/2";
    const yExpr =
      typeof item.y === "number" && Number.isFinite(item.y)
        ? `h*${num(clamp01(item.y))}-th/2`
        : `h*${TEXT_Y_BOTTOM}-th/2`;
    // size is a fraction of the frame height (as in the editor preview); a bigger number is taken as pixels.
    const size = item.size && item.size > 0 ? (item.size <= 1 ? Math.max(8, Math.round(item.size * H)) : item.size) : Math.round(H / 18);
    post.push(drawtext(item.text, start, start + dur, size, xExpr, yExpr, item.color));
  }
  cardTexts.forEach((text, i) => {
    if (!text) return;
    post.push(
      drawtext(
        text,
        starts[i]!,
        starts[i]! + durs[i]!,
        Math.round(H / 12),
        "(w-tw)/2",
        `h*${TEXT_Y_CENTER}-th/2`,
      ),
    );
  });
  filters.push(`[vj]${post.length > 0 ? post.join(",") : "null"}[vout]`);

  // Audio: clips of plan.audio (a source window [srcIn, srcIn + dur * speed], then tempo, volume, fades, delay) plus the sound
  // of video clips that keep it. Narration is optionally used to duck the rest (sidechaincompress).
  let nextIdx = N;
  let audioMap: string;
  const audio = plan.audio ?? [];
  const entries: { lab: string; narration: boolean }[] = [];
  const fadeChain = (dur: number, fadeInSec?: number, fadeOutSec?: number): string => {
    const fi = typeof fadeInSec === "number" && fadeInSec > 0 ? Math.min(fadeInSec, dur) : 0;
    const fo = typeof fadeOutSec === "number" && fadeOutSec > 0 ? Math.min(fadeOutSec, dur) : 0;
    return (fi > 0 ? `afade=t=in:st=0:d=${num(fi)},` : "") + (fo > 0 ? `afade=t=out:st=${num(Math.max(0, dur - fo))}:d=${num(fo)},` : "");
  };
  audio.forEach((a, k) => {
    const dur = posNum(a.duration, "Thời lượng âm thanh");
    args.push("-i", dir(a.asset));
    const ms = Math.round(Math.max(0, a.start) * 1000);
    const vol = typeof a.volume === "number" && Number.isFinite(a.volume) ? a.volume : 1;
    const speed = typeof a.speed === "number" && a.speed >= 0.5 && a.speed <= 2 ? a.speed : 1;
    const from = typeof a.srcIn === "number" && a.srcIn > 0 ? a.srcIn : 0;
    const lab = `[a${k}]`;
    filters.push(
      `[${nextIdx}:a]atrim=start=${num(from)}:end=${num(from + dur * speed)},asetpts=PTS-STARTPTS,${tempoChain(speed)}` +
        `atrim=0:${num(dur)},asetpts=PTS-STARTPTS,volume=${num(vol)},${fadeChain(dur, a.fadeIn, a.fadeOut)}adelay=${ms}|${ms}${lab}`,
    );
    entries.push({ lab, narration: a.kind === "narration" });
    nextIdx++;
  });
  keptAudio.forEach((ka, k) => {
    const ms = Math.round(Math.max(0, ka.start) * 1000);
    const lab = `[k${k}]`;
    filters.push(
      `[${ka.input}:a]asetpts=PTS-STARTPTS,${tempoChain(ka.speed)}atrim=0:${num(ka.dur)},asetpts=PTS-STARTPTS,volume=${num(ka.volume)},adelay=${ms}|${ms}${lab}`,
    );
    entries.push({ lab, narration: false });
  });
  const mix = (labs: string[], out: string): void => {
    if (labs.length === 1) filters.push(`${labs[0]}anull${out}`);
    else filters.push(`${labs.join("")}amix=inputs=${labs.length}:normalize=0:duration=longest${out}`);
  };
  if (entries.length === 0) {
    args.push("-f", "lavfi", "-t", num(total), "-i", "anullsrc=r=44100:cl=stereo");
    audioMap = `${nextIdx}:a`;
  } else {
    const narr = entries.filter((e) => e.narration).map((e) => e.lab);
    const rest = entries.filter((e) => !e.narration).map((e) => e.lab);
    if (plan.duck !== false && narr.length > 0 && rest.length > 0) {
      mix(rest, "[mus]");
      mix(narr, "[nar]");
      filters.push("[nar]asplit=2[narA][narB]");
      filters.push("[mus][narA]sidechaincompress=threshold=0.03:ratio=10:attack=30:release=500[musd]");
      filters.push("[musd][narB]amix=inputs=2:normalize=0:duration=longest[aout]");
    } else {
      mix(entries.map((e) => e.lab), "[aout]");
    }
    audioMap = "[aout]";
  }

  args.push(
    "-filter_complex",
    filters.join(";"),
    "-map",
    "[vout]",
    "-map",
    audioMap,
    "-c:v",
    "libx264",
    ...(opts.draft ? ["-preset", "ultrafast", "-crf", "32"] : []),
    "-pix_fmt",
    "yuv420p",
    "-c:a",
    "aac",
    "-t",
    num(total),
    "-y",
    "-progress",
    "pipe:1",
    "-nostats",
    opts.outFile,
  );
  return { args, textFiles };
}

export interface RunFfmpegResult {
  ok: boolean;
  error?: string;
}

export interface RunFfmpegOptions {
  totalSec?: number;
  onProgress?: (sec: number, ratio?: number) => void;
}

export interface RunFfmpegDeps {
  spawn?: typeof nodeSpawn;
  timeoutMs?: number;
}

function parseClock(v: string): number | null {
  const m = /^(\d+):(\d+):(\d+(?:\.\d+)?)$/.exec(v.trim());
  if (!m) return null;
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
}

export function runFfmpeg(
  ffmpegPath: string,
  args: string[],
  opts: RunFfmpegOptions = {},
  deps: RunFfmpegDeps = {},
): Promise<RunFfmpegResult> {
  const spawnFn = deps.spawn ?? nodeSpawn;
  const timeoutMs = deps.timeoutMs ?? 600000;
  return new Promise((resolve) => {
    let settled = false;
    const done = (r: RunFfmpegResult): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(r);
    };
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawnFn(ffmpegPath, args, {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"],
      });
    } catch (e) {
      resolve({ ok: false, error: `Không chạy được ffmpeg: ${(e as Error).message}` });
      return;
    }
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {
        /* ignore */
      }
      done({ ok: false, error: `ffmpeg hết giờ sau ${Math.round(timeoutMs / 1000)} giây nên đã bị dừng.` });
    }, timeoutMs);

    let us: number | null = null;
    let ms: number | null = null;
    let clock: number | null = null;
    const flush = (): void => {
      const sec = us ?? ms ?? clock;
      us = ms = clock = null;
      if (sec === null || !Number.isFinite(sec) || sec < 0) return;
      const ratio =
        opts.totalSec && opts.totalSec > 0 ? Math.min(1, Math.max(0, sec / opts.totalSec)) : undefined;
      opts.onProgress?.(sec, ratio);
    };
    const num6 = (v: string): number | null => {
      const n = Number(v);
      return Number.isFinite(n) && n >= 0 ? n / 1e6 : null;
    };
    let buf = "";
    child.stdout?.on("data", (d: Buffer | string) => {
      buf += d.toString();
      const lines = buf.split(/\r?\n/);
      buf = lines.pop() ?? "";
      for (const line of lines) {
        const i = line.indexOf("=");
        if (i < 0) continue;
        const k = line.slice(0, i).trim();
        const v = line.slice(i + 1).trim();
        if (k === "out_time_us") us = num6(v);
        else if (k === "out_time_ms") ms = num6(v);
        else if (k === "out_time") clock = parseClock(v);
        else if (k === "progress") flush();
      }
    });
    const errLines: string[] = [];
    let errBuf = "";
    child.stderr?.on("data", (d: Buffer | string) => {
      errBuf += d.toString();
      const lines = errBuf.split(/\r?\n/);
      errBuf = lines.pop() ?? "";
      for (const l of lines) if (l.trim()) errLines.push(l);
      if (errLines.length > 20) errLines.splice(0, errLines.length - 20);
    });
    child.on("error", (e: Error) => {
      done({ ok: false, error: `Không chạy được ffmpeg: ${e.message}` });
    });
    child.on("close", (code: number | null) => {
      flush();
      if (errBuf.trim()) errLines.push(errBuf);
      if (code === 0) {
        done({ ok: true });
      } else {
        const tail = errLines.slice(-5).join("\n");
        const crash = code === 3221225477 ? " ffmpeg bị lỗi nội bộ (thường do phông chữ); thử đổi phong cách hoặc phông chữ khác." : "";
        done({ ok: false, error: `ffmpeg thất bại (mã ${code ?? "?"}):${crash} ${tail}` });
      }
    });
  });
}

/** True when the file has at least one audio stream (ffprobe). */
export function probeHasAudio(ffprobePath: string, file: string, deps: { spawn?: typeof nodeSpawn } = {}): Promise<boolean> {
  const spawnFn = deps.spawn ?? nodeSpawn;
  return new Promise((resolve) => {
    let out = "";
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawnFn(ffprobePath, ["-v", "error", "-select_streams", "a", "-show_entries", "stream=index", "-of", "csv=p=0", file], {
        shell: false,
        windowsHide: true,
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {
      resolve(false);
      return;
    }
    child.stdout?.on("data", (d: Buffer | string) => {
      out += d.toString();
    });
    child.on("error", () => resolve(false));
    child.on("close", (code: number | null) => resolve(code === 0 && out.trim() !== ""));
  });
}

export function probeDuration(
  ffprobePath: string,
  file: string,
  deps: { spawn?: typeof nodeSpawn } = {},
): Promise<number | null> {
  const spawnFn = deps.spawn ?? nodeSpawn;
  return new Promise((resolve) => {
    let out = "";
    let child: ReturnType<typeof nodeSpawn>;
    try {
      child = spawnFn(
        ffprobePath,
        ["-v", "error", "-show_entries", "format=duration", "-of", "default=nw=1:nk=1", file],
        { shell: false, windowsHide: true, stdio: ["ignore", "pipe", "pipe"] },
      );
    } catch {
      resolve(null);
      return;
    }
    child.stdout?.on("data", (d: Buffer | string) => {
      out += d.toString();
    });
    child.on("error", () => resolve(null));
    child.on("close", (code: number | null) => {
      if (code !== 0) return resolve(null);
      const n = Number(out.trim());
      resolve(Number.isFinite(n) && n > 0 ? n : null);
    });
  });
}
