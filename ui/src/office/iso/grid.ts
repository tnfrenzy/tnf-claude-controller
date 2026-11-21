// Pure grid module for the isometric office (ported from docs/design/single-screen.html 286-320).
// Room is 12 x 9 m, cells are 0.5 m. No DOM, no randomness.

export interface Rect { u: number; v: number; w: number; d: number }
export interface Spot { u: number; v: number; face: 1 | -1; back?: boolean }
export interface Desk extends Rect { seat: Spot }
export interface Pt { u: number; v: number }

export const ROOM = { W: 12, D: 9, H: 150 } as const;
export const RES = 0.5;
export const COLS = ROOM.W / RES;
export const ROWS = ROOM.D / RES;
export const MAX_DESKS = 6;

export interface Furn {
  coordDesk: Rect; coordSeat: Spot; coordSide: Spot;
  desk: (i: number) => Desk;
  cooler: Rect; coolerSpot: Spot;
  sofa: Rect; sofaSit: Spot; sofaLie: Spot;
  table: Rect; counter: Rect; coffeeSpot: Spot; fridge: Rect;
  plants: Rect[];
  lanes: number[];
}

// Seats are in FRONT of the desk (larger v): the person sits with their back to the viewer.
export const FURN: Furn = {
  coordDesk: { u: 1.0, v: 1.5, w: 2.4, d: 0.9 },
  coordSeat: { u: 2.2, v: 3.15, face: 1, back: true },
  coordSide: { u: 4.0, v: 3.15, face: -1 },
  desk: (i) => {
    const col = i % 3;
    const row = i < 3 ? 0 : 1;
    const u = 1.4 + col * 2.4;
    const v = row ? 6.6 : 4.2;
    return { u, v, w: 1.6, d: 0.8, seat: { u: u + 0.8, v: v + 0.8 + 0.75, face: 1, back: true } };
  },
  cooler: { u: 0.3, v: 6.0, w: 0.5, d: 0.5 },
  coolerSpot: { u: 1.2, v: 6.3, face: -1 },
  sofa: { u: 9.0, v: 6.1, w: 2.4, d: 0.9 },
  sofaSit: { u: 9.7, v: 7.12, face: -1 },
  sofaLie: { u: 9.25, v: 6.6, face: 1 },
  table: { u: 9.3, v: 7.6, w: 1.6, d: 0.7 },
  counter: { u: 8.2, v: 0.2, w: 3.2, d: 0.9 },
  coffeeSpot: { u: 9.7, v: 1.6, face: 1, back: true },
  fridge: { u: 11.4, v: 0.2, w: 0.6, d: 0.9 },
  plants: [
    { u: 0.3, v: 0.3, w: 0.6, d: 0.6 },
    { u: 11.1, v: 5.0, w: 0.6, d: 0.6 },
    { u: 11.1, v: 8.2, w: 0.6, d: 0.6 },
  ],
  lanes: [3.7, 6.3, 8.6],
};

export interface Grid { blocked: Set<string> }

const key = (cu: number, cv: number): string => `${cu},${cv}`;
export const cellKey = (u: number, v: number): string => key(Math.floor(u / RES), Math.floor(v / RES));

/** Blocked cells for the fixed furniture plus one desk (and its seat) per role. */
export function buildGrid(deskCount: number): Grid {
  const blocked = new Set<string>();
  const block = (r: Rect): void => {
    for (let cu = Math.floor(r.u / RES); cu < Math.ceil((r.u + r.w) / RES); cu++) {
      for (let cv = Math.floor(r.v / RES); cv < Math.ceil((r.v + r.d) / RES); cv++) blocked.add(key(cu, cv));
    }
  };
  [FURN.coordDesk, FURN.cooler, FURN.sofa, FURN.table, FURN.counter, FURN.fridge, ...FURN.plants].forEach(block);
  const n = Math.max(0, Math.min(MAX_DESKS, Math.floor(deskCount)));
  for (let i = 0; i < n; i++) {
    const d = FURN.desk(i);
    block(d);
    blocked.add(cellKey(d.seat.u, d.seat.v));
  }
  blocked.add(cellKey(FURN.coordSeat.u, FURN.coordSeat.v));
  return { blocked };
}

export const isFree = (g: Grid, u: number, v: number): boolean =>
  u >= 0 && v >= 0 && u < ROOM.W && v < ROOM.D && !g.blocked.has(cellKey(u, v));

export const cellOf = (p: Pt): [number, number] => [
  Math.max(0, Math.min(COLS - 1, Math.floor(p.u / RES))),
  Math.max(0, Math.min(ROWS - 1, Math.floor(p.v / RES))),
];

export const centerOf = (cu: number, cv: number): Pt => ({ u: (cu + 0.5) * RES, v: (cv + 0.5) * RES });

const DIRS: Array<[number, number]> = [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]];

/**
 * BFS over 8 directions. Rules kept from the mock:
 * - The GOAL cell may be entered even when blocked (seats and spots sit on blocked cells);
 *   every other blocked cell stays blocked.
 * - Diagonal steps are forbidden when either orthogonal neighbour is blocked
 *   (no corner cutting: people do not walk through the corner of a desk).
 * Returns waypoints ending exactly at `to`, or null when unreachable.
 */
export function findPath(g: Grid, from: Pt, to: Pt): Pt[] | null {
  const [su, sv] = cellOf(from);
  const [tu, tv] = cellOf(to);
  const free = (u: number, v: number): boolean => u >= 0 && v >= 0 && u < COLS && v < ROWS && !g.blocked.has(key(u, v));
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
      if (goal && (nu < 0 || nv < 0 || nu >= COLS || nv >= ROWS)) continue;
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
    const [u, v] = c.split(',').map(Number);
    return centerOf(u!, v!);
  });
  pts.push({ u: to.u, v: to.v });
  return pts;
}
