// src/core/workshop3d/variants.ts — configuration variants of a master model (docs/DESIGN-3D.md 6c).
// Pure code: slot validation, slot -> GLB node mapping, config product, applying choices to a GLB. No AI.
import { bboxOfNodes, importMaterial, nodeNames, parseGlb, replaceNodesWithPart, setNodesMaterial, writeGlb, type Glb } from "./glb.js";
import { W3D_SLOT_LIMITS, type W3DSlot } from "./types.js";
import { fold } from "../app/util.js";
export { fold };

export const MAX_CONFIGS = 24;
export const MAX_OPTIONS = 24;
const SLOT_ID = /^[a-z0-9][a-z0-9_]{0,63}$/;

export class VariantError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 409 | 413 | 503 = 400) {
    super(message);
  }
}

export type Checked<T> = { ok: true; value: T } | { ok: false; error: string };

/** Validates the `slots` of a brief (intake output or API body). Never throws. */
export function normalizeSlots(v: unknown): Checked<W3DSlot[]> {
  if (v === undefined || v === null) return { ok: true, value: [] };
  if (!Array.isArray(v)) return { ok: false, error: "brief.slots phải là mảng." };
  if (v.length > W3D_SLOT_LIMITS.max) return { ok: false, error: `brief.slots tối đa ${W3D_SLOT_LIMITS.max} chỗ cấu hình.` };
  const out: W3DSlot[] = [];
  const seen = new Set<string>();
  for (const raw of v) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, error: "Mỗi slot phải là một đối tượng." };
    const r = raw as Record<string, unknown>;
    const id = typeof r["id"] === "string" ? r["id"].trim() : "";
    if (!SLOT_ID.test(id)) return { ok: false, error: "slot.id chỉ gồm a-z, 0-9, gạch dưới, bắt đầu bằng chữ hoặc số (tối đa 64 ký tự)." };
    if (seen.has(id)) return { ok: false, error: `slot.id "${id}" bị trùng.` };
    seen.add(id);
    const name = typeof r["name"] === "string" ? r["name"].trim() : "";
    if (!name || name.length > W3D_SLOT_LIMITS.name) return { ok: false, error: `slot.name của "${id}" phải là chuỗi 1 đến ${W3D_SLOT_LIMITS.name} ký tự.` };
    const type = r["type"] === undefined ? "material" : r["type"];
    if (type !== "material" && type !== "part") return { ok: false, error: `slot.type của "${id}" phải là "material" hoặc "part".` };
    const slot: W3DSlot = { id, name, type };
    if (r["nodes"] !== undefined) {
      const nodes = r["nodes"];
      if (!Array.isArray(nodes) || nodes.length > W3D_SLOT_LIMITS.nodes || nodes.some((x) => typeof x !== "string" || !x.trim() || x.length > W3D_SLOT_LIMITS.pattern)) {
        return { ok: false, error: `slot.nodes của "${id}" phải là mảng tối đa ${W3D_SLOT_LIMITS.nodes} chuỗi (mỗi chuỗi ≤ ${W3D_SLOT_LIMITS.pattern} ký tự).` };
      }
      if (nodes.length > 0) slot.nodes = (nodes as string[]).map((x) => x.trim());
    }
    if (typeof r["hint"] === "string" && r["hint"].trim()) slot.hint = r["hint"].trim().slice(0, W3D_SLOT_LIMITS.hint);
    out.push(slot);
  }
  return { ok: true, value: out };
}

// ---------- mapping ----------
/** Exact name, or `prefix*`. Case-insensitive. */
export function matchPattern(name: string, pattern: string): boolean {
  const n = name.toLowerCase();
  const p = pattern.toLowerCase();
  return p.endsWith("*") ? n.startsWith(p.slice(0, -1)) : n === p;
}

export interface SlotMapping {
  slot: W3DSlot;
  /** Indices of the matched nodes (meshes below them are included when applying). */
  nodes: number[];
  names: string[];
  /** Size of the matched geometry in mm, null when nothing matched / no geometry. */
  size_mm: { w: number; d: number; h: number } | null;
}

/** slot -> GLB nodes. Explicit patterns win; otherwise nodes named like the id or starting with `id_`. A node already taken by an earlier slot is skipped. */
export function mapSlots(g: Glb, slots: W3DSlot[]): SlotMapping[] {
  const names = nodeNames(g);
  const taken = new Set<number>();
  return slots.map((slot) => {
    const patterns = slot.nodes && slot.nodes.length > 0 ? slot.nodes : [slot.id, `${slot.id}_*`];
    const nodes: number[] = [];
    names.forEach((nm, i) => {
      if (!nm || taken.has(i)) return;
      if (patterns.some((p) => matchPattern(nm, p))) nodes.push(i);
    });
    nodes.forEach((i) => taken.add(i));
    const box = nodes.length > 0 ? bboxOfNodes(g, nodes) : null;
    const size = box ? { w: round((box.max[0] - box.min[0]) * 1000), d: round((box.max[2] - box.min[2]) * 1000), h: round((box.max[1] - box.min[1]) * 1000) } : null;
    return { slot, nodes, names: nodes.map((i) => names[i]!), size_mm: size };
  });
}

const round = (n: number): number => Math.round(n * 10) / 10;

/** Library-slab size for a slot: its two largest extents as width/depth and the smallest as thickness, clamped to the library limits. */
export function slabSizeForSlot(size: { w: number; d: number; h: number } | null): { w: number; d: number; h: number } {
  if (!size) return { w: 600, d: 600, h: 20 };
  const [a, b, c] = [size.w, size.d, size.h].sort((x, y) => y - x) as [number, number, number];
  const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(v)));
  return { w: clamp(a, 10, 5000), d: clamp(b, 10, 5000), h: clamp(c, 1, 500) };
}

// ---------- commands (name + slot only; never generates shapes) ----------
/** Slot a command is about: every word of the slot name (or of its id) appears in the command, accents and word order ignored; null when none or more than one slot is named. */
export function pickSlotFromCommand(command: string, slots: W3DSlot[]): string | null {
  const words = new Set(fold(command).split(/[^a-z0-9]+/).filter(Boolean));
  const score = (key: string): number => {
    const ws = key.split(/[^a-z0-9]+/).filter(Boolean);
    return ws.length > 0 && ws.every((w) => words.has(w)) ? ws.join("").length : 0;
  };
  const hits = slots
    .map((s) => ({ id: s.id, len: Math.max(score(fold(s.name)), score(s.id)) }))
    .filter((h) => h.len > 0)
    .sort((a, b) => b.len - a.len);
  if (hits.length === 0) return null;
  if (hits.length !== 1) return null; // several slots named: the user must choose
  return hits[0]!.id;
}

/** Display name from a command: its first line, trimmed; the fallback when empty. */
export function optionNameFromCommand(command: string, fallback: string): string {
  const first = command.split(/\r?\n/).map((l) => l.trim()).find((l) => l.length > 0) ?? "";
  const name = first.replace(/\s+/g, " ").slice(0, 60).trim();
  return name || fallback;
}

// ---------- configs ----------
export type Choices = Record<string, string | null>;

/** Cartesian product of the chosen options per slot (a slot with no options keeps the master). Throws VariantError above `max`. */
export function configProduct(perSlot: Record<string, string[]>, slotOrder: string[], max = MAX_CONFIGS): Choices[] {
  const used = slotOrder.filter((id) => (perSlot[id] ?? []).length > 0);
  if (used.length === 0) throw new VariantError("Chọn ít nhất một phương án cho một chỗ cấu hình.");
  let total = 1;
  for (const id of used) total *= new Set(perSlot[id]).size;
  if (total > max) throw new VariantError(`Tạo ${total} cấu hình vượt trần ${max}. Bớt phương án rồi thử lại.`);
  let acc: Choices[] = [{}];
  for (const id of used) {
    const next: Choices[] = [];
    for (const base of acc) for (const opt of new Set(perSlot[id])) next.push({ ...base, [id]: opt });
    acc = next;
  }
  return acc;
}

export type ResolvedOption =
  | { kind: "material"; slab: Buffer; mapping: "tile" | "fit"; tileCm: number }
  | { kind: "part"; glb: Buffer };

/**
 * Builds one configuration: the master GLB with each chosen slot changed (material swapped / node replaced).
 * `choices[slot] = null` or missing keeps the master for that slot. Throws VariantError with a Vietnamese message.
 */
export function applyConfig(master: Buffer, slots: W3DSlot[], choices: Choices, resolve: (optionId: string) => ResolvedOption): Buffer {
  let g: Glb;
  try {
    g = parseGlb(master);
  } catch (e) {
    throw new VariantError(`Mẫu chính không đọc được: ${e instanceof Error ? e.message : String(e)}`);
  }
  const maps = mapSlots(g, slots);
  for (const m of maps) {
    const optionId = choices[m.slot.id];
    if (!optionId) continue;
    if (m.nodes.length === 0) throw new VariantError(`Chỗ "${m.slot.name}" chưa khớp node nào của mẫu chính.`);
    const opt = resolve(optionId);
    try {
      if (opt.kind === "material") {
        const idx = importMaterial(g, parseGlb(opt.slab));
        setNodesMaterial(g, m.nodes, idx, { mode: opt.mapping, tileCm: opt.tileCm });
      } else {
        if (m.slot.type !== "part") throw new VariantError(`Chỗ "${m.slot.name}" chỉ nhận phương án vật liệu.`);
        replaceNodesWithPart(g, m.nodes, parseGlb(opt.glb), `${m.slot.id}_variant`);
      }
    } catch (e) {
      if (e instanceof VariantError) throw e;
      throw new VariantError(`Không ghép được phương án vào "${m.slot.name}": ${e instanceof Error ? e.message : String(e)}`);
    }
  }
  return writeGlb(g);
}
