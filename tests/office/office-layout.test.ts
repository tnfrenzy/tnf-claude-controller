import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { COMMAND_ZONES, DESK_GROUPS, NARROW, WIDE, buildSteps, chainBetween, deskChairs, groupForRole, roomOf, routeFor, segmentMs, spotFor, type DeskGroup, type OfficeLayout } from "../../ui/src/office/layout.js";

const layouts: [string, OfficeLayout][] = [
  ["WIDE", WIDE],
  ["NARROW", NARROW],
];

function roleKeys(file: string): string[] {
  const path = fileURLToPath(new URL(`../../config/${file}`, import.meta.url));
  return Object.keys(JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>);
}

const expectedGroups: Record<string, DeskGroup> = {
  coordinator: "coordinator",
  analyst: "analyst",
  planner: "analyst",
  critic: "critic",
  implementer: "implementer",
  qa: "qa",
  debug: "debug",
  searcher: "analyst",
  analyzer: "analyst",
  synthesizer: "implementer",
};

describe("groupForRole", () => {
  it("maps every role of the coding and research sets as expected", () => {
    const keys = [...roleKeys("roles-coding.json"), ...roleKeys("roles-research.json")];
    expect(keys.length).toBeGreaterThan(0);
    for (const key of keys) {
      expect(expectedGroups[key], `role ${key} missing from the expected table`).toBeDefined();
      expect(groupForRole(key), key).toBe(expectedGroups[key]);
    }
  });

  it("maps the whole expected table, coordinator included", () => {
    for (const [role, group] of Object.entries(expectedGroups)) {
      expect(groupForRole(role), role).toBe(group);
    }
  });
});

describe.each(layouts)("routeFor: %s", (_name, layout) => {
  it("starts at the door, ends at the spot, no NaN, no repeated points", () => {
    for (const group of DESK_GROUPS) {
      for (const seat of [0, 1, layout.desks.length + 3]) {
        const r = routeFor(group, seat, layout);
        expect(r[0]).toEqual(layout.door);
        expect(r[r.length - 1]).toEqual(spotFor(group, seat, layout));
        r.forEach((p, i) => {
          expect(Number.isFinite(p.x) && Number.isFinite(p.y), `${group}#${seat}`).toBe(true);
          if (i > 0) expect(p.x === r[i - 1]!.x && p.y === r[i - 1]!.y, `${group}#${seat} dup at ${i}`).toBe(false);
        });
      }
    }
  });
});

describe("routeFor: WIDE paths", () => {
  const pts = (g: DeskGroup, s = 0) => routeFor(g, s, WIDE);
  const centre = (a: string, b: string) => {
    const k = WIDE.links.find((l) => (l.a === a && l.b === b) || (l.a === b && l.b === a))!;
    return { x: k.x + k.w / 2, y: k.y + k.h / 2 };
  };
  it("the front door opens onto the lobby; every work room is entered through its own doorway off the lobby", () => {
    expect(WIDE.entryRooms).toEqual(["hall"]);
    for (const g of ["analyst", "critic", "implementer", "qa", "debug", "subagent"] as const) {
      const r = pts(g);
      const room = roomOf(g, WIDE);
      expect(r.slice(0, 2)).toEqual([WIDE.door, ...WIDE.entryPath].slice(0, 2));
      // along the lobby centre line, through the room's own doorway, to the gate inside the room
      const c = centre(room.id, "hall");
      const iDoor = r.findIndex((p) => p.x === c.x && p.y === c.y);
      expect(iDoor, `${g} passes its doorway`).toBeGreaterThan(2);
      expect(r[iDoor - 1]).toEqual({ x: WIDE.hallX, y: c.y });
      expect(r[iDoor + 1]).toEqual(WIDE.gates[room.id]);
      expect(r[r.length - 1]).toEqual(spotFor(g, 0, WIDE));
    }
  });
  it("every leg of a WIDE route is axis-aligned or a short step, so people never cut through desks", () => {
    const desks = WIDE.desks;
    for (const g of DESK_GROUPS) {
      for (let seat = 0; seat < 6; seat++) {
        const r = routeFor(g, seat, WIDE);
        for (let i = 1; i < r.length; i++) {
          const a = r[i - 1]!;
          const b = r[i]!;
          for (let t = 0; t <= 1; t += 0.05) {
            const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
            for (const d of desks) {
              const inside = p.x > d.x + 4 && p.x < d.x + d.w - 4 && p.y > d.y + 4 && p.y < d.y + d.h - 4;
              expect(inside, `${g}#${seat} leg ${i} crosses desk ${d.group}#${d.seat}`).toBe(false);
            }
          }
        }
      }
    }
  });
  it("the coordination room (top) is reached through the lobby-to-command doorway", () => {
    const c = pts("coordinator");
    expect(c.slice(0, 3)).toEqual([WIDE.door, ...WIDE.entryPath]);
    const door = centre("command", "hall");
    const i = c.findIndex((p) => p.x === door.x && p.y === door.y);
    expect(i).toBeGreaterThan(2);
    expect(door.y).toBeLessThan(WIDE.entryPath[1]!.y);
    expect(c[i + 1]).toEqual(WIDE.gates.command);
  });
  it("the plan has a coordination room on top, a lobby and four work rooms with a doorway each", () => {
    const ids = WIDE.rooms.map((r) => r.id);
    expect(ids).toEqual(["command", "hall", "analyst", "critic", "qa", "subagent"]);
    const top = WIDE.rooms.find((r) => r.id === "command")!;
    for (const r of WIDE.rooms) if (r.id !== "command") expect(r.y).toBeGreaterThan(top.y + top.h - 1);
    expect(WIDE.links).toHaveLength(5);
  });
  it("the command room is large, has one coordinator desk and three zones (kitchen, work, rest)", () => {
    const cmd = WIDE.rooms.find((r) => r.id === "command")!;
    expect(cmd.w).toBeGreaterThanOrEqual(800);
    expect(cmd.h).toBeGreaterThanOrEqual(340);
    const desks = WIDE.desks.filter((d) => roomOf(d.group, WIDE).id === "command");
    expect(desks).toHaveLength(1);
    expect(desks[0]!.group).toBe("coordinator");
    const cx = desks[0]!.x + desks[0]!.w / 2;
    expect(cx).toBeGreaterThanOrEqual(COMMAND_ZONES.work.x);
    expect(cx).toBeLessThanOrEqual(COMMAND_ZONES.work.x + COMMAND_ZONES.work.w);
    expect(COMMAND_ZONES.kitchen.x + COMMAND_ZONES.kitchen.w).toBeLessThanOrEqual(COMMAND_ZONES.work.x);
    expect(COMMAND_ZONES.work.x + COMMAND_ZONES.work.w).toBeLessThanOrEqual(COMMAND_ZONES.rest.x);
  });
  it("every doorway and gate lies inside or touches its room, and routes exist between all room pairs", () => {
    for (const l of WIDE.links) {
      const rooms = [l.a, l.b].map((id) => WIDE.rooms.find((r) => r.id === id)!);
      for (const r of rooms) expect(l.x <= r.x + r.w && l.x + l.w >= r.x && l.y <= r.y + r.h && l.y + l.h >= r.y, `${l.a}-${l.b} touches ${r.id}`).toBe(true);
    }
    for (const r of WIDE.rooms) {
      const g = WIDE.gates[r.id];
      expect(g.x >= r.x && g.x <= r.x + r.w && g.y >= r.y && g.y <= r.y + r.h, `gate ${r.id}`).toBe(true);
    }
    for (const layout of [WIDE, NARROW]) {
      for (const a of DESK_GROUPS) for (const b of DESK_GROUPS) {
        const chain = chainBetween(layout, [roomOf(a, layout).id], roomOf(b, layout).id);
        for (const p of chain) expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
        if (roomOf(a, layout).id !== roomOf(b, layout).id) expect(chain.length).toBeGreaterThan(0);
      }
    }
  });
});

describe("routeFor: NARROW paths", () => {
  it("coordinator crosses the four doorway centres bottom to top", () => {
    const r = routeFor("coordinator", 0, NARROW);
    const i = r.findIndex((p) => p.x === 200 && p.y === 1955);
    expect(i).toBeGreaterThan(0);
    expect(r.slice(i, i + 4)).toEqual([{ x: 200, y: 1955 }, { x: 200, y: 1435 }, { x: 200, y: 915 }, { x: 200, y: 425 }]);
  });
});

describe("kitchen leisure spot", () => {
  it("is in the command room kitchen zone, reached from the gate without crossing the dining set", () => {
    const k = WIDE.leisure.find((l) => l.id === "kitchen")!;
    expect(k.room).toBe("command");
    expect(k.pos.x).toBeGreaterThanOrEqual(40);
    expect(k.pos.x).toBeLessThanOrEqual(400);
    expect(k.access[0]).toEqual(WIDE.gates.command);
    expect(k.access[k.access.length - 1]).toEqual(k.pos);
    const f = WIDE.furniture.command;
    const rects = [...f.tables, ...f.chairs.map((c) => ({ x: c.x - 12, y: c.y - 12, w: 24, h: 24 }))];
    for (let i = 1; i < k.access.length; i++) {
      const a = k.access[i - 1]!, b = k.access[i]!;
      for (const r of rects) {
        const hit = Math.max(a.x, b.x) >= r.x && Math.min(a.x, b.x) <= r.x + r.w && Math.max(a.y, b.y) >= r.y && Math.min(a.y, b.y) <= r.y + r.h;
        expect(hit, `leg ${i} crosses ${JSON.stringify(r)}`).toBe(false);
      }
    }
    expect(f.chairs.length).toBeGreaterThanOrEqual(4);
  });
});

describe("segmentMs and buildSteps", () => {
  it("segmentMs is clamped to [200, 2500] and non-decreasing in distance", () => {
    const o = { x: 0, y: 0 };
    let prev = 0;
    for (const d of [0, 10, 60, 100, 500, 750, 1000, 5000]) {
      const ms = segmentMs(o, { x: d, y: 0 });
      expect(ms).toBeGreaterThanOrEqual(200);
      expect(ms).toBeLessThanOrEqual(2500);
      expect(ms).toBeGreaterThanOrEqual(prev);
      prev = ms;
    }
    expect(segmentMs(o, { x: 0, y: 0 })).toBe(200);
    expect(segmentMs(o, { x: 5000, y: 0 })).toBe(2500);
  });
  const route = routeFor("coordinator", 0, WIDE);
  it("in from 0 accumulates `at` and uses segmentMs", () => {
    const s = buildSteps(route, 0, "in");
    expect(s.length).toBe(route.length - 1);
    let at = 0;
    s.forEach((st, j) => {
      expect(st.p).toEqual(route[j + 1]);
      expect(st.ms).toBe(segmentMs(route[j]!, route[j + 1]!));
      expect(st.at).toBe(at);
      at += st.ms;
    });
  });
  it("out from the end starts at route[end-1] and finishes at the door", () => {
    const s = buildSteps(route, route.length - 1, "out");
    expect(s[0]!.p).toEqual(route[route.length - 2]);
    expect(s[0]!.ms).toBe(segmentMs(route[route.length - 1]!, route[route.length - 2]!));
    expect(s[s.length - 1]!.p).toEqual(WIDE.door);
  });
  it("out from mid-route starts at route[idx-1]; out from 0 is empty", () => {
    expect(buildSteps(route, 2, "out")[0]!.p).toEqual(route[1]);
    expect(buildSteps(route, 0, "out")).toEqual([]);
  });
});

describe.each(layouts)("office layout geometry: %s", (_name, layout) => {
  it("every desk lies inside the room that houses its group", () => {
    for (const desk of layout.desks) {
      const room = layout.rooms.find((r) => r.groups.includes(desk.group));
      expect(room, `no room for group ${desk.group}`).toBeDefined();
      if (!room) continue;
      const label = `${desk.group}#${desk.seat}`;
      expect(desk.x, label).toBeGreaterThanOrEqual(room.x);
      expect(desk.y, label).toBeGreaterThanOrEqual(room.y);
      expect(desk.x + desk.w, label).toBeLessThanOrEqual(room.x + room.w);
      expect(desk.y + desk.h, label).toBeLessThanOrEqual(room.y + room.h);
    }
  });

  it("no two desks overlap", () => {
    const ds = layout.desks;
    for (let i = 0; i < ds.length; i++) {
      for (let j = i + 1; j < ds.length; j++) {
        const a = ds[i]!;
        const b = ds[j]!;
        const overlap = a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
        expect(overlap, `${a.group}#${a.seat} overlaps ${b.group}#${b.seat}`).toBe(false);
      }
    }
  });

  it("spotFor stays inside the scene for every group and seat, including standby overflow", () => {
    for (const group of DESK_GROUPS) {
      for (let seat = 0; seat <= layout.desks.length + 10; seat++) {
        const p = spotFor(group, seat, layout);
        const label = `${group}#${seat}`;
        expect(p.x, label).toBeGreaterThanOrEqual(0);
        expect(p.x, label).toBeLessThanOrEqual(layout.scene.w);
        expect(p.y, label).toBeGreaterThanOrEqual(0);
        expect(p.y, label).toBeLessThanOrEqual(layout.scene.h);
      }
    }
  });

  it("deskChairs yields one chair per desk at its spotFor", () => {
    const chairs = deskChairs(layout);
    expect(chairs.length).toBe(layout.desks.length);
    layout.desks.forEach((d, i) => {
      const c = chairs[i]!;
      expect(c.group).toBe(d.group);
      expect(c.seat).toBe(d.seat);
      const p = spotFor(d.group, d.seat, layout);
      expect(c.x).toBe(p.x);
      expect(c.y).toBe(p.y);
    });
  });

  it("deskChairs stay inside their room and clear of every desk", () => {
    for (const c of deskChairs(layout)) {
      const label = `${c.group}#${c.seat}`;
      const room = roomOf(c.group, layout);
      expect(c.x - 17, label).toBeGreaterThanOrEqual(room.x);
      expect(c.y - 17, label).toBeGreaterThanOrEqual(room.y);
      expect(c.x + 17, label).toBeLessThanOrEqual(room.x + room.w);
      expect(c.y + 17, label).toBeLessThanOrEqual(room.y + room.h);
      for (const d of layout.desks) {
        if (d.group === c.group && d.seat === c.seat) continue;
        const inside = c.x > d.x && c.x < d.x + d.w && c.y > d.y && c.y < d.y + d.h;
        expect(inside, `${label} inside desk ${d.group}#${d.seat}`).toBe(false);
      }
    }
  });

  it("16 standby slots per group are >= 24 px apart, inside the room, and wrap after 16", () => {
    for (const group of DESK_GROUPS) {
      const n = layout.desks.filter((d) => d.group === group).length;
      const room = roomOf(group, layout);
      const ps = Array.from({ length: 16 }, (_, i) => spotFor(group, n + i, layout));
      ps.forEach((p, i) => {
        expect(p.x, `${group}#${i}`).toBeGreaterThanOrEqual(room.x);
        expect(p.x, `${group}#${i}`).toBeLessThanOrEqual(room.x + room.w);
        expect(p.y, `${group}#${i}`).toBeGreaterThanOrEqual(room.y);
        expect(p.y, `${group}#${i}`).toBeLessThanOrEqual(room.y + room.h);
        for (let j = i + 1; j < ps.length; j++) {
          expect(Math.hypot(p.x - ps[j]!.x, p.y - ps[j]!.y), `${group} ${i}/${j}`).toBeGreaterThanOrEqual(24);
        }
      });
      // seat n+16 wraps around to the same slot as seat n
      expect(spotFor(group, n + 16, layout)).toEqual(ps[0]);
    }
  });

  it("every DeskGroup has at least one room", () => {
    for (const group of DESK_GROUPS) {
      expect(
        layout.rooms.some((r) => r.groups.includes(group)),
        `no room for group ${group}`,
      ).toBe(true);
    }
  });
});

describe('lobby has no bench or sofa', () => {
  it('WIDE drops the lobby bench and sofa; other leisure spots stay in their rooms', () => {
    expect(WIDE.leisure.some((l) => l.id === 'bench')).toBe(false);
    expect(WIDE.furniture.hall.sofas).toEqual([]);
    for (const l of WIDE.leisure) {
      const r = WIDE.rooms.find((x) => x.id === l.room)!;
      expect(l.pos.x >= r.x && l.pos.x <= r.x + r.w && l.pos.y >= r.y && l.pos.y <= r.y + r.h, l.id).toBe(true);
      expect(l.access.length).toBeGreaterThan(0);
      expect(l.access[l.access.length - 1]).toEqual(l.pos);
    }
  });
});
