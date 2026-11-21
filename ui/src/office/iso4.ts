// Pure isometric (2.5D) projection of the approved four-room floor plan. No DOM, no React.
// The flat layout (office/layout.ts) stays the single source of geometry: rooms, desks, doors, walking routes.
// Camera looks from the south-east corner, so back walls are the north (y = room.y) and west (x = room.x) ones.
import type { OfficeLayout, Point, Rect } from "./layout.js";

/** Plan units to screen pixels. */
export const ISO_K = 0.62;
/** Height of the north and west walls (plan units). */
export const WALL_H = 64;
export const WALL_SEGMENT = 60;
const COS30 = 0.8660254037844386;

/** Screen point of plan point (x, y) lifted z plan units above the floor. */
export function isoPoint(x: number, y: number, z = 0, k = ISO_K): Point {
  return { x: (x - y) * COS30 * k, y: (x + y) * 0.5 * k - z * k };
}

export interface IsoBounds {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** ViewBox of the whole scene (floor corners plus wall height), with padding. */
export function isoBounds(scene: { w: number; h: number }, pad = 24): IsoBounds {
  const left = isoPoint(0, scene.h).x;
  const right = isoPoint(scene.w, 0).x;
  const top = isoPoint(0, 0, WALL_H).y;
  const bottom = isoPoint(scene.w, scene.h).y;
  return { x: left - pad, y: top - pad, w: right - left + pad * 2, h: bottom - top + pad * 2 };
}

/** Painter's order key: larger = nearer to the camera, drawn later. */
export function isoDepth(x: number, y: number): number {
  return x + y;
}

export interface BoxFaces {
  top: Point[];
  /** Face looking south (+y). */
  south: Point[];
  /** Face looking east (+x). */
  east: Point[];
}

/** Screen polygons of the three visible faces of a box standing on the floor (z0 to z1). */
export function boxFaces(x: number, y: number, w: number, h: number, z0: number, z1: number): BoxFaces {
  const p = (px: number, py: number, pz: number) => isoPoint(px, py, pz);
  return {
    top: [p(x, y, z1), p(x + w, y, z1), p(x + w, y + h, z1), p(x, y + h, z1)],
    south: [p(x, y + h, z0), p(x + w, y + h, z0), p(x + w, y + h, z1), p(x, y + h, z1)],
    east: [p(x + w, y, z0), p(x + w, y + h, z0), p(x + w, y + h, z1), p(x + w, y, z1)],
  };
}

export const pointsAttr = (pts: Point[]): string => pts.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(" ");

/** Multiply an #rrggbb colour by `f` (0..1.2); anything else is returned unchanged. */
export function shade(hex: string, f: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!m) return hex;
  const n = parseInt(m[1]!, 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `#${[c((n >> 16) & 255), c((n >> 8) & 255), c(n & 255)].map((v) => v.toString(16).padStart(2, "0")).join("")}`;
}

// ---- walls with doorways ------------------------------------------------------------------------------------------

export const LOW_WALL_H = 10;

export type WallSide = "north" | "west" | "south" | "east";

export interface WallPiece {
  roomId: string;
  side: WallSide;
  /** Plan coordinates of the piece ends on the floor line. */
  a: Point;
  b: Point;
  h: number;
  depth: number;
}

export interface DoorFrame {
  roomId: string;
  side: WallSide;
  a: Point;
  b: Point;
}

interface Span {
  lo: number;
  hi: number;
}

/** Doorway intervals along each wall of each room: derived from the links and the building entrance. */
function doorSpans(layout: OfficeLayout): Map<string, Span[]> {
  const spans = new Map<string, Span[]>();
  const add = (roomId: string, side: WallSide, lo: number, hi: number) => {
    const key = `${roomId}:${side}`;
    const list = spans.get(key) ?? [];
    list.push({ lo, hi });
    spans.set(key, list);
  };
  const touch = (r: OfficeLayout["rooms"][number], k: Rect) => {
    if (k.x + k.w === r.x) add(r.id, "west", k.y, k.y + k.h);
    if (k.x === r.x + r.w) add(r.id, "east", k.y, k.y + k.h);
    if (k.y + k.h === r.y) add(r.id, "north", k.x, k.x + k.w);
    if (k.y === r.y + r.h) add(r.id, "south", k.x, k.x + k.w);
  };
  for (const l of layout.links) {
    for (const id of [l.a, l.b]) {
      const r = layout.rooms.find((x) => x.id === id);
      if (r) touch(r, l);
    }
  }
  // The front door is cut into the outer wall of the room it touches.
  const e = layout.entrance;
  for (const r of layout.rooms) {
    if (r.y + r.h === e.y && e.x >= r.x && e.x + e.w <= r.x + r.w) add(r.id, "south", e.x, e.x + e.w);
  }
  return spans;
}

function solidSpans(from: number, to: number, doors: Span[]): Span[] {
  const sorted = [...doors].sort((p, q) => p.lo - q.lo);
  const out: Span[] = [];
  let at = from;
  for (const d of sorted) {
    if (d.lo > at) out.push({ lo: at, hi: Math.min(d.lo, to) });
    at = Math.max(at, d.hi);
  }
  if (at < to) out.push({ lo: at, hi: to });
  return out.filter((s) => s.hi - s.lo > 0.5);
}

/**
 * Every wall of every room, with doorways cut out where a link or the front door touches it. The north and west walls
 * (far side from the camera) are tall; the south and east walls are low so the rooms stay visible. Door frames are
 * returned for the tall walls.
 */
export function wallPieces(layout: OfficeLayout): { pieces: WallPiece[]; frames: DoorFrame[] } {
  const doors = doorSpans(layout);
  const pieces: WallPiece[] = [];
  const frames: DoorFrame[] = [];
  const chop = (roomId: string, side: WallSide, s: Span, fixed: number, h: number, vertical: boolean) => {
    for (let t = s.lo; t < s.hi - 0.01; t += WALL_SEGMENT) {
      const t1 = Math.min(s.hi, t + WALL_SEGMENT);
      const a = vertical ? { x: fixed, y: t } : { x: t, y: fixed };
      const b = vertical ? { x: fixed, y: t1 } : { x: t1, y: fixed };
      pieces.push({ roomId, side, a, b, h, depth: isoDepth((a.x + b.x) / 2, (a.y + b.y) / 2) });
    }
  };
  for (const r of layout.rooms) {
    const sides: Array<{ side: WallSide; fixed: number; from: number; to: number; vertical: boolean; h: number }> = [
      { side: "north", fixed: r.y, from: r.x, to: r.x + r.w, vertical: false, h: WALL_H },
      { side: "west", fixed: r.x, from: r.y, to: r.y + r.h, vertical: true, h: WALL_H },
      { side: "south", fixed: r.y + r.h, from: r.x, to: r.x + r.w, vertical: false, h: LOW_WALL_H },
      { side: "east", fixed: r.x + r.w, from: r.y, to: r.y + r.h, vertical: true, h: LOW_WALL_H },
    ];
    for (const sd of sides) {
      const ds = doors.get(`${r.id}:${sd.side}`) ?? [];
      for (const s of solidSpans(sd.from, sd.to, ds)) chop(r.id, sd.side, s, sd.fixed, sd.h, sd.vertical);
      if (sd.h === WALL_H) {
        for (const d of ds) {
          const a = sd.vertical ? { x: sd.fixed, y: d.lo } : { x: d.lo, y: sd.fixed };
          const b = sd.vertical ? { x: sd.fixed, y: d.hi } : { x: d.hi, y: sd.fixed };
          frames.push({ roomId: r.id, side: sd.side, a, b });
        }
      }
    }
  }
  return { pieces, frames };
}
