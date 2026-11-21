// src/core/videostudio/styles.ts
// Builtin and user video styles for Video Studio.

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { VsStyle } from "./plan-types.js";
import { VsError } from "./plan.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(HERE, "..", "..", "..");
const DEFAULT_BUILTIN_FILE = path.join(REPO_ROOT, "config", "video-styles.json");

const ID_RE = /^[a-z0-9]+(-[a-z0-9]+)*$/;
const COLOR_RE = /^#[0-9a-fA-F]{6}$/;

export type StyleValidation =
  | { ok: true; style: VsStyle }
  | { ok: false; message: string };

function fail(message: string): StyleValidation {
  return { ok: false, message };
}

function inRange(v: unknown, min: number, max: number): v is number {
  return typeof v === "number" && Number.isFinite(v) && v >= min && v <= max;
}

export function validateStyle(raw: unknown): StyleValidation {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return fail("Mẫu phong cách phải là một đối tượng.");
  }
  const r = raw as Record<string, unknown>;

  if (typeof r.name !== "string") return fail("Tên phong cách phải là chuỗi.");
  const name = r.name.trim();
  if (name.length < 1 || name.length > 40) {
    return fail("Tên phong cách phải dài 1-40 ký tự.");
  }
  if (r.transition !== "none" && r.transition !== "fade") {
    return fail("Chuyển cảnh phải là none hoặc fade.");
  }
  if (!inRange(r.transitionSec, 0, 2)) {
    return fail("Thời lượng chuyển cảnh phải từ 0 đến 2 giây.");
  }
  if (!inRange(r.shotSec, 0.5, 20)) {
    return fail("Thời lượng mỗi cảnh phải từ 0,5 đến 20 giây.");
  }
  if (typeof r.textColor !== "string" || !COLOR_RE.test(r.textColor)) {
    return fail("Màu chữ phải có dạng #rrggbb.");
  }
  const opt = (key: string, min: number, max: number, label: string): string | null => {
    const v = r[key];
    if (v === undefined) return null;
    return inRange(v, min, max) ? null : `${label} phải từ ${min} đến ${max}.`;
  };
  const e =
    opt("brightness", -1, 1, "Độ sáng") ??
    opt("contrast", 0, 3, "Độ tương phản") ??
    opt("saturation", 0, 3, "Độ bão hòa") ??
    opt("gamma", 0.1, 10, "Gamma");
  if (e) return fail(e);

  if (typeof r.visualPrompt !== "string" || r.visualPrompt.length > 400) {
    return fail("Mô tả hình ảnh phải là chuỗi tối đa 400 ký tự.");
  }
  if (typeof r.font !== "string" || r.font.length > 60) {
    return fail("Phông chữ phải là chuỗi tối đa 60 ký tự.");
  }
  if (r.textBox !== undefined && typeof r.textBox !== "boolean") {
    return fail("textBox phải là đúng/sai.");
  }
  if (r.description !== undefined && typeof r.description !== "string") {
    return fail("Mô tả phải là chuỗi.");
  }
  let id = "";
  if (r.id !== undefined) {
    if (typeof r.id !== "string" || r.id.length > 60 || !ID_RE.test(r.id)) {
      return fail("Mã phong cách chỉ gồm chữ thường, số và gạch ngang (tối đa 60).");
    }
    id = r.id;
  }

  const style: VsStyle = {
    id,
    name,
    builtin: false,
    transition: r.transition,
    transitionSec: r.transitionSec as number,
    shotSec: r.shotSec as number,
    font: r.font,
    textColor: r.textColor,
    textBox: r.textBox === true,
    visualPrompt: r.visualPrompt,
  };
  if (typeof r.description === "string") style.description = r.description;
  if (typeof r.brightness === "number") style.brightness = r.brightness;
  if (typeof r.contrast === "number") style.contrast = r.contrast;
  if (typeof r.saturation === "number") style.saturation = r.saturation;
  if (typeof r.gamma === "number") style.gamma = r.gamma;
  return { ok: true, style };
}

export function loadBuiltinStyles(file: string = DEFAULT_BUILTIN_FILE): VsStyle[] {
  let data: unknown;
  try {
    data = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(data)) return [];
  const out: VsStyle[] = [];
  for (const item of data) {
    const v = validateStyle(item);
    if (v.ok && v.style.id !== "") out.push({ ...v.style, builtin: true });
  }
  return out;
}

const MAX_USER_STYLES = 50;

export interface StyleStore {
  list(): VsStyle[];
  save(raw: unknown): VsStyle;
  remove(id: string): boolean;
}

function slugifyName(name: string): string {
  const s = name
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/đ/g, "d")
    .replace(/Đ/g, "d")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 50)
    .replace(/-+$/g, "");
  return s === "" ? "style" : s;
}

export function createStyleStore(dataDir: string, builtinFile?: string): StyleStore {
  const file = path.join(dataDir, "videostudio", "styles.json");
  const builtins = (): VsStyle[] => loadBuiltinStyles(builtinFile);

  const readUser = (builtinIds: Set<string>): VsStyle[] => {
    let data: unknown;
    try {
      data = JSON.parse(fs.readFileSync(file, "utf8"));
    } catch {
      return [];
    }
    if (!Array.isArray(data)) return [];
    const out: VsStyle[] = [];
    const seen = new Set<string>();
    for (const item of data) {
      const v = validateStyle(item);
      if (!v.ok || v.style.id === "") continue;
      if (builtinIds.has(v.style.id) || seen.has(v.style.id)) continue;
      seen.add(v.style.id);
      out.push({ ...v.style, builtin: false });
    }
    return out;
  };

  const write = (styles: VsStyle[]): void => {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const tmpFile = `${file}.${process.pid}.tmp`;
    fs.writeFileSync(tmpFile, JSON.stringify(styles, null, 2), "utf8");
    fs.renameSync(tmpFile, file);
  };

  return {
    list() {
      const b = builtins();
      return [...b, ...readUser(new Set(b.map((s) => s.id)))];
    },
    save(raw) {
      const v = validateStyle(raw);
      if (!v.ok) throw new VsError(v.message, 400);
      const b = builtins();
      const builtinIds = new Set(b.map((s) => s.id));
      const users = readUser(builtinIds);
      let id = v.style.id;
      if (id === "") {
        const taken = new Set([...builtinIds, ...users.map((s) => s.id)]);
        const root = slugifyName(v.style.name);
        id = root;
        for (let n = 2; taken.has(id); n++) id = `${root}-${n}`;
      } else if (builtinIds.has(id)) {
        throw new VsError("Mã phong cách trùng với mẫu có sẵn.", 400);
      }
      const style: VsStyle = { ...v.style, id, builtin: false };
      const idx = users.findIndex((s) => s.id === id);
      if (idx >= 0) {
        users[idx] = style;
      } else {
        if (users.length >= MAX_USER_STYLES) {
          throw new VsError("Tối đa 50 mẫu phong cách của người dùng.", 400);
        }
        users.push(style);
      }
      write(users);
      return style;
    },
    remove(id) {
      const b = builtins();
      if (b.some((s) => s.id === id)) {
        throw new VsError("Không thể xóa mẫu phong cách có sẵn.", 400);
      }
      const users = readUser(new Set(b.map((s) => s.id)));
      const next = users.filter((s) => s.id !== id);
      if (next.length === users.length) return false;
      write(next);
      return true;
    },
  };
}
