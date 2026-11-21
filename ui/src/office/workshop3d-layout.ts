// Pure geometry of the 3D workshop room (no React, no DOM): room size, furniture footprints, the spots where each of
// the nine roles works, sits or rests, and the blocked-cell grid. The room has the gym's size (16 x 13.5 m, 0.5 m
// cells), so the gym's BFS (findGymPath) is reused as is: only the blocked set differs.
import { findGymPath, GYM_COLS, GYM_RES, GYM_ROOM, gymIsFree, type GymGrid, type Pt, type Rect, type Spot } from "./gym-layout";
import type { W3DStationId } from "./workshop3d";

export type { Pt, Rect, Spot } from "./gym-layout";
export const W3D_ROOM = GYM_ROOM;
export const W3D_RES = GYM_RES;
export const W3D_COLS = GYM_COLS;
export type W3DGrid = GymGrid;
export const w3dIsFree = (g: W3DGrid, u: number, v: number): boolean => gymIsFree(g, u, v);
export const findW3DPath = (g: W3DGrid, from: Pt, to: Pt): Pt[] | null => findGymPath(g, from, to);

export type W3DPose = "stand" | "sit" | "sofa";

/** Where a role stands (or sits) to do its job. `approach` is a free cell in front of blocked furniture. */
export interface W3DStation { spot: Spot; approach?: Pt; pose: W3DPose }

export const W3D_STATIONS: Record<W3DStationId, W3DStation> = {
  reception: { spot: { u: 1.6, v: 11.4, face: 1 }, pose: "stand" },
  moodboard: { spot: { u: 2.8, v: 1.1, face: 1, back: true }, pose: "stand" },
  plan: { spot: { u: 6.0, v: 5.2, face: 1, back: true }, pose: "stand" },
  drafting: { spot: { u: 1.9, v: 4.9, face: 1, back: true }, approach: { u: 1.9, v: 5.7 }, pose: "sit" },
  shelf: { spot: { u: 12.2, v: 1.9, face: 1, back: true }, pose: "stand" },
  studio: { spot: { u: 11.9, v: 9.6, face: 1 }, pose: "stand" },
  review: { spot: { u: 5.9, v: 11.25, face: 1 }, pose: "stand" },
  printer: { spot: { u: 14.9, v: 2.2, face: -1, back: true }, pose: "stand" },
  presenter: { spot: { u: 7.2, v: 7.6, face: 1 }, pose: "stand" },
};

/** Extra places people walk to. */
export const COFFEE_SPOT: Spot = { u: 5.75, v: 1.4, face: 1, back: true };
export const ISSUE_BOARD_SPOT: Spot = { u: 1.0, v: 7.4, face: -1, back: true };
export const PODIUM_CENTER: Pt = { u: 9.1, v: 6.7 };
/** Stand beside the podium to place or inspect the model (front, i.e. towards the viewer, is +v). */
export const PODIUM_SPOTS: Spot[] = [
  { u: 9.1, v: 8.4, face: 1, back: true },
  { u: 7.2, v: 6.7, face: 1 },
  { u: 11.0, v: 6.7, face: -1 },
  { u: 9.1, v: 4.8, face: -1 },
];
export const REST_SPOTS: Array<{ spot: Spot; approach: Pt }> = [
  { spot: { u: 8.3, v: 12.45, face: -1 }, approach: { u: 8.3, v: 13.25 } },
  { spot: { u: 9.7, v: 12.45, face: 1 }, approach: { u: 9.7, v: 13.25 } },
];

/** Where nobody works: a role rests near its own station. */
export const W3D_HOMES: Record<string, Spot> = {
  "tiep-nhan-3d": W3D_STATIONS.reception.spot,
  "art-director": W3D_STATIONS.moodboard.spot,
  "detail-planner": W3D_STATIONS.plan.spot,
  "cad-modeler": W3D_STATIONS.drafting.spot,
  "material-artist": W3D_STATIONS.shelf.spot,
  "render-director": W3D_STATIONS.studio.spot,
  "visual-reviewer": W3D_STATIONS.review.spot,
  "ar-optimizer": W3D_STATIONS.printer.spot,
  "render-presenter": W3D_STATIONS.presenter.spot,
};

/** Fixed furniture footprints that block walking. */
export const W3D_RECTS = {
  counter: { u: 2.4, v: 10.2, w: 0.9, d: 2.6 },
  guestChair: { u: 4.1, v: 11.0, w: 0.6, d: 0.6 },
  draftDesk: { u: 0.6, v: 3.2, w: 2.6, d: 1.0 },
  draftRack: { u: 3.5, v: 3.2, w: 0.5, d: 1.6 },
  planTable: { u: 5.0, v: 3.6, w: 2.0, d: 1.2 },
  coffee: { u: 5.2, v: 0.3, w: 1.0, d: 0.7 },
  shelf: { u: 10.6, v: 0.3, w: 3.4, d: 0.8 },
  printer: { u: 14.3, v: 0.3, w: 1.2, d: 1.2 },
  podium: { u: 8.0, v: 5.6, w: 2.2, d: 2.2 },
  turntable: { u: 13.9, v: 9.1, w: 0.8, d: 0.8 },
  tripod: { u: 12.7, v: 9.3, w: 0.5, d: 0.5 },
  softboxA: { u: 14.9, v: 7.6, w: 0.5, d: 0.5 },
  softboxB: { u: 14.9, v: 10.8, w: 0.5, d: 0.5 },
  backdrop: { u: 15.7, v: 7.6, w: 0.2, d: 3.7 },
  reviewDesk: { u: 5.0, v: 11.8, w: 1.8, d: 0.9 },
  sofa: { u: 7.6, v: 12.0, w: 2.8, d: 0.7 },
  plantA: { u: 11.0, v: 12.4, w: 0.6, d: 0.6 },
  plantB: { u: 15.0, v: 12.5, w: 0.6, d: 0.6 },
  plantC: { u: 0.4, v: 12.9, w: 0.5, d: 0.5 },
} as const satisfies Record<string, Rect>;

/** Studio floor patch (white sweep), not blocking. */
export const STUDIO_PATCH: Rect = { u: 11.6, v: 7.4, w: 4.1, d: 4.2 };

export function buildW3DGrid(): W3DGrid {
  const blocked = new Set<string>();
  for (const r of Object.values(W3D_RECTS) as Rect[]) {
    for (let cu = Math.floor(r.u / W3D_RES); cu < Math.ceil((r.u + r.w) / W3D_RES); cu++) {
      for (let cv = Math.floor(r.v / W3D_RES); cv < Math.ceil((r.v + r.d) / W3D_RES); cv++) blocked.add(`${cu},${cv}`);
    }
  }
  return { blocked };
}

/** Candidate offsets around a point for a watcher to stand on (never straight in front of the anchor). */
export const WATCH_OFFSETS: Array<[number, number]> = [[-1.9, 1.9], [1.9, -1.9], [-2.6, 0.4], [2.6, -0.4], [-0.6, 2.6], [0.6, -2.6], [-3, 2.4], [3, -2.4]];
