import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { OfficeScene25D } from "../../ui/src/components/office/OfficeScene25D.js";
import { NARROW } from "../../ui/src/office/layout.js";
import type { OfficeAgent } from "../../ui/src/office/model.js";
import { createScene, DEFAULT_ROLES, finishAgent, isoLabelsFrom, summon, tickScene, type IsoScene } from "../../ui/src/office/iso/scene.js";
import { FURN } from "../../ui/src/office/iso/grid.js";

const labels = isoLabelsFrom({
  iso_drink: "drink", iso_coffee: "coffee", iso_rest: "rest|relax", iso_sleep: "nap", iso_stretch: "stretch",
  iso_phone: "phone", iso_chat: "chat", iso_read: "read", iso_summoned: "{role}: assigned",
  iso_work: "{role}: working", iso_work_tool: "{role}: {tool}", iso_reported: "{role} done", iso_verdict: "{role}: {verdict}", iso_run_done: "done",
});

function lcg(seed: number): () => number {
  let x = seed >>> 0;
  return () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
const snap = (s: IsoScene): string => JSON.stringify(s.agents.map((a) => [a.id, a.act, a.pos.u.toFixed(2), a.pos.v.toFixed(2), a.bubble]));
function run(seed: number, ticks: number): IsoScene {
  const rng = lcg(seed);
  const s = createScene(DEFAULT_ROLES, rng, labels);
  for (let i = 0; i < ticks; i++) tickScene(s, 0.1, rng);
  return s;
}

describe("iso scene tick (no run)", () => {
  it("is deterministic for a fixed rng", () => {
    expect(snap(run(7, 600))).toBe(snap(run(7, 600)));
    expect(snap(run(7, 600))).not.toBe(snap(run(8, 600)));
  });
  it("starts with every agent seated at their own desk, one desk per role", () => {
    const s = createScene(DEFAULT_ROLES, lcg(1), labels);
    expect(s.agents.length).toBe(DEFAULT_ROLES.length + 1);
    DEFAULT_ROLES.forEach((r, i) => {
      const a = s.agents.find((x) => x.role === r)!;
      expect(a.pos).toEqual({ u: FURN.desk(i).seat.u, v: FURN.desk(i).seat.v });
      expect(a.pose).toBe("sit");
    });
    expect(s.overflow).toBe(false);
  });
  it("some agent takes a break and nobody stays away from the desk for long", () => {
    const rng = lcg(3);
    const s = createScene(DEFAULT_ROLES, rng, labels);
    let sawBreak = false;
    const away = new Map<string, number>();
    let maxAway = 0;
    for (let i = 0; i < 6000; i++) {
      tickScene(s, 0.1, rng);
      for (const a of s.agents) {
        const atSeat = Math.hypot(a.pos.u - a.seat.u, a.pos.v - a.seat.v) < 0.2;
        if (!a.isCoord && ["drinking", "cooking", "resting", "sleeping", "talking"].includes(a.act)) sawBreak = true;
        away.set(a.id, atSeat ? 0 : (away.get(a.id) ?? 0) + 1);
        maxAway = Math.max(maxAway, away.get(a.id)!);      }
    }
    expect(sawBreak).toBe(true);
    // Breaks chain randomly (as in the mock), so a long absence is possible but must stay bounded (2 min simulated).
    expect(maxAway).toBeLessThan(1200);
  });
  it("a working agent never goes on a break", () => {
    const rng = lcg(5);
    const s = createScene(DEFAULT_ROLES, rng, labels);
    const a = s.agents.find((x) => x.role === "implementer")!;
    summon(s, a);
    let working = false;
    for (let i = 0; i < 3000; i++) {
      tickScene(s, 0.1, rng);
      if (a.state === "working") {
        working = true;
        expect(a.act).toBe("typing");
        expect(a.leisure).toBe("");
        expect(a.pos).toEqual({ u: a.seat.u, v: a.seat.v });
      }
    }
    expect(working).toBe(true);
  });
  it("no two agents hold the same break spot (cooler, kitchen, sofa)", () => {
    const rng = lcg(11);
    const s = createScene(DEFAULT_ROLES, rng, labels);
    for (let i = 0; i < 8000; i++) {
      tickScene(s, 0.1, rng);
      for (const g of ["cooler", "kitchen", "sofa"]) {
        expect(s.agents.filter((a) => a.mode === "free" && a.goal === g).length).toBeLessThanOrEqual(1);
      }
    }
  });
  it("queues simultaneous summons at the coordinator spot and finishes both", () => {
    const rng = lcg(2);
    const s = createScene(DEFAULT_ROLES, rng, labels);
    const [a, b] = [s.agents[1], s.agents[2]];
    summon(s, a); summon(s, b);
    expect(b.mode).toBe("queued");
    for (let i = 0; i < 1500; i++) tickScene(s, 0.1, rng);
    expect(a.state).toBe("working");
    expect(b.state).toBe("working");
    expect(a.screenOn && b.screenOn).toBe(true);
    finishAgent(s, a);
    for (let i = 0; i < 600; i++) tickScene(s, 0.1, rng);
    expect(a.state).toBe("idle");
    expect(a.screenOn).toBe(false);
  });
  it("more roles than desks: flags overflow and extras wait standing", () => {
    const roles = ["a", "b", "c", "d", "e", "f", "g", "h"];
    const s = createScene(roles, lcg(1), labels);
    expect(s.overflow).toBe(true);
    expect(s.agents.length).toBe(9);
    const extra = s.agents.find((x) => x.role === "h")!;
    expect(extra.pose).toBe("stand");
    const rng = lcg(1);
    summon(s, extra);
    for (let i = 0; i < 1500; i++) tickScene(s, 0.1, rng);
    expect(extra.state).toBe("working");
  });
});

describe("OfficeScene25D extra staff", () => {
  const mk = (n: number): OfficeAgent[] => Array.from({ length: n }, (_, i) => ({ id: `e${i}`, role: "scout", parent_id: null, group: "subagent", seat: i, phase: "working", activity: "typing", bubble: null, tools: 0, tokens: 0, startedAt: Date.now() + i, ok: true }) as OfficeAgent);
  const html = (agents: OfficeAgent[], residents: boolean, layout?: typeof NARROW) => renderToStaticMarkup(createElement(OfficeScene25D, { agents, running: true, residents, ...(layout ? { layout } : {}) }));
  const count = (h: string, re: RegExp) => (h.match(re) ?? []).length;

  it("a 4th subagent in a full group comes in as an extra person and is not drawn twice", () => {
    const h = html(mk(4), true);
    expect(count(h, /data-staff="ext-subagent-/g)).toBe(1);
    expect(count(h, /agent-fig/g)).toBe(0);
  });

  it("agents beyond MAX_EXTRAS_PER_GROUP are still drawn as walking-in agents", () => {
    const h = html(mk(7), true);
    expect(count(h, /data-staff="ext-subagent-/g)).toBe(3);
    expect(count(h, /agent-fig/g)).toBe(1);
  });

  it("residents=false creates no extra people", () => {
    expect(html(mk(4), false)).not.toContain('data-staff="ext-');
  });

  it("NARROW does not throw", () => {
    const g = globalThis as unknown as { matchMedia?: unknown };
    g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    try {
      expect(() => html(mk(4), true, NARROW)).not.toThrow();
    } finally {
      delete g.matchMedia;
    }
  });
});
