import { describe, expect, it } from "vitest";
import { boxFaces, isoBounds, isoPoint, shade, wallPieces, WALL_H } from "../../ui/src/office/iso4";
import { WIDE } from "../../ui/src/office/layout";

describe("iso4 projection", () => {
  it("moves right/down for +x and left/down for +y; lifts with z", () => {
    const o = isoPoint(0, 0);
    expect(isoPoint(100, 0).x).toBeGreaterThan(o.x);
    expect(isoPoint(0, 100).x).toBeLessThan(o.x);
    expect(isoPoint(100, 0).y).toBeGreaterThan(o.y);
    expect(isoPoint(0, 0, 50).y).toBeLessThan(o.y);
  });
  it("bounds contain every floor corner and the wall tops", () => {
    const b = isoBounds(WIDE.scene, 0);
    for (const [x, y, z] of [[0, 0, WALL_H], [WIDE.scene.w, 0, 0], [0, WIDE.scene.h, 0], [WIDE.scene.w, WIDE.scene.h, 0]] as const) {
      const p = isoPoint(x, y, z);
      expect(p.x).toBeGreaterThanOrEqual(b.x - 0.01);
      expect(p.x).toBeLessThanOrEqual(b.x + b.w + 0.01);
      expect(p.y).toBeGreaterThanOrEqual(b.y - 0.01);
      expect(p.y).toBeLessThanOrEqual(b.y + b.h + 0.01);
    }
  });
  it("boxes have three faces and shade keeps format", () => {
    const f = boxFaces(0, 0, 10, 10, 0, 5);
    expect([f.top.length, f.south.length, f.east.length]).toEqual([4, 4, 4]);
    expect(shade("#c5cfe2", 0.5)).toMatch(/^#[0-9a-f]{6}$/);
    expect(shade("var(--x)", 0.5)).toBe("var(--x)");
  });
  it("cuts walls into short pieces and leaves a doorway for every link and the front door", () => {
    const { pieces, frames } = wallPieces(WIDE);
    for (const s of pieces) expect(Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)).toBeLessThanOrEqual(60.001);
    // no wall piece covers a doorway centre
    const covers = (p: { x: number; y: number }) => pieces.some((w) => {
      const minx = Math.min(w.a.x, w.b.x) - 0.5, maxx = Math.max(w.a.x, w.b.x) + 0.5, miny = Math.min(w.a.y, w.b.y) - 0.5, maxy = Math.max(w.a.y, w.b.y) + 0.5;
      return p.x >= minx && p.x <= maxx && p.y >= miny && p.y <= maxy;
    });
    for (const k of WIDE.links) {
      for (const id of [k.a, k.b]) {
        const r = WIDE.rooms.find((x) => x.id === id)!;
        const c = { x: k.x + k.w / 2, y: k.y + k.h / 2 };
        // doorway centre projected onto the room's wall line it touches
        const onWall = k.x + k.w === r.x ? { x: r.x, y: c.y } : k.x === r.x + r.w ? { x: r.x + r.w, y: c.y } : k.y + k.h === r.y ? { x: c.x, y: r.y } : { x: c.x, y: r.y + r.h };
        expect(covers(onWall), `${k.a}-${k.b} doorway in ${id} wall is open`).toBe(false);
      }
    }
    expect(covers({ x: WIDE.entrance.x + WIDE.entrance.w / 2, y: WIDE.entrance.y })).toBe(false);
    // two door frames per room side that has a doorway in a tall wall
    expect(frames.length).toBeGreaterThanOrEqual(WIDE.links.length - 1);
  });
});
