// src/core/videostudio/plan.ts
import type {
  VsAspect,
  VsAudioClip,
  VsPlan,
  VsTextItem,
  VsVideoClip,
} from "./plan-types.js";

export class VsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.name = "VsError";
    this.status = status;
  }
}

export function safeVsRel(rel: string): string {
  const norm = String(rel ?? "").replace(/\\/g, "/");
  if (norm === "") throw new VsError("Đường dẫn tệp không được rỗng.");
  if (norm.startsWith("/")) throw new VsError("Đường dẫn tệp không được là đường dẫn tuyệt đối.");
  if (/^[A-Za-z]:/.test(norm)) throw new VsError("Đường dẫn tệp không được chứa ký tự ổ đĩa.");
  for (const part of norm.split("/")) {
    if (part === "") throw new VsError("Đường dẫn tệp có phần rỗng.");
    if (part === "." || part === "..") throw new VsError("Đường dẫn tệp không được chứa '.' hoặc '..'.");
  }
  return norm;
}

export function emptyPlan(styleId: string, aspect: VsAspect): VsPlan {
  const size =
    aspect === "9:16" ? { width: 1080, height: 1920 }
    : aspect === "1:1" ? { width: 1080, height: 1080 }
    : { width: 1920, height: 1080 };
  return { version: 1, ...size, fps: 30, video: [], audio: [], texts: [], styleId };
}

export function planDuration(plan: VsPlan): number {
  let video = 0;
  for (const c of plan.video) video += c.duration;
  let end = video;
  for (const a of plan.audio) end = Math.max(end, a.start + a.duration);
  for (const t of plan.texts) end = Math.max(end, t.start + t.duration);
  return end;
}

export type VsValidation = { ok: true; plan: VsPlan } | { ok: false; errors: string[] };

const ID_RE = /^[A-Za-z0-9_-]{1,40}$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

function isRec(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function validatePlan(raw: unknown): VsValidation {
  const errors: string[] = [];
  if (!isRec(raw)) return { ok: false, errors: ["Kế hoạch phải là một đối tượng."] };

  if (raw["version"] !== 1) errors.push("version phải bằng 1.");

  const dim = (key: "width" | "height"): number => {
    const v = raw[key];
    if (typeof v !== "number" || !Number.isInteger(v) || v % 2 !== 0 || v < 16 || v > 4096) {
      errors.push(`${key} phải là số nguyên chẵn từ 16 đến 4096.`);
      return 0;
    }
    return v;
  };
  const width = dim("width");
  const height = dim("height");
  const fpsRaw = raw["fps"];
  let fps = 0;
  if (typeof fpsRaw !== "number" || !Number.isFinite(fpsRaw) || fpsRaw < 1 || fpsRaw > 60) {
    errors.push("fps phải là số từ 1 đến 60.");
  } else fps = fpsRaw;

  const num = (obj: Record<string, unknown>, key: string, pos: string, def?: number): number => {
    const v = obj[key];
    if (v === undefined && def !== undefined) return def;
    if (typeof v !== "number" || !Number.isFinite(v)) {
      errors.push(`${pos}.${key} phải là số hữu hạn.`);
      return 0;
    }
    return v;
  };
  const checkDuration = (d: number, pos: string, obj: Record<string, unknown>): void => {
    if (typeof obj["duration"] === "number" && Number.isFinite(d) && (d <= 0 || d > 600)) {
      errors.push(`${pos}.duration phải lớn hơn 0 và tối đa 600 giây.`);
    }
  };
  const checkId = (obj: Record<string, unknown>, pos: string, seen: Set<string>): string => {
    const id = obj["id"];
    if (typeof id !== "string" || !ID_RE.test(id)) {
      errors.push(`${pos}.id không hợp lệ (chỉ chữ, số, '_' và '-', tối đa 40 ký tự).`);
      return "";
    }
    if (seen.has(id)) errors.push(`${pos}.id bị trùng: ${id}.`);
    seen.add(id);
    return id;
  };
  const checkAsset = (v: unknown, pos: string): string | undefined => {
    if (typeof v !== "string") {
      errors.push(`${pos}.asset phải là chuỗi.`);
      return undefined;
    }
    try {
      return safeVsRel(v);
    } catch (e) {
      errors.push(`${pos}.asset: ${e instanceof Error ? e.message : String(e)}`);
      return undefined;
    }
  };
  const arr = (key: string, max: number): unknown[] => {
    const v = raw[key];
    if (v === undefined) return [];
    if (!Array.isArray(v)) {
      errors.push(`${key} phải là một mảng.`);
      return [];
    }
    if (v.length > max) {
      errors.push(`${key} có tối đa ${max} phần tử.`);
      return [];
    }
    return v;
  };

  const video: VsVideoClip[] = [];
  const seenV = new Set<string>();
  arr("video", 200).forEach((item, i) => {
    const pos = `video[${i}]`;
    if (!isRec(item)) {
      errors.push(`${pos} phải là một đối tượng.`);
      return;
    }
    const id = checkId(item, pos, seenV);
    const kind = item["kind"];
    if (kind !== "video" && kind !== "image" && kind !== "card") {
      errors.push(`${pos}.kind phải là video, image hoặc card.`);
      return;
    }
    const srcIn = num(item, "srcIn", pos, 0);
    if (srcIn < 0) errors.push(`${pos}.srcIn không được âm.`);
    const duration = num(item, "duration", pos);
    checkDuration(duration, pos, item);
    const clip: VsVideoClip = { id, kind, srcIn, duration };
    const fit = item["fit"];
    if (fit === "contain" || fit === "cover" || fit === "blur") clip.fit = fit;
    else if (fit !== undefined) errors.push(`${pos}.fit phải là contain, cover hoặc blur.`);
    const tr = item["transition"];
    if (tr !== undefined) {
      if (typeof tr === "string" && ["none", "fade", "dissolve", "wipeleft", "slideleft", "zoomin", "circleopen"].includes(tr)) clip.transition = tr as VsVideoClip["transition"] & string;
      else errors.push(`${pos}.transition không hợp lệ.`);
    }
    if (item["transitionSec"] !== undefined) {
      const v = num(item, "transitionSec", pos);
      if (v < 0 || v > 5) errors.push(`${pos}.transitionSec phải từ 0 đến 5 giây.`);
      else clip.transitionSec = v;
    }
    const mo = item["motion"];
    if (mo !== undefined) {
      if (typeof mo === "string" && ["none", "zoomin", "zoomout", "panleft", "panright"].includes(mo)) clip.motion = mo as VsVideoClip["motion"] & string;
      else errors.push(`${pos}.motion không hợp lệ.`);
    }
    if (item["speed"] !== undefined) {
      const v = num(item, "speed", pos);
      if (v < 0.25 || v > 4) errors.push(`${pos}.speed phải từ 0.25 đến 4.`);
      else clip.speed = v;
    }
    if (typeof item["keepAudio"] === "boolean") clip.keepAudio = item["keepAudio"];
    const prompt = item["prompt"];
    if (prompt !== undefined) {
      if (typeof prompt !== "string") errors.push(`${pos}.prompt phải là chuỗi.`);
      else if (prompt.length > 500) errors.push(`${pos}.prompt tối đa 500 ký tự.`);
      else clip.prompt = prompt;
    }
    if (item["asset"] !== undefined && item["asset"] !== null && item["asset"] !== "") {
      const a = checkAsset(item["asset"], pos);
      if (a !== undefined) clip.asset = a;
    }
    if (kind === "card") {
      const color = item["color"] === undefined ? "#000000" : item["color"];
      if (typeof color !== "string" || !COLOR_RE.test(color)) {
        errors.push(`${pos}.color phải có dạng #rrggbb.`);
      } else clip.color = color;
      const ct = item["cardText"];
      if (ct !== undefined) {
        if (typeof ct !== "string") errors.push(`${pos}.cardText phải là chuỗi.`);
        else if (ct.length > 200) errors.push(`${pos}.cardText tối đa 200 ký tự.`);
        else clip.cardText = ct;
      }
    } else if (clip.asset === undefined && (clip.prompt === undefined || clip.prompt === "")) {
      errors.push(`${pos} (${kind}) cần asset hoặc prompt.`);
    }
    video.push(clip);
  });

  const audio: VsAudioClip[] = [];
  const seenA = new Set<string>();
  arr("audio", 50).forEach((item, i) => {
    const pos = `audio[${i}]`;
    if (!isRec(item)) {
      errors.push(`${pos} phải là một đối tượng.`);
      return;
    }
    const id = checkId(item, pos, seenA);
    const asset = checkAsset(item["asset"], pos) ?? "";
    const start = num(item, "start", pos);
    if (start < 0) errors.push(`${pos}.start không được âm.`);
    const duration = num(item, "duration", pos);
    checkDuration(duration, pos, item);
    const volume = num(item, "volume", pos, 1);
    if (volume < 0 || volume > 2) errors.push(`${pos}.volume phải từ 0 đến 2.`);
    const clip: VsAudioClip = { id, asset, start, duration, volume };
    const k = item["kind"];
    if (k === "music" || k === "narration" || k === "sfx") clip.kind = k;
    else if (k !== undefined) errors.push(`${pos}.kind phải là music, narration hoặc sfx.`);
    for (const key of ["fadeIn", "fadeOut"] as const) {
      if (item[key] === undefined) continue;
      const v = num(item, key, pos);
      if (v < 0 || v > 30) errors.push(`${pos}.${key} phải từ 0 đến 30 giây.`);
      else clip[key] = v;
    }
    if (item["speed"] !== undefined) {
      const v = num(item, "speed", pos);
      if (v < 0.5 || v > 2) errors.push(`${pos}.speed phải từ 0.5 đến 2.`);
      else clip.speed = v;
    }
    if (item["srcIn"] !== undefined) {
      const v = num(item, "srcIn", pos);
      if (v < 0) errors.push(`${pos}.srcIn không được âm.`);
      else clip.srcIn = v;
    }
    audio.push(clip);
  });

  const texts: VsTextItem[] = [];
  const seenT = new Set<string>();
  arr("texts", 100).forEach((item, i) => {
    const pos = `texts[${i}]`;
    if (!isRec(item)) {
      errors.push(`${pos} phải là một đối tượng.`);
      return;
    }
    const id = checkId(item, pos, seenT);
    const text = item["text"];
    let t = "";
    if (typeof text !== "string" || text.trim() === "") errors.push(`${pos}.text không được rỗng.`);
    else if (text.length > 300) errors.push(`${pos}.text tối đa 300 ký tự.`);
    else t = text;
    const start = num(item, "start", pos);
    if (start < 0) errors.push(`${pos}.start không được âm.`);
    const duration = num(item, "duration", pos);
    checkDuration(duration, pos, item);
    const it: VsTextItem = { id, text: t, start, duration };
    for (const key of ["x", "y", "size"] as const) {
      if (item[key] !== undefined) it[key] = num(item, key, pos);
    }
    if (item["color"] !== undefined) {
      if (typeof item["color"] === "string" && COLOR_RE.test(item["color"])) it.color = item["color"];
      else errors.push(`${pos}.color phải có dạng #rrggbb.`);
    }
    if (typeof item["caption"] === "boolean") it.caption = item["caption"];
    texts.push(it);
  });

  const plan: VsPlan = { version: 1, width, height, fps, video, audio, texts };
  const narration = raw["narration"];
  if (narration !== undefined) {
    if (typeof narration !== "string") errors.push("narration phải là chuỗi.");
    else if (narration.length > 5000) errors.push("narration tối đa 5000 ký tự.");
    else plan.narration = narration;
  }
  const styleId = raw["styleId"];
  if (typeof styleId === "string") plan.styleId = styleId;
  if (typeof raw["showTexts"] === "boolean") plan.showTexts = raw["showTexts"];
  if (typeof raw["duck"] === "boolean") plan.duck = raw["duck"];
  const pf = raw["fit"];
  if (pf === "contain" || pf === "cover" || pf === "blur") plan.fit = pf;
  else if (pf !== undefined) errors.push("fit phải là contain, cover hoặc blur.");
  const pv = raw["voice"];
  if (pv !== undefined) {
    if (!isRec(pv)) errors.push("voice phải là một đối tượng.");
    else {
      const v: { name?: string; rate?: number } = {};
      if (typeof pv["name"] === "string" && pv["name"].length <= 200) v.name = pv["name"];
      if (typeof pv["rate"] === "number" && Number.isInteger(pv["rate"]) && pv["rate"] >= -10 && pv["rate"] <= 10) v.rate = pv["rate"];
      plan.voice = v;
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, plan };
}
