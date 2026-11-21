/** Pure geometry: the empty strips between rooms (inside the rooms' bounding box), so the scene can floor them. */
import type { OfficeLayout, Rect } from "./layout.js";

function uniqueSorted(values: number[]): number[] {
  return [...new Set(values)].sort((p, q) => p - q);
}

function inside(r: Rect, x: number, y: number): boolean {
  return x > r.x && x < r.x + r.w && y > r.y && y < r.y + r.h;
}

/** Cells of the grid cut by every room edge that lie in the bounding box of the rooms but in no room. */
export function gapRects(layout: Pick<OfficeLayout, "rooms">): Rect[] {
  const rooms = layout.rooms;
  if (rooms.length === 0) return [];
  const xs = uniqueSorted(rooms.flatMap((r) => [r.x, r.x + r.w]));
  const ys = uniqueSorted(rooms.flatMap((r) => [r.y, r.y + r.h]));
  const out: Rect[] = [];
  for (let j = 0; j + 1 < ys.length; j++) {
    for (let i = 0; i + 1 < xs.length; i++) {
      const x = xs[i]!;
      const y = ys[j]!;
      const w = xs[i + 1]! - x;
      const h = ys[j + 1]! - y;
      const cx = x + w / 2;
      const cy = y + h / 2;
      if (!rooms.some((r) => inside(r, cx, cy))) out.push({ x, y, w, h });
    }
  }
  return out;
}

export interface GapBlock extends Rect {
  /** Sides that continue a room's full-height wall line (north / west). */
  tall: Array<"north" | "west">;
}

const overlaps = (a: Rect, b: Rect): boolean => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

/** `r` minus `k` as up to four rectangles. */
function subtractRect(r: Rect, k: Rect): Rect[] {
  if (!overlaps(r, k)) return [r];
  const out: Rect[] = [];
  const x1 = Math.min(r.x + r.w, k.x + k.w);
  if (k.y > r.y) out.push({ x: r.x, y: r.y, w: r.w, h: k.y - r.y });
  if (k.y + k.h < r.y + r.h) out.push({ x: r.x, y: k.y + k.h, w: r.w, h: r.y + r.h - (k.y + k.h) });
  if (k.x > r.x) out.push({ x: r.x, y: Math.max(r.y, k.y), w: k.x - r.x, h: Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y) });
  if (k.x + k.w < r.x + r.w) out.push({ x: x1, y: Math.max(r.y, k.y), w: r.x + r.w - x1, h: Math.min(r.y + r.h, k.y + k.h) - Math.max(r.y, k.y) });
  return out.filter((p) => p.w > 0.5 && p.h > 0.5);
}

/**
 * Solid wall mass filling the strips between rooms, with the doorways (links) and the front entrance left open and cut
 * into pieces of at most `maxLen` along the long side (so painter's order stays right). `tall` marks the sides that
 * line up with a room's tall (north / west) wall, so the full-height wall runs on without a break across the strip.
 */
export function gapBlocks(layout: Pick<OfficeLayout, "rooms" | "links" | "entrance">, maxLen = 60): GapBlock[] {
  const openings: Rect[] = [...layout.links, layout.entrance];
  let pieces: Rect[] = gapRects(layout);
  for (const k of openings) pieces = pieces.flatMap((p) => subtractRect(p, k));
  const out: GapBlock[] = [];
  for (const p of pieces) {
    const alongX = p.w >= p.h;
    const len = alongX ? p.w : p.h;
    const n = Math.max(1, Math.ceil(len / maxLen));
    for (let i = 0; i < n; i++) {
      const a = (len * i) / n;
      const b = (len * (i + 1)) / n;
      const r: Rect = alongX ? { x: p.x + a, y: p.y, w: b - a, h: p.h } : { x: p.x, y: p.y + a, w: p.w, h: b - a };
      const tall: GapBlock["tall"] = [];
      // Only where the wall line truly runs on: a vertical strip with rooms on both sides whose north walls share this y,
      // or a horizontal strip with rooms above and below whose west walls share this x. Never at a chop boundary.
      if (i === 0 && !alongX) {
        const left = layout.rooms.some((room) => room.x + room.w === r.x && room.y === r.y);
        const right = layout.rooms.some((room) => room.x === r.x + r.w && room.y === r.y);
        if (left && right) tall.push("north");
      }
      if (i === 0 && alongX) {
        const above = layout.rooms.some((room) => room.y + room.h === r.y && room.x === r.x);
        const below = layout.rooms.some((room) => room.y === r.y + r.h && room.x === r.x);
        if (above && below) tall.push("west");
      }
      out.push({ ...r, tall });
    }
  }
  return out;
}
