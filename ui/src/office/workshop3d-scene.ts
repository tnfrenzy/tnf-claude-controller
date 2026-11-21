// Pure state machine of the 3D workshop room: the working role walks to its station and does its job (sits and
// draws, compares material samples, shoots, looks through a loupe, ...), the others fetch coffee, chat, watch the
// podium or rest, everybody claps on "done". Same style as office/gym-scene.ts: no DOM, no React, no Math.random /
// Date.now; randomness comes from an injected `rng`, time from the `dt` given to tickW3D.
import { mulberry32, type Rng } from "./gym-scene";
import {
  buildW3DGrid, COFFEE_SPOT, findW3DPath, ISSUE_BOARD_SPOT, PODIUM_CENTER, PODIUM_SPOTS, REST_SPOTS, W3D_HOMES, W3D_STATIONS, w3dIsFree,
  type Pt, type Spot, type W3DGrid, type W3DPose,
} from "./workshop3d-layout";
import { W3D_JOBS, W3D_ROLE_IDS, w3dFreeChoices, w3dScene, type W3DPhase, type W3DRoleId, type W3DScene } from "./workshop3d";

export { mulberry32 };
export type { Rng };
export const W3D_SPEED = 1.7;

/** Bubble texts (lists are alternatives). Built from the i18n keys `w3r_say_*` (lists separated by "|"). */
export interface W3DLabels {
  drink: string; stretch: string; chat: string[]; phone: string[]; rest: string[]; cheer: string[]; mark: string[]; place: string[];
  /** Role specific working line (`w3r_say_<id>`). */
  say: Record<string, string>;
}

export function w3dLabelsFrom(t: Record<string, string>): W3DLabels {
  const list = (k: string): string[] => (t[k] ?? "").split("|").filter(Boolean);
  const say: Record<string, string> = {};
  for (const id of W3D_ROLE_IDS) say[id] = t[`w3r_say_${id}`] ?? "";
  return {
    drink: t.w3r_say_drink ?? "", stretch: t.w3r_say_stretch ?? "", chat: list("w3r_say_chat"), phone: list("w3r_say_phone"),
    rest: list("w3r_say_rest"), cheer: list("w3r_say_cheer"), mark: list("w3r_say_mark"), place: list("w3r_say_place"), say,
  };
}

export interface W3DAgent {
  id: W3DRoleId;
  pos: Pt;
  path: Pt[];
  /** IsoPerson act (extra acts: compare, shoot, inspect, present, write, point, clap, stretch). */
  act: string;
  pose: W3DPose;
  face: 1 | -1;
  back: boolean;
  bubble: string;
  timer: number;
  then: (() => void) | null;
  endFace: 1 | -1 | 0;
  endBack: boolean;
  endPose: W3DPose;
  spotKey: string;
  cycle: number;
  home: Spot;
}

export interface W3DSim {
  agents: W3DAgent[];
  grid: W3DGrid;
  rng: Rng;
  labels: W3DLabels;
  phase: W3DPhase;
  scene: W3DScene;
  /** Number of open issues (the reviewer walks to the wall board to mark them). */
  issues: number;
  /** Seconds since the room opened (drives the wall screen and the turntable). */
  clock: number;
}

const pick = <T,>(rng: Rng, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]!;
const rnd = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);
const word = (rng: Rng, list: string[]): string => (list.length ? pick(rng, list) : "");
const dist = (a: Pt, b: Pt): number => Math.hypot(a.u - b.u, a.v - b.v);
const roleIndex = (id: string): number => Math.max(0, (W3D_ROLE_IDS as readonly string[]).indexOf(id));

function mk(id: W3DRoleId): W3DAgent {
  const home = W3D_HOMES[id]!;
  const pose: W3DPose = W3D_STATIONS[W3D_JOBS[id].station].pose;
  return {
    id, pos: { u: home.u, v: home.v }, path: [], act: "idle", pose: pose === "sit" ? "stand" : pose, face: home.face, back: !!home.back, bubble: "",
    timer: 0, then: null, endFace: 0, endBack: false, endPose: "stand", spotKey: "", cycle: 0, home,
  };
}

export function createW3DSim(rng: Rng, labels: W3DLabels, phase: W3DPhase = "idle", issues = 0): W3DSim {
  const agents = W3D_ROLE_IDS.map((id) => mk(id));
  agents.forEach((a) => { a.timer = rnd(rng, 0.2, 2.5); });
  return { agents, grid: buildW3DGrid(), rng, labels, phase, scene: w3dScene(phase), issues, clock: 0 };
}

function setAct(a: W3DAgent, act: string, secs: number, bubble = "", pose: W3DPose = "stand", face?: 1 | -1, back = false): void {
  a.act = act; a.timer = secs; a.bubble = bubble; a.pose = pose; a.back = back; a.path = [];
  if (face) a.face = face;
}

/** Walk to `spot` (through `approach` when given). An unreachable target warps (a state change must never stall). */
function goTo(s: W3DSim, a: W3DAgent, spot: Spot, then: () => void, approach?: Pt): void {
  const p = findW3DPath(s.grid, a.pos, approach ?? spot);
  if (!p) { a.pos = { u: spot.u, v: spot.v }; a.path = []; a.then = null; a.face = spot.face; a.back = !!spot.back; then(); return; }
  if (approach) p.push({ u: spot.u, v: spot.v });
  a.path = p; a.then = then; a.act = "walking"; a.pose = "stand"; a.back = false; a.bubble = "";
  a.endFace = spot.face; a.endBack = !!spot.back;
}

const someoneAt = (s: W3DSim, a: W3DAgent, key: string): boolean => s.agents.some((b) => b !== a && b.spotKey === key);

function interrupt(a: W3DAgent): void {
  a.timer = 0; a.then = null; a.path = []; a.spotKey = "";
  if (a.act === "walking") a.act = "idle";
}

/** The phase / issue count changed: re-plan whoever the change concerns (workers, and everybody on done/rest). */
export function directW3D(s: W3DSim, phase: W3DPhase, issues = s.issues): void {
  const next = w3dScene(phase);
  const phaseChanged = phase !== s.phase;
  for (const a of s.agents) {
    const was = s.scene.active.includes(a.id);
    const now = next.active.includes(a.id);
    if (was !== now || (phaseChanged && (now || next.cheering || next.resting || s.scene.cheering || s.scene.resting)) || (a.id === "visual-reviewer" && issues !== s.issues && now)) interrupt(a);
  }
  s.phase = phase; s.scene = next; s.issues = issues;
}

// ---- work ----------------------------------------------------------------------------------------

function startWork(s: W3DSim, a: W3DAgent): void {
  const job = W3D_JOBS[a.id];
  const st = W3D_STATIONS[job.station];
  const say = s.rng() < 0.6 ? (s.labels.say[a.id] ?? "") : "";
  setAct(a, job.act, rnd(s.rng, 8, 12), say, st.pose, st.spot.face, !!st.spot.back);
  a.then = () => afterSet(s, a);
}

/** After a work set: keep going, take a short break, walk to the podium to place/inspect, or mark an issue on the wall board. */
function afterSet(s: W3DSim, a: W3DAgent): void {
  a.cycle++;
  const m = a.cycle % 3;
  const job = W3D_JOBS[a.id];
  if (m === 1) {
    setAct(a, "idle", rnd(s.rng, 1.2, 2.2), "", "stand", a.face, a.back);
    a.pose = W3D_STATIONS[job.station].pose;
  } else if (m === 2) {
    if (a.id === "visual-reviewer" && s.issues > 0) {
      goTo(s, a, ISSUE_BOARD_SPOT, () => setAct(a, "write", rnd(s.rng, 3, 5), word(s.rng, s.labels.mark), "stand", ISSUE_BOARD_SPOT.face, true));
    } else if (a.id === "tiep-nhan-3d" || a.id === "render-presenter") {
      startWork(s, a);
    } else {
      const sp = PODIUM_SPOTS[roleIndex(a.id) % PODIUM_SPOTS.length]!;
      goTo(s, a, sp, () => setAct(a, "point", rnd(s.rng, 3, 4.5), word(s.rng, s.labels.place), "stand", sp.face, !!sp.back));
    }
  } else {
    startWork(s, a);
  }
}

function decideWorker(s: W3DSim, a: W3DAgent): void {
  const st = W3D_STATIONS[W3D_JOBS[a.id].station];
  if (dist(a.pos, st.spot) > 0.15) goTo(s, a, st.spot, () => startWork(s, a), st.approach);
  else startWork(s, a);
}

// ---- free time ----------------------------------------------------------------------------------

/** Ring of cells around the podium where the team gathers to applaud. */
export function cheerSpot(s: W3DSim, a: W3DAgent): Spot {
  const i = roleIndex(a.id);
  for (let k = 0; k < W3D_ROLE_IDS.length * 2; k++) {
    const ang = ((i + k * 0.5) / W3D_ROLE_IDS.length) * Math.PI * 2 + 0.4;
    const r = 2.5 + (k % 2) * 0.5;
    const u = PODIUM_CENTER.u + Math.cos(ang) * r, v = PODIUM_CENTER.v + Math.sin(ang) * r * 0.9;
    const key = `cheer${Math.floor(u / 0.5)},${Math.floor(v / 0.5)}`;
    if (!w3dIsFree(s.grid, u, v) || someoneAt(s, a, key)) continue;
    a.spotKey = key;
    return { u, v, face: u > PODIUM_CENTER.u ? -1 : 1 };
  }
  return { u: a.home.u, v: a.home.v, face: a.home.face };
}

function decide(s: W3DSim, a: W3DAgent): void {
  if (s.scene.cheering) {
    const c = cheerSpot(s, a);
    const go = (): void => setAct(a, "clap", rnd(s.rng, 3, 4.5), word(s.rng, s.labels.cheer), "stand", a.face);
    if (dist(a.pos, c) > 0.4) goTo(s, a, c, go); else go();
    return;
  }
  if (s.scene.active.includes(a.id)) { decideWorker(s, a); return; }
  free(s, a);
}

function free(s: W3DSim, a: W3DAgent): void {
  const { rng, labels: L } = s;
  const c = pick(rng, w3dFreeChoices(s.phase, false));
  a.spotKey = "";
  const idle = (secs = 1.5): void => setAct(a, "idle", secs, "", "stand", a.face);
  switch (c) {
    case "coffee":
      if (someoneAt(s, a, "coffee")) { idle(); break; }
      goTo(s, a, COFFEE_SPOT, () => setAct(a, "drinking", rnd(rng, 2.5, 3.5), L.drink, "stand", 1, true));
      a.spotKey = "coffee";
      break;
    case "stretch":
      setAct(a, "stretch", rnd(rng, 3, 5), L.stretch, "stand", a.face);
      break;
    case "phone":
      setAct(a, "phone", rnd(rng, 3.5, 6), word(rng, L.phone), "stand", a.face);
      break;
    case "sofa": {
      const i = REST_SPOTS.findIndex((_, k) => !someoneAt(s, a, `rest${k}`));
      const seat = REST_SPOTS[i];
      if (!seat) { idle(); break; }
      goTo(s, a, seat.spot, () => setAct(a, "resting", rnd(rng, 6, 10), word(rng, L.rest), "sofa", seat.spot.face), seat.approach);
      a.spotKey = `rest${i}`;
      break;
    }
    case "watch": {
      const sp = PODIUM_SPOTS[(roleIndex(a.id) + Math.floor(rng() * 3)) % PODIUM_SPOTS.length]!;
      const key = `watch${PODIUM_SPOTS.indexOf(sp)}`;
      if (someoneAt(s, a, key)) { idle(); break; }
      goTo(s, a, sp, () => setAct(a, "idle", rnd(rng, 4, 8), "", "stand", sp.face, !!sp.back));
      a.spotKey = key;
      break;
    }
    case "chat": {
      const others = s.agents.filter((b) => b !== a && b.act !== "walking" && b.pose === "stand" && !s.scene.active.includes(b.id));
      if (!others.length) { idle(); break; }
      const o = pick(rng, others);
      const side: 1 | -1 = rng() < 0.5 ? 1 : -1;
      const sp: Spot = { u: o.pos.u + 0.9 * side, v: o.pos.v, face: (-side) as 1 | -1 };
      if (!w3dIsFree(s.grid, sp.u, sp.v)) { idle(); break; }
      goTo(s, a, sp, () => {
        setAct(a, "talking", rnd(rng, 3, 5), word(rng, L.chat), "stand", (-side) as 1 | -1);
        o.face = side;
        if (o.act === "idle") setAct(o, "talking", 3, "", "stand", side);
      });
      break;
    }
    case "cheer":
      setAct(a, "happy", rnd(rng, 3, 5), word(rng, L.cheer), "stand", a.face);
      break;
    default: {
      let t: Spot | null = null;
      for (let k = 0; k < 10 && !t; k++) {
        const u = rnd(rng, 1.2, 14.5), v = rnd(rng, 2.6, 13);
        if (w3dIsFree(s.grid, u, v)) t = { u, v, face: pick(rng, [1, -1] as const) };
      }
      if (t) goTo(s, a, t, () => idle(rnd(rng, 1.5, 3.5))); else idle();
    }
  }
}

// ---- tick ---------------------------------------------------------------------------------------

export function tickW3D(s: W3DSim, dt: number, rng: Rng = s.rng): void {
  s.rng = rng;
  s.clock += dt;
  for (const a of s.agents) {
    if (a.act === "walking") {
      const t = a.path[0];
      if (!t) { arrive(a); continue; }
      const du = t.u - a.pos.u, dv = t.v - a.pos.v, d = Math.hypot(du, dv), step = W3D_SPEED * dt;
      const sx = du - dv;
      if (Math.abs(sx) > 0.05) a.face = sx > 0 ? 1 : -1;
      a.back = du + dv < -0.05;
      if (d <= step) {
        a.pos = { u: t.u, v: t.v }; a.path.shift();
        if (!a.path.length) { if (a.endFace) a.face = a.endFace; a.back = a.endBack; arrive(a); }
      } else a.pos = { u: a.pos.u + (du / d) * step, v: a.pos.v + (dv / d) * step };
    } else {
      a.timer -= dt;
      if (a.timer <= 0) {
        const th = a.then; a.then = null;
        if (th) th(); else decide(s, a);
      }
    }
  }
}

function arrive(a: W3DAgent): void {
  const th = a.then; a.then = null;
  if (th) th(); else setAct(a, "idle", 0.05);
}

/** Seconds as mm:ss. */
export function w3dClockText(clock: number): string {
  const sec = Math.max(0, Math.floor(clock));
  return `${String(Math.floor(sec / 60) % 100).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}
