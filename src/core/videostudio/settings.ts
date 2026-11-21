// src/core/videostudio/settings.ts
// Video Studio settings and external tool lookup (ffmpeg / ffprobe).

import fs from "node:fs";
import path from "node:path";
import { VsError } from "./plan.js";
import { VS_PROFILE_KEYS, VS_PROFILE_LIMITS, type VsProfile } from "./plan-types.js";

type Env = Record<string, string | undefined>;

function isFile(p: string | null | undefined): p is string {
  if (typeof p !== "string" || p.length === 0) return false;
  try {
    return fs.statSync(p).isFile();
  } catch {
    return false;
  }
}

function pathDirs(env: Env): string[] {
  const raw = env.PATH ?? env.Path ?? "";
  return raw.split(path.delimiter).filter((d) => d.length > 0);
}

function listDirs(dir: string): string[] {
  try {
    return fs.readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => path.join(dir, e.name));
  } catch {
    return [];
  }
}

/**
 * Places where ffmpeg usually lives even when it is not on the PATH of this process: winget and Chocolatey installs
 * (a program started before the install does not see the new PATH), and the common manual folders.
 */
export function knownFfmpegDirs(env: Env): string[] {
  const dirs: string[] = [];
  const local = env.LOCALAPPDATA;
  const programFiles = [env.ProgramFiles, env["ProgramFiles(x86)"], env.ProgramW6432].filter((d): d is string => !!d);
  if (local) {
    dirs.push(path.join(local, "Microsoft", "WinGet", "Links"));
    const pkgs = path.join(local, "Microsoft", "WinGet", "Packages");
    for (const p of listDirs(pkgs).filter((d) => /ffmpeg/i.test(path.basename(d)))) {
      dirs.push(path.join(p, "bin"));
      for (const sub of listDirs(p)) dirs.push(path.join(sub, "bin"));
    }
  }
  if (env.ProgramData) dirs.push(path.join(env.ProgramData, "chocolatey", "bin"));
  for (const pf of programFiles) {
    dirs.push(path.join(pf, "ffmpeg", "bin"));
    dirs.push(path.join(pf, "FFmpeg", "bin"));
  }
  dirs.push("C:\\ffmpeg\\bin");
  return dirs;
}

function toolNames(base: string): string[] {
  return process.platform === "win32" ? [base, `${base}.exe`] : [base];
}

function findInDirs(dirs: string[], base: string): string | null {
  for (const dir of dirs) {
    for (const name of toolNames(base)) {
      const candidate = path.join(dir, name);
      if (isFile(candidate)) return candidate;
    }
  }
  return null;
}

export function findFfmpeg(configured?: string | null, env: Env = process.env): string | null {
  if (isFile(env.TNF_FFMPEG)) return env.TNF_FFMPEG;
  if (isFile(configured)) return configured;
  return findInDirs(pathDirs(env), "ffmpeg") ?? findInDirs(knownFfmpegDirs(env), "ffmpeg");
}

export interface VsSettings {
  ffmpegPath: string | null;
  voice: {
    provider: "none" | "windows" | "http";
    voiceName: string;
    rate: number;
    url: string;
    token: string | null;
  };
  media: { provider: "none" | "http"; url: string; token: string | null };
  model: string | null;
  profile: VsProfile;
  defaultStyleId: string | null;
}

export interface VsSettingsPublic {
  ffmpegPath: string | null;
  ffmpegFound: boolean;
  voice: {
    provider: "none" | "windows" | "http";
    voiceName: string;
    rate: number;
    url: string;
    hasToken: boolean;
  };
  media: { provider: "none" | "http"; url: string; hasToken: boolean };
  model: string | null;
  profile: VsProfile;
  defaultStyleId: string | null;
}

export interface VsSettingsInput {
  ffmpegPath?: string | null;
  voice?: {
    provider?: string;
    voiceName?: string;
    rate?: number;
    url?: string;
    token?: string | null;
  };
  media?: { provider?: string; url?: string; token?: string | null };
  model?: string | null;
  profile?: Partial<VsProfile>;
  defaultStyleId?: string | null;
}

export interface VsSettingsStore {
  read(): VsSettings;
  publicView(): VsSettingsPublic;
  update(input: VsSettingsInput): VsSettingsPublic;
}

function defaults(): VsSettings {
  return {
    ffmpegPath: null,
    voice: {
      provider: process.platform === "win32" ? "windows" : "none",
      voiceName: "",
      rate: 0,
      url: "",
      token: null,
    },
    media: { provider: "none", url: "", token: null },
    model: null,
    profile: emptyProfile(),
    defaultStyleId: null,
  };
}

export function emptyProfile(): VsProfile {
  return { brand: "", slogan: "", about: "", products: "", facts: "", contact: "", avoid: "" };
}

function cleanText(v: string): string {
  return v.replace(/\r\n/g, "\n").trim();
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function okUrl(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "") return true;
  return checkUrl(v) === null;
}

function checkUrl(v: string): string | null {
  if (v.length > 300) return "Địa chỉ URL quá dài (tối đa 300 ký tự).";
  let u: URL;
  try {
    u = new URL(v);
  } catch {
    return "Địa chỉ URL không hợp lệ.";
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return "Địa chỉ URL phải dùng http hoặc https.";
  }
  if (u.username || u.password) {
    return "Địa chỉ URL không được chứa thông tin đăng nhập.";
  }
  return null;
}

function checkFfmpegPath(v: string): string | null {
  if (!path.isAbsolute(v)) return "Đường dẫn ffmpeg phải là đường dẫn tuyệt đối.";
  const base = path.basename(v).toLowerCase();
  if (base !== "ffmpeg" && base !== "ffmpeg.exe") {
    return "Tệp phải có tên ffmpeg hoặc ffmpeg.exe.";
  }
  return null;
}

function sanitize(raw: unknown): VsSettings {
  const d = defaults();
  if (!isObj(raw)) return d;
  if (typeof raw.ffmpegPath === "string" && raw.ffmpegPath && checkFfmpegPath(raw.ffmpegPath) === null) {
    d.ffmpegPath = raw.ffmpegPath;
  }
  if (typeof raw.model === "string" && raw.model.trim() && raw.model.trim().length <= 100) {
    d.model = raw.model.trim();
  }
  const tok = (v: unknown): string | null =>
    typeof v === "string" && v.length > 0 && v.length <= 4000 ? v : null;
  if (isObj(raw.voice)) {
    const v = raw.voice;
    if (v.provider === "none" || v.provider === "windows" || v.provider === "http") d.voice.provider = v.provider;
    if (typeof v.voiceName === "string" && v.voiceName.length <= 200) d.voice.voiceName = v.voiceName;
    if (typeof v.rate === "number" && Number.isInteger(v.rate) && v.rate >= -10 && v.rate <= 10) d.voice.rate = v.rate;
    if (okUrl(v.url)) d.voice.url = v.url;
    d.voice.token = tok(v.token);
  }
  if (isObj(raw.media)) {
    const m = raw.media;
    if (m.provider === "none" || m.provider === "http") d.media.provider = m.provider;
    if (okUrl(m.url)) d.media.url = m.url;
    d.media.token = tok(m.token);
  }
  if (typeof raw.defaultStyleId === "string" && /^[a-z0-9-]{1,60}$/.test(raw.defaultStyleId)) d.defaultStyleId = raw.defaultStyleId;
  if (isObj(raw.profile)) {
    for (const k of VS_PROFILE_KEYS) {
      const v = raw.profile[k];
      if (typeof v === "string" && cleanText(v).length <= VS_PROFILE_LIMITS[k]) d.profile[k] = cleanText(v);
    }
  }
  return d;
}

export function createVsSettingsStore(dataDir: string, env: Env = process.env): VsSettingsStore {
  const file = path.join(dataDir, "videostudio", "settings.json");

  function read(): VsSettings {
    try {
      return sanitize(JSON.parse(fs.readFileSync(file, "utf8")));
    } catch {
      return defaults();
    }
  }

  function view(s: VsSettings): VsSettingsPublic {
    return {
      ffmpegPath: s.ffmpegPath,
      ffmpegFound: findFfmpeg(s.ffmpegPath, env) !== null,
      voice: {
        provider: s.voice.provider,
        voiceName: s.voice.voiceName,
        rate: s.voice.rate,
        url: s.voice.url,
        hasToken: s.voice.token !== null,
      },
      media: { provider: s.media.provider, url: s.media.url, hasToken: s.media.token !== null },
      model: s.model,
      profile: { ...s.profile },
      defaultStyleId: s.defaultStyleId,
    };
  }

  function applyToken(cur: string | null, v: unknown): string | null {
    if (v === undefined || v === "") return cur;
    if (v === null) return null;
    if (typeof v !== "string") throw new VsError("Token không hợp lệ.", 400);
    if (v.length > 4000) throw new VsError("Token quá dài (tối đa 4000 ký tự).", 400);
    return v;
  }

  function applyUrl(cur: string, v: unknown): string {
    if (v === undefined) return cur;
    if (typeof v !== "string") throw new VsError("Địa chỉ URL không hợp lệ.", 400);
    if (v === "") return "";
    const err = checkUrl(v);
    if (err) throw new VsError(err, 400);
    return v;
  }

  function update(input: VsSettingsInput): VsSettingsPublic {
    if (!isObj(input)) throw new VsError("Dữ liệu cài đặt không hợp lệ.", 400);
    const next = read();
    if (input.ffmpegPath !== undefined) {
      if (input.ffmpegPath === null || input.ffmpegPath === "") next.ffmpegPath = null;
      else if (typeof input.ffmpegPath !== "string") throw new VsError("Đường dẫn ffmpeg không hợp lệ.", 400);
      else {
        const err = checkFfmpegPath(input.ffmpegPath);
        if (err) throw new VsError(err, 400);
        next.ffmpegPath = input.ffmpegPath;
      }
    }
    if (input.model !== undefined) {
      if (input.model === null) next.model = null;
      else if (typeof input.model !== "string") throw new VsError("Tên mô hình không hợp lệ.", 400);
      else {
        const m = input.model.trim();
        if (m.length > 100) throw new VsError("Tên mô hình quá dài (tối đa 100 ký tự).", 400);
        next.model = m === "" ? null : m;
      }
    }
    if (input.defaultStyleId !== undefined) {
      if (input.defaultStyleId === null || input.defaultStyleId === "") next.defaultStyleId = null;
      else if (typeof input.defaultStyleId !== "string" || !/^[a-z0-9-]{1,60}$/.test(input.defaultStyleId)) throw new VsError("Mã phong cách không hợp lệ.", 400);
      else next.defaultStyleId = input.defaultStyleId;
    }
    if (input.profile !== undefined) {
      if (!isObj(input.profile)) throw new VsError("Thông tin cho AI không hợp lệ.", 400);
      const p = input.profile as Record<string, unknown>;
      for (const k of VS_PROFILE_KEYS) {
        const v = p[k];
        if (v === undefined) continue;
        if (typeof v !== "string") throw new VsError("Mỗi mục thông tin cho AI phải là chuỗi văn bản.", 400);
        const t = cleanText(v);
        if (t.length > VS_PROFILE_LIMITS[k]) throw new VsError(`Mục "${k}" tối đa ${VS_PROFILE_LIMITS[k]} ký tự.`, 400);
        next.profile[k] = t;
      }
    }
    if (input.voice !== undefined) {
      if (!isObj(input.voice)) throw new VsError("Cài đặt giọng đọc không hợp lệ.", 400);
      const v = input.voice;
      if (v.provider !== undefined) {
        if (v.provider !== "none" && v.provider !== "windows" && v.provider !== "http") {
          throw new VsError("Nhà cung cấp giọng đọc phải là none, windows hoặc http.", 400);
        }
        next.voice.provider = v.provider;
      }
      if (v.voiceName !== undefined) {
        if (typeof v.voiceName !== "string" || v.voiceName.length > 200) {
          throw new VsError("Tên giọng đọc không hợp lệ (tối đa 200 ký tự).", 400);
        }
        next.voice.voiceName = v.voiceName;
      }
      if (v.rate !== undefined) {
        if (typeof v.rate !== "number" || !Number.isInteger(v.rate) || v.rate < -10 || v.rate > 10) {
          throw new VsError("Tốc độ đọc phải là số nguyên từ -10 đến 10.", 400);
        }
        next.voice.rate = v.rate;
      }
      next.voice.url = applyUrl(next.voice.url, v.url);
      next.voice.token = applyToken(next.voice.token, v.token);
    }
    if (input.media !== undefined) {
      if (!isObj(input.media)) throw new VsError("Cài đặt media không hợp lệ.", 400);
      const m = input.media;
      if (m.provider !== undefined) {
        if (m.provider !== "none" && m.provider !== "http") {
          throw new VsError("Nhà cung cấp media phải là none hoặc http.", 400);
        }
        next.media.provider = m.provider;
      }
      next.media.url = applyUrl(next.media.url, m.url);
      next.media.token = applyToken(next.media.token, m.token);
    }
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmpFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(next, null, 2), "utf8");
    fs.renameSync(tmpFile, file);
    return view(next);
  }

  return { read, publicView: () => view(read()), update };
}

export function findFfprobe(ffmpegPath: string | null, env: Env = process.env): string | null {
  if (ffmpegPath) {
    const found = findInDirs([path.dirname(ffmpegPath)], "ffprobe");
    if (found) return found;
  }
  return findInDirs(pathDirs(env), "ffprobe") ?? findInDirs(knownFfmpegDirs(env), "ffprobe");
}
