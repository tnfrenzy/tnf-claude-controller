import { describe, expect, it } from "vitest";
import { W3D_ROLE_IDS } from "../../ui/src/office/workshop3d.js";
import { buildW3DGrid, findW3DPath, PODIUM_SPOTS, REST_SPOTS, W3D_HOMES, W3D_RECTS, W3D_ROOM, W3D_STATIONS, w3dIsFree, COFFEE_SPOT, ISSUE_BOARD_SPOT } from "../../ui/src/office/workshop3d-layout.js";

const overlap = (a: { u: number; v: number; w: number; d: number }, b: { u: number; v: number; w: number; d: number }) =>
  a.u < b.u + b.w && b.u < a.u + a.w && a.v < b.v + b.d && b.v < a.v + a.d;

describe("workshop3d layout", () => {
  it("room is 16 x 13.5 m", () => {
    expect(W3D_ROOM.W).toBe(16);
    expect(W3D_ROOM.D).toBe(13.5);
  });
  it("furniture stays inside the room and never overlaps", () => {
    const e = Object.entries(W3D_RECTS);
    for (const [k, r] of e) {
      expect(r.u, k).toBeGreaterThanOrEqual(0);
      expect(r.v, k).toBeGreaterThanOrEqual(0);
      expect(r.u + r.w, k).toBeLessThanOrEqual(W3D_ROOM.W);
      expect(r.v + r.d, k).toBeLessThanOrEqual(W3D_ROOM.D);
    }
    for (let i = 0; i < e.length; i++) for (let j = i + 1; j < e.length; j++) expect(overlap(e[i]![1], e[j]![1]), `${e[i]![0]} x ${e[j]![0]}`).toBe(false);
  });
  it("every spot is on a free cell and reachable from every other spot", () => {
    const g = buildW3DGrid();
    const spots = [
      ...Object.values(W3D_STATIONS).map((s) => s.spot),
      ...Object.values(W3D_STATIONS).flatMap((s) => (s.approach ? [s.approach] : [])),
      ...PODIUM_SPOTS, ...REST_SPOTS.map((r) => r.approach), COFFEE_SPOT, ISSUE_BOARD_SPOT,
    ];
    for (const s of spots) expect(w3dIsFree(g, s.u, s.v), `${s.u},${s.v}`).toBe(true);
    for (const a of spots) for (const b of spots) expect(findW3DPath(g, a, b), `${a.u},${a.v} -> ${b.u},${b.v}`).not.toBeNull();
  });
  it("rest seats stand on the sofa strip and have a free approach", () => {
    const g = buildW3DGrid();
    for (const r of REST_SPOTS) {
      expect(r.spot.u).toBeGreaterThanOrEqual(W3D_RECTS.sofa.u);
      expect(r.spot.u).toBeLessThanOrEqual(W3D_RECTS.sofa.u + W3D_RECTS.sofa.w);
      expect(w3dIsFree(g, r.approach.u, r.approach.v)).toBe(true);
    }
  });
  it("every role has a home and a station", () => {
    for (const r of W3D_ROLE_IDS) expect(W3D_HOMES[r], r).toBeDefined();
  });
});
