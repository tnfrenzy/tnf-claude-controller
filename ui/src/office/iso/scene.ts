// Pure state machine for the isometric office (ported from docs/design/single-screen.html 329-372:
// goTo/setAct/leisure/assign/tickEnv). No DOM, no React, no Math.random/Date.now:
// randomness comes from an injected `rng`, time from the `dt` passed to tickScene.
import { buildGrid, findPath, FURN, isFree, MAX_DESKS, type Grid, type Pt, type Spot } from "./grid.js";

export type Rng = () => number;
export type IsoState = "idle" | "summoned" | "working" | "reporting" | "done";
export type Act = "seated" | "typing" | "walking" | "talking" | "drinking" | "cooking" | "resting" | "sleeping" | "stretch" | "phone" | "idle" | "happy";
export type Pose = "stand" | "sit" | "sofa" | "lie";

/** All visible text of the scene. `{role}`, `{tool}`, `{verdict}` are substituted. Lists are alternatives. */
export interface IsoLabels {
  drink: string; coffee: string; rest: string[]; sleep: string; stretch: string;
  phone: string[]; chat: string[]; read: string[];
  summoned: string; work: string; workTool: string; reported: string; verdict: string; runDone: string;
}

/** Build labels from i18n dictionary keys `iso_*` (lists separated by "|"). */
export function isoLabelsFrom(t: Record<string, string>): IsoLabels {
  const list = (k: string): string[] => (t[k] ?? "").split("|");
  return {
    drink: t.iso_drink ?? "", coffee: t.iso_coffee ?? "", rest: list("iso_rest"), sleep: t.iso_sleep ?? "", stretch: t.iso_stretch ?? "",
    phone: list("iso_phone"), chat: list("iso_chat"), read: list("iso_read"),
    summoned: t.iso_summoned ?? "", work: t.iso_work ?? "", workTool: t.iso_work_tool ?? "", reported: t.iso_reported ?? "",
    verdict: t.iso_verdict ?? "", runDone: t.iso_run_done ?? "",
  };
}
export const fill = (s: string, v: Record<string, string>): string => s.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? "");

/** Default roles for the idle (no run) office. */
export const DEFAULT_ROLES = ["analyst", "planner", "critic", "implementer", "qa", "debug"];
export const SPEED = 1.5;
const COORD = "coordinator";

export interface IsoAgent {
  id: string; role: string; state: IsoState;
  pos: Pt; path: Pt[]; bubble: string; screenOn: boolean; leisure: string;
  act: Act; pose: Pose; face: 1 | -1; back: boolean; timer: number;
  seat: Spot; sits: boolean; isCoord: boolean;
  mode: "free" | "queued" | "assigned" | "working" | "reporting";
  goal: string; active: number; pendingFinish: boolean; tool: string; toolBubble: string; verdict: string;
  then: (() => void) | null; endFace: 1 | -1 | 0; endBack: boolean;
}

export interface IsoScene {
  agents: IsoAgent[];
  grid: Grid;
  rng: Rng;
  labels: IsoLabels;
  /** True while a run drives the scene: free agents stay at their desk instead of wandering. */
  live: boolean;
  /** More roles than desks: extras have no desk and wait standing at a waiting spot. */
  overflow: boolean;
  /** run agent_id -> scene agent. Two turns of the same role share the same desk/agent (see events.ts rule). */
  idMap: Map<string, IsoAgent>;
  /** The coordinator side spot holds one agent at a time; the others queue (the mock assumed sequential runs). */
  slot: string | null;
  queue: Array<() => void>;
}

const pick = <T,>(rng: Rng, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]!;
const rnd = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);
const word = (rng: Rng, list: string[]): string => (list.length ? pick(rng, list) : "");

function mk(id: string, role: string, seat: Spot, sits: boolean, isCoord: boolean): IsoAgent {
  return {
    id, role, state: "idle", pos: { u: seat.u, v: seat.v }, path: [], bubble: "", screenOn: false, leisure: "",
    act: "seated", pose: sits ? "sit" : "stand", face: seat.face, back: !!seat.back, timer: 0,
    seat, sits, isCoord, mode: "free", goal: "desk", active: 0, pendingFinish: false, tool: "", toolBubble: "", verdict: "",
    then: null, endFace: 0, endBack: false,
  };
}

export function createScene(roles: string[], rng: Rng, labels: IsoLabels): IsoScene {
  const uniq = roles.filter((r, i) => r && r !== COORD && roles.indexOf(r) === i);
  const withDesk = uniq.slice(0, MAX_DESKS);
  const agents: IsoAgent[] = [mk(COORD, COORD, FURN.coordSeat, true, true)];
  withDesk.forEach((r, i) => agents.push(mk(r, r, FURN.desk(i).seat, true, false)));
  // Overflow roles: no desk, they wait on the row between the coordinator and the desks.
  uniq.slice(MAX_DESKS).forEach((r, k) => agents.push(mk(r, r, { u: 5.3 + k * 0.9, v: 3.15, face: -1 }, false, false)));
  const scene: IsoScene = {
    agents, grid: buildGrid(withDesk.length), rng, labels, live: false, overflow: uniq.length > MAX_DESKS,
    idMap: new Map([[COORD, agents[0]!]]), slot: null, queue: [],
  };
  agents.forEach((a) => {
    if (a.isCoord) { a.act = "typing"; a.timer = Infinity; a.screenOn = true; return; }
    a.timer = rnd(rng, 2, 10); // stagger first breaks
  });
  return scene;
}

function setAct(s: IsoScene, a: IsoAgent, act: Act, secs: number, mood = "", pose: Pose = "stand", face?: 1 | -1, back = false): void {
  a.act = act; a.timer = secs; a.bubble = mood; a.pose = pose; a.back = back; a.path = [];
  if (face) a.face = face;
  void s;
}

/** Walk to `t`; with `must` an unreachable target warps instead (state transitions must never stall). */
function goTo(s: IsoScene, a: IsoAgent, t: Spot, then: () => void, must = false): boolean {
  const p = findPath(s.grid, a.pos, t);
  if (!p) {
    if (!must) { setAct(s, a, "idle", 1); return false; }
    a.pos = { u: t.u, v: t.v }; a.path = []; a.then = null; then(); return true;
  }
  a.path = p; a.then = then; a.act = "walking"; a.pose = "stand"; a.back = false; a.bubble = "";
  a.endFace = t.face; a.endBack = !!t.back;
  return true;
}

const seatedAct = (a: IsoAgent): Pose => (a.sits ? "sit" : "stand");

function takenBy(s: IsoScene, a: IsoAgent, goal: string): boolean {
  return s.agents.some((b) => b !== a && b.goal === goal && b.mode === "free");
}

function freeSpotNear(s: IsoScene, u: number, v: number): Pt | null {
  const offs: Array<[number, number]> = [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.9, 0.9], [-0.9, -0.9]];
  for (const [du, dv] of offs) if (isFree(s.grid, u + du, v + dv)) return { u: u + du, v: v + dv };
  return null;
}

export function leisure(s: IsoScene, a: IsoAgent): void {
  const { rng, labels: L } = s;
  a.state = "idle"; a.screenOn = false; a.leisure = "";
  const atSeat = a.pose === "sit" && Math.abs(a.pos.u - a.seat.u) < 0.1;
  const backToSeat = (): void => { a.goal = "desk"; goTo(s, a, a.seat, () => { setAct(s, a, "seated", rnd(rng, 8, 16), "", seatedAct(a), a.seat.face, !!a.seat.back); }); };
  if (s.live) { // during a run free agents just sit tight
    if (atSeat || !a.sits) { a.goal = "desk"; setAct(s, a, "seated", rnd(rng, 6, 14), "", seatedAct(a), a.seat.face, !!a.seat.back); } else backToSeat();
    return;
  }
  const others = s.agents.filter((b) => b !== a && b.mode === "free" && b.act !== "walking" && b.pose === "stand");
  const sofaBusy = takenBy(s, a, "sofa");
  const c = atSeat ? pick(rng, ["desk", "desk", "cooler", "sofa", "kitchen", "stretch", "chat", "wander", "phone"])
    : pick(rng, ["desk", "desk", "desk", "cooler", "kitchen", "chat", "phone"]);
  a.goal = c;
  if (c === "desk") {
    if (atSeat) setAct(s, a, "seated", rnd(rng, 6, 14), rng() < 0.3 ? word(rng, L.read) : "", "sit", 1, true);
    else backToSeat();
  } else if (c === "cooler" && !takenBy(s, a, "cooler")) {
    a.leisure = "cooler"; goTo(s, a, FURN.coolerSpot, () => setAct(s, a, "drinking", rnd(rng, 2.5, 4), L.drink, "stand", -1));
  } else if (c === "sofa" && !sofaBusy) {
    const lie = rng() < 0.25; a.leisure = "sofa";
    goTo(s, a, lie ? FURN.sofaLie : FURN.sofaSit, () => setAct(s, a, lie ? "sleeping" : "resting", rnd(rng, 6, 10), lie ? L.sleep : word(rng, L.rest), lie ? "lie" : "sofa", -1));
  } else if (c === "kitchen" && !takenBy(s, a, "kitchen")) {
    a.leisure = "kitchen"; goTo(s, a, FURN.coffeeSpot, () => setAct(s, a, "cooking", rnd(rng, 4, 6), L.coffee, "stand", 1, true));
  } else if (c === "stretch") {
    a.leisure = "stretch"; setAct(s, a, "stretch", rnd(rng, 2, 3), L.stretch, atSeat ? "sit" : "stand", atSeat ? 1 : undefined, atSeat);
  } else if (c === "phone") {
    a.leisure = "phone"; setAct(s, a, "phone", rnd(rng, 3, 5), word(rng, L.phone), a.pose, a.face, a.back);
  } else if (c === "chat" && others.length) {
    const o = pick(rng, others); const sp = freeSpotNear(s, o.pos.u, o.pos.v);
    if (sp) {
      const side: 1 | -1 = sp.u > o.pos.u ? 1 : -1; a.leisure = "chat";
      goTo(s, a, { ...sp, face: (-side) as 1 | -1 }, () => {
        setAct(s, a, "talking", rnd(rng, 3, 5), word(rng, L.chat), "stand", (-side) as 1 | -1); o.face = side;
        if (o.act === "idle") setAct(s, o, "talking", 3, "", "stand", side);
      });
    } else setAct(s, a, "idle", 1.5);
  } else if (c === "wander") {
    let t: Spot | null = null;
    for (let k = 0; k < 8 && !t; k++) { const u = rnd(rng, 1.2, 8.4); const v = pick(rng, FURN.lanes) + rnd(rng, -0.2, 0.2); if (isFree(s.grid, u, v)) t = { u, v, face: pick(rng, [1, -1] as const) }; }
    a.leisure = "wander";
    if (t) goTo(s, a, t, () => setAct(s, a, "idle", rnd(rng, 1.5, 3.5))); else setAct(s, a, "idle", 1.5);
  } else { a.goal = "desk"; setAct(s, a, "idle", 1.5); }
  if (a.goal !== "desk" && a.act === "walking") a.state = "idle";
}

// ---- coordinator slot (queue) -------------------------------------------------------------

function releaseSlot(s: IsoScene, a: IsoAgent): void {
  if (s.slot !== a.id) return;
  s.slot = null;
  const next = s.queue.shift();
  if (next) next();
}

function withSlot(s: IsoScene, a: IsoAgent, fn: () => void): void {
  const run = (): void => { s.slot = a.id; fn(); };
  if (s.slot === null) run(); else { a.mode = "queued"; s.queue.push(run); }
}

const coordTalk = (s: IsoScene, text: string): void => {
  const c = s.agents[0]!; c.bubble = text; c.act = "talking"; c.timer = 2; c.face = 1;
};

/** Summon an agent: coordinator side, then the own desk where it works until `finishAgent`. */
export function summon(s: IsoScene, a: IsoAgent): void {
  if (a.isCoord) return;
  a.active++;
  if (a.mode !== "free" && a.mode !== "reporting") { return; } // already on the way / working: shared desk, just counted
  a.mode = "assigned"; a.pendingFinish = false; a.verdict = ""; a.state = "summoned"; a.goal = "work"; a.leisure = "";
  const { labels: L } = s;
  withSlot(s, a, () => {
    a.mode = "assigned"; a.state = "summoned";
    goTo(s, a, FURN.coordSide, () => {
      setAct(s, a, "talking", 1.8, fill(L.summoned, { role: a.role }), "stand", -1);
      coordTalk(s, fill(L.summoned, { role: a.role }));
      a.then = () => {
        releaseSlot(s, a);
        goTo(s, a, a.seat, () => {
          a.mode = "working"; a.state = "working"; a.screenOn = true;
          setAct(s, a, "typing", Infinity, workBubble(s, a), seatedAct(a), a.seat.face, !!a.seat.back);
          if (a.pendingFinish) { a.pendingFinish = false; report(s, a); }
        }, true);
      };
    }, true);
  });
}

export function workBubble(s: IsoScene, a: IsoAgent): string {
  return a.tool ? fill(s.labels.workTool, { role: a.role, tool: a.tool }) : fill(s.labels.work, { role: a.role });
}

/** Agent finished: report to the coordinator, then idle. */
export function finishAgent(s: IsoScene, a: IsoAgent): void {
  if (a.isCoord) return;
  a.active = Math.max(0, a.active - 1);
  if (a.active > 0) return; // another turn of the same role is still running
  if (a.mode === "working") report(s, a); else a.pendingFinish = true;
}

function report(s: IsoScene, a: IsoAgent): void {
  const { labels: L } = s;
  a.mode = "reporting"; a.state = "reporting"; a.screenOn = false; a.tool = ""; a.toolBubble = "";
  withSlot(s, a, () => {
    a.mode = "reporting"; a.state = "reporting";
    goTo(s, a, FURN.coordSide, () => {
      const text = fill(L.reported, { role: a.role }) + (a.verdict ? ` · ${a.verdict}` : "");
      setAct(s, a, "happy", 1.6, text, "stand", -1);
      coordTalk(s, text);
      a.then = () => { releaseSlot(s, a); a.mode = "free"; a.state = "idle"; a.goal = "desk"; leisure(s, a); };
    }, true);
  });
}

// ---- tick ---------------------------------------------------------------------------------

export function tickScene(s: IsoScene, dt: number, rng: Rng = s.rng): void {
  s.rng = rng;
  for (const a of s.agents) {
    if (a.act === "walking") {
      const t = a.path[0];
      if (!t) { arrive(s, a); continue; }
      const du = t.u - a.pos.u; const dv = t.v - a.pos.v; const d = Math.hypot(du, dv); const step = SPEED * dt;
      const sx = du - dv; if (Math.abs(sx) > 0.05) a.face = sx > 0 ? 1 : -1;
      a.back = du + dv < -0.05; // heading toward the far wall: show the back
      if (d <= step) { a.pos = { u: t.u, v: t.v }; a.path.shift(); if (!a.path.length) { if (a.endFace) a.face = a.endFace; a.back = a.endBack; arrive(s, a); } }
      else a.pos = { u: a.pos.u + (du / d) * step, v: a.pos.v + (dv / d) * step };
    } else {
      a.timer -= dt;
      if (a.timer <= 0) {
        const th = a.then; a.then = null;
        if (a.isCoord) { a.bubble = a.toolBubble; a.act = "typing"; a.timer = Infinity; a.face = 1; }
        else if (th) th();
        else if (a.mode === "free") leisure(s, a);
      }
    }
  }
}

function arrive(s: IsoScene, a: IsoAgent): void {
  const th = a.then; a.then = null;
  if (th) th(); else setAct(s, a, "idle", 1);
}
