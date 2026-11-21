import { describe, expect, it } from "vitest";
import { gapRects } from "../../ui/src/office/gaps.js";
import { NARROW, WIDE, type Rect } from "../../ui/src/office/layout.js";

const has = (r: Rect, x: number, y: number) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
const overlap = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;

describe("gapRects", () => {
  for (const [name, L] of [["WIDE", WIDE], ["NARROW", NARROW]] as const) {
    it(`${name}: no strip overlaps a room`, () => {
      const gaps = gapRects(L);
      expect(gaps.length).toBeGreaterThan(0);
      for (const g of gaps) for (const r of L.rooms) expect(overlap(g, r)).toBe(false);
    });

    it(`${name}: the midpoint of every adjacent room pair lies in a strip`, () => {
      const gaps = gapRects(L);
      let pairs = 0;
      for (const a of L.rooms) {
        for (const b of L.rooms) {
          if (a === b) continue;
          const ox0 = Math.max(a.x, b.x);
          const ox1 = Math.min(a.x + a.w, b.x + b.w);
          const oy0 = Math.max(a.y, b.y);
          const oy1 = Math.min(a.y + a.h, b.y + b.h);
          let mid: { x: number; y: number } | null = null;
          if (ox1 > ox0 && b.y >= a.y + a.h && b.y - (a.y + a.h) <= 40) mid = { x: (ox0 + ox1) / 2, y: (a.y + a.h + b.y) / 2 };
          else if (oy1 > oy0 && b.x >= a.x + a.w && b.x - (a.x + a.w) <= 40) mid = { x: (a.x + a.w + b.x) / 2, y: (oy0 + oy1) / 2 };
          if (!mid) continue;
          pairs++;
          expect(gaps.some((g) => has(g, mid!.x, mid!.y))).toBe(true);
        }
      }
      expect(pairs).toBeGreaterThan(0);
    });
  }

  it("WIDE covers the named strips", () => {
    const gaps = gapRects(WIDE);
    for (const [x, y] of [[300, 420], [1100, 420], [520, 600], [680, 1000], [100, 860], [900, 860]] as const) {
      expect(gaps.some((g) => has(g, x, y))).toBe(true);
    }
  });
});

import { gapBlocks } from "../../ui/src/office/gaps.js";

describe("gapBlocks", () => {
  for (const [name, L] of [["WIDE", WIDE], ["NARROW", NARROW]] as const) {
    it(`${name}: fills the strips, leaves every doorway and the entrance open, never overlaps a room`, () => {
      const blocks = gapBlocks(L);
      expect(blocks.length).toBeGreaterThan(0);
      for (const b of blocks) {
        for (const r of L.rooms) expect(overlap(b, r)).toBe(false);
        for (const k of [...L.links, L.entrance]) expect(overlap(b, k)).toBe(false);
        expect(Math.max(b.w, b.h)).toBeLessThanOrEqual(60.01);
      }
    });
  }
  it("WIDE: the strip east of the analyst room is solid wall and its north end lines up with the tall wall", () => {
    const col = gapBlocks(WIDE).filter((b) => b.x === 500 && b.w === 40);
    expect(col.length).toBeGreaterThan(0);
    expect(col.some((b) => b.y === 440 && b.tall.includes("north"))).toBe(true);
  });
});
