import type { W3DParams, W3DState } from "./types";

export interface Vec3 { x: number; y: number; z: number }

export const M_TO_MM = 1000;

/** Distance between two points given in metres (glTF units), in millimetres. */
export function distanceMm(a: Vec3, b: Vec3): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z) * M_TO_MM;
}

function mmNumber(mm: number): string {
  const v = Math.abs(mm) < 100 ? Math.round(mm * 10) / 10 : Math.round(mm);
  return String(v).replace(".", ",");
}

export function formatMm(mm: number): string {
  if (!Number.isFinite(mm)) return "—";
  return `${mmNumber(mm)} mm`;
}

/** Bounding box size in metres (x = width, y = height, z = depth) → "W × D × H mm". */
export function formatDimsMm(size: Vec3): string {
  return `${mmNumber(size.x * M_TO_MM)} × ${mmNumber(size.z * M_TO_MM)} × ${mmNumber(size.y * M_TO_MM)} mm`;
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1).replace(".", ",")} KB`;
  return `${(n / 1024 / 1024).toFixed(1).replace(".", ",")} MB`;
}

export type Platform = "ios" | "android" | "desktop";

export function detectPlatform(ua: string, maxTouchPoints = 0): Platform {
  if (/iPhone|iPad|iPod/i.test(ua)) return "ios";
  // iPadOS 13+ reports a Mac UA but has touch points.
  if (/Macintosh/i.test(ua) && maxTouchPoints > 1) return "ios";
  if (/Android/i.test(ua)) return "android";
  return "desktop";
}

export interface ModelSources {
  /** Path of the GLB shown in the viewer / sent to Scene Viewer. */
  glb: string | null;
  /** Path for Quick Look (iOS), if the engine produced one. */
  usdz: string | null;
  /** STL part files, for the three.js viewer. */
  stl: string[];
}

export const GLB_MAIN = "outputs/model.glb";
export const GLB_MOBILE = "outputs/model-mobile.glb";
/** Blender export with real stone textures; written only when gltf-validator found 0 errors, so the desktop viewer prefers it. */
export const GLB_BLENDER = "outputs/model-blender.glb";
export const USDZ_MAIN = "outputs/model.usdz";

/** Choose model files by device: the Blender export first on desktop, phones prefer the light GLB; the USDZ is kept for Quick Look. */
export function pickSources(files: string[], platform: Platform): ModelSources {
  const has = (p: string) => files.includes(p);
  const mobile = platform !== "desktop";
  const original = mobile && has(GLB_MOBILE) ? GLB_MOBILE : has(GLB_BLENDER) ? GLB_BLENDER : has(GLB_MAIN) ? GLB_MAIN : has(GLB_MOBILE) ? GLB_MOBILE : null;
  const glb = original;
  const usdz = has(USDZ_MAIN) ? USDZ_MAIN : null;
  const stl = files.filter((f) => /^outputs\/parts\/[^/]+\.stl$/i.test(f)).sort();
  return { glb, usdz, stl };
}

/**
 * `ar-modes` attribute. The GLB reaches model-viewer as a blob: URL, which Scene Viewer cannot fetch, so on Android WebXR
 * goes first (it renders the live scene, blob or not, and keeps a changed size). iOS always offers Quick Look: without a
 * ready USDZ (or after the size was changed) model-viewer builds one from the live scene.
 */
export function arModes(platform: Platform, _hasUsdz?: boolean): string {
  if (platform === "ios") return "quick-look";
  if (platform === "android") return "webxr scene-viewer";
  return "webxr";
}

/** Why the AR button may be missing, for the line under the viewer. */
export type ArIssue = "desktop" | "insecure" | "unsupported" | null;
export function arIssue(platform: Platform, secure: boolean, canActivate: boolean | null): ArIssue {
  if (canActivate === true) return null;
  if (platform === "desktop") return "desktop";
  if (platform === "android" && !secure) return "insecure";
  return canActivate === false ? "unsupported" : null;
}

/** Size the user typed, in millimetres, per axis: x = length, z = width, y = height. */
export interface SizeMm { x: number; y: number; z: number }
export const SCALE_MIN = 0.01;
export const SCALE_MAX = 100;

/** Original bounding box (metres) → millimetres. */
export function sizeToMm(size: Vec3): SizeMm {
  return { x: size.x * M_TO_MM, y: size.y * M_TO_MM, z: size.z * M_TO_MM };
}

/**
 * Change one axis of the size. With `lock` the other axes follow by the same ratio. Returns the new size in mm, or null
 * when the value is not a positive number inside the allowed range (0.01x – 100x of the original).
 */
export function resizeAxis(orig: SizeMm, current: SizeMm, axis: keyof SizeMm, valueMm: number, lock: boolean): SizeMm | null {
  if (!Number.isFinite(valueMm) || valueMm <= 0 || orig[axis] <= 0) return null;
  const k = valueMm / current[axis];
  const next: SizeMm = lock ? { x: current.x * k, y: current.y * k, z: current.z * k } : { ...current, [axis]: valueMm };
  for (const a of ["x", "y", "z"] as const) {
    if (orig[a] <= 0) continue;
    const r = next[a] / orig[a];
    if (r < SCALE_MIN || r > SCALE_MAX) return null;
  }
  return next;
}

/** model-viewer `scale` attribute ("x y z" multipliers) for a size; null when the size equals the original. */
export function scaleFor(orig: SizeMm, current: SizeMm): { x: number; y: number; z: number } | null {
  const r = (a: keyof SizeMm) => (orig[a] > 0 ? current[a] / orig[a] : 1);
  const v = { x: r("x"), y: r("y"), z: r("z") };
  return Math.abs(v.x - 1) < 1e-6 && Math.abs(v.y - 1) < 1e-6 && Math.abs(v.z - 1) < 1e-6 ? null : v;
}

export function baseName(p: string): string {
  return p.split(/[\\/]/).pop() ?? p;
}

const IDLE: readonly W3DState[] = ["done", "failed", "stopped"];
export function canRebuild(state: W3DState): boolean {
  return IDLE.includes(state);
}
/** True while the engine is working (poll for progress). */
export function isBusy(state: W3DState): boolean {
  return !["done", "failed", "stopped", "paused", "awaiting_user"].includes(state);
}

/** Parse the text of a param input against the original value's type. null = invalid. */
export function parseParamInput(orig: string | number, text: string): string | number | null {
  if (typeof orig === "number") {
    const s = text.trim().replace(",", ".");
    if (s === "") return null;
    const n = Number(s);
    return Number.isFinite(n) ? n : null;
  }
  return text;
}

/** Only the entries whose value differs from the original. */
export function changedParams(orig: W3DParams, next: W3DParams): W3DParams {
  const out: W3DParams = {};
  for (const [k, v] of Object.entries(next)) if (orig[k] !== v) out[k] = v;
  return out;
}

export function renderLabel(path: string): string {
  return baseName(path).replace(/\.[^.]+$/, "").replace(/[_-]+/g, " ");
}

/** Labels of the Blender views (renders/hq/<name>.png). */
const HQ_LABELS: Record<"vi" | "en", Record<string, string>> = {
  vi: { overview: "Toàn cảnh (nhìn vách hậu)", door: "Nhìn ra cửa", ceiling: "Trần và đèn", floor: "Sàn", wall_left: "Vách trái", wall_right: "Vách phải", wall_back: "Vách hậu", cop: "Bảng gọi tầng (COP)" },
  en: { overview: "Overview (back wall)", door: "Towards the door", ceiling: "Ceiling and lights", floor: "Floor", wall_left: "Left wall", wall_right: "Right wall", wall_back: "Back wall", cop: "Car operating panel (COP)" },
};
export function hqViewLabel(name: string, lang: "vi" | "en" = "vi"): string {
  const n = baseName(name).replace(/\.png$/i, "");
  const known = HQ_LABELS[lang][n];
  if (known) return known;
  if (n.startsWith("plan_")) return `${lang === "vi" ? "Góc" : "View"} ${n.slice(5).replace(/[_-]+/g, " ")}`;
  return n.replace(/[_-]+/g, " ");
}
/** Blender images (high-quality set) in the renders list. */
export function hqImages(renders: string[]): string[] {
  return renders.filter((r) => /^renders\/hq\/[a-z0-9_-]+\.png$/.test(r));
}
