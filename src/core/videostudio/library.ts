// src/core/videostudio/library.ts
// Shared library of images/videos/audio the user provides once (logo, product photos, shop videos, jingles) and can
// attach to any new video. Files live in <dataDir>/videostudio/_library/.

import fs from "node:fs";
import path from "node:path";
import { VsError } from "./plan.js";

export const LIBRARY_MAX_FILES = 100;
export const LIBRARY_MAX_BYTES = 300 * 1024 * 1024;

export interface VsLibraryItem {
  name: string;
  kind: "image" | "video" | "audio";
  size: number;
}

const IMAGE_EXT = new Set([".jpg", ".jpeg", ".png", ".webp", ".bmp", ".gif"]);
const VIDEO_EXT = new Set([".mp4", ".mov", ".webm", ".mkv", ".m4v", ".avi"]);
const AUDIO_EXT = new Set([".mp3", ".wav", ".m4a", ".aac", ".ogg"]);

export function libraryKind(name: string): VsLibraryItem["kind"] | null {
  const e = path.extname(name).toLowerCase();
  if (IMAGE_EXT.has(e)) return "image";
  if (VIDEO_EXT.has(e)) return "video";
  if (AUDIO_EXT.has(e)) return "audio";
  return null;
}

/** A safe file name: no folders, only letters, digits, dot, dash and underscore (accents dropped), at most 100 characters. */
export function safeLibraryName(raw: string): string {
  const base = String(raw ?? "").replace(/\\/g, "/").split("/").pop() ?? "";
  const ext = path.extname(base);
  const stem = base
    .slice(0, base.length - ext.length)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "D")
    .replace(/[^A-Za-z0-9._-]+/g, "_")
    .replace(/^[._]+/, "");
  const cleanExt = ext.replace(/[^A-Za-z0-9.]/g, "").toLowerCase();
  return `${(stem || "file").slice(0, 100 - cleanExt.length)}${cleanExt}`;
}

export interface VsLibrary {
  list(): VsLibraryItem[];
  add(name: string, data: Buffer): VsLibraryItem;
  remove(name: string): boolean;
  /** Absolute path of an existing library file, or null. */
  filePath(name: string): string | null;
  read(name: string): Buffer | null;
}

export function createVsLibrary(dataDir: string): VsLibrary {
  const dir = path.join(dataDir, "videostudio", "_library");

  function filePath(name: string): string | null {
    const safe = safeLibraryName(name);
    if (safe !== name) return null; // only exact stored names, never a path
    const p = path.join(dir, safe);
    try {
      return fs.statSync(p).isFile() ? p : null;
    } catch {
      return null;
    }
  }

  function list(): VsLibraryItem[] {
    let names: string[];
    try {
      names = fs.readdirSync(dir);
    } catch {
      return [];
    }
    const out: VsLibraryItem[] = [];
    for (const n of names.sort((a, b) => a.localeCompare(b))) {
      const kind = libraryKind(n);
      if (!kind) continue;
      try {
        const st = fs.statSync(path.join(dir, n));
        if (st.isFile()) out.push({ name: n, kind, size: st.size });
      } catch {
        /* vanished */
      }
    }
    return out;
  }

  return {
    list,
    add(rawName, data) {
      const name = safeLibraryName(rawName);
      const kind = libraryKind(name);
      if (!kind) throw new VsError("Chỉ nhận ảnh (jpg, png, webp...), video (mp4, mov, webm...) hoặc âm thanh (mp3, wav...).", 400);
      if (data.length === 0) throw new VsError("Tệp rỗng.", 400);
      if (data.length > LIBRARY_MAX_BYTES) throw new VsError("Tệp quá lớn (tối đa 300 MB).", 400);
      const existing = list();
      if (!existing.some((i) => i.name === name) && existing.length >= LIBRARY_MAX_FILES) {
        throw new VsError(`Thư viện chỉ chứa tối đa ${LIBRARY_MAX_FILES} tệp.`, 400);
      }
      fs.mkdirSync(dir, { recursive: true });
      const tmp = path.join(dir, `.${name}.tmp`);
      fs.writeFileSync(tmp, data);
      fs.renameSync(tmp, path.join(dir, name));
      return { name, kind, size: data.length };
    },
    remove(name) {
      const p = filePath(name);
      if (!p) return false;
      fs.rmSync(p, { force: true });
      return true;
    },
    filePath,
    read(name) {
      const p = filePath(name);
      return p ? fs.readFileSync(p) : null;
    },
  };
}
