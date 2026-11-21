// Pure state machine of the AI-training gym: the skill works out on the machine of its discipline (with short
// breaks to wipe sweat and drink), the trainers walk over to coach, write on the board, watch, chat, rest and clap.
// Same style as office/iso/scene.ts: no DOM, no React, no Math.random/Date.now; randomness comes from an injected
// `rng`, time from the `dt` given to tickGym.
import { gymBusy, gymExercise, gymFreeChoices, GYM_TRAINER_IDS, type GymPhase } from "./gym";
import {
  BOARD_SPOT, buildGymGrid, COACH_OFFSETS, COOLER_SPOT, findGymPath, gymIsFree, REST_SPOTS, STATIONS, stationFor, TOWEL_SPOT, TRAINER_HOMES,
  type EquipId, type GymGrid, type GymPose, type Pt, type Spot, type Station,
} from "./gym-layout";

export type Rng = () => number;
export const GYM_SPEED = 1.7;
export const SKILL_ID = "skill";

/** Deterministic rng for tests and for the room component. */
export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Bubble texts (lists are alternatives). Built from the i18n keys `gym_say_*` (lists separated by "|"). */
export interface GymLabels {
  drink: string; wipe: string; stretch: string; write: string[];
  rest: string[]; phone: string[]; chat: string[]; skill: string[]; coach: string[]; cheer: string[];
  /** Role specific line of each trainer (`gym_say_<id>`). */
  say: Record<string, string>;
}

export function gymLabelsFrom(t: Record<string, string>): GymLabels {
  const list = (k: string): string[] => (t[k] ?? "").split("|").filter(Boolean);
  const say: Record<string, string> = {};
  for (const id of GYM_TRAINER_IDS) say[id] = t[`gym_say_${id}`] ?? "";
  return {
    drink: t.gym_say_drink ?? "", wipe: t.gym_say_wipe ?? "", stretch: t.gym_say_stretch ?? "", write: list("gym_say_write"),
    rest: list("gym_say_rest"), phone: list("gym_say_phone"), chat: list("gym_say_chat"), skill: list("gym_say_skill"),
    coach: list("gym_say_coach"), cheer: list("gym_say_cheer"), say,
  };
}

export interface GymAgent {
  id: string;
  trainer: boolean;
  pos: Pt;
  path: Pt[];
  /** IsoPerson act (extra gym acts: run, pedal, pull, hang, curl, benchpress, punch, situp, wipe, point, write, clap). */
  act: string;
  pose: GymPose;
  face: 1 | -1;
  back: boolean;
  bubble: string;
  timer: number;
  then: (() => void) | null;
  endFace: 1 | -1 | 0;
  endBack: boolean;
  /** Machine in use right now ("" when not exercising). */
  equip: EquipId | "";
  /** Cell reserved for a coach / watcher so two trainers never pick the same one. */
  spotKey: string;
  cycle: number;
  home: Spot;
}

export interface GymSim {
  agents: GymAgent[];
  grid: GymGrid;
  rng: Rng;
  labels: GymLabels;
  phase: GymPhase;
  round: number;
  station: Station;
  speaking: string[];
  cheering: boolean;
  /** Seconds since the room opened (drives the clock and the treadmill display). */
  clock: number;
}

const pick = <T,>(rng: Rng, a: readonly T[]): T => a[Math.min(a.length - 1, Math.floor(rng() * a.length))]!;
const rnd = (rng: Rng, a: number, b: number): number => a + rng() * (b - a);
const word = (rng: Rng, list: string[]): string => (list.length ? pick(rng, list) : "");
const dist = (a: Pt, b: Pt): number => Math.hypot(a.u - b.u, a.v - b.v);

function mk(id: string, home: Spot, trainer: boolean): GymAgent {
  return {
    id, trainer, pos: { u: home.u, v: home.v }, path: [], act: "idle", pose: "stand", face: home.face, back: !!home.back, bubble: "",
    timer: 0, then: null, endFace: 0, endBack: false, equip: "", spotKey: "", cycle: 0, home,
  };
}

export function createGymSim(rng: Rng, labels: GymLabels, phase: GymPhase = "idle", round = 0): GymSim {
  const skillHome: Spot = { u: 3.0, v: 8.2, face: 1 };
  const agents: GymAgent[] = [mk(SKILL_ID, skillHome, false)];
  for (const id of GYM_TRAINER_IDS) agents.push(mk(id, TRAINER_HOMES[id]!, true));
  const sim: GymSim = {
    agents, grid: buildGymGrid(), rng, labels, phase, round, station: stationFor(gymExercise(phase, round), round),
    speaking: [], cheering: phase === "passed", clock: 0,
  };
  agents.forEach((a) => { a.timer = rnd(rng, 0.2, 2.5); });
  return sim;
}

function setAct(a: GymAgent, act: string, secs: number, bubble = "", pose: GymPose = "stand", face?: 1 | -1, back = false): void {
  a.act = act; a.timer = secs; a.bubble = bubble; a.pose = pose; a.back = back; a.path = []; a.equip = "";
  if (face) a.face = face;
}

/** Walk to `spot` (through `approach` when given). An unreachable target warps (a state change must never stall). */
function goTo(s: GymSim, a: GymAgent, spot: Spot, then: () => void, approach?: Pt): void {
  const p = findGymPath(s.grid, a.pos, approach ?? spot);
  if (!p) { a.pos = { u: spot.u, v: spot.v }; a.path = []; a.then = null; a.face = spot.face; a.back = !!spot.back; then(); return; }
  if (approach) p.push({ u: spot.u, v: spot.v });
  a.path = p; a.then = then; a.act = "walking"; a.pose = "stand"; a.back = false; a.bubble = ""; a.equip = "";
  a.endFace = spot.face; a.endBack = !!spot.back;
}

const someoneAt = (s: GymSim, a: GymAgent, key: string): boolean => s.agents.some((b) => b !== a && b.spotKey === key);

/** Interrupt the current action so the next tick decides again. */
function interrupt(a: GymAgent): void {
  a.timer = 0; a.then = null; a.path = []; a.spotKey = "";
  if (a.act === "walking") { a.act = "idle"; }
}

/** The phase / round / speakers changed: re-plan whoever the change concerns. */
export function directGym(s: GymSim, phase: GymPhase, round: number, speaking: readonly string[], cheering: boolean): void {
  const station = stationFor(gymExercise(phase, round), round);
  const stationChanged = station.key !== s.station.key || gymBusy(phase) !== gymBusy(s.phase) || phase !== s.phase;
  const skill = s.agents[0]!;
  if (stationChanged) interrupt(skill);
  for (const a of s.agents) {
    if (!a.trainer) continue;
    const was = s.speaking.includes(a.id);
    const now = speaking.includes(a.id);
    if (was !== now || cheering !== s.cheering || stationChanged) interrupt(a);
  }
  s.phase = phase; s.round = round; s.station = station; s.speaking = [...speaking]; s.cheering = cheering;
}

function freeSpotNear(s: GymSim, p: Pt): Pt | null {
  const offs: Array<[number, number]> = [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0.9, 0.9], [-0.9, -0.9]];
  for (const [du, dv] of offs) if (gymIsFree(s.grid, p.u + du, p.v + dv)) return { u: p.u + du, v: p.v + dv };
  return null;
}

/** Standing place for a coach around an anchor: first free offset (rotated per trainer) nobody else reserved. */
export function coachSpot(s: GymSim, a: GymAgent, anchor: Pt): { spot: Spot; key: string } | null {
  const idx = Math.max(0, GYM_TRAINER_IDS.indexOf(a.id as (typeof GYM_TRAINER_IDS)[number]));
  for (let k = 0; k < COACH_OFFSETS.length; k++) {
    const [du, dv] = COACH_OFFSETS[(idx + k) % COACH_OFFSETS.length]!;
    const u = anchor.u + du, v = anchor.v + dv;
    if (!gymIsFree(s.grid, u, v)) continue;
    const key = `${Math.floor(u / 0.5)},${Math.floor(v / 0.5)}`;
    if (someoneAt(s, a, key)) continue;
    return { spot: { u, v, face: anchor.u + du > anchor.u ? -1 : 1 }, key };
  }
  return null;
}

// ---- skill --------------------------------------------------------------------------------------

function startExercise(s: GymSim, a: GymAgent): void {
  const st = s.station;
  setAct(a, st.act, rnd(s.rng, 9, 14), s.rng() < 0.35 ? word(s.rng, s.labels.skill) : "", st.pose, st.spot.face, !!st.spot.back);
  a.equip = st.equip;
  a.then = () => afterSet(s, a);
}

/** After a set: keep going, wipe sweat in place, or walk to the cooler for a drink, then come back. */
function afterSet(s: GymSim, a: GymAgent): void {
  a.cycle++;
  const m = a.cycle % 3;
  if (m === 1) {
    setAct(a, "wipe", rnd(s.rng, 2.2, 3.2), s.labels.wipe, "stand", a.face, false);
  } else if (m === 2) {
    goTo(s, a, COOLER_SPOT, () => setAct(a, "drinking", rnd(s.rng, 2.5, 3.5), s.labels.drink, "stand", 1, true));
  } else {
    startExercise(s, a);
  }
}

function decideSkill(s: GymSim, a: GymAgent): void {
  a.equip = "";
  if (gymBusy(s.phase)) {
    const st = s.station;
    if (dist(a.pos, st.spot) > 0.15) goTo(s, a, st.spot, () => startExercise(s, a), st.approach);
    else startExercise(s, a);
    return;
  }
  free(s, a, "skill");
}

// ---- trainers -----------------------------------------------------------------------------------

function decideTrainer(s: GymSim, a: GymAgent): void {
  a.equip = "";
  const skill = s.agents[0]!;
  if (s.cheering) {
    const c = coachSpot(s, a, skill.pos);
    const go = (): void => setAct(a, "clap", rnd(s.rng, 3, 4.5), word(s.rng, s.labels.cheer), "stand", a.face);
    if (c && dist(a.pos, c.spot) > 0.5) { a.spotKey = c.key; goTo(s, a, c.spot, go); } else go();
    return;
  }
  if (s.speaking.includes(a.id)) {
    const anchor: Pt = gymBusy(s.phase) ? (s.station.approach ?? s.station.spot) : skill.pos;
    const c = coachSpot(s, a, anchor);
    const act = (): void => {
      a.cycle++;
      const face: 1 | -1 = skill.pos.u + skill.pos.v - a.pos.u - a.pos.v >= 0 && skill.pos.u - skill.pos.v - a.pos.u + a.pos.v >= 0 ? 1 : -1;
      if (a.cycle % 2 === 1) {
        setAct(a, "point", rnd(s.rng, 3, 4.5), s.labels.say[a.id] ?? "", "stand", face);
      } else {
        setAct(a, "talking", rnd(s.rng, 2.5, 3.5), word(s.rng, s.labels.coach), "stand", face);
      }
    };
    if (c && dist(a.pos, c.spot) > 0.7) { a.spotKey = c.key; goTo(s, a, c.spot, act); } else act();
    return;
  }
  free(s, a, "trainer");
}

// ---- free time (both) ---------------------------------------------------------------------------

function free(s: GymSim, a: GymAgent, who: "skill" | "trainer"): void {
  const { rng, labels: L } = s;
  const choices = gymFreeChoices(s.phase, who === "trainer");
  const c = pick(rng, choices);
  a.spotKey = "";
  const others = s.agents.filter((b) => b !== a && b.act !== "walking" && b.pose === "stand" && b.equip === "");
  const idle = (secs = 1.5): void => setAct(a, "idle", secs);
  switch (c) {
    case "stretch": {
      const st = STATIONS.mat[rng() < 0.4 ? 1 : 0]!; // stretch standing on mat A or sit-ups on mat B
      goTo(s, a, st.spot, () => setAct(a, st.act, rnd(rng, 5, 8), s.labels.stretch, st.pose, st.spot.face));
      break;
    }
    case "listen": {
      const st = STATIONS.mat[0]!;
      goTo(s, a, st.spot, () => setAct(a, "idle", rnd(rng, 4, 7), "", "stand", -1));
      break;
    }
    case "drink":
      if (someoneAt(s, a, "cooler")) { idle(); break; }
      goTo(s, a, COOLER_SPOT, () => setAct(a, "drinking", rnd(rng, 2.5, 3.5), L.drink, "stand", 1, true));
      a.spotKey = "cooler";
      break;
    case "wipe":
      if (someoneAt(s, a, "towel")) { setAct(a, "wipe", rnd(rng, 2.2, 3.2), L.wipe, "stand", a.face); break; }
      goTo(s, a, TOWEL_SPOT, () => setAct(a, "wipe", rnd(rng, 2.5, 3.5), L.wipe, "stand", -1));
      a.spotKey = "towel";
      break;
    case "phone":
      setAct(a, "phone", rnd(rng, 3.5, 6), word(rng, L.phone), "stand", a.face);
      break;
    case "sit": {
      const i = REST_SPOTS.findIndex((_, k) => !someoneAt(s, a, `rest${k}`));
      const seat = REST_SPOTS[i];
      if (!seat) { idle(); break; }
      goTo(s, a, seat.spot, () => setAct(a, "resting", rnd(rng, 6, 10), word(rng, L.rest), "sofa", seat.spot.face), seat.approach);
      a.spotKey = `rest${i}`;
      break;
    }
    case "board":
      if (someoneAt(s, a, "board")) { idle(); break; }
      goTo(s, a, BOARD_SPOT, () => setAct(a, "write", rnd(rng, 4, 6), word(rng, L.write), "stand", 1, true));
      a.spotKey = "board";
      break;
    case "watch": {
      const skill = s.agents[0]!;
      const anchor: Pt = gymBusy(s.phase) ? (s.station.approach ?? s.station.spot) : skill.pos;
      const cs = coachSpot(s, a, anchor);
      if (!cs) { idle(); break; }
      goTo(s, a, cs.spot, () => setAct(a, "idle", rnd(rng, 4, 8), "", "stand", cs.spot.face));
      a.spotKey = cs.key;
      break;
    }
    case "chat": {
      if (!others.length) { idle(); break; }
      const o = pick(rng, others);
      const sp = freeSpotNear(s, o.pos);
      if (!sp) { idle(); break; }
      const side: 1 | -1 = sp.u > o.pos.u ? 1 : -1;
      goTo(s, a, { ...sp, face: (-side) as 1 | -1 }, () => {
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
        if (gymIsFree(s.grid, u, v)) t = { u, v, face: pick(rng, [1, -1] as const) };
      }
      if (t) goTo(s, a, t, () => idle(rnd(rng, 1.5, 3.5))); else idle();
    }
  }
}

// ---- tick ---------------------------------------------------------------------------------------

export function tickGym(s: GymSim, dt: number, rng: Rng = s.rng): void {
  s.rng = rng;
  s.clock += dt;
  for (const a of s.agents) {
    if (a.act === "walking") {
      const t = a.path[0];
      if (!t) { arrive(s, a); continue; }
      const du = t.u - a.pos.u, dv = t.v - a.pos.v, d = Math.hypot(du, dv), step = GYM_SPEED * dt;
      const sx = du - dv;
      if (Math.abs(sx) > 0.05) a.face = sx > 0 ? 1 : -1;
      a.back = du + dv < -0.05;
      if (d <= step) {
        a.pos = { u: t.u, v: t.v }; a.path.shift();
        if (!a.path.length) { if (a.endFace) a.face = a.endFace; a.back = a.endBack; arrive(s, a); }
      } else a.pos = { u: a.pos.u + (du / d) * step, v: a.pos.v + (dv / d) * step };
    } else {
      a.timer -= dt;
      if (a.timer <= 0) {
        const th = a.then; a.then = null;
        if (th) th(); else if (a.trainer) decideTrainer(s, a); else decideSkill(s, a);
      }
    }
  }
}

function arrive(_s: GymSim, a: GymAgent): void {
  const th = a.then; a.then = null;
  if (th) th(); else setAct(a, "idle", 0.05);
}

/** Machines that are being used right now (they animate: belt, bar, bag, wheel). */
export function activeEquip(s: GymSim): Set<EquipId> {
  const out = new Set<EquipId>();
  for (const a of s.agents) if (a.equip && a.act !== "walking") out.add(a.equip);
  return out;
}

/** Treadmill display: speed (km/h) and distance (m) from the clock, deterministic. */
export function treadmillReadout(clock: number): { speed: string; dist: string } {
  const speed = 8 + Math.sin(clock * 0.7) * 1.2;
  return { speed: speed.toFixed(1), dist: String(Math.floor(clock * speed / 3.6)) };
}

/** mm:ss of the training clock. */
export function clockText(clock: number): string {
  const sec = Math.max(0, Math.floor(clock));
  return `${String(Math.floor(sec / 60) % 100).padStart(2, "0")}:${String(sec % 60).padStart(2, "0")}`;
}

