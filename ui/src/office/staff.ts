// Staff of the four-room office. Every role is one real person who lives in the building:
//   - idle (no job): at the desk reading, or off to the water cooler, the bench, the lounge, a chat with a colleague,
//     a phone call, a stretch (always along real routes: aisles, doorways, the lobby centre line);
//   - working (a run agent of their group is working): walks to their desk, sits, types / thinks / uses a tool as the
//     agent does, and goes back to leisure when the agent has finished.
// Extra agents of a group (more concurrent agents than people) are not handled here: the scene draws them walking in
// from the front door. Pure: no DOM, no Math.random/Date.now (rng and time are injected).
import { WIDE, accessFor, chainBetween, spotFor, roomOf, type DeskGroup, type LeisureSpot, type OfficeLayout, type Point, type RoomId } from "./layout.js";
import { fill, type IsoLabels } from "./iso/scene.js";
import { bubbleFor, type OfficeAgent } from "./model.js";

export type Rng = () => number;

/** Small deterministic generator (mulberry32). */
export function seededRng(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Resident {
  id: string;
  role: string;
  group: DeskGroup;
  /** Seat (desk index inside the group) this person always sits at; null = an extra person without a seat (stands). */
  seat: number | null;
}

export const RESIDENTS: readonly Resident[] = [
  { id: "res-coordinator", role: "coordinator", group: "coordinator", seat: 0 },
  { id: "res-analyst", role: "analyst", group: "analyst", seat: 0 },
  { id: "res-planner", role: "planner", group: "analyst", seat: 1 },
  { id: "res-critic", role: "critic", group: "critic", seat: 0 },
  { id: "res-implementer", role: "implementer", group: "implementer", seat: 0 },
  { id: "res-qa", role: "qa", group: "qa", seat: 0 },
  { id: "res-debug", role: "debug", group: "debug", seat: 0 },
  { id: "res-scout", role: "scout", group: "subagent", seat: 0 },
  { id: "res-helper", role: "helper", group: "subagent", seat: 1 },
  { id: "res-reviewer-bot", role: "reviewer-bot", group: "subagent", seat: 2 },
];

/** Where a person stands or sits, and how to get there from the room's gate (or the lobby centre line). */
export interface Place {
  id: string;
  room: RoomId;
  pos: Point;
  /** Points after the gate (wide plan), ending at `pos`. */
  access: Point[];
  pose: "stand" | "sit" | "sofa" | "lie";
  act: string;
  face: 1 | -1;
  /** True for a work chair: the person sits with the back to the viewer. */
  back: boolean;
  kind: "desk" | LeisureSpot["kind"] | "stretch";
}

export function deskPlace(r: Resident & { seat: number }, layout: OfficeLayout): Place {
  const room = roomOf(r.group, layout).id;
  return { id: `desk-${r.id}`, room, pos: spotFor(r.group, r.seat, layout), access: accessFor(r.group, r.seat, layout), pose: "sit", act: "seated", face: 1, back: true, kind: "desk" };
}

export function leisurePlaces(layout: OfficeLayout): Place[] {
  return layout.leisure.map((l) => ({ id: l.id, room: l.room, pos: l.pos, access: l.access, pose: l.pose, act: l.act, face: l.face, back: false, kind: l.kind }));
}

/** Number of stretch spots per room. */
export const STRETCH_SLOTS = 2;

/** A spot to stand and stretch, moved off the gate lane into the room (one spot per slot). */
export function stretchPlace(room: RoomId, layout: OfficeLayout, slot = 0): Place {
  const g = layout.gates[room];
  const r = layout.rooms.find((x) => x.id === room);
  const cx = r ? r.x + r.w / 2 : g.x;
  const cy = r ? r.y + r.h / 2 : g.y + 20;
  const dx = cx - g.x;
  const dy = cy - g.y;
  const len = Math.hypot(dx, dy) || 1;
  const step = Math.min(22, len * 0.6);
  const ux = dx / len;
  const uy = dy / len;
  // Sideways from the inward direction, alternating per slot.
  const side = (slot % 2 === 0 ? 1 : -1) * (16 + 8 * Math.floor(slot / 2));
  let pos = { x: Math.round(g.x + ux * step - uy * side), y: Math.round(g.y + uy * step + ux * side) };
  if (pos.x === g.x && pos.y === g.y) pos = { x: g.x + 16, y: g.y + 16 };
  return { id: `stretch-${room}-${slot}`, room, pos, access: [g, pos], pose: "stand", act: "stretch", face: 1, back: false, kind: "stretch" };
}

/** Minimum distance between standing spots (plan units). */
export const WAIT_GAP = 14;

/**
 * Standing spots for `count` extra agents of a group: queued inward from the room's gate, at least WAIT_GAP apart and
 * at least WAIT_GAP from every point in `occupied` (people, desks), so an extra agent never overlaps seated staff.
 */
export function waitingSpots(group: DeskGroup, count: number, layout: OfficeLayout, occupied: readonly Point[]): Point[] {
  if (count <= 0) return [];
  const room = roomOf(group, layout);
  const g = layout.gates[room.id];
  const cx = room.x + room.w / 2;
  const cy = room.y + room.h / 2;
  const len = Math.hypot(cx - g.x, cy - g.y) || 1;
  const ux = (cx - g.x) / len;
  const uy = (cy - g.y) / len;
  const out: Point[] = [];
  const free = (p: Point) => [...occupied, ...out].every((o) => Math.hypot(o.x - p.x, o.y - p.y) >= WAIT_GAP);
  const inside = (p: Point) => p.x >= room.x + 8 && p.x <= room.x + room.w - 8 && p.y >= room.y + 8 && p.y <= room.y + room.h - 8;
  const reach = Math.hypot(room.w, room.h);
  for (let d = 18; d <= reach && out.length < count; d += WAIT_GAP) {
    for (let k = 0; k < 11 && out.length < count; k++) {
      const side = (k % 2 === 0 ? 1 : -1) * Math.ceil(k / 2) * WAIT_GAP;
      const p = { x: Math.round(g.x + ux * d - uy * side), y: Math.round(g.y + uy * d + ux * side) };
      if (inside(p) && free(p)) out.push(p);
    }
  }
  return out;
}

const dedupe = (pts: Point[]): Point[] => pts.filter((p, i) => i === 0 || p.x !== pts[i - 1]!.x || p.y !== pts[i - 1]!.y);

/**
 * Walking route between two places: back out along the first one's access points, through the doorways (and along the
 * lobby) and in along the second one's. Never cuts through desks because every leg follows gates, aisles and doorways.
 */
export function routeBetween(from: Place, to: Place, layout: OfficeLayout): Point[] {
  const wide = layout.hallX !== null;
  const out: Point[] = [from.pos];
  for (const p of [...from.access].reverse().slice(1)) out.push(p);
  if (wide && from.room !== "hall") out.push(layout.gates[from.room]);
  if (from.room !== to.room) out.push(...chainBetween(layout, [from.room], to.room));
  if (wide && to.room !== "hall") out.push(layout.gates[to.room]);
  out.push(...to.access);
  return dedupe(out);
}

/** Walking speed in plan units per millisecond. */
export const WALK_SPEED = 0.11;

export function routeLength(route: readonly Point[]): number {
  let n = 0;
  for (let i = 1; i < route.length; i++) n += Math.hypot(route[i]!.x - route[i - 1]!.x, route[i]!.y - route[i - 1]!.y);
  return n;
}

/** Position `elapsed` ms into a walk along `route`, whether it is still walking and the direction of the current leg. */
export function positionAlong(route: readonly Point[], elapsed: number, speed = WALK_SPEED): { pos: Point; walking: boolean; dx: number; dy: number } {
  const first = route[0]!;
  if (route.length < 2) return { pos: first, walking: false, dx: 0, dy: 0 };
  let left = Math.max(0, elapsed) * speed;
  for (let i = 1; i < route.length; i++) {
    const a = route[i - 1]!;
    const b = route[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= len) {
      const t = len === 0 ? 1 : left / len;
      return { pos: { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t }, walking: true, dx: b.x - a.x, dy: b.y - a.y };
    }
    left -= len;
  }
  const last = route[route.length - 1]!;
  return { pos: last, walking: false, dx: 0, dy: 0 };
}

export interface StaffState {
  resident: Resident;
  desk: Place;
  at: Place;
  route: Point[];
  startedAt: number;
  /** When the walk to `at` ends. */
  arriveAt: number;
  /** When the current leisure stay ends and a new destination is chosen (ignored while there is a job). */
  until: number;
  /** Run agent this person is working for (null = free time). */
  job: string | null;
  bubble: string;
  bubbleUntil: number;
  /** Chat partner id while a chat is going on. */
  chatWith: string | null;
  /** Place just left while standing up, and when the standing-up ends (walk starts after it). */
  leaving?: Place | null;
  standUntil?: number;
  /** Extra person (more concurrent agents than people in a group): walks in, gets dispatched, works, walks out. */
  extra?: boolean;
  /** Extra person standing at the dispatch point until this time, then walking on to `desk`. */
  dispatchUntil?: number | undefined;
  /** Extra person on the way out through the front door; removed on arrival. */
  exiting?: boolean;
}

export const SIT_DOWN_MS = 500;
export const STAND_UP_MS = 400;
/** Distance before the seat where the person stops walking and starts to sit. */
export const SIT_DISTANCE = 12;

export interface StaffView {
  id: string;
  role: string;
  isCoord: boolean;
  pos: Point;
  pose: string;
  act: string;
  face: 1 | -1;
  back: boolean;
  walking: boolean;
  /** Never goes walking <-> seated directly: sitting-down / standing-up sit between. */
  phase: "walking" | "sitting-down" | "seated" | "standing-up" | "idle";
  /** 0 standing .. 1 seated. */
  sitT: number;
  bubble: string;
  /** The person is at their desk working on a job (the desk lights up). */
  working: boolean;
  deskGroup: DeskGroup;
  /** Seat index of the desk, null for an extra person standing without a seat. */
  deskSeat: number | null;
}

function pick<T>(rng: Rng, list: readonly T[]): T {
  return list[Math.floor(rng() * list.length) % list.length]!;
}

/** What to say at a leisure place (one of the labels). */
export function leisureBubble(place: Place, labels: IsoLabels, rng: Rng): string {
  switch (place.kind) {
    case "drink": return rng() < 0.5 ? labels.drink : labels.coffee;
    case "kitchen": return labels.coffee;
    case "sofa": return pick(rng, labels.rest);
    case "bed": return labels.sleep;
    case "phone": return pick(rng, labels.phone);
    case "chat": return pick(rng, labels.chat);
    case "stretch": return labels.stretch;
    default: return rng() < 0.4 ? pick(rng, labels.read) : "";
  }
}

/** The thought/speech bubble of a working person: the tool in use, or what the agent last said, or "working". */
export function workBubble(a: OfficeAgent, now: number, labels: IsoLabels, roleName: string): string {
  if (a.activity === "tool" && a.lastTool) return fill(labels.workTool, { role: roleName, tool: a.lastTool });
  const b = bubbleFor(a, now);
  if (b && b.kind !== "tool" && b.text) return b.text.length > 48 ? `${b.text.slice(0, 47)}…` : b.text;
  if (a.activity === "thinking") return fill(labels.work, { role: roleName });
  return "";
}

/** What the person does while sitting at the desk for a job. */
export function workAct(a: OfficeAgent): string {
  if (a.activity === "typing" || a.activity === "tool") return "typing";
  if (a.activity === "thinking") return "thinking";
  return "seated";
}

const STAY_MS: Record<Place["kind"], [number, number]> = {
  desk: [20000, 45000],
  drink: [6000, 9000],
  kitchen: [7000, 11000],
  sofa: [14000, 24000],
  bed: [18000, 30000],
  chat: [9000, 15000],
  phone: [7000, 12000],
  stretch: [4000, 6000],
};

const isFree = (s: StaffState): boolean => s.job === null;

function startWalk(state: StaffState, to: Place, layout: OfficeLayout, now: number): void {
  const route = routeBetween(state.at, to, layout);
  const wasSeat = state.at.pose !== "stand" && now >= state.arriveAt;
  const lead = wasSeat ? STAND_UP_MS : 0;
  state.leaving = wasSeat ? state.at : null;
  state.standUntil = now + lead;
  state.route = route;
  state.startedAt = now + lead;
  state.arriveAt = now + lead + routeLength(route) / WALK_SPEED;
  state.at = to;
}

export function createStaff(layout: OfficeLayout, now: number, rng: Rng, residents: readonly Resident[] = RESIDENTS): StaffState[] {
  return residents.map((resident, i) => {
    const desk = deskPlace({ ...resident, seat: resident.seat ?? 0 }, layout);
    const stay = STAY_MS.desk;
    // Stagger the first moves so everybody does not get up at once.
    const until = now + stay[0] / 2 + rng() * (stay[1] - stay[0]) + i * 6000;
    return { resident, desk, at: desk, route: [desk.pos], startedAt: now, arriveAt: now, until, job: null, bubble: "", bubbleUntil: 0, chatWith: null };
  });
}

/**
 * Give each working agent a free person of its group (people never swap jobs mid-way); release people whose agent has
 * finished. Returns the ids of every agent that has been handled by a person (now or earlier), which the scene must not
 * draw a second time.
 */
export function assignJobs(states: StaffState[], agents: readonly OfficeAgent[], claimed: Set<string>, now: number, labels: IsoLabels, roleName: (role: string) => string = (r) => r): void {
  const working = new Set(agents.filter((a) => a.phase === "working").map((a) => a.id));
  for (const s of states) {
    if (s.job && !working.has(s.job)) {
      s.job = null;
      s.until = now + 3000;
      s.bubble = fill(labels.reported, { role: roleName(s.resident.role) });
      s.bubbleUntil = now + 3500;
    }
  }
  const queue = agents.filter((a) => a.phase === "working" && !claimed.has(a.id)).sort((p, q) => p.startedAt - q.startedAt);
  for (const a of queue) {
    const person = states.find((s) => !s.extra && isFree(s) && (a.residentId !== undefined ? s.resident.id === a.residentId : s.resident.group === a.group));
    if (!person) continue;
    person.job = a.id;
    person.chatWith = null;
    claimed.add(a.id);
    person.bubble = "";
  }
}

/**
 * Advance every person to `now`. A person with a job heads to the desk and stays; a free person who has finished the
 * current stay picks a place (a chat needs a free colleague, who joins at the other chat spot) and walks there.
 * Mutates the states.
 */
export function tickStaff(states: StaffState[], layout: OfficeLayout, now: number, rng: Rng, labels: IsoLabels): void {
  const leisure = leisurePlaces(layout);
  const taken = (id: string) => states.some((s) => s.at.id === id);
  for (const state of states) {
    if (state.extra) {
      // Extra people only follow their fixed route: dispatch point, then the work place. No leisure, no chat.
      if (!state.exiting && state.dispatchUntil !== undefined && now >= state.arriveAt && now >= state.dispatchUntil) {
        state.dispatchUntil = undefined;
        startWalk(state, state.desk, layout, now);
        state.bubble = "";
      }
      continue;
    }
    if (now < state.arriveAt) {
      // Still walking. A job interrupts a walk to anywhere but the desk: turn around where we are.
      if (state.job && state.at.id !== state.desk.id) {
        const here = positionAlong(state.route, now - state.startedAt).pos;
        const rest = routeBetween(state.at, state.desk, layout).slice(1);
        const route = dedupe([here, ...rest]);
        state.route = route;
        state.startedAt = now;
        state.standUntil = 0;
        state.arriveAt = now + routeLength(route) / WALK_SPEED;
        state.at = state.desk;
        if (state.chatWith) {
          const other = states.find((s) => s.resident.id === state.chatWith);
          if (other) other.chatWith = null;
          state.chatWith = null;
        }
      }
      continue;
    }
    if (state.job) {
      if (state.chatWith) {
        const other = states.find((s) => s.resident.id === state.chatWith);
        if (other) other.chatWith = null;
        state.chatWith = null;
      }
      if (state.at.id !== state.desk.id) startWalk(state, state.desk, layout, now);
      continue;
    }
    if (now < state.until) continue;
    // Not everybody leaves their desk at the same time: at most three free people are away at once.
    if (state.at.kind === "desk" && states.filter((s) => !s.extra && s.job === null && s.at.kind !== "desk").length >= 3) {
      state.until = now + 5000 + rng() * 8000;
      continue;
    }
    const options: Array<{ place: Place; w: number }> = [];
    if (state.at.kind !== "desk") options.push({ place: state.desk, w: 5 });
    else options.push({ place: state.desk, w: 3 });
    for (const p of leisure) {
      if (p.id === state.at.id || taken(p.id)) continue;
      if (p.kind === "chat") continue; // handled below, needs a partner
      options.push({ place: p, w: p.kind === "sofa" ? 2 : p.kind === "bed" ? 1.6 : p.kind === "drink" ? 2.5 : 1.5 });
    }
    if (state.at.kind !== "stretch") {
      for (let slot = 0; slot < STRETCH_SLOTS; slot++) {
        const sp = stretchPlace(state.desk.room, layout, slot);
        if (!taken(sp.id)) {
          options.push({ place: sp, w: 1.2 });
          break;
        }
      }
    }
    const chatA = leisure.find((p) => p.id === "chat-a");
    const chatB = leisure.find((p) => p.id === "chat-b");
    const partner = chatA && chatB && !taken(chatA.id) && !taken(chatB.id) ? states.find((s) => s !== state && !s.extra && isFree(s) && now >= s.arriveAt && s.until - now > 2000 && !s.chatWith) : undefined;
    if (partner && chatA && chatB) options.push({ place: chatA, w: 2 });
    const total = options.reduce((n, o) => n + o.w, 0);
    let r = rng() * total;
    let next = options[options.length - 1]!.place;
    for (const o of options) {
      r -= o.w;
      if (r <= 0) {
        next = o.place;
        break;
      }
    }
    const [lo, hi] = STAY_MS[next.kind];
    const stay = lo + rng() * (hi - lo);
    startWalk(state, next, layout, now);
    state.until = state.arriveAt + stay;
    state.bubble = leisureBubble(next, labels, rng);
    state.bubbleUntil = state.arriveAt + 3500;
    if (next.kind === "chat" && partner && chatB) {
      startWalk(partner, chatB, layout, now);
      partner.until = state.until;
      partner.bubble = leisureBubble(chatB, labels, rng);
      partner.bubbleUntil = partner.arriveAt + 3500;
      state.chatWith = partner.resident.id;
      partner.chatWith = state.resident.id;
    } else {
      state.chatWith = null;
    }
  }
}

/** What to draw for a person at time `now`; `job` is the agent they work for (when they do). */
export function staffView(state: StaffState, now: number, job?: OfficeAgent | null, labels?: IsoLabels, roleName = ""): StaffView {
  const at = state.at;
  const isSeat = at.pose !== "stand";
  const len = routeLength(state.route);
  const D = isSeat ? Math.min(SIT_DISTANCE, len) : 0;
  const tStand = state.startedAt + (len - D) / WALK_SPEED;
  const standUntil = state.standUntil ?? 0;
  let phase: StaffView["phase"];
  let sitT = 0;
  let pos = at.pos;
  let pose: string = at.pose;
  let face: 1 | -1 = at.face;
  let back = at.back;
  let act = at.act;
  const from = state.leaving;
  if (from && now < standUntil) {
    phase = "standing-up";
    sitT = Math.max(0, Math.min(1, (standUntil - now) / STAND_UP_MS));
    pos = from.pos;
    pose = sitT >= 0.5 ? from.pose : "stand";
    face = from.face;
    back = from.back && sitT >= 0.5;
    act = sitT >= 0.5 ? from.act : "stand";
  } else if (len > 0 && now < tStand) {
    phase = "walking";
    const along = positionAlong(state.route, now - state.startedAt);
    pos = along.pos;
    pose = "stand";
    face = (along.dx - along.dy) >= 0 ? 1 : -1;
    back = false;
    act = "walking";
  } else if (isSeat && len > 0 && now < tStand + SIT_DOWN_MS) {
    phase = "sitting-down";
    sitT = Math.max(0, Math.min(1, (now - tStand) / SIT_DOWN_MS));
    const sp = positionAlong(state.route, (len - D) / WALK_SPEED).pos;
    pos = { x: sp.x + (at.pos.x - sp.x) * sitT, y: sp.y + (at.pos.y - sp.y) * sitT };
    pose = sitT >= 0.5 ? at.pose : "stand";
    back = at.back && sitT >= 0.5;
    act = sitT >= 0.5 ? at.act : "stand";
  } else if (isSeat) {
    phase = "seated";
    sitT = 1;
  } else {
    phase = len > 0 && now < state.arriveAt ? "walking" : "idle";
  }
  const walking = phase === "walking";
  const settled = phase === "seated" || phase === "idle";
  const working = (settled || phase === "sitting-down") && !!job && at.kind === "desk";
  let bubble = settled && now < state.bubbleUntil ? state.bubble : "";
  if (working && job) {
    act = workAct(job);
    bubble = labels ? workBubble(job, now, labels, roleName) : "";
  } else if (settled && at.kind === "desk" && !state.job) act = "seated";
  return {
    id: state.resident.id,
    role: state.resident.role,
    isCoord: state.resident.role === "coordinator",
    pos,
    pose,
    act,
    face,
    back,
    walking,
    phase,
    sitT,
    bubble,
    working,
    deskGroup: state.resident.group,
    deskSeat: state.resident.seat,
  };
}

/** Most extra people one group may have at the same time. */
export const MAX_EXTRAS_PER_GROUP = 3;
/** How long an extra person stands at the dispatch point to receive the job. */
export const DISPATCH_MS = 1500;

/** Extra person `n` of a group: stable id, role of the group's first resident, lowest free seat (null when there is none). */
export function extraResident(group: DeskGroup, n: number, layout: OfficeLayout = WIDE, taken: readonly number[] = []): Resident {
  const seatCount = layout.desks.filter((d) => d.group === group).length;
  const used = new Set<number>([...taken, ...RESIDENTS.filter((r) => r.group === group).map((r) => r.seat as number)]);
  let seat: number | null = null;
  for (let i = 0; i < seatCount; i++) {
    if (!used.has(i)) {
      seat = i;
      break;
    }
  }
  const role = RESIDENTS.find((r) => r.group === group)?.role ?? group;
  return { id: `ext-${group}-${n}`, role, group, seat };
}

function entryPlace(layout: OfficeLayout): Place {
  return { id: "entry", room: layout.entryRooms[0] ?? "hall", pos: layout.entryPath[0]!, access: layout.entryPath, pose: "stand", act: "walking", face: 1, back: false, kind: "stretch" };
}

/** Where extra people receive their job: the doorway of the command room. */
function dispatchPlace(layout: OfficeLayout, id: string): Place {
  const g = layout.gates.command;
  return { id: `dispatch-${id}`, room: "command", pos: g, access: [g], pose: "stand", act: "stand", face: 1, back: false, kind: "stretch" };
}

/**
 * Bring in an extra person for every working agent that no person has taken, when everybody of its group is busy: in
 * through the front door, along the entry path to the dispatch point, then (after DISPATCH_MS) to the group's room.
 */
export function ensureExtras(states: StaffState[], agents: readonly OfficeAgent[], layout: OfficeLayout, now: number, labels: IsoLabels, roleName: (role: string) => string = (r) => r): void {
  const queue = agents.filter((a) => a.phase === "working" && !states.some((s) => s.job === a.id)).sort((p, q) => p.startedAt - q.startedAt);
  for (const a of queue) {
    const members = states.filter((s) => !s.extra && s.resident.group === a.group);
    if (members.some((s) => s.job === null)) continue;
    const mine = states.filter((s) => s.extra && !s.exiting && s.resident.group === a.group);
    if (mine.length >= MAX_EXTRAS_PER_GROUP) continue;
    let n = 0;
    while (states.some((s) => s.resident.id === `ext-${a.group}-${n}`)) n++;
    const resident = extraResident(a.group, n, layout, states.filter((s) => s.extra && s.resident.group === a.group).map((s) => s.resident.seat).filter((x): x is number => x !== null));
    const room = roomOf(a.group, layout);
    let desk: Place;
    if (resident.seat !== null) {
      desk = deskPlace({ ...resident, seat: resident.seat }, layout);
    } else {
      const occupied = [...layout.desks.map((d) => spotFor(d.group, d.seat, layout)), ...states.map((s) => s.at.pos)];
      const spot = waitingSpots(a.group, 1, layout, occupied)[0] ?? spotFor(a.group, 0, layout);
      desk = { id: `wait-${resident.id}`, room: room.id, pos: spot, access: [layout.gates[room.id], spot], pose: "stand", act: "stand", face: 1, back: false, kind: "stretch" };
    }
    const dispatch = dispatchPlace(layout, resident.id);
    const first: Point[] = [...layout.entryPath];
    if (!layout.entryRooms.includes("command")) first.push(...chainBetween(layout, layout.entryRooms, "command"));
    if (layout.hallX !== null) first.push(layout.gates.command);
    const route = dedupe([...first, dispatch.pos]);
    const arriveAt = now + routeLength(route) / WALK_SPEED;
    states.push({
      resident, desk, at: dispatch, route, startedAt: now, arriveAt, until: Number.MAX_SAFE_INTEGER, job: a.id,
      bubble: fill(labels.summoned, { role: roleName(resident.role) }), bubbleUntil: arriveAt + DISPATCH_MS, chatWith: null,
      extra: true, dispatchUntil: arriveAt + DISPATCH_MS,
    });
  }
}

/** Extra people whose agent has finished walk back out through the front door and are removed once they get there. */
export function releaseExtras(states: StaffState[], layout: OfficeLayout, now: number): void {
  for (let i = states.length - 1; i >= 0; i--) {
    const s = states[i]!;
    if (!s.extra) continue;
    if (s.exiting) {
      if (now >= s.arriveAt) states.splice(i, 1);
      continue;
    }
    if (s.job !== null) continue;
    // Still walking in: turn around where they are; otherwise leave from the current place.
    const last = layout.entryPath[layout.entryPath.length - 1]!;
    let out: Point[];
    if (now < s.arriveAt) {
      // Still walking in: back along the points already passed.
      const here = positionAlong(s.route, now - s.startedAt).pos;
      let left = Math.max(0, now - s.startedAt) * WALK_SPEED;
      const passed: Point[] = [s.route[0]!];
      for (let k = 1; k < s.route.length; k++) {
        const len = Math.hypot(s.route[k]!.x - s.route[k - 1]!.x, s.route[k]!.y - s.route[k - 1]!.y);
        if (left < len) break;
        left -= len;
        passed.push(s.route[k]!);
      }
      out = dedupe([here, ...passed.reverse()]);
    } else {
      const ret: Place = { ...entryPlace(layout), pos: last, access: [last] };
      out = dedupe([...routeBetween(s.at, ret, layout), layout.entryPath[0]!]);
    }
    if (out.length < 2) out = dedupe([...out, layout.entryPath[0]!]);
    s.exiting = true;
    s.dispatchUntil = undefined;
    s.leaving = null;
    s.standUntil = 0;
    s.route = out;
    s.startedAt = now;
    s.arriveAt = now + routeLength(out) / WALK_SPEED;
    s.bubble = "";
    s.at = { ...entryPlace(layout), id: `exit-${s.resident.id}`, pos: layout.entryPath[0]!, access: [layout.entryPath[0]!] };
  }
}
