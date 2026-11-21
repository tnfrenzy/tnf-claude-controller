/* Pure helpers for a 3D workshop session in the UI: controls by state, polling stop, request sheet -> brief. */
import type { Design3DTemplate, Workshop3DBriefInput } from "../types.js";

/** States in which a role or a build step is working (the engine's isRunning, minus waiting_quota). */
export const W3D_WORKING_STATES = [
  "intake", "art", "planning", "modeling", "building", "materials", "rendering", "reviewing", "optimizing", "presenting",
  "hqrender", "hqreview", "hqmaterials",
] as const;

/** "Đang render chất lượng cao: ảnh i/N" while Blender works (index of the image being rendered, total). */
export function w3dHqProgress(state: string, hq: { running?: unknown; total?: unknown; index?: unknown } | null | undefined): { i: number; n: number } | "preparing" | null {
  if (state !== "hqrender" && state !== "rendering") return null;
  const n = typeof hq?.total === "number" ? hq.total : 0;
  const i = typeof hq?.index === "number" ? hq.index : 0;
  if (hq?.running === true && n > 0 && i > 0) return { i, n };
  return state === "hqrender" ? "preparing" : null;
}

/** Polling stops in these states: nothing changes until the user acts (resume / rebuild restart it). */
export function w3dTerminal(state: string): boolean {
  return state === "done" || state === "failed" || state === "stopped";
}

/** Buttons the engine accepts in a state (mirrors src/core/workshop3d/state.ts pause / resume / stop). */
export function w3dControls(state: string): { pause: boolean; resume: boolean; stop: boolean } {
  const working = (W3D_WORKING_STATES as readonly string[]).includes(state) || state === "waiting_quota";
  return {
    pause: working,
    resume: state === "paused" || state === "stopped" || state === "failed",
    stop: state !== "" && state !== "done" && state !== "stopped",
  };
}

/** The error is about the CAD python (missing venv, cadquery, trimesh...): the UI adds where to install it. */
export function w3dNeedsCadHint(error: string | null | undefined): boolean {
  return typeof error === "string" && /python|cadquery|trimesh|pygltflib|usd-core|\bCAD\b/i.test(error);
}

export type W3DDetail = Workshop3DBriefInput["detail"];
export interface W3DParamRow { key: string; value: string }
export interface W3DRequestSheet {
  title: string;
  object: string;
  rows: readonly W3DParamRow[];
  material: string;
  purpose: string;
  detail: W3DDetail;
  /** Configurable parts asked up front (name + type); ids are derived from the names. */
  slots?: readonly W3DSlotRow[];
}
export interface W3DSlotRow { name: string; type: "material" | "part" }
export type W3DSheetError = "title" | "object" | "object_long" | "param_key" | "too_many" | "slots";

/** Server limit of configurable slots (src/core/workshop3d/types.ts W3D_SLOT_LIMITS). */
export const W3D_SLOT_MAX = 8;

/** ASCII slot id from a Vietnamese name ("Đá sàn" -> "da_san"), unique among `taken`; "slot" when nothing is left. */
export function slotIdFromName(name: string, taken: ReadonlySet<string> = new Set()): string {
  const base = name.normalize("NFD").replace(/\p{M}/gu, "").replace(/đ/g, "d").replace(/Đ/g, "d").toLowerCase()
    .replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40) || "slot";
  let id = base;
  for (let n = 2; taken.has(id); n++) id = `${base}_${n}`;
  return id;
}

/** Slot rows -> brief slots (empty names dropped). null = invalid (too many). */
export function slotsFromRows(rows: readonly W3DSlotRow[]): { id: string; name: string; type: "material" | "part" }[] | null {
  const used = rows.map((r) => ({ name: r.name.trim().slice(0, 80), type: r.type })).filter((r) => r.name);
  if (used.length > W3D_SLOT_MAX) return null;
  const taken = new Set<string>();
  return used.map((r) => {
    const id = slotIdFromName(r.name, taken);
    taken.add(id);
    return { id, ...r };
  });
}

/** Server limits (src/core/workshop3d/types.ts W3D_BRIEF_LIMITS, src/server/http.ts w3dBriefFromBody). */
export const W3D_LIMITS = { title: 120, object: 4000, material: 200, purpose: 300, params: 50, key: 60, value: 200 } as const;

/** Reference images (src/core/workshop3d/attachments.ts W3D_IMAGE_LIMITS). */
export const W3D_IMAGE_LIMITS = { files: 5, fileBytes: 5 * 1024 * 1024, totalBytes: 15 * 1024 * 1024 } as const;
export const W3D_IMAGE_ACCEPT = "image/png,image/jpeg,image/webp";
const IMAGE_EXT_RE = /\.(png|jpe?g|webp)$/i;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];
export type W3DImageError = "image_type" | "image_size" | "image_count" | "image_total";

/** File name the inbox accepts (ASCII letters, digits, . _ -), keeping the image extension; unique within `taken`. */
export function safeImageName(name: string, taken: ReadonlySet<string>): string {
  const m = IMAGE_EXT_RE.exec(name);
  const ext = (m?.[1] ?? "png").toLowerCase();
  const stem = (m ? name.slice(0, -m[0].length) : name)
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, (c) => (c === "đ" ? "d" : "D"))
    .replace(/[^A-Za-z0-9._-]+/g, "-").replace(/\.{2,}/g, ".").replace(/^[^A-Za-z0-9]+/, "").replace(/[-.]+$/, "")
    .slice(0, 60) || "anh";
  let out = `${stem}.${ext}`;
  for (let i = 2; taken.has(out.toLowerCase()); i++) out = `${stem}-${i}.${ext}`;
  return out;
}

/** Add picked files to the chosen images: type, per-file size, count and total size checked; the first problem is reported. */
export function addReferenceImages<T extends { name: string; size: number; type: string }>(current: readonly T[], picked: readonly T[]): { images: T[]; error: W3DImageError | null } {
  const images = [...current];
  let error: W3DImageError | null = null;
  for (const f of picked) {
    if (!IMAGE_TYPES.includes(f.type) && !IMAGE_EXT_RE.test(f.name)) error ??= "image_type";
    else if (f.size <= 0 || f.size > W3D_IMAGE_LIMITS.fileBytes) error ??= "image_size";
    else if (images.length >= W3D_IMAGE_LIMITS.files) error ??= "image_count";
    else if (images.reduce((a, x) => a + x.size, 0) + f.size > W3D_IMAGE_LIMITS.totalBytes) error ??= "image_total";
    else images.push(f);
  }
  return { images, error };
}

/** "1100" -> 1100, "1,5" -> 1.5, anything else stays text. */
export function parseParamValue(v: string): string | number {
  const t = v.trim();
  if (/^-?\d+([.,]\d+)?$/.test(t)) {
    const n = Number(t.replace(",", "."));
    if (Number.isFinite(n)) return n;
  }
  return t;
}

/** Request sheet -> brief for POST /api/workshop3d. Empty rows are dropped; a value without a name is an error. */
export function buildWorkshop3DBrief(f: W3DRequestSheet): { brief: Workshop3DBriefInput } | { error: W3DSheetError } {
  const title = f.title.trim();
  const object = f.object.trim();
  if (!title) return { error: "title" };
  if (!object) return { error: "object" };
  // Never cut the description silently: the server refuses a longer one, so say it here.
  if (object.length > W3D_LIMITS.object) return { error: "object_long" };
  const params: Record<string, string | number> = {};
  let count = 0;
  for (const r of f.rows) {
    const key = r.key.trim();
    const value = r.value.trim();
    if (!key && !value) continue;
    if (!key || key.length > W3D_LIMITS.key) return { error: "param_key" };
    if (!(key in params)) count++;
    params[key] = parseParamValue(value.slice(0, W3D_LIMITS.value));
  }
  if (count > W3D_LIMITS.params) return { error: "too_many" };
  const brief: Workshop3DBriefInput = {
    title: title.slice(0, W3D_LIMITS.title),
    object,
    params,
    detail: f.detail,
    attachments: [],
  };
  const material = f.material.trim();
  const purpose = f.purpose.trim();
  if (material) brief.material = material.slice(0, W3D_LIMITS.material);
  if (purpose) brief.purpose = purpose.slice(0, W3D_LIMITS.purpose);
  if (f.slots && f.slots.length > 0) {
    const slots = slotsFromRows(f.slots);
    if (slots === null) return { error: "slots" };
    if (slots.length > 0) brief.slots = slots;
  }
  return { brief };
}

/** Default sizes (mm) per elevator template of config/design3d-kit.json; unknown ids use the cabin sizes. */
const TEMPLATE_SIZES: Record<string, [number, number, number]> = {
  "cabin-passenger": [1100, 1400, 2300],
  "landing-door": [900, 120, 2100],
  "cop-panel": [250, 40, 1100],
  "cabin-ceiling": [1100, 1400, 150],
  handrail: [1000, 60, 900],
};
export const W3D_DEFAULT_MATERIAL = "inox sọc nhuyễn";

/** Choosing a template fills the size rows, the name and the description (its prompt with the sizes filled in). */
export function sheetFromTemplate(tpl: Design3DTemplate, material = W3D_DEFAULT_MATERIAL): Pick<W3DRequestSheet, "title" | "object" | "rows" | "material"> {
  const [w, d, h] = TEMPLATE_SIZES[tpl.id] ?? TEMPLATE_SIZES["cabin-passenger"]!;
  const object = tpl.prompt
    .replace(/\{\{width\}\}/g, () => String(w))
    .replace(/\{\{depth\}\}/g, () => String(d))
    .replace(/\{\{height\}\}/g, () => String(h))
    .replace(/\{\{material\}\}/g, () => material)
    .slice(0, W3D_LIMITS.object);
  return {
    title: tpl.label,
    object,
    rows: [{ key: "width_mm", value: String(w) }, { key: "depth_mm", value: String(d) }, { key: "height_mm", value: String(h) }],
    material,
  };
}

/** "Xóa bản dựng" is offered only when nothing runs (done, failed, stopped, paused); the server checks again (409). */
export function w3dCanDelete(state: string): boolean {
  return ["done", "failed", "stopped", "paused"].includes(state);
}
/** Confirmation text: session name, space freed (MB), and that it cannot be undone (the dictionary sentence says so). */
export function w3dDeleteConfirmText(template: string, title: string, bytes: unknown): string {
  const size = typeof bytes === "number" && Number.isFinite(bytes) && bytes >= 0 ? `${(bytes / 1048576).toFixed(1).replace(".", ",")} MB` : "?";
  return template.replace("{title}", title.slice(0, 120)).replace("{size}", size);
}
