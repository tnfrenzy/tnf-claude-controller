// Pure geometry of the AI-training gym (no React, no DOM): room size, equipment footprints, the spots where the
// skill and the trainers stand, sit or lie, and the blocked-cell grid with a BFS path finder (same rules as
// office/iso/grid.ts: 8 directions, no corner cutting, the goal cell may be blocked). The room is twice the area
// of the one-room office (16 x 13.5 m = 216 m2 against 12 x 9 = 108 m2), cells are 0.5 m.

export interface Rect { u: number; v: number; w: number; d: number }
export interface Pt { u: number; v: number }
export interface Spot extends Pt { face: 1 | -1; back?: boolean }

export const GYM_ROOM = { W: 16, D: 13.5, H: 150 } as const;
export const GYM_RES = 0.5;
export const GYM_COLS = GYM_ROOM.W / GYM_RES;
export const GYM_ROWS = GYM_ROOM.D / GYM_RES;

export type GymExercise = "mat" | "treadmill" | "bench" | "bag" | "bike" | "cable" | "pullup" | "dumbbell";
export type GymPose = "stand" | "sit" | "sofa" | "lie";
export type EquipId = "treadmillA" | "treadmillB" | "cable" | "bench" | "pullup" | "bag" | "bikeA" | "bikeB" | "dumbbells" | "matA" | "matB";

/** A place where the skill works out: where it stands, the way it gets there and the pose/act it takes. */
export interface Station {
  key: string;
  equip: EquipId;
  exercise: GymExercise;
  spot: Spot;
  /** Free cell in front of the machine; the last step to `spot` is a straight move over blocked cells. */
  approach?: Pt;
  pose: GymPose;
  act: string;
}

export const STATIONS: Record<GymExercise, Station[]> = {
  treadmill: [
    { key: "treadmillA", equip: "treadmillA", exercise: "treadmill", spot: { u: 5.55, v: 1.6, face: 1, back: true }, approach: { u: 5.55, v: 3.1 }, pose: "stand", act: "run" },
    { key: "treadmillB", equip: "treadmillB", exercise: "treadmill", spot: { u: 7.15, v: 1.6, face: 1, back: true }, approach: { u: 7.15, v: 3.1 }, pose: "stand", act: "run" },
  ],
  bike: [
    { key: "bikeA", equip: "bikeA", exercise: "bike", spot: { u: 12.1, v: 9.55, face: 1 }, approach: { u: 12.3, v: 10.25 }, pose: "sit", act: "pedal" },
    { key: "bikeB", equip: "bikeB", exercise: "bike", spot: { u: 12.1, v: 11.25, face: 1 }, approach: { u: 12.3, v: 12.05 }, pose: "sit", act: "pedal" },
  ],
  cable: [{ key: "cable", equip: "cable", exercise: "cable", spot: { u: 11.6, v: 2.0, face: 1, back: true }, pose: "stand", act: "pull" }],
  dumbbell: [{ key: "dumbbells", equip: "dumbbells", exercise: "dumbbell", spot: { u: 2.5, v: 2.1, face: 1 }, pose: "stand", act: "curl" }],
  bench: [{ key: "bench", equip: "bench", exercise: "bench", spot: { u: 3.35, v: 6.75, face: 1 }, approach: { u: 2.3, v: 6.75 }, pose: "lie", act: "benchpress" }],
  pullup: [{ key: "pullup", equip: "pullup", exercise: "pullup", spot: { u: 9.1, v: 5.0, face: 1 }, approach: { u: 9.1, v: 5.9 }, pose: "stand", act: "hang" }],
  bag: [{ key: "bag", equip: "bag", exercise: "bag", spot: { u: 11.4, v: 6.55, face: 1 }, pose: "stand", act: "punch" }],
  mat: [
    { key: "matA", equip: "matA", exercise: "mat", spot: { u: 3.0, v: 9.8, face: 1 }, pose: "stand", act: "stretch" },
    { key: "matB", equip: "matB", exercise: "mat", spot: { u: 2.2, v: 11.0, face: 1 }, pose: "lie", act: "situp" },
  ],
};

/** Station of an exercise for a round (alternates between machines of the same kind). Pure. */
export function stationFor(exercise: GymExercise, round: number): Station {
  const list = STATIONS[exercise];
  const i = Math.abs(Math.floor(Number.isFinite(round) ? round : 0)) % list.length;
  return list[i] ?? list[0]!;
}

/** Fixed furniture footprints that block walking (mats and the rest of the floor decor do not). */
export const EQUIP_RECTS = {
  dumbbells: { u: 0.6, v: 0.3, w: 3.8, d: 0.9 },
  treadmillA: { u: 5.0, v: 0.3, w: 1.1, d: 2.4 },
  treadmillB: { u: 6.6, v: 0.3, w: 1.1, d: 2.4 },
  cable: { u: 9.2, v: 0.3, w: 2.6, d: 0.8 },
  cooler: { u: 12.3, v: 0.3, w: 0.5, d: 0.5 },
  towels: { u: 13.0, v: 0.3, w: 0.8, d: 0.4 },
  lockers: { u: 14.0, v: 0.2, w: 1.8, d: 0.8 },
  plateRack: { u: 0.3, v: 8.4, w: 0.8, d: 1.6 },
  plateTree: { u: 1.4, v: 5.2, w: 0.6, d: 0.6 },
  bench: { u: 3.0, v: 6.4, w: 2.2, d: 0.7 },
  postL: { u: 4.4, v: 5.7, w: 0.3, d: 0.3 },
  postR: { u: 4.4, v: 7.5, w: 0.3, d: 0.3 },
  pullupL: { u: 8.0, v: 4.6, w: 0.25, d: 0.25 },
  pullupR: { u: 10.2, v: 4.6, w: 0.25, d: 0.25 },
  bagPost: { u: 13.6, v: 6.2, w: 0.25, d: 0.25 },
  bagBody: { u: 12.4, v: 6.1, w: 0.5, d: 0.5 },
  bikeA: { u: 11.6, v: 9.2, w: 1.7, d: 0.7 },
  bikeB: { u: 11.6, v: 10.9, w: 1.7, d: 0.7 },
  ballA: { u: 5.3, v: 9.9, w: 0.7, d: 0.7 },
  ballB: { u: 5.6, v: 11.2, w: 0.7, d: 0.7 },
  restBench: { u: 7.0, v: 12.0, w: 2.8, d: 0.7 },
} as const satisfies Record<string, Rect>;

/** Floor mats (not blocking). */
export const MAT_RECTS = { matA: { u: 2.0, v: 9.4, w: 2.0, d: 0.8 }, matB: { u: 2.0, v: 10.6, w: 2.0, d: 0.8 } } as const satisfies Record<string, Rect>;

export const COOLER_SPOT: Spot = { u: 12.55, v: 1.3, face: 1, back: true };
export const TOWEL_SPOT: Spot = { u: 13.4, v: 1.3, face: -1 };
export const BOARD_SPOT: Spot = { u: 1.4, v: 3.2, face: 1, back: true };
export const REST_SPOTS: Array<{ spot: Spot; approach: Pt }> = [
  { spot: { u: 7.9, v: 12.82, face: -1 }, approach: { u: 7.9, v: 13.25 } },
  { spot: { u: 9.0, v: 12.82, face: 1 }, approach: { u: 9.0, v: 13.25 } },
];

/** Where each trainer stands when nothing needs coaching. */
export const TRAINER_HOMES: Record<string, Spot> = {
  "phong-van": { u: 8.5, v: 8.6, face: -1 },
  "phan-tich-mau": { u: 6.8, v: 4.4, face: 1 },
  "soan-skill": { u: 3.4, v: 3.6, face: 1 },
  "chay-thu": { u: 9.8, v: 7.0, face: -1 },
  "cham-diem": { u: 14.6, v: 4.4, face: -1 },
  "phan-bien": { u: 5.8, v: 8.8, face: 1 },
};

/** Candidate offsets around an anchor for a coach to stand on (the order is rotated per trainer). */
/** Beside the anchor on screen first (along u-v), then further out; never straight in front of it. */
export const COACH_OFFSETS: Array<[number, number]> = [[-1.5, 1.5], [1.5, -1.5], [-2.4, 0.4], [2.4, -0.4], [-0.6, 2.4], [0.6, -2.4], [-2.8, 2.2], [2.8, -2.2]];

const rectsList = (): Rect[] => Object.values(EQUIP_RECTS);

export interface GymGrid { blocked: Set<string> }
const key = (cu: number, cv: number): string => `${cu},${cv}`;
export const gymCellKey = (u: number, v: number): string => key(Math.floor(u / GYM_RES), Math.floor(v / GYM_RES));

export function buildGymGrid(): GymGrid {
  const blocked = new Set<string>();
  for (const r of rectsList()) {
    for (let cu = Math.floor(r.u / GYM_RES); cu < Math.ceil((r.u + r.w) / GYM_RES); cu++) {
      for (let cv = Math.floor(r.v / GYM_RES); cv < Math.ceil((r.v + r.d) / GYM_RES); cv++) blocked.add(key(cu, cv));
    }
  }
  return { blocked };
}

export const gymIsFree = (g: GymGrid, u: number, v: number): boolean =>
  u >= 0 && v >= 0 && u < GYM_ROOM.W && v < GYM_ROOM.D && !g.blocked.has(gymCellKey(u, v));

const cellOf = (p: Pt): [number, number] => [
  Math.max(0, Math.min(GYM_COLS - 1, Math.floor(p.u / GYM_RES))),
  Math.max(0, Math.min(GYM_ROWS - 1, Math.floor(p.v / GYM_RES))),
];
const centerOf = (cu: number, cv: number): Pt => ({ u: (cu + 0.5) * GYM_RES, v: (cv + 0.5) * GYM_RES });
const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/** BFS path (waypoints ending exactly at `to`) or null when unreachable. The goal cell may be blocked. */
export function findGymPath(g: GymGrid, from: Pt, to: Pt): Pt[] | null {
  const [su, sv] = cellOf(from);
  const [tu, tv] = cellOf(to);
  const free = (u: number, v: number): boolean => u >= 0 && v >= 0 && u < GYM_COLS && v < GYM_ROWS && !g.blocked.has(key(u, v));
  if (su === tu && sv === tv) return [{ u: to.u, v: to.v }];
  const prev = new Map<string, string | null>([[key(su, sv), null]]);
  const queue: Array<[number, number]> = [[su, sv]];
  let head = 0;
  let found = false;
  while (head < queue.length) {
    const [u, v] = queue[head++]!;
    if (u === tu && v === tv) { found = true; break; }
    for (const [du, dv] of DIRS) {
      const nu = u + du;
      const nv = v + dv;
      const k = key(nu, nv);
      if (prev.has(k)) continue;
      const goal = nu === tu && nv === tv;
      if (!goal && !free(nu, nv)) continue;
      if (goal && (nu < 0 || nv < 0 || nu >= GYM_COLS || nv >= GYM_ROWS)) continue;
      if (du && dv && (!free(u + du, v) || !free(u, v + dv))) continue;
      prev.set(k, key(u, v));
      queue.push([nu, nv]);
    }
  }
  if (!found) return null;
  const cells: string[] = [];
  for (let k: string | null | undefined = key(tu, tv); k; k = prev.get(k)) cells.push(k);
  cells.reverse();
  const pts = cells.slice(1, -1).map((c) => {
    const [u, v] = c.split(",").map(Number);
    return centerOf(u!, v!);
  });
  pts.push({ u: to.u, v: to.v });
  return pts;
}
