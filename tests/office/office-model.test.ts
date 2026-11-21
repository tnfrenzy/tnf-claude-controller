import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { StreamParser } from "../../src/core/run/stream-parser.js";
import type { StoredEvent } from "../../src/core/run/events.js";
import { bubbleFor, emptyOffice, reduceAll, reduceOffice, visibleAgents } from "../../ui/src/office/model.js";
import { groupForRole, layoutFor, NARROW, roomOf, spotFor, WIDE, type Rect } from "../../ui/src/office/layout.js";

const FILE = path.resolve(__dirname, "..", "..", "fixtures", "real-roles.stream.jsonl");

/** Run the real fixture through the parser and stamp monotonically increasing timestamps. */
function storedEvents(): StoredEvent[] {
  const parser = new StreamParser("real-roles");
  const out: StoredEvent[] = [];
  let seq = 0;
  const push = (events: ReturnType<StreamParser["feedLine"]>) => {
    for (const event of events) out.push({ seq: ++seq, run_id: "real-roles", ts: 1_000_000 + seq * 100, event });
  };
  for (const line of fs.readFileSync(FILE, "utf8").split(/\r?\n/)) push(parser.feedLine(line));
  push(parser.finalize());
  return out;
}

describe("office model – real roles run", () => {
  const events = storedEvents();
  const final = reduceAll(events, "real-roles");

  it("research roles share the coding rooms: searchers + analyzer in analysis, synthesizer in implementation", () => {
    const seats = final.agents.map((a) => `${a.role}:${a.group}/${a.seat}`);
    // the analyzer starts after both searchers left, so it reuses seat 0
    expect(seats).toEqual(["coordinator:coordinator/0", "searcher:analyst/0", "searcher:analyst/1", "analyzer:analyst/0", "synthesizer:implementer/0"]);
  });
  it("everyone has left once the run finished", () => {
    expect(final.status).toBe("done");
    expect(final.agents.every((a) => a.phase === "left" && a.ok)).toBe(true);
    expect(visibleAgents(final, final.lastEventTs + 10_000)).toEqual([]);
    expect(visibleAgents(final, final.lastEventTs + 1_000).length).toBeGreaterThan(0);
  });
  it("tracks tools/tokens from task_progress and shows the last tool as a bubble", () => {
    const mid = events.find((s) => s.event.type === "agent.progress" && s.event.last_tool)!;
    const upTo = events.slice(0, events.indexOf(mid) + 1);
    const state = reduceAll(upTo, "real-roles");
    const a = state.agents.find((x) => x.id === (mid.event as { agent_id: string }).agent_id)!;
    expect(a.phase).toBe("working");
    expect(a.tokens).toBeGreaterThan(0);
    expect(bubbleFor(a, mid.ts + 100)?.kind).toBe("tool");
  });
  it("coordinator tool.use shows a tool bubble that clears on tool.result", () => {
    const i = events.findIndex((s) => s.event.type === "tool.use" && s.event.agent_id === "coordinator");
    const after = reduceAll(events.slice(0, i + 1));
    expect(after.agents[0]?.bubble?.kind).toBe("tool");
    expect(after.agents[0]?.activity).toBe("tool");
    const j = events.findIndex((s, k) => k > i && s.event.type === "tool.result" && s.event.agent_id === "coordinator");
    const cleared = reduceAll(events.slice(0, j + 1));
    expect(cleared.agents[0]?.activity).toBe("idle");
  });
});

describe("office model – seat reuse and layout", () => {
  it("frees a seat when its agent leaves and reuses it", () => {
    let s = emptyOffice();
    const ev = (event: StoredEvent["event"], ts: number): StoredEvent => ({ seq: ts, run_id: "x", ts, event });
    s = reduceOffice(s, ev({ type: "run.started", run_id: "x" }, 1));
    s = reduceOffice(s, ev({ type: "agent.started", agent_id: "a", role: "searcher", parent_id: "coordinator", tool_use_id: "a" }, 2));
    s = reduceOffice(s, ev({ type: "agent.started", agent_id: "b", role: "searcher", parent_id: "coordinator", tool_use_id: "b" }, 3));
    s = reduceOffice(s, ev({ type: "agent.finished", agent_id: "a", summary: "ok", status: "completed" }, 4));
    s = reduceOffice(s, ev({ type: "agent.started", agent_id: "c", role: "searcher", parent_id: "coordinator", tool_use_id: "c" }, 5));
    expect(s.agents.map((a) => [a.id, a.seat])).toEqual([["coordinator", 0], ["a", 0], ["b", 1], ["c", 0]]);
  });
  it("three running agents of one group get three distinct seats", () => {
    let s = emptyOffice();
    const ev = (event: StoredEvent["event"], ts: number): StoredEvent => ({ seq: ts, run_id: "x", ts, event });
    s = reduceOffice(s, ev({ type: "run.started", run_id: "x" }, 1));
    for (const [i, id] of ["a", "b", "c"].entries()) {
      s = reduceOffice(s, ev({ type: "agent.started", agent_id: id, role: "implementer", parent_id: "coordinator", tool_use_id: id }, 2 + i));
    }
    const seats = s.agents.filter((a) => a.group === "implementer" && a.phase === "working").map((a) => a.seat);
    expect(seats).toEqual([0, 1, 2]);
  });
  it("maps both role sets to rooms; unknown roles go to the subagent room", () => {
    expect(["analyst", "planner", "critic", "implementer", "qa", "debug"].map(groupForRole)).toEqual(["analyst", "analyst", "critic", "implementer", "qa", "debug"]);
    expect(["scout", "helper", "reviewer-bot"].map(groupForRole)).toEqual(["subagent", "subagent", "subagent"]);
    expect(["searcher", "analyzer", "synthesizer", "coordinator"].map(groupForRole)).toEqual(["analyst", "analyst", "implementer", "coordinator"]);
    expect(groupForRole("Reviewer")).toBe("critic");
    expect(groupForRole("translator")).toBe("subagent");
  });
  it("overflow seats get a standing spot inside the room", () => {
    const p6 = spotFor("analyst", 6);
    const p7 = spotFor("analyst", 7);
    expect(p7.y - p6.y).toBe(WIDE.standbyStagger);
    expect(p7.x).toBeGreaterThan(p6.x);
    expect(spotFor("analyst", 8).y).toBe(p6.y);
  });
  it("narrow plan (≤ 480 px) keeps every desk, chair and overflow spot inside its room and the 400-wide scene", () => {
    expect(layoutFor(375)).toBe(NARROW);
    expect(layoutFor(480)).toBe(NARROW);
    expect(layoutFor(481)).toBe(WIDE);
    expect(layoutFor(0)).toBe(WIDE);
    expect(NARROW.scene.w).toBe(400);
    for (const L of [NARROW, WIDE]) {
      // same seats as the wide plan, so agents keep their desk assignments when the viewport changes
      expect(L.desks.map((d) => `${d.group}:${d.seat}`).sort()).toEqual(WIDE.desks.map((d) => `${d.group}:${d.seat}`).sort());
      for (const d of L.desks) {
        const room = roomOf(d.group, L);
        expect(room, `${d.group} room`).toBeDefined();
        expect(room.groups, `${d.group} in room.groups`).toContain(d.group);
        const chairBottom = d.y + d.h + 36 + 17;
        expect(d.x).toBeGreaterThanOrEqual(room.x);
        expect(d.x + d.w).toBeLessThanOrEqual(room.x + room.w);
        expect(d.y - 14).toBeGreaterThanOrEqual(room.y); // nameplate above the desk
        expect(chairBottom).toBeLessThanOrEqual(room.y + room.h + 1);
        // a chair must never reach the nameplate/top of the next desk below it in the same room
        for (const o of L.desks) {
          if (o === d || o.group !== d.group || o.y <= d.y || o.x !== d.x) continue;
          expect(chairBottom, `${d.group}:${d.seat} chair vs ${o.group}:${o.seat}`).toBeLessThanOrEqual(o.y - 14);
        }
      }
      for (const r of L.rooms) {
        expect(r.x + r.w).toBeLessThanOrEqual(L.scene.w);
        expect(r.y + r.h).toBeLessThanOrEqual(L.scene.h);
      }
      const over = spotFor("analyst", 7, L);
      const analyst = L.rooms.find((r) => r.id === "analyst")!;
      expect(over.x).toBeGreaterThan(analyst.x);
      expect(over.x).toBeLessThan(analyst.x + analyst.w);
      expect(L.door.y).toBeLessThan(L.scene.h);
    }
  });
  it("both plans have walled rooms in order; unknown roles live in the subagent room", () => {
    const touches = (a: Rect, b: Rect) => a.x <= b.x + b.w && b.x <= a.x + a.w && a.y <= b.y + b.h && b.y <= a.y + a.h;
    const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
    for (const L of [WIDE, NARROW]) {
      expect(L.rooms.map((r) => r.id).filter((id) => id !== "hall")).toEqual(["command", "analyst", "critic", "qa", "subagent"]);
      expect(roomOf(groupForRole("translator"), L).id).toBe("subagent");
      expect(roomOf(groupForRole("coordinator"), L).id).toBe("command");
      expect(roomOf(groupForRole("critic"), L)).toBe(roomOf(groupForRole("implementer"), L));
      expect(roomOf("critic", L).id).toBe("critic");
      expect(roomOf("debug", L).id).toBe("qa");
      for (let i = 0; i < L.rooms.length; i++) {
        for (let j = i + 1; j < L.rooms.length; j++) expect(overlaps(L.rooms[i]!, L.rooms[j]!), `${L.rooms[i]!.id}/${L.rooms[j]!.id}`).toBe(false);
      }
      expect(L.links.length).toBeGreaterThanOrEqual(3);
      for (const k of L.links) {
        const a = L.rooms.find((r) => r.id === k.a)!;
        const b = L.rooms.find((r) => r.id === k.b)!;
        expect(touches(k, a) && touches(k, b), `link ${k.a}-${k.b} touches both rooms`).toBe(true);
        expect(overlaps(k, a) || overlaps(k, b), `link ${k.a}-${k.b} stays in the wall gap`).toBe(false);
        expect(k.x).toBeGreaterThanOrEqual(0);
        expect(k.y).toBeGreaterThanOrEqual(0);
        expect(k.x + k.w).toBeLessThanOrEqual(L.scene.w);
        expect(k.y + k.h).toBeLessThanOrEqual(L.scene.h);
      }
      expect(L.entrance.x + L.entrance.w).toBeLessThanOrEqual(L.scene.w);
      expect(L.door.y).toBeGreaterThanOrEqual(L.entrance.y + L.entrance.h);
      // overflow standing spots stay in their own room
      for (const [g, id] of [["implementer", "critic"], ["critic", "critic"]] as const) {
        const room = L.rooms.find((r) => r.id === id)!;
        const p = spotFor(g, 5, L);
        expect(p.x).toBeGreaterThan(room.x);
        expect(p.x).toBeLessThan(room.x + room.w);
        expect(p.y).toBeGreaterThan(room.y);
        expect(p.y).toBeLessThan(room.y + room.h);
      }
      // command room has exactly one desk (the coordinator's)
      expect(L.desks.filter((d) => roomOf(d.group, L).id === "command")).toHaveLength(1);
    }
    expect(NARROW.scene.w).toBe(400);
  });
  it("run.error marks working agents as not ok", () => {
    let s = emptyOffice();
    s = reduceOffice(s, { seq: 1, run_id: "x", ts: 1, event: { type: "run.started", run_id: "x" } });
    s = reduceOffice(s, { seq: 2, run_id: "x", ts: 2, event: { type: "run.error", kind: "spawn", message: "boom" } });
    expect(s.status).toBe("error");
    expect(s.agents[0]).toMatchObject({ phase: "left", ok: false });
  });
});

describe.each([
  ["WIDE", WIDE],
  ["NARROW", NARROW],
])("office layout geometry – %s", (_name, L) => {
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (a: Rect, r: Rect) => a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h;
  const chairHitsRect = (d: { x: number; y: number; w: number; h: number }, r: Rect) => {
    const cx = d.x + d.w / 2;
    const cy = d.y + d.h + 36;
    const nx = Math.max(r.x, Math.min(cx, r.x + r.w));
    const ny = Math.max(r.y, Math.min(cy, r.y + r.h));
    return Math.hypot(cx - nx, cy - ny) < 17;
  };
  const counts = (g: string) => L.desks.filter((d) => d.group === g).length;
  it("has the planned desk counts", () => {
    expect(["coordinator", "analyst", "critic", "implementer", "qa", "debug", "subagent"].map(counts)).toEqual([1, 6, 3, 2, 3, 2, 3]);
    expect(L.desks.length).toBe(20);
  });
  it("keeps desks apart and chairs clear of the desk below", () => {
    for (let i = 0; i < L.desks.length; i++) {
      for (let j = i + 1; j < L.desks.length; j++) expect(overlaps(L.desks[i]!, L.desks[j]!), `${i}/${j}`).toBe(false);
    }
    for (const d of L.desks) {
      for (const o of L.desks) {
        if (o === d || o.x !== d.x || o.y <= d.y) continue;
        expect(o.y).toBeGreaterThanOrEqual(d.y + d.h + 53 + 14);
      }
    }
  });
  it("standby strips sit inside their rooms, clear of desks, chairs and links", () => {
    for (const r of L.rooms) {
      const s = L.standby[r.id];
      expect(inside(s, r), `${r.id} inside`).toBe(true);
      expect(s.h).toBeGreaterThanOrEqual(30 * r.groups.length + 10);
      for (const d of L.desks) {
        expect(overlaps(s, d), `${r.id} vs desk ${d.group}:${d.seat}`).toBe(false);
        expect(chairHitsRect(d, s), `${r.id} vs chair ${d.group}:${d.seat}`).toBe(false);
      }
      for (const k of L.links) expect(overlaps(s, k)).toBe(false);
    }
  });
  it("plants stay inside a room, clear of desks, chairs, standby strips and links", () => {
    for (const p of L.plants) {
      const box: Rect = { x: p.x - 14, y: p.y - 14, w: 28, h: 28 };
      expect(L.rooms.some((r) => inside(box, r)), `plant ${p.x},${p.y} in a room`).toBe(true);
      for (const d of L.desks) {
        expect(overlaps(box, d)).toBe(false);
        expect(chairHitsRect(d, box)).toBe(false);
      }
      for (const r of L.rooms) expect(overlaps(box, L.standby[r.id])).toBe(false);
      for (const k of L.links) expect(overlaps(box, k)).toBe(false);
    }
  });
  it("scene holds the rooms and the entrance", () => {
    for (const r of L.rooms) {
      expect(r.x + r.w).toBeLessThanOrEqual(L.scene.w);
      expect(r.y + r.h).toBeLessThanOrEqual(L.scene.h);
    }
    expect(L.entrance.y + L.entrance.h).toBeLessThanOrEqual(L.scene.h);
    expect(L.door.y).toBeLessThan(L.scene.h);
  });
});

describe.each([
  ["WIDE", WIDE],
  ["NARROW", NARROW],
])("spotFor overflow – %s", (_name, L) => {
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const rectDist = (p: { x: number; y: number }, r: Rect) =>
    dist(p, { x: Math.max(r.x, Math.min(p.x, r.x + r.w)), y: Math.max(r.y, Math.min(p.y, r.y + r.h)) });
  const groups = ["coordinator", "analyst", "critic", "implementer", "qa", "debug", "subagent"] as const;
  const spots = (g: (typeof groups)[number]) => {
    const n = L.desks.filter((d) => d.group === g).length;
    return Array.from({ length: 16 }, (_, i) => spotFor(g, n + i, L));
  };
  it("gives 16 spots per group in the standby band, clear of desks, chairs, furniture and plants", () => {
    for (const g of groups) {
      const band = L.standby[roomOf(g, L).id];
      const ps = spots(g);
      for (let i = 0; i < ps.length; i++) {
        const p = ps[i]!;
        expect(p.x).toBeGreaterThanOrEqual(band.x);
        expect(p.x).toBeLessThanOrEqual(band.x + band.w);
        expect(p.y).toBeGreaterThanOrEqual(band.y);
        expect(p.y).toBeLessThanOrEqual(band.y + band.h);
        for (let j = i + 1; j < ps.length; j++) expect(dist(p, ps[j]!), `${g} ${i}/${j}`).toBeGreaterThanOrEqual(24);
        for (const d of L.desks) {
          // 14 (was 20): staggered odd columns drop up to 20 px; a character body is ~24 px wide, so half = 12 px of clearance is enough
          expect(rectDist(p, d), `${g} vs desk`).toBeGreaterThanOrEqual(14);
          expect(dist(p, { x: d.x + d.w / 2, y: d.y + d.h + 36 }), `${g} vs chair`).toBeGreaterThanOrEqual(37);
        }
        const f = L.furniture[roomOf(g, L).id];
        for (const r of [...f.shelves, ...f.sofas, ...f.tables]) expect(rectDist(p, r), `${g} vs furniture`).toBeGreaterThanOrEqual(12);
        for (const c of f.chairs) expect(dist(p, c)).toBeGreaterThanOrEqual(12);
        // plants are low decoration: the staggered last analyst slot sits ~9 px from the plant box at (1130,400)
        for (const q of [...f.plants, ...L.plants]) expect(rectDist(p, { x: q.x - 14, y: q.y - 14, w: 28, h: 28 })).toBeGreaterThanOrEqual(9);
      }
    }
  });
  it("shared rooms do not collide and far overflow stays finite in the band", () => {
    for (const [a, b] of [["critic", "implementer"], ["qa", "debug"]] as const) {
      for (const p of spots(a)) for (const q of spots(b)) expect(dist(p, q)).toBeGreaterThanOrEqual(20);
    }
    for (const g of groups) {
      const n = L.desks.filter((d) => d.group === g).length;
      const p = spotFor(g, n + 60, L);
      const band = L.standby[roomOf(g, L).id];
      expect(Number.isFinite(p.x) && Number.isFinite(p.y)).toBe(true);
      expect(p.x >= band.x && p.x <= band.x + band.w && p.y >= band.y && p.y <= band.y + band.h).toBe(true);
    }
    const d = L.desks[0]!;
    expect(spotFor(d.group, d.seat, L)).toEqual({ x: d.x + d.w / 2, y: d.y + d.h + 36 });
  });
});

describe("office furniture – same categories in both layouts", () => {
  it("WIDE and NARROW carry the same kinds of furniture", () => {
    for (const L of [WIDE, NARROW]) {
      expect(L.furniture.command.sofas.length).toBeGreaterThanOrEqual(1);
      expect(L.furniture.command.tables.length).toBeGreaterThanOrEqual(1);
      for (const id of ["analyst", "critic", "qa", "subagent"] as const) expect(L.furniture[id].shelves.length, id).toBeGreaterThanOrEqual(1);
      for (const id of ["command", "analyst", "critic", "qa", "subagent"] as const) expect(L.furniture[id].plants.length, id).toBeGreaterThanOrEqual(1);
    }
  });
});

describe.each([
  ["WIDE", WIDE],
  ["NARROW", NARROW],
])("office furniture – %s", (_name, L) => {
  const overlaps = (a: Rect, b: Rect) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
  const inside = (a: Rect, r: Rect) => a.x >= r.x && a.y >= r.y && a.x + a.w <= r.x + r.w && a.y + a.h <= r.y + r.h;
  const circleHits = (c: { x: number; y: number }, rad: number, r: Rect) => {
    const nx = Math.max(r.x, Math.min(c.x, r.x + r.w));
    const ny = Math.max(r.y, Math.min(c.y, r.y + r.h));
    return Math.hypot(c.x - nx, c.y - ny) < rad;
  };
  const box = (p: { x: number; y: number }): Rect => ({ x: p.x - 14, y: p.y - 14, w: 28, h: 28 });
  type Item = { kind: string; rect: Rect; circle?: { x: number; y: number; r: number } };
  const itemsOf = (id: keyof typeof L.furniture): Item[] => {
    const f = L.furniture[id];
    return [
      ...f.shelves.map((rect) => ({ kind: "shelf", rect })),
      ...f.sofas.map((rect) => ({ kind: "sofa", rect })),
      ...f.tables.map((rect) => ({ kind: "table", rect })),
      ...f.chairs.map((c) => ({ kind: "chair", rect: { x: c.x - 12, y: c.y - 12, w: 24, h: 24 }, circle: { ...c, r: 12 } })),
      ...f.plants.map((p) => ({ kind: "plant", rect: box(p) })),
    ];
  };
  const hitsRect = (it: Item, r: Rect) => (it.circle ? circleHits(it.circle, it.circle.r, r) : overlaps(it.rect, r));
  it("every room has the five keys and at least one plant", () => {
    for (const r of L.rooms) {
      const f = L.furniture[r.id];
      expect(Object.keys(f).filter((k) => k !== "beds").sort()).toEqual(["chairs", "coolers", "plants", "shelves", "sofas", "tables"]);
      expect(f.plants.length).toBeGreaterThanOrEqual(1);
    }
    expect(L.furniture.command.sofas.length).toBeGreaterThanOrEqual(1);
    expect(L.furniture.command.tables.length).toBeGreaterThanOrEqual(1);
  });
  it("furniture stays inside its room and clear of desks, seat chairs, links, standby and corner plants", () => {
    for (const r of L.rooms) {
      const items = itemsOf(r.id);
      for (const it of items) {
        expect(inside(it.rect, r), `${r.id} ${it.kind} inside`).toBe(true);
        for (const d of L.desks) {
          expect(hitsRect(it, d), `${r.id} ${it.kind} vs desk ${d.group}:${d.seat}`).toBe(false);
          const c = { x: d.x + d.w / 2, y: d.y + d.h + 36 };
          expect(Math.hypot(c.x - Math.max(it.rect.x, Math.min(c.x, it.rect.x + it.rect.w)), c.y - Math.max(it.rect.y, Math.min(c.y, it.rect.y + it.rect.h))), `${r.id} ${it.kind} vs seat chair`).toBeGreaterThanOrEqual(17);
        }
        for (const k of L.links) expect(overlaps(it.rect, k)).toBe(false);
        expect(hitsRect(it, L.standby[r.id]), `${r.id} ${it.kind} vs standby`).toBe(false);
        for (const p of L.plants) expect(hitsRect(it, box(p)), `${r.id} ${it.kind} vs corner plant`).toBe(false);
      }
      for (let i = 0; i < items.length; i++) {
        for (let j = i + 1; j < items.length; j++) expect(overlaps(items[i]!.rect, items[j]!.rect), `${r.id} ${i}/${j}`).toBe(false);
      }
    }
  });
});

describe("office model – merging several runs", () => {
  it("re-seats agents so two runs never share a desk", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const ev = (run: string, event: StoredEvent["event"], ts: number): StoredEvent => ({ seq: ts, run_id: run, ts, event });
    const mk = (run: string, base: number) =>
      [ev(run, { type: "run.started", run_id: run }, base), ev(run, { type: "agent.started", agent_id: "s", role: "searcher", parent_id: "coordinator", tool_use_id: "s" }, base + 1)].reduce(reduceOffice, emptyOffice(run));
    const merged = mergeOffices([{ state: mk("r1", 10), tag: "A" }, { state: mk("r2", 20), tag: "B" }]);
    expect(merged.map((a) => [a.id, a.group, a.seat, a.tag])).toEqual([
      ["coordinator*", "coordinator", 0, "A, B"],
      ["r1:s", "analyst", 0, "A"],
      ["r2:s", "analyst", 1, "B"],
    ]);
  });

  const ev = (run: string, event: StoredEvent["event"], ts: number): StoredEvent => ({ seq: ts, run_id: run, ts, event });
  const mk = (run: string, base: number, withAgent = true) => {
    const evs = [ev(run, { type: "run.started", run_id: run }, base)];
    if (withAgent) evs.push(ev(run, { type: "agent.started", agent_id: "s", role: "searcher", parent_id: "coordinator", tool_use_id: "s" }, base + 1));
    return evs.reduce(reduceOffice, emptyOffice(run));
  };
  const finish = (st: ReturnType<typeof mk>, run: string, ts: number) =>
    reduceOffice(st, ev(run, { type: "run.result", ok: true, text: "", cost_usd_est: 0, usage: {}, duration_ms: 1, num_turns: 1, permission_denials: [] } as unknown as StoredEvent["event"], ts));

  it("(a) a single run keeps id runId:coordinator", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const merged = mergeOffices([{ state: mk("r1", 10), tag: "A" }]);
    expect(merged.map((a) => a.id)).toEqual(["r1:coordinator", "r1:s"]);
  });

  it("(b) one run finished, the other working: merged coordinator keeps working with the running tag", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const merged = mergeOffices([{ state: finish(mk("r1", 10), "r1", 50), tag: "A" }, { state: mk("r2", 20), tag: "B" }]);
    const c = merged.filter((a) => a.group === "coordinator");
    expect(c).toHaveLength(1);
    expect(c[0]!.phase).toBe("working");
    expect(c[0]!.tag).toBe("B");
  });

  it("(b2) r1 finished while r2 has no coordinator yet: still one character, left", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const merged = mergeOffices([{ state: finish(mk("r1", 10), "r1", 50), tag: "A" }, { state: emptyOffice("r2"), tag: "B" }]);
    const c = merged.filter((a) => a.group === "coordinator");
    expect(c).toHaveLength(1);
    expect(c[0]!.id).toBe("r1:coordinator");
    expect(c[0]!.phase).toBe("left");
  });

  it("(c) all finished: merged coordinator left with max finishedAt", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const merged = mergeOffices([{ state: finish(mk("r1", 10), "r1", 50), tag: "A" }, { state: finish(mk("r2", 20), "r2", 70), tag: "B" }]);
    const c = merged.filter((a) => a.group === "coordinator");
    expect(c).toHaveLength(1);
    expect(c[0]!.id).toBe("coordinator*");
    expect(c[0]!.phase).toBe("left");
    expect(c[0]!.finishedAt).toBe(70);
    expect(c[0]!.tag).toBe("A, B");
  });

  it("(d) three runs: one coordinator, subagents on seats 0,1,2", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const merged = mergeOffices([{ state: mk("r1", 10), tag: "A" }, { state: mk("r2", 20), tag: "B" }, { state: mk("r3", 30), tag: "C" }]);
    expect(merged.filter((a) => a.group === "coordinator").map((a) => [a.id, a.seat, a.tag])).toEqual([["coordinator*", 0, "A, B, C"]]);
    expect(merged.filter((a) => a.group === "analyst").map((a) => [a.id, a.seat])).toEqual([["r1:s", 0], ["r2:s", 1], ["r3:s", 2]]);
  });

  it("sumUsage adds usages and returns undefined when empty", async () => {
    const { sumUsage } = await import("../../ui/src/office/model.js");
    expect(sumUsage([])).toBeUndefined();
    expect(sumUsage([undefined])).toBeUndefined();
    expect(sumUsage([{ input: 1, output: 2, cache_read: 3, cache_write: 4 }, undefined, { input: 10, output: 20, cache_read: 30, cache_write: 40 }])).toEqual({ input: 11, output: 22, cache_read: 33, cache_write: 44 });
  });

  it("(e) tools and tokens add up", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const s1 = mk("r1", 10, false);
    const s2 = mk("r2", 20, false);
    s1.agents[0]!.tools = 2;
    s1.agents[0]!.tokens = 100;
    s2.agents[0]!.tools = 3;
    s2.agents[0]!.tokens = 50;
    const merged = mergeOffices([{ state: s1, tag: "A" }, { state: s2, tag: "B" }]);
    expect(merged).toHaveLength(1);
    expect(merged[0]!.tools).toBe(5);
    expect(merged[0]!.tokens).toBe(150);
  });

  it("(f) two or three parallel running runs give exactly one coordinator on seat 0, working", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    for (const n of [2, 3]) {
      const runs = Array.from({ length: n }, (_, i) => ({ state: mk(`r${i + 1}`, (i + 1) * 10), tag: `T${i + 1}` }));
      const merged = mergeOffices(runs);
      const coords = merged.filter((a) => a.id.startsWith("coordinator"));
      expect(coords, `n=${n}`).toHaveLength(1);
      expect(coords[0]!.seat).toBe(0);
      expect(coords[0]!.phase).toBe("working");
      expect(merged.some((a) => a.id.endsWith(":coordinator")), `n=${n}`).toBe(false);
    }
  });

  it("(g) three parallel runs with two same-group subagents each: no (group, seat) collision", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const runs = ["r1", "r2", "r3"].map((run, i) => {
      const base = (i + 1) * 10;
      const st = mk(run, base);
      return { state: reduceOffice(st, ev(run, { type: "agent.started", agent_id: "s2", role: "searcher", parent_id: "coordinator", tool_use_id: "s2" }, base + 2)), tag: run.toUpperCase() };
    });
    const merged = mergeOffices(runs);
    const subs = merged.filter((a) => a.group !== "coordinator" && a.phase === "working");
    expect(subs).toHaveLength(6);
    const keys = subs.map((a) => `${a.group}:${a.seat}`);
    expect(new Set(keys).size).toBe(keys.length);
    for (const a of subs) expect(a.id).toMatch(/^r[123]:s2?$/);
  });

  it("(h) merged coordinator stays working until the last run finishes, then leaves at the last ts", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const coord = (s: ReturnType<typeof mk>[]) => mergeOffices(s.map((state, i) => ({ state, tag: `T${i + 1}` }))).filter((a) => a.group === "coordinator");
    const s1 = mk("r1", 10);
    const s2 = mk("r2", 20);
    const s3 = mk("r3", 30);
    const f1 = finish(s1, "r1", 100);
    const c1 = coord([f1, s2, s3]);
    expect(c1).toHaveLength(1);
    expect(c1[0]!.phase).toBe("working");
    const f2 = finish(s2, "r2", 200);
    const c2 = coord([f1, f2, s3]);
    expect(c2).toHaveLength(1);
    expect(c2[0]!.phase).toBe("working");
    const f3 = finish(s3, "r3", 300);
    const c3 = coord([f1, f2, f3]);
    expect(c3).toHaveLength(1);
    expect(c3[0]!.phase).toBe("left");
    expect(c3[0]!.finishedAt).toBe(300);
  });

  it("(i) a subagent that left keeps its group and seat in the merged result", async () => {
    const { mergeOffices } = await import("../../ui/src/office/model.js");
    const s1 = mk("r1", 10);
    const s2 = mk("r2", 20);
    const before = mergeOffices([{ state: s1, tag: "A" }, { state: s2, tag: "B" }]);
    const a1 = before.find((a) => a.id === "r1:s")!;
    expect(a1.phase).toBe("working");
    const f1 = reduceOffice(s1, ev("r1", { type: "agent.finished", agent_id: "s", summary: "", status: "completed" } as unknown as StoredEvent["event"], 60));
    const after = mergeOffices([{ state: f1, tag: "A" }, { state: s2, tag: "B" }]);
    const left = after.find((a) => a.id === "r1:s")!;
    expect(left.phase).toBe("left");
    expect(left.group).toBe(a1.group);
    expect(left.seat).toBe(a1.seat);
    expect(after.find((a) => a.id === "r2:s")!.phase).toBe("working");
  });
});

describe("office model – real coding run (verdicts, commit)", () => {
  const CODING = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-pass.stream.jsonl");
  const parser = new StreamParser("real-coding-pass");
  const events: StoredEvent[] = [];
  let seq = 0;
  const push = (evs: ReturnType<StreamParser["feedLine"]>) => {
    for (const event of evs) events.push({ seq: ++seq, run_id: "real-coding-pass", ts: 2_000_000 + seq * 100, event });
  };
  for (const line of fs.readFileSync(CODING, "utf8").split(/\r?\n/)) push(parser.feedLine(line));
  push(parser.finalize());
  const final = reduceAll(events, "real-coding-pass");

  it("seats the coding roles in their rooms", () => {
    const groups = new Map(final.agents.map((a) => [a.role, a.group]));
    expect(groups.get("coordinator")).toBe("coordinator");
    expect(groups.get("analyst")).toBe("analyst");
    expect(groups.get("planner")).toBe("analyst");
    expect(groups.get("critic")).toBe("critic");
    expect(groups.get("implementer")).toBe("implementer");
    expect(groups.get("qa")).toBe("qa");
  });
  it("keeps the critic / qa verdict on the agent for the desk badge, and the bubble survives agent.finished", () => {
    const critic = final.agents.find((a) => a.role === "critic")!;
    const qa = final.agents.find((a) => a.role === "qa")!;
    expect(critic.verdict).toMatch(/^APPROVED/);
    expect(qa.verdict).toBe("PASS");
    expect(qa.bubble?.text).toBe("VERDICT: PASS");
    expect(qa.bubble?.kind).toBe("done");
  });
  it("vcs.commit shows a commit bubble on the agent it is attributed to", () => {
    const i = events.findIndex((s) => s.event.type === "vcs.commit");
    expect(i).toBeGreaterThan(0);
    const st = reduceAll(events.slice(0, i + 1), "real-coding-pass");
    const id = (events[i]!.event as { agent_id: string }).agent_id;
    expect(st.agents.find((a) => a.id === id)?.bubble?.text).toMatch(/commit/);
  });
});
