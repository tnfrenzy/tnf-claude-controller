import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeScene25D } from "../../ui/src/components/office/OfficeScene25D.js";
import { buildSteps, NARROW, roomOf, segmentMs, spotFor, WIDE, type OfficeLayout } from "../../ui/src/office/layout.js";
import type { OfficeAgent } from "../../ui/src/office/model.js";

const g = globalThis as unknown as { matchMedia?: unknown };

afterEach(() => {
  delete g.matchMedia;
});

function render(agents: OfficeAgent[] = [], running = false, layout?: OfficeLayout): string {
  return renderToStaticMarkup(createElement(OfficeScene25D, { agents, running, residents: false, ...(layout ? { layout } : {}) }));
}

function agent(over: Partial<OfficeAgent> = {}): OfficeAgent {
  return {
    id: "a1",
    role: "analyst",
    parent_id: null,
    group: "analyst",
    seat: 0,
    phase: "working",
    activity: "typing",
    bubble: null,
    tools: 0,
    tokens: 0,
    startedAt: Date.now(),
    ok: true,
    ...over,
  };
}

function chairIds(html: string): string[] {
  // Each chair is a wrapper with its group-seat id plus the "base" and "back" parts of the isometric chair.
  return [...new Set([...html.matchAll(/data-chair="([^"]+)"/g)].map((m) => m[1]!))].filter((id) => id !== "base" && id !== "back");
}

describe("OfficeScene25D desk chairs", () => {
  it("WIDE draws one data-chair per desk with group-seat ids", () => {
    const ids = chairIds(render());
    expect(ids.length).toBe(WIDE.desks.length);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toContain("coordinator-0");
    expect(ids).toContain("analyst-5");
  });

  it("draws connecting floor (.iso4-gap) for WIDE and NARROW", () => {
    expect(render()).toContain("iso4-gap");
    g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    expect(render([], false, NARROW)).toContain("iso4-gap");
  });

  it("NARROW draws one data-chair per desk (fake matchMedia)", () => {
    g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    const ids = chairIds(render([], false, NARROW));
    expect(ids.length).toBe(NARROW.desks.length);
    expect(ids).toContain("analyst-4");
  });

});

function figs(html: string): string[] {
  return html.match(/<g class="agent-fig[\s\S]*?(?=<g class="agent-fig|<\/svg>)/g) ?? [];
}

describe("OfficeScene25D agents use the isometric IsoPerson", () => {
  it("working agent renders one char, no circle body/initial/halo, labels and bubble kept", () => {
    const html = render([agent({ tools: 2, bubble: { kind: "text", text: "xin chào", ts: Date.now() } as never })], true);
    const [fig] = figs(html);
    expect(fig).toBeDefined();
    expect((fig!.match(/data-role="/g) ?? []).length).toBe(1);
    expect(fig).toContain('data-role="analyst"');
    expect(fig).toContain('data-act="walking"');
    expect(fig).toMatch(/y="36"[^>]*class="agent-name"|class="agent-name"[^>]*y="36"/);
    expect(fig).toContain('y="-96"');
    expect(fig).toContain("transform 0ms linear, opacity .6s");
  });

  it("left agent stays visible during linger and disappears after", () => {
    const left = (ago: number) => agent({ phase: "left", activity: "idle", finishedAt: Date.now() - ago });
    expect(render([left(5000)])).toContain('class="agent-fig left');
    expect(render([left(10000)])).not.toContain('class="agent-fig');
  });
});

describe("OfficeScene25D shows every running agent (desks and standby)", () => {
  const GROUPS = ["coordinator", "analyst", "critic", "implementer", "qa"] as const;
  const dist = (a: { x: number; y: number }, b: { x: number; y: number }) => Math.hypot(a.x - b.x, a.y - b.y);
  const inRect = (p: { x: number; y: number }, r: { x: number; y: number; w: number; h: number }, slackY = 0) =>
    p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h + slackY;

  function check(list: OfficeAgent[], layout: typeof WIDE) {
    const html = render(list, true, layout);
    const fs = figs(html);
    expect(fs.length).toBe(list.length);
    expect((html.match(/data-role="/g) ?? []).length).toBe(list.length);
    for (const f of fs) expect((f.match(/class="agent-name"/g) ?? []).length).toBe(1);
    for (const grp of new Set(list.map((a) => a.group))) {
      const n = list.filter((a) => a.group === grp).length;
      expect((html.match(new RegExp(`data-role="${grp}"`, "g")) ?? []).length).toBe(n);
    }
    const spots = list.map((a) => ({ a, p: spotFor(a.group, a.seat, layout) }));
    for (const { a, p } of spots) {
      const room = roomOf(a.group, layout);
      expect(inRect(p, room), `${a.group}-${a.seat} inside room`).toBe(true);
    }
    for (let i = 0; i < spots.length; i++) {
      for (let j = i + 1; j < spots.length; j++) {
        const x = spots[i]!;
        const y = spots[j]!;
        const sameGroup = x.a.group === y.a.group;
        const sameRoom = roomOf(x.a.group, layout).id === roomOf(y.a.group, layout).id;
        if (!sameRoom) continue;
        // same group 24 px; different groups sharing a room 20 px (see layout standby numbers)
        expect(dist(x.p, y.p), `${x.a.group}-${x.a.seat} vs ${y.a.group}-${y.a.seat}`).toBeGreaterThanOrEqual(sameGroup ? 24 : 20);
      }
    }
  }

  const layouts: Array<[string, typeof WIDE, boolean]> = [["WIDE", WIDE, false], ["NARROW", NARROW, true]];
  for (const [name, layout, narrow] of layouts) {
    const setup = () => {
      if (narrow) g.matchMedia = () => ({ matches: true, addEventListener() {}, removeEventListener() {} });
    };
    it(`${name}: three agents in each of the five groups all render`, () => {
      setup();
      const list: OfficeAgent[] = [];
      for (const grp of GROUPS) for (let s = 0; s < 3; s++) list.push(agent({ id: `${grp}-${s}`, role: grp, group: grp, seat: s }));
      check(list, layout);
    });
    it(`${name}: implementer seats 0..7 and analyst seats 0..8 (out of desks) render in the right room`, () => {
      setup();
      const list: OfficeAgent[] = [];
      for (let s = 0; s < 8; s++) list.push(agent({ id: `impl-${s}`, role: "implementer", group: "implementer", seat: s }));
      for (let s = 0; s < 9; s++) list.push(agent({ id: `an-${s}`, role: "analyst", group: "analyst", seat: s }));
      check(list, layout);
      const nDesks = layout.desks.filter((d) => d.group === "implementer").length;
      for (let s = nDesks; s < 8; s++) {
        expect(inRect(spotFor("implementer", s, layout), layout.standby[roomOf("implementer", layout).id], layout.standbyStagger), `impl-${s} standby`).toBe(true);
      }
    });
  }
});

describe("buildSteps", () => {
  const route = [{ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 300, y: 300 }, { x: 600, y: 300 }];
  it("walks in with cumulative at", () => {
    const s = buildSteps(route, 0, "in");
    expect(s.map((x) => x.p)).toEqual(route.slice(1));
    expect(s[0]!.at).toBe(0);
    expect(s[1]!.at).toBe(s[0]!.ms);
    expect(s[2]!.at).toBe(s[0]!.ms + s[1]!.ms);
    expect(s[0]!.ms).toBe(segmentMs(route[0]!, route[1]!));
  });
  it("walks out from the end, mid-way and from the door", () => {
    const end = buildSteps(route, 3, "out");
    expect(end[0]!.p).toEqual(route[2]);
    expect(end.at(-1)!.p).toEqual(route[0]);
    expect(end[0]!.ms).toBe(segmentMs(route[3]!, route[2]!));
    expect(buildSteps(route, 2, "out")[0]!.p).toEqual(route[1]);
    expect(buildSteps(route, 0, "out")).toEqual([]);
  });
});

describe("OfficeScene25D walls and doors", () => {
  it("draws a floor, walls, a room label and a doorway per link in 2.5D", () => {
    const html = render();
    expect((html.match(/data-room="/g) ?? []).length).toBe(WIDE.rooms.length);
    expect(html).toContain("iso4-wall");
    expect(html).not.toContain("data-room-label");
    expect(html).not.toContain("door-label");
    expect(html).not.toContain("empty-hint");
    expect((html.match(/data-link="/g) ?? []).length).toBe(WIDE.links.length);
  });
});
