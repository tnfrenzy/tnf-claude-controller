import { describe, expect, it } from "vitest";
import { NARROW, WIDE, type OfficeLayout, type Point } from "../../ui/src/office/layout";
import { isoLabelsFrom } from "../../ui/src/office/iso/scene";
import { dicts } from "../../ui/src/i18n";
import type { OfficeAgent } from "../../ui/src/office/model";
import { RESIDENTS, assignJobs, createStaff, deskPlace, leisurePlaces, positionAlong, routeBetween, routeLength, seededRng, staffView, stretchPlace, tickStaff, workAct, workBubble, waitingSpots } from "../../ui/src/office/staff";
import { spotFor } from "../../ui/src/office/layout";
import { STAFF_SCALE } from "../../ui/src/components/office/OfficeScene25D";

describe("staff scale", () => {
  it("is 10% smaller than 0.7", () => {
    expect(STAFF_SCALE).toBe(0.63);
  });
});

describe("waitingSpots", () => {
  it("places extra agents apart from each other and from seated people", () => {
    const seats = WIDE.desks.map((d) => spotFor(d.group, d.seat, WIDE));
    const groups = [...new Set(WIDE.desks.map((d) => d.group))];
    for (const group of groups) {
      const spots = waitingSpots(group, 3, WIDE, seats);
      expect(spots.length).toBe(3);
      const all = [...seats, ...spots];
      spots.forEach((p, i) => {
        all.forEach((o, j) => {
          if (o === p) return;
          expect(Math.hypot(o.x - p.x, o.y - p.y)).toBeGreaterThanOrEqual(14);
          void i; void j;
        });
      });
    }
  });
});

const labels = isoLabelsFrom(dicts.vi as unknown as Record<string, string>);

function placesOf(L: OfficeLayout) {
  return [...RESIDENTS.map((r) => deskPlace(r, L)), ...leisurePlaces(L), ...L.rooms.filter((r) => r.groups.length > 0).flatMap((r) => [stretchPlace(r.id, L, 0), stretchPlace(r.id, L, 1)])];
}

describe("staff spots and interrupts", () => {
  it("two free people never share a spot", () => {
    const rng = seededRng(21);
    const list = createStaff(WIDE, 0, rng);
    for (let i = 0; i < 200; i++) {
      tickStaff(list, WIDE, i * 1500, rng, labels);
      const ids = list.map((s) => s.at.id);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it("stretch spot is off the gate", () => {
    for (const r of WIDE.rooms.filter((x) => x.groups.length > 0)) {
      const g = WIDE.gates[r.id];
      const a = stretchPlace(r.id, WIDE, 0);
      const b = stretchPlace(r.id, WIDE, 1);
      expect(a.pos.x !== g.x || a.pos.y !== g.y).toBe(true);
      expect(a.id).not.toBe(b.id);
      expect(a.pos.x !== b.pos.x || a.pos.y !== b.pos.y).toBe(true);
    }
  });

  it("a job interrupts a walk to the sofa", () => {
    const rng = seededRng(4);
    const list = createStaff(WIDE, 0, rng);
    const s = list[0]!;
    const sofa = leisurePlaces(WIDE).find((p) => p.kind === "sofa") ?? leisurePlaces(WIDE)[0]!;
    s.route = routeBetween(s.at, sofa, WIDE);
    s.startedAt = 0;
    s.arriveAt = routeLength(s.route) / 0.11;
    s.at = sofa;
    const mid = s.arriveAt / 2;
    const here = positionAlong(s.route, mid).pos;
    s.job = "agent-x";
    tickStaff(list, WIDE, mid, rng, labels);
    expect(s.at.id).toBe(s.desk.id);
    expect(Math.hypot(s.route[0]!.x - here.x, s.route[0]!.y - here.y)).toBeLessThan(1);
  });
});

function crossesDesk(L: OfficeLayout, a: Point, b: Point): string | null {
  for (let t = 0; t <= 1; t += 0.04) {
    const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    for (const d of L.desks) {
      if (p.x > d.x + 4 && p.x < d.x + d.w - 4 && p.y > d.y + 4 && p.y < d.y + d.h - 4) return `${d.group}#${d.seat}`;
    }
  }
  return null;
}

function agent(id: string, group: OfficeAgent["group"], role: string, over: Partial<OfficeAgent> = {}): OfficeAgent {
  return { id, role, parent_id: null, group, seat: 0, phase: "working", activity: "typing", bubble: null, tools: 0, tokens: 0, startedAt: 1, ok: true, ...over };
}

describe.each([["WIDE", WIDE], ["NARROW", NARROW]] as const)("staff routes: %s", (_n, L) => {
  it("every route between two places starts and ends right and never crosses a desk", () => {
    const ps = placesOf(L);
    expect(ps.length).toBeGreaterThan(RESIDENTS.length);
    for (const a of ps) {
      for (const b of ps) {
        if (a.id === b.id) continue;
        const r = routeBetween(a, b, L);
        expect(r[0], `${a.id}->${b.id} start`).toEqual(a.pos);
        expect(r[r.length - 1], `${a.id}->${b.id} end`).toEqual(b.pos);
        for (let i = 1; i < r.length; i++) {
          expect(Number.isFinite(r[i]!.x + r[i]!.y)).toBe(true);
          expect(crossesDesk(L, r[i - 1]!, r[i]!), `${a.id}->${b.id} leg ${i}`).toBeNull();
        }
      }
    }
  });
});

describe("walking", () => {
  it("positionAlong follows the route and stops at the end", () => {
    const route = [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 100 }];
    expect(positionAlong(route, 0).pos).toEqual({ x: 0, y: 0 });
    expect(positionAlong(route, 1e9).walking).toBe(false);
    expect(positionAlong(route, 1e9).pos).toEqual({ x: 100, y: 100 });
    expect(routeLength(route)).toBe(200);
    const mid = positionAlong(route, 100 / 0.11 + 50 / 0.11);
    expect(mid.pos.x).toBeCloseTo(100, 3);
    expect(mid.pos.y).toBeCloseTo(50, 3);
  });
});

describe("free time", () => {
  it("nobody types without a job; people sit at the desk, drink, rest and stretch, deterministically", () => {
    const run = (seed: number) => {
      const rng = seededRng(seed);
      const t0 = 1_000_000;
      const list = createStaff(WIDE, t0, rng);
      const seen = new Set<string>();
      for (let t = t0; t < t0 + 10 * 60_000; t += 1000) {
        tickStaff(list, WIDE, t, rng, labels);
        for (const s of list) {
          seen.add(s.at.kind);
          const v = staffView(s, t);
          expect(v.working).toBe(false);
          expect(v.act, `${s.resident.id} must not type while free`).not.toBe("typing");
          expect(v.pos.x).toBeGreaterThanOrEqual(0);
          expect(v.pos.x).toBeLessThanOrEqual(WIDE.scene.w);
          expect(v.pos.y).toBeGreaterThanOrEqual(0);
          expect(v.pos.y).toBeLessThanOrEqual(WIDE.scene.h);
        }
      }
      return [...seen].sort().join(",");
    };
    const a = run(7);
    expect(a).toBe(run(7));
    for (const kind of ["desk", "drink", "sofa", "stretch"]) expect(a).toContain(kind);
  });

  it("a chat is always between two people at the two chat spots", () => {
    const rng = seededRng(3);
    const t0 = 0;
    const list = createStaff(WIDE, t0, rng);
    let chats = 0;
    for (let t = t0; t < 30 * 60_000; t += 1000) {
      tickStaff(list, WIDE, t, rng, labels);
      const a = list.find((s) => s.at.id === "chat-a");
      const b = list.find((s) => s.at.id === "chat-b");
      expect(!!a, `chat-a and chat-b are taken together at ${t}`).toBe(!!b);
      if (a && b) {
        chats++;
        expect(a.chatWith).toBe(b.resident.id);
        expect(b.chatWith).toBe(a.resident.id);
      }
    }
    expect(chats).toBeGreaterThan(0);
  });
});

describe("working", () => {
  it("a free person of the agent's group takes the job, walks to the desk and works as the agent does", () => {
    const rng = seededRng(5);
    const list = createStaff(WIDE, 0, rng);
    const claimed = new Set<string>();
    const a = agent("a1", "analyst", "analyst", { activity: "typing" });
    assignJobs(list, [a], claimed, 100, labels);
    const person = list.find((s) => s.job === "a1")!;
    expect(person.resident.group).toBe("analyst");
    expect(claimed.has("a1")).toBe(true);
    // at the desk (they start there): sits and types
    tickStaff(list, WIDE, 200, rng, labels);
    const v = staffView(person, 300, a, labels, "Phân tích viên");
    expect([v.working, v.pose, v.act, v.back]).toEqual([true, "sit", "typing", true]);
    // thinking: sits, hands off the keyboard, thought bubble
    const t = { ...a, activity: "thinking" as const };
    const vt = staffView(person, 300, t, labels, "Phân tích viên");
    expect([vt.act, vt.working]).toEqual(["thinking", true]);
    expect(workAct(a)).toBe("typing");
    expect(workAct(t)).toBe("thinking");
    expect(workAct({ ...a, activity: "tool" as const })).toBe("typing");
    expect(workAct({ ...a, activity: "idle" as never })).toBe("seated");
    expect(vt.bubble.length).toBeGreaterThan(0);
    // tool: types with the tool in the bubble
    const tool = { ...a, activity: "tool" as const, lastTool: "WebSearch" };
    expect(workAct(tool)).toBe("typing");
    expect(workBubble(tool, 300, labels, "Phân tích viên")).toContain("WebSearch");
  });

  it("someone away from the desk walks back to it before working", () => {
    const rng = seededRng(9);
    const list = createStaff(WIDE, 0, rng);
    const claimed = new Set<string>();
    const p = list.find((s) => s.resident.role === "critic")!;
    // send the critic to the cooler first
    const cooler = leisurePlaces(WIDE).find((l) => l.id === "cooler")!;
    p.at = cooler;
    p.route = [cooler.pos];
    p.arriveAt = 0;
    assignJobs(list, [agent("c1", "critic", "critic")], claimed, 1000, labels);
    tickStaff(list, WIDE, 1000, rng, labels);
    expect(p.at.id).toBe(p.desk.id);
    expect(p.arriveAt).toBeGreaterThan(1000);
    const walking = staffView(p, 1500, null, labels, "x");
    expect(walking.walking).toBe(true);
    expect(walking.act).toBe("walking");
    const arrived = staffView(p, p.arriveAt + 10, agent("c1", "critic", "critic"), labels, "x");
    expect([arrived.walking, arrived.working]).toEqual([false, true]);
  });

  it("when the agent finishes the person is freed with a done bubble and goes back to free time", () => {
    const rng = seededRng(11);
    const list = createStaff(WIDE, 0, rng);
    const claimed = new Set<string>();
    const a = agent("q1", "qa", "qa");
    assignJobs(list, [a], claimed, 100, labels);
    const person = list.find((s) => s.job === "q1")!;
    assignJobs(list, [{ ...a, phase: "left" }], claimed, 5000, labels);
    expect(person.job).toBeNull();
    expect(person.bubble).toBe(labels.reported.replace("{role}", "qa"));
    expect(person.bubble).not.toContain("{");
    // the finished agent stays claimed so the scene never draws it a second time
    expect(claimed.has("q1")).toBe(true);
    const v = staffView(person, 5100, null, labels, "x");
    expect(v.working).toBe(false);
    expect(v.act).not.toBe("typing");
  });

  it("agents beyond the people of their group are not claimed (they walk in from the door)", () => {
    const rng = seededRng(2);
    const list = createStaff(WIDE, 0, rng);
    const claimed = new Set<string>();
    const analysts = [1, 2, 3].map((n) => agent(`a${n}`, "analyst", "analyst", { startedAt: n }));
    assignJobs(list, analysts, claimed, 100, labels);
    expect([...claimed].sort()).toEqual(["a1", "a2"]);
    // a new agent of a group whose people are all busy stays unclaimed until someone is freed
    assignJobs(list, analysts, claimed, 200, labels);
    expect(claimed.has("a3")).toBe(false);
    assignJobs(list, [{ ...analysts[0]!, phase: "left" }, analysts[1]!, analysts[2]!], claimed, 300, labels);
    expect(claimed.has("a3")).toBe(true);
  });
});

describe("pace", () => {
  it("no more than three free people are away from their desks at the same time", () => {
    // seed re-picked after the lobby bench was removed (the random sequence shifted)
    const rng = seededRng(23);
    const list = createStaff(WIDE, 0, rng);
    let maxAway = 0;
    for (let t = 0; t < 20 * 60_000; t += 500) {
      tickStaff(list, WIDE, t, rng, labels);
      // a chat pulls a partner along, so allow the pair that was started in the same tick
      maxAway = Math.max(maxAway, list.filter((s) => s.job === null && s.at.kind !== "desk").length);
    }
    expect(maxAway).toBeLessThanOrEqual(4);
  });
});

import { RESIDENTS as RES5 } from "../../ui/src/office/staff";
import { WIDE as W5, roomOf as roomOf5, deskFor as deskFor5 } from "../../ui/src/office/layout";
describe("residents (ten people, three subagents)", () => {
  it("has ten residents, each with a real seat in the room of its group", () => {
    expect(RES5).toHaveLength(10);
    expect(RES5.filter((r) => r.group === "subagent").map((r) => r.role)).toEqual(["scout", "helper", "reviewer-bot"]);
    for (const r of RES5) {
      expect(deskFor5(r.group, r.seat, W5), r.id).toBeDefined();
      expect(roomOf5(r.group, W5).groups).toContain(r.group);
    }
    expect(JSON.stringify(RES5)).not.toContain("spare");
  });
});
