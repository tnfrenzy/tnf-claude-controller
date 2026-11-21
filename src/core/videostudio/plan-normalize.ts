// src/core/videostudio/plan-normalize.ts
// Pure. The director/editor AI does not always follow the exact VsPlan field names (it may leave out `id` and `kind`,
// invent `start`/`transition`, name an asset by its original file name, or send the narration as a list).
// This turns such an answer into something validatePlan accepts, without inventing content: only structure is repaired.

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".avi", ".m4v"]);
const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const DEFAULT_SHOT_SEC = 3;

export interface NormalizeCtx {
  /** Relative paths of the project's assets, e.g. "assets/photo.jpg". */
  assets: readonly string[];
  /** Seconds used for a clip that gives no length. */
  defaultShotSec?: number;
}

type Rec = Record<string, unknown>;

function isRec(v: unknown): v is Rec {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function ext(p: string): string {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}

function baseName(p: string): string {
  const s = p.replace(/\\/g, "/");
  return s.slice(s.lastIndexOf("/") + 1);
}

/** Lower-case letters and digits only, so "Thang_M_y-1.jpg" and "thang-m-y 1.JPG" compare equal. */
function squash(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9.]/g, "");
}

function num(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function str(v: unknown): string | null {
  return typeof v === "string" ? v : null;
}

function uniqueId(want: unknown, prefix: string, n: number, used: Set<string>): string {
  const w = typeof want === "string" ? want.trim() : "";
  const base = ID_RE.test(w) ? w : `${prefix}${n}`;
  let id = base;
  for (let k = 2; used.has(id); k++) id = `${base.slice(0, 36)}-${k}`;
  used.add(id);
  return id;
}

/** The project's asset that the AI means, or null when it names none that exists. */
export function matchAsset(name: unknown, assets: readonly string[]): string | null {
  const s = str(name);
  if (!s || !s.trim()) return null;
  const clean = s.trim().replace(/\\/g, "/").replace(/^\.?\//, "");
  if (assets.includes(clean)) return clean;
  const withPrefix = clean.startsWith("assets/") ? clean : `assets/${clean}`;
  if (assets.includes(withPrefix)) return withPrefix;
  const want = squash(baseName(clean));
  if (!want) return null;
  const hit = assets.find((a) => squash(baseName(a)) === want);
  return hit ?? null;
}

function normalizeClips(rawClips: unknown, ctx: NormalizeCtx): Rec[] {
  if (!Array.isArray(rawClips)) return [];
  const fallbackSec = ctx.defaultShotSec && ctx.defaultShotSec > 0 ? ctx.defaultShotSec : DEFAULT_SHOT_SEC;
  const used = new Set<string>();
  const items = rawClips.filter(isRec);
  return items.map((c, i) => {
    const out: Rec = {};
    out["id"] = uniqueId(c["id"], "v", i + 1, used);

    const asset = matchAsset(c["asset"] ?? c["file"] ?? c["src"] ?? c["source"], ctx.assets);
    const text = str(c["cardText"]) ?? str(c["text"]) ?? str(c["caption"]) ?? str(c["title"]);
    const prompt = str(c["prompt"]);

    let kind = str(c["kind"]) ?? str(c["type"]);
    if (kind !== "video" && kind !== "image" && kind !== "card") {
      if (asset) kind = VIDEO_EXT.has(ext(asset)) ? "video" : IMAGE_EXT.has(ext(asset)) ? "image" : "video";
      else kind = prompt && prompt.trim() ? "image" : "card";
    }
    // A video/image clip needs an asset or a prompt; when the named asset does not exist keep the clip as a prompt/card.
    if (asset) out["asset"] = asset;
    if (prompt !== null && prompt.trim()) out["prompt"] = prompt.slice(0, 500);
    else if (!asset && kind !== "card" && text && text.trim()) out["prompt"] = text.slice(0, 500);
    if (!asset && kind !== "card" && out["prompt"] === undefined) kind = "card";
    out["kind"] = kind;

    const srcIn = num(c["srcIn"]) ?? num(c["in"]) ?? 0;
    out["srcIn"] = srcIn >= 0 ? srcIn : 0;

    let duration = num(c["duration"]);
    if (duration === null) {
      const start = num(c["start"]);
      const end = num(c["end"]) ?? (start !== null ? num(items[i + 1]?.["start"]) : null);
      duration = start !== null && end !== null && end > start ? end - start : fallbackSec;
    }
    out["duration"] = Math.min(600, Math.max(0.1, duration));

    if (kind === "card") {
      const color = str(c["color"]);
      if (color && COLOR_RE.test(color)) out["color"] = color;
      const ct = text ?? prompt;
      if (ct && ct.trim()) out["cardText"] = ct.slice(0, 200);
    }
    return out;
  });
}

function normalizeTexts(rawTexts: unknown): Rec[] {
  if (!Array.isArray(rawTexts)) return [];
  const used = new Set<string>();
  const out: Rec[] = [];
  rawTexts.forEach((item, i) => {
    const t: Rec = typeof item === "string" ? { text: item } : isRec(item) ? item : {};
    const text = str(t["text"]) ?? str(t["content"]) ?? str(t["caption"]);
    if (text === null || !text.trim()) return;
    const o: Rec = { id: uniqueId(t["id"], "t", i + 1, used), text: text.slice(0, 500) };
    const start = num(t["start"]);
    o["start"] = start !== null && start >= 0 ? start : 0;
    const dur = num(t["duration"]);
    o["duration"] = dur !== null && dur > 0 ? Math.min(600, dur) : DEFAULT_SHOT_SEC;
    for (const k of ["x", "y", "size"] as const) {
      const v = num(t[k]);
      if (v !== null) o[k] = v;
    }
    out.push(o);
  });
  return out;
}

function normalizeAudio(rawAudio: unknown, ctx: NormalizeCtx): Rec[] {
  if (!Array.isArray(rawAudio)) return [];
  const used = new Set<string>();
  const out: Rec[] = [];
  rawAudio.filter(isRec).forEach((a, i) => {
    const asset = matchAsset(a["asset"], ctx.assets);
    const dur = num(a["duration"]);
    if (!asset || dur === null || dur <= 0) return;
    const kind = str(a["kind"]);
    const o: Rec = {
      id: uniqueId(a["id"], "a", i + 1, used),
      asset,
      start: Math.max(0, num(a["start"]) ?? 0),
      duration: Math.min(600, dur),
      volume: Math.min(4, Math.max(0, num(a["volume"]) ?? 1)),
    };
    if (kind === "music" || kind === "narration" || kind === "sfx") o["kind"] = kind;
    out.push(o);
  });
  return out;
}

/** Narration as one string: a string stays, a list is joined, an object's `text` is used, anything else is dropped. */
export function normalizeNarration(v: unknown): string | undefined {
  if (typeof v === "string") return v;
  if (Array.isArray(v)) {
    const parts = v.map((x) => (typeof x === "string" ? x : isRec(x) ? (str(x["text"]) ?? str(x["narration"]) ?? "") : "")).filter((s) => s.trim());
    return parts.length ? parts.join(" ") : undefined;
  }
  if (isRec(v)) return str(v["text"]) ?? str(v["narration"]) ?? undefined;
  return undefined;
}

/** A whole plan from the director: structure repaired, content untouched. */
export function normalizeDirectorPlan(raw: Rec, ctx: NormalizeCtx): Rec {
  const out: Rec = { ...raw, version: 1 };
  out["video"] = normalizeClips(raw["video"] ?? raw["clips"] ?? raw["scenes"] ?? raw["shots"], ctx);
  out["texts"] = normalizeTexts(raw["texts"] ?? raw["captions"] ?? raw["subtitles"]);
  out["audio"] = normalizeAudio(raw["audio"], ctx);
  const narration = normalizeNarration(raw["narration"]);
  if (narration === undefined) delete out["narration"];
  else out["narration"] = narration;
  return out;
}

/** The `{ video, texts }` answer of the editor for one segment. */
export function normalizeSegment(raw: Rec, ctx: NormalizeCtx): { video: Rec[]; texts: Rec[] } {
  return { video: normalizeClips(raw["video"] ?? raw["clips"], ctx), texts: normalizeTexts(raw["texts"]) };
}
