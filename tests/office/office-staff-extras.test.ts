import { describe, expect, it } from "vitest";
import { NARROW, WIDE, spotFor, type DeskGroup } from "../../ui/src/office/layout";
import { isoLabelsFrom } from "../../ui/src/office/iso/scene";
import { dicts } from "../../ui/src/i18n";
import type { OfficeAgent } from "../../ui/src/office/model";
import { DISPATCH_MS, MAX_EXTRAS_PER_GROUP, RESIDENTS, assignJobs, createStaff, ensureExtras, extraResident, positionAlong, releaseExtras, seededRng, staffView, tickStaff, waitingSpots } from "../../ui/src/office/staff";

const labels = isoLabelsFrom(dicts.vi as unknown as Record<string, string>);
const agent = (id: string, group: DeskGroup, role: string, startedAt = 1): OfficeAgent =>
  ({ id, role, parent_id: null, group, seat: 0, phase: "working", activity: "typing", bubble: null, tools: 0, tokens: 0, startedAt, ok: true }) as OfficeAgent;

function setup(group: DeskGroup, n: number, L = WIDE) {
  const list = createStaff(L, 0, seededRng(1));
  const agents = Array.from({ length: n }, (_, i) => agent(`a${i}`, group, group, i + 1));
  assignJobs(list, agents, new Set(), 0, labels);
  ensureExtras(list, agents, L, 0, labels);
  return { list, agents };
}
const extras = (list: ReturnType<typeof createStaff>) => list.filter((s) => s.extra);
const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);

describe("extra staff", () => {
  it("a full subagent group (3 people) gets one extra for a 4th agent, with a stable id", () => {
    const { list } = setup("subagent", 4);
    expect(extras(list).map((s) => s.resident.id)).toEqual(["ext-subagent-0"]);
    expect(extras(list)[0]!.resident.seat).toBeNull();
    expect(extras(list)[0]!.job).toBe("a3");
  });

  it("the coordinator group (1 person) gets an extra for a 2nd agent", () => {
    const { list } = setup("coordinator", 2);
    expect(extras(list).map((s) => s.resident.id)).toEqual(["ext-coordinator-0"]);
  });

  it("no extra while someone of the group is free, and none beyond MAX_EXTRAS_PER_GROUP", () => {
    expect(extras(setup("subagent", 3).list)).toHaveLength(0);
    expect(extras(setup("subagent", 3 + MAX_EXTRAS_PER_GROUP + 2).list)).toHaveLength(MAX_EXTRAS_PER_GROUP);
  });

  it.each([["WIDE", WIDE], ["NARROW", NARROW]] as const)("walks in from the door, stops at the dispatch point, then to the group room (%s)", (_n, L) => {
    const { list } = setup("subagent", 4, L);
    const s = extras(list)[0]!;
    expect(s.route[0]).toEqual(L.entryPath[0]);
    expect(s.route[s.route.length - 1]).toEqual(L.gates.command);
    expect(dist(positionAlong(s.route, 0).pos, L.entrance.x ? L.entryPath[0]! : L.entryPath[0]!)).toBeLessThan(1);
    // Dispatch: stands at the gate of the command room, with the bubble.
    const v = staffView(s, s.arriveAt + 10, null, labels, "x");
    expect(v.pos).toEqual(L.gates.command);
    expect(v.bubble).not.toBe("");
    const dispatchedAt = s.arriveAt;
    tickStaff(list, L, dispatchedAt + 10, seededRng(2), labels);
    expect(s.dispatchUntil).toBeDefined();
    tickStaff(list, L, dispatchedAt + DISPATCH_MS + 10, seededRng(2), labels);
    expect(s.dispatchUntil).toBeUndefined();
    expect(s.route[0]).toEqual(L.gates.command);
    expect(s.arriveAt).toBeGreaterThan(dispatchedAt + DISPATCH_MS);
    const end = staffView(s, s.arriveAt + 5000, null, labels, "x");
    const spots = waitingSpots("subagent", 8, L, []);
    expect(spots.some((p) => dist(p, end.pos) < 40)).toBe(true);
    expect(end.deskSeat).toBeNull();
    expect(end.phase).toBe("idle");
  });

  it("the extra stands at a waiting spot when no seat is left and sits at a free seat otherwise", () => {
    const { list } = setup("subagent", 4);
    const s = extras(list)[0]!;
    const t = s.arriveAt + DISPATCH_MS + 10;
    tickStaff(list, WIDE, s.arriveAt + 10, seededRng(2), labels);
    tickStaff(list, WIDE, t, seededRng(2), labels);
    expect(s.desk.pose).toBe("stand");
    expect(s.desk.kind).not.toBe("desk");
    // A group with more desks than residents: the extra takes the lowest free seat.
    const groups = [...new Set(WIDE.desks.map((d) => d.group))];
    const g = groups.find((x) => WIDE.desks.filter((d) => d.group === x).length > RESIDENTS.filter((r) => r.group === x).length);
    if (g) {
      const r = extraResident(g, 0, WIDE);
      expect(r.seat).toBe(RESIDENTS.filter((x) => x.group === g).length);
      const free = setup(g, RESIDENTS.filter((x) => x.group === g).length + 1);
      const e = extras(free.list)[0]!;
      expect(e.desk.kind).toBe("desk");
      expect(e.desk.pos).toEqual(spotFor(g, e.resident.seat!, WIDE));
    }
  });

  it("extras are skipped by leisure and chat logic", () => {
    const { list } = setup("subagent", 4);
    const s = extras(list)[0]!;
    const rng = seededRng(5);
    for (let t = 0; t < 120000; t += 1000) {
      tickStaff(list, WIDE, t, rng, labels);
      expect(s.chatWith).toBeNull();
      expect(["entry", "desk", "stretch"]).toContain(s.at.kind === "desk" ? "desk" : s.at.kind === "stretch" ? "stretch" : "entry");
    }
    expect(list.filter((x) => !x.extra && x.chatWith).every((x) => !x.chatWith?.startsWith("ext-"))).toBe(true);
  });

  it("an extra whose agent has finished walks back to the door and is removed", () => {
    const { list, agents } = setup("subagent", 4);
    const s = extras(list)[0]!;
    assignJobs(list, agents.map((a) => ({ ...a, phase: "left" as const })), new Set(), 20000, labels);
    releaseExtras(list, WIDE, 20000);
    expect(s.exiting).toBe(true);
    expect(s.route[s.route.length - 1]).toEqual(WIDE.entryPath[0]);
    releaseExtras(list, WIDE, s.arriveAt - 1);
    expect(extras(list)).toHaveLength(1);
    releaseExtras(list, WIDE, s.arriveAt + 1);
    expect(extras(list)).toHaveLength(0);
  });

  it("is deterministic for the same input", () => {
    const a = setup("subagent", 5).list.map((s) => [s.resident.id, s.route, s.arriveAt, s.desk.pos]);
    const b = setup("subagent", 5).list.map((s) => [s.resident.id, s.route, s.arriveAt, s.desk.pos]);
    expect(a).toEqual(b);
  });
});
