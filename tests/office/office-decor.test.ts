import { describe, expect, it } from "vitest";
import { COMMAND_ZONES, DESK_GROUPS, WIDE, routeFor, spotFor, type Point, type Rect } from "../../ui/src/office/layout";
import { DECOR_WIDE, decorFor } from "../../ui/src/office/decor";
import { NARROW } from "../../ui/src/office/layout";
import { RESIDENTS, deskPlace, leisurePlaces, routeBetween, stretchPlace } from "../../ui/src/office/staff";

const overlaps = (a: Rect, b: Rect, m = 0) => a.x < b.x + b.w + m && b.x < a.x + a.w + m && a.y < b.y + b.h + m && b.y < a.y + a.h + m;
const inside = (a: Rect, r: Rect) => a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h;
const segDist = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
};
const nearest = (box: Rect, a: Point, b: Point) => {
  let best = Infinity;
  for (let i = 0; i <= 8; i++) for (let j = 0; j <= 8; j++) best = Math.min(best, segDist({ x: box.x + (box.w * i) / 8, y: box.y + (box.h * j) / 8 }, a, b));
  return best;
};

describe("office decoration", () => {
  it("the phone plan has none", () => {
    expect(decorFor(NARROW).boxes).toHaveLength(0);
    expect(decorFor(WIDE)).toBe(DECOR_WIDE);
  });

  it("floor boxes stay in their room and clear of desks, chairs, standby strips, doorways and other furniture", () => {
    const L = WIDE;
    const others: Rect[] = [];
    for (const r of L.rooms) {
      const f = L.furniture[r.id];
      others.push(...f.shelves, ...f.sofas, ...f.tables, ...f.coolers, ...f.plants.map((p) => ({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 })), ...f.chairs.map((c) => ({ x: c.x - 12, y: c.y - 12, w: 24, h: 24 })));
    }
    others.push(...L.plants.map((p) => ({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 })));
    for (const b of DECOR_WIDE.boxes) {
      const room = L.rooms.find((r) => r.id === b.room)!;
      expect(inside(b, room), `${b.id} inside ${b.room}`).toBe(true);
      for (const d of L.desks) expect(overlaps(b, d, 4), `${b.id} vs desk ${d.group}#${d.seat}`).toBe(false);
      for (const d of L.desks) {
        const c = spotFor(d.group, d.seat, L);
        expect(overlaps(b, { x: c.x - 20, y: c.y - 20, w: 40, h: 40 }), `${b.id} vs chair ${d.group}#${d.seat}`).toBe(false);
      }
      for (const r of L.rooms) expect(overlaps(b, L.standby[r.id]), `${b.id} vs standby ${r.id}`).toBe(false);
      for (const k of L.links) expect(overlaps(b, k, 6), `${b.id} vs doorway`).toBe(false);
      for (const o of others) expect(overlaps(b, o, 2), `${b.id} vs furniture`).toBe(false);
      for (const o of DECOR_WIDE.boxes) if (o !== b) expect(overlaps(b, o, 2), `${b.id} vs ${o.id}`).toBe(false);
    }
  });

  it("no floor box is within 14 plan units of any walking route", () => {
    const L = WIDE;
    const routes: Point[][] = [];
    for (const g of DESK_GROUPS) for (let s = 0; s < 8; s++) routes.push(routeFor(g, s, L));
    const places = [...RESIDENTS.map((r) => deskPlace(r, L)), ...leisurePlaces(L), ...L.rooms.filter((r) => r.groups.length).map((r) => stretchPlace(r.id, L))];
    for (const a of places) for (const b of places) if (a.id !== b.id) routes.push(routeBetween(a, b, L));
    for (const b of DECOR_WIDE.boxes) {
      for (const r of routes) {
        for (let i = 1; i < r.length; i++) expect(nearest(b, r[i - 1]!, r[i]!), `${b.id} blocks a route`).toBeGreaterThanOrEqual(14);
      }
    }
  });

  it("wall items sit on a north wall inside their room's width and do not overlap each other", () => {
    for (const w of DECOR_WIDE.walls) {
      const room = WIDE.rooms.find((r) => r.id === w.room)!;
      expect(w.from).toBeGreaterThanOrEqual(room.x);
      expect(w.to).toBeLessThanOrEqual(room.x + room.w);
      expect(w.to).toBeGreaterThan(w.from);
      for (const o of DECOR_WIDE.walls) if (o !== w && o.room === w.room) expect(o.to <= w.from || o.from >= w.to, `${w.id}/${o.id}`).toBe(true);
    }
  });
});

describe("kitchen fittings", () => {
  const zone = { x: COMMAND_ZONES.kitchen.x, y: 0, w: COMMAND_ZONES.kitchen.w, h: 1000 };
  const fit = DECOR_WIDE.boxes.filter((b) => b.id.startsWith("kitchen-"));
  it("has counter, fridge, sink and hob inside the kitchen zone without overlapping", () => {
    expect(fit.map((b) => b.id).sort()).toEqual(["kitchen-counter", "kitchen-fridge", "kitchen-hob", "kitchen-sink"]);
    for (const b of fit) {
      expect(inside(b, zone), b.id).toBe(true);
      for (const o of fit) if (o !== b) expect(overlaps(b, o), `${b.id}/${o.id}`).toBe(false);
    }
  });
  it("does not block the kitchen access", () => {
    const k = WIDE.leisure.find((l) => l.id === "kitchen")!;
    for (const b of fit) for (let i = 1; i < k.access.length; i++) expect(nearest(b, k.access[i - 1]!, k.access[i]!), b.id).toBeGreaterThanOrEqual(14);
  });
});

describe("lounge details", () => {
  const zone = { x: COMMAND_ZONES.rest.x, y: 0, w: COMMAND_ZONES.rest.w, h: 400 };
  const rest = DECOR_WIDE.boxes.filter((b) => b.id.startsWith("rest-"));
  it("has books, coffee, armchair and lamp, all in the rest zone (the rest bed replaced the media rack)", () => {
    expect(rest.map((b) => b.id).sort()).toEqual(["rest-armchair", "rest-books", "rest-coffee", "rest-lamp"]);
    expect(rest.filter((b) => b.kind === "rack")).toHaveLength(0);
    for (const b of rest) {
      expect(inside(b, zone), b.id).toBe(true);
      for (const o of rest) if (o !== b) expect(overlaps(b, o), `${b.id}/${o.id}`).toBe(false);
      for (const s of WIDE.furniture.command.sofas) expect(overlaps(b, s), `${b.id} vs sofa`).toBe(false);
      expect(overlaps(b, WIDE.furniture.command.tables[1]!), `${b.id} vs low table`).toBe(false);
      expect(b.y + b.h, `${b.id} near gate`).toBeLessThanOrEqual(330);
    }
    expect(WIDE.furniture.command.sofas.length).toBeGreaterThanOrEqual(1);
  });
  it("does not block the lounge access", () => {
    const l = WIDE.leisure.find((x) => x.id === "lounge")!;
    for (const b of rest) for (let i = 1; i < l.access.length; i++) expect(nearest(b, l.access[i - 1]!, l.access[i]!), b.id).toBeGreaterThanOrEqual(14);
  });
});

describe("command room zones", () => {
  it("has one desk in the middle, kitchen on the left and rest area on the right", () => {
    const desks = WIDE.desks.filter((d) => d.group === "coordinator");
    expect(desks).toHaveLength(1);
    expect(desks[0]!.x).toBeGreaterThanOrEqual(COMMAND_ZONES.work.x);
    expect(desks[0]!.x + desks[0]!.w).toBeLessThanOrEqual(COMMAND_ZONES.work.x + COMMAND_ZONES.work.w);
    for (const id of ["kitchen-counter", "kitchen-fridge"]) {
      const b = DECOR_WIDE.boxes.find((x) => x.id === id)!;
      expect(b.x + b.w).toBeLessThanOrEqual(COMMAND_ZONES.kitchen.x + COMMAND_ZONES.kitchen.w);
    }
    const f = WIDE.furniture.command;
    expect(f.tables[0]!.x + f.tables[0]!.w).toBeLessThanOrEqual(COMMAND_ZONES.kitchen.x + COMMAND_ZONES.kitchen.w);
    const rest = [...f.sofas, f.tables[1]!, ...(f.beds ?? [])];
    for (const r of rest) expect(r.x).toBeGreaterThanOrEqual(COMMAND_ZONES.rest.x);
  });
});
