// Pure, immutable timeline helpers for the Video Studio editor.
import type {
  VsPlan,
  VsVideoClip,
  VsAudioClip,
  VsTextItem,
  VsFit,
  VsAspect,
} from "../../../src/core/videostudio/plan-types";

const MIN_DUR = 0.2;
const MIN_EDGE = 0.1;

export interface ActiveAt {
  clip: VsVideoClip | null;
  index: number;
  offset: number;
  texts: VsTextItem[];
  audio: VsAudioClip[];
}

export function newId(prefix = ""): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let s = "";
  for (let i = 0; i < 6; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return prefix + s;
}

export function timelineDuration(plan: VsPlan): number {
  return plan.video.reduce((sum, c) => sum + c.duration, 0);
}

export function clipStarts(plan: VsPlan): number[] {
  const out: number[] = [];
  let acc = 0;
  for (const c of plan.video) {
    out.push(acc);
    acc += c.duration;
  }
  return out;
}

export function activeAt(plan: VsPlan, t: number): ActiveAt {
  const starts = clipStarts(plan);
  let index = -1;
  if (t >= 0) {
    for (let i = 0; i < plan.video.length; i++) {
      const s = starts[i] as number;
      const c = plan.video[i] as VsVideoClip;
      if (t >= s && t < s + c.duration) {
        index = i;
        break;
      }
    }
  }
  const clip = index >= 0 ? (plan.video[index] as VsVideoClip) : null;
  const offset = index >= 0 ? t - (starts[index] as number) : 0;
  const within = (s: number, d: number) => t >= s && t < s + d;
  return {
    clip,
    index,
    offset,
    texts: plan.texts.filter((x) => within(x.start, x.duration)),
    audio: plan.audio.filter((x) => within(x.start, x.duration)),
  };
}

export function moveClip(plan: VsPlan, from: number, to: number): VsPlan {
  const n = plan.video.length;
  if (!Number.isInteger(from) || !Number.isInteger(to)) return plan;
  if (from < 0 || from >= n || to < 0 || to >= n) return plan;
  const video = plan.video.slice();
  const [item] = video.splice(from, 1);
  video.splice(to, 0, item as VsVideoClip);
  return { ...plan, video };
}

export function splitClipAt(plan: VsPlan, t: number): VsPlan {
  const starts = clipStarts(plan);
  for (let i = 0; i < plan.video.length; i++) {
    const s = starts[i] as number;
    const c = plan.video[i] as VsVideoClip;
    if (t >= s && t < s + c.duration) {
      const offset = t - s;
      if (offset < MIN_EDGE || c.duration - offset < MIN_EDGE) return plan;
      const first: VsVideoClip = { ...c, duration: offset };
      const second: VsVideoClip = {
        ...c,
        id: newId("clip-"),
        duration: c.duration - offset,
        srcIn: c.kind === "video" ? c.srcIn + offset : c.srcIn,
      };
      const video = plan.video.slice();
      video.splice(i, 1, first, second);
      return { ...plan, video };
    }
  }
  return plan;
}

export function trimClip(
  plan: VsPlan,
  index: number,
  edge: "start" | "end",
  deltaSec: number,
): VsPlan {
  if (!Number.isInteger(index) || index < 0 || index >= plan.video.length) return plan;
  if (!Number.isFinite(deltaSec)) return plan;
  const c = plan.video[index] as VsVideoClip;
  let next: VsVideoClip;
  if (edge === "start") {
    const lo = c.kind === "video" ? -c.srcIn : -Infinity;
    const hi = c.duration - MIN_DUR;
    const delta = Math.max(lo, Math.min(hi, deltaSec));
    next = {
      ...c,
      srcIn: c.kind === "video" ? c.srcIn + delta : c.srcIn,
      duration: Math.max(MIN_DUR, c.duration - delta),
    };
  } else {
    next = { ...c, duration: Math.max(MIN_DUR, c.duration + deltaSec) };
  }
  const video = plan.video.slice();
  video[index] = next;
  return { ...plan, video };
}

const IMAGE_EXT = /.(png|jpe?g|gif|webp|bmp)$/i;
const VIDEO_EXT = /.(mp4|mov|mkv|webm|avi|m4v)$/i;

/** "image" / "video" for a media file name, null for anything else. */
export function mediaKindOf(name: string): "image" | "video" | null {
  if (IMAGE_EXT.test(name)) return "image";
  if (VIDEO_EXT.test(name)) return "video";
  return null;
}

/** Index where a new clip goes for a playhead at `t`: before the first clip that starts at or after t, else at the end. */
export function insertIndexAt(plan: VsPlan, t: number): number {
  const starts = clipStarts(plan);
  for (let i = 0; i < starts.length; i++) if ((starts[i] as number) >= t - 0.01) return i;
  return plan.video.length;
}

/** Puts new media clips (asset path + length in seconds) into the timeline at the playhead. */
export function insertMedia(plan: VsPlan, t: number, items: { asset: string; kind: "image" | "video"; duration: number }[]): VsPlan {
  if (items.length === 0) return plan;
  const clips: VsVideoClip[] = items.map((m) => ({ id: newId("clip-"), kind: m.kind, asset: m.asset, srcIn: 0, duration: Math.max(0.5, m.duration) }));
  const at = insertIndexAt(plan, t);
  const video = plan.video.slice();
  video.splice(at, 0, ...clips);
  return { ...plan, video };
}

export function deleteClip(plan: VsPlan, index: number): VsPlan {
  if (!Number.isInteger(index) || index < 0 || index >= plan.video.length) return plan;
  return { ...plan, video: plan.video.filter((_, i) => i !== index) };
}

export function addText(plan: VsPlan, text: string, start: number, duration = 3): VsPlan {
  const item: VsTextItem = { id: newId("txt-"), text, start, duration, x: 0.5, y: 0.85 };
  return { ...plan, texts: [...plan.texts, item] };
}

export function updateText(
  plan: VsPlan,
  id: string,
  patch: Partial<Omit<VsTextItem, "id">>,
): VsPlan {
  if (!plan.texts.some((x) => x.id === id)) return plan;
  return { ...plan, texts: plan.texts.map((x) => (x.id === id ? { ...x, ...patch, id: x.id } : x)) };
}

export function removeText(plan: VsPlan, id: string): VsPlan {
  if (!plan.texts.some((x) => x.id === id)) return plan;
  return { ...plan, texts: plan.texts.filter((x) => x.id !== id) };
}

export function moveAudio(plan: VsPlan, id: string, newStart: number): VsPlan {
  if (!plan.audio.some((x) => x.id === id)) return plan;
  const start = Math.max(0, newStart);
  return { ...plan, audio: plan.audio.map((x) => (x.id === id ? { ...x, start } : x)) };
}

export function deleteAudio(plan: VsPlan, id: string): VsPlan {
  if (!plan.audio.some((x) => x.id === id)) return plan;
  return { ...plan, audio: plan.audio.filter((x) => x.id !== id) };
}

export function secToPx(sec: number, zoom: number): number {
  if (zoom <= 0) return 0;
  return sec * zoom;
}

export function pxToSec(px: number, zoom: number): number {
  if (zoom <= 0) return 0;
  return px / zoom;
}

/** Frame size of each aspect ratio the editor can switch to (even numbers, as ffmpeg needs). */
export const ASPECT_SIZES: Record<VsAspect, { width: number; height: number }> = {
  "16:9": { width: 1280, height: 720 },
  "9:16": { width: 720, height: 1280 },
  "1:1": { width: 1080, height: 1080 },
};

export function aspectOf(plan: VsPlan): VsAspect | null {
  for (const k of Object.keys(ASPECT_SIZES) as VsAspect[]) {
    if (ASPECT_SIZES[k].width === plan.width && ASPECT_SIZES[k].height === plan.height) return k;
  }
  return null;
}

export function setAspect(plan: VsPlan, aspect: VsAspect): VsPlan {
  const s = ASPECT_SIZES[aspect];
  if (!s || (plan.width === s.width && plan.height === s.height)) return plan;
  return { ...plan, width: s.width, height: s.height };
}

/** Fit used by a clip: its own, else the plan's, else "blur". */
export function fitOf(plan: VsPlan, clip: VsVideoClip): VsFit {
  return clip.fit ?? plan.fit ?? "blur";
}

/** Sets the fit of one clip. */
export function setClipFit(plan: VsPlan, id: string, fit: VsFit): VsPlan {
  return { ...plan, video: plan.video.map((c) => (c.id === id ? { ...c, fit } : c)) };
}

/** Sets one fit for the whole video: the plan default, and no clip keeps its own. */
export function setAllFit(plan: VsPlan, fit: VsFit): VsPlan {
  return { ...plan, fit, video: plan.video.map((c) => {
    const { fit: _drop, ...rest } = c;
    void _drop;
    return rest;
  }) };
}

export function setClipDuration(plan: VsPlan, id: string, duration: number): VsPlan {
  if (!Number.isFinite(duration)) return plan;
  const d = Math.min(600, Math.max(MIN_DUR, duration));
  return { ...plan, video: plan.video.map((c) => (c.id === id ? { ...c, duration: d } : c)) };
}

/** Copies a clip and puts the copy right after it. */
export function duplicateClip(plan: VsPlan, index: number): VsPlan {
  const c = plan.video[index];
  if (!c) return plan;
  const copy: VsVideoClip = { ...c, id: newId("clip-") };
  const video = plan.video.slice();
  video.splice(index + 1, 0, copy);
  return { ...plan, video };
}

/** A title card (colour background with centred text) at the clip boundary at/after the playhead. */
export function addCardAt(plan: VsPlan, t: number, text: string, color = "#16213e", duration = 3): VsPlan {
  const card: VsVideoClip = { id: newId("card-"), kind: "card", srcIn: 0, duration, color, cardText: text };
  const video = plan.video.slice();
  video.splice(insertIndexAt(plan, t), 0, card);
  return { ...plan, video };
}

export function showTextsOf(plan: VsPlan): boolean {
  return plan.showTexts !== false;
}

export function setShowTexts(plan: VsPlan, show: boolean): VsPlan {
  return { ...plan, showTexts: show };
}

/** Patch of the fields of an audio clip the inspector edits. */
export type AudioPatch = Partial<Pick<VsAudioClip, "volume" | "fadeIn" | "fadeOut" | "speed" | "start" | "duration">>;

export function updateAudio(plan: VsPlan, id: string, patch: AudioPatch): VsPlan {
  return { ...plan, audio: plan.audio.map((a) => (a.id === id ? { ...a, ...patch } : a)) };
}

/** Adds an audio clip (uploaded file or music) at `start`. A narration clip replaces the earlier narration clips. */
export function addAudioClip(plan: VsPlan, asset: string, start: number, duration: number, kind: "music" | "narration" | "sfx"): VsPlan {
  const clip: VsAudioClip = { id: newId("aud-"), asset, start: Math.max(0, start), duration: Math.min(600, Math.max(MIN_DUR, duration)), volume: 1, kind };
  const keep = kind === "narration" ? plan.audio.filter((a) => a.kind !== "narration") : plan.audio;
  return { ...plan, audio: [...keep, clip] };
}

/** Patch of the fields of a video clip the inspector edits. */
export type ClipPatch = Partial<Pick<VsVideoClip, "transition" | "transitionSec" | "motion" | "speed" | "keepAudio" | "fit" | "duration">>;

export function updateClip(plan: VsPlan, id: string, patch: ClipPatch): VsPlan {
  if (!plan.video.some((c) => c.id === id)) return plan;
  return { ...plan, video: plan.video.map((c) => (c.id === id ? { ...c, ...patch } : c)) };
}

/** Sets one transition for every boundary (each clip's own value is replaced). */
export function setAllTransitions(plan: VsPlan, transition: NonNullable<VsVideoClip["transition"]>, sec?: number): VsPlan {
  return { ...plan, video: plan.video.map((c) => ({ ...c, transition, ...(sec !== undefined ? { transitionSec: sec } : {}) })) };
}

/** Splits an audio clip at time t (timeline seconds): the second part keeps playing the same file from where the first stopped. */
export function splitAudioAt(plan: VsPlan, id: string, t: number): VsPlan {
  const a = plan.audio.find((x) => x.id === id);
  if (!a) return plan;
  const cut = t - a.start;
  if (cut < MIN_DUR || a.duration - cut < MIN_DUR) return plan;
  const sp = a.speed ?? 1;
  const first: VsAudioClip = { ...a, duration: cut };
  delete first.fadeOut;
  const second: VsAudioClip = { ...a, id: newId("aud-"), start: t, duration: a.duration - cut, srcIn: (a.srcIn ?? 0) + cut * sp };
  delete second.fadeIn;
  return { ...plan, audio: plan.audio.flatMap((x) => (x.id === id ? [first, second] : [x])) };
}

/** Trims an audio clip from one edge by deltaSec (negative = grow). The start edge also moves the in-point so the sound stays in place. */
export function trimAudio(plan: VsPlan, id: string, edge: "start" | "end", deltaSec: number): VsPlan {
  const a = plan.audio.find((x) => x.id === id);
  if (!a || !Number.isFinite(deltaSec)) return plan;
  const sp = a.speed ?? 1;
  let next: VsAudioClip;
  if (edge === "start") {
    const lo = Math.max(-(a.srcIn ?? 0) / sp, -a.start);
    const d = Math.max(lo, Math.min(a.duration - MIN_DUR, deltaSec));
    next = { ...a, start: a.start + d, duration: a.duration - d, srcIn: Math.max(0, (a.srcIn ?? 0) + d * sp) };
  } else {
    next = { ...a, duration: Math.max(MIN_DUR, a.duration + deltaSec) };
  }
  return { ...plan, audio: plan.audio.map((x) => (x.id === id ? next : x)) };
}

/** Sentences of a narration text; long ones are cut at commas / semicolons so each caption stays short. */
export function splitCaptionLines(text: string, maxChars = 70): string[] {
  const out: string[] = [];
  const sentences = text.replace(/\s+/g, " ").trim().split(/(?<=[.!?…。])\s+|\n+/);
  for (const raw of sentences) {
    const s = raw.trim();
    if (!s) continue;
    if (s.length <= maxChars) {
      out.push(s);
      continue;
    }
    let cur = "";
    for (const part of s.split(/(?<=[,;:])\s+/)) {
      if (cur && (cur + " " + part).length > maxChars) {
        out.push(cur);
        cur = part;
      } else cur = cur ? cur + " " + part : part;
    }
    if (cur) out.push(cur);
  }
  return out;
}

/**
 * Captions that follow the narration: the narration text is cut into sentences and each gets a share of the narration
 * clip's time in proportion to its length. Earlier generated captions are replaced; other texts stay. It is an estimate
 * of the speech timing, not a word-level alignment. Returns the plan unchanged when there is no text or no narration clip.
 */
export function captionsFromNarration(plan: VsPlan): VsPlan {
  const text = plan.narration ?? "";
  const clip = plan.audio.find((a) => a.kind === "narration");
  const lines = splitCaptionLines(text);
  if (!clip || lines.length === 0) return plan;
  const weights = lines.map((l) => Math.max(8, l.length));
  const sum = weights.reduce((s, w) => s + w, 0);
  let at = clip.start;
  const made: VsTextItem[] = lines.map((l, i) => {
    const d = (clip.duration * (weights[i] as number)) / sum;
    const item: VsTextItem = { id: newId("cap-"), text: l.slice(0, 300), start: Math.round(at * 100) / 100, duration: Math.max(0.3, Math.round(d * 100) / 100), caption: true };
    at += d;
    return item;
  });
  return { ...plan, texts: [...plan.texts.filter((x) => x.caption !== true), ...made] };
}
