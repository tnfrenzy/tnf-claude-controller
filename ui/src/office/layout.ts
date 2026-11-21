/**
 * Geometry + role metadata for the built-in 2.5D office (WIDE plan 1200x1360, NARROW 400x2405).
 * A wide coordination room on top (kitchen left, work area middle, rest area right), a lobby down the middle to the
 * front door and four work rooms beside it (stacked in one column on the phone plan), joined by doorways:
 *   command (coordinator) / analyst (analyst + planner) / critic (critic + implementer) / qa (qa + debug) / subagent.
 * The research role set shares the rooms through `groupForRole` (searcher/analyzer -> analyst, synthesizer -> implementer).
 */

export type DeskGroup = "coordinator" | "analyst" | "critic" | "implementer" | "qa" | "debug" | "subagent";

export type RoomId = "command" | "hall" | "analyst" | "critic" | "qa" | "subagent";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Desk {
  group: DeskGroup;
  seat: number;
  /** Top-left corner of the desk top. */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Chair side: agent sits below ("s") or above ("n") the desk. */
  side: "n" | "s";
}

export interface Room {
  id: RoomId;
  x: number;
  y: number;
  w: number;
  h: number;
  /** Desk groups housed by this room (the first one is the room's main group). */
  groups: DeskGroup[];
  labelKey:
    | "room_command"
    | "room_dev"
    | "room_coordinator"
    | "room_analyst"
    | "room_critic"
    | "room_implementer"
    | "room_debug"
    | "room_subagent"
    | "room_qa"
    | "room_lobby";
}

/** Doorway in the wall gap between two rooms. */
export interface RoomLink extends Rect {
  a: RoomId;
  b: RoomId;
}

/** Decorative furniture of one room (never interactive, never blocks a seat or standby spot). */
export interface Furniture {
  /** Decorative chairs (radius 12). */
  chairs: Point[];
  shelves: Rect[];
  sofas: Rect[];
  /** Meeting tables. */
  tables: Rect[];
  /** Potted plants (occupy a 28x28 box around the centre). */
  plants: Point[];
  /** Water coolers. */
  coolers: Rect[];
  /** Rest beds (a person lies along the x axis, head to the east end). */
  beds?: Rect[];
}

const EMPTY_FURNITURE: Furniture = { chairs: [], shelves: [], sofas: [], tables: [], plants: [], coolers: [] };

/** One geometry set. WIDE is the desktop floor plan; NARROW stacks the four rooms in one column for phones (≤ 480 px). */
export interface OfficeLayout {
  scene: { w: number; h: number };
  /** Point outside the building where agents walk in from and out to. */
  door: Point;
  /** Main entrance opening in the building's outer wall (door.y lies below it). */
  entrance: Rect;
  rooms: Room[];
  /** Doorways between two rooms (each lies in the wall gap and touches both rooms). */
  links: RoomLink[];
  desks: Desk[];
  plants: Point[];
  /** Standing strip per room where overflow agents wait (clear of desks, chairs and links). */
  standby: Record<RoomId, Rect>;
  /** Extra y offset applied to odd standby columns so neighbouring standing spots do not overlap. */
  standbyStagger: number;
  /** Walking path from `door` that ends at a doorway centre (WIDE) or inside the first room (NARROW). */
  entryPath: Point[];
  /** Rooms adjacent to the end of `entryPath` (the BFS for room-to-room routes starts from all of them). */
  entryRooms: RoomId[];
  /** Centre line of the lobby (WIDE plan); null on the phone plan, which has no lobby. */
  hallX: number | null;
  /** Point just inside each room's doorway, on a clear lane; seats are reached from here. */
  gates: Record<RoomId, Point>;
  /** Places staff go when they are not working (drink, rest, chat, phone). */
  leisure: LeisureSpot[];
  /** Decorative furniture per room. */
  furniture: Record<RoomId, Furniture>;
}

/** A spot where a resident can spend a moment: where to stand/sit, how, and the points to walk from the room's gate. */
export interface LeisureSpot {
  id: string;
  room: RoomId;
  kind: "sofa" | "drink" | "chat" | "phone" | "kitchen" | "bed";
  pose: "stand" | "sofa" | "lie";
  act: "resting" | "drinking" | "talking" | "phone" | "sleeping";
  face: 1 | -1;
  pos: Point;
  /** Walking points from the room gate (or the lobby centre line) to `pos`, ending at `pos`. */
  access: Point[];
}

export const SCENE = { w: 1200, h: 1360 } as const;

/** Entrance (agents walk in from and out to this point), outside the building, below the lobby. */
export const DOOR: Point = { x: 600, y: 1340 };

/** The command room (x 40..1160) in three vertical zones: kitchen on the left, the single workstation in the middle, rest area on the right. */
export const COMMAND_ZONES = {
  kitchen: { x: 40, w: 360 },
  work: { x: 400, w: 400 },
  rest: { x: 800, w: 360 },
} as const;

/** Centre line of the lobby that agents walk along. */
export const HALL_X = 600;

/**
 * Desktop plan: the coordination room sits on top; below it a lobby (hall) runs down the middle to the front door,
 * with the four work rooms on its left and right, each opening onto the lobby through its own doorway.
 * Every room has a "gate" just inside its doorway on a clear lane, and desks are reached through aisles.
 */
export const ROOMS: Room[] = [
  { id: "command", x: 40, y: 40, w: 1120, h: 360, groups: ["coordinator"], labelKey: "room_coordinator" },
  { id: "hall", x: 540, y: 440, w: 120, h: 840, groups: [], labelKey: "room_lobby" },
  { id: "analyst", x: 40, y: 440, w: 460, h: 400, groups: ["analyst"], labelKey: "room_analyst" },
  { id: "critic", x: 700, y: 440, w: 460, h: 400, groups: ["critic", "implementer"], labelKey: "room_dev" },
  { id: "qa", x: 40, y: 880, w: 460, h: 400, groups: ["qa", "debug"], labelKey: "room_debug" },
  { id: "subagent", x: 700, y: 880, w: 460, h: 400, groups: ["subagent"], labelKey: "room_subagent" },
];

const DESK_W = 124;
const DESK_H = 54;

function deskRow(group: DeskGroup, firstSeat: number, xs: number[], y: number, h = DESK_H): Desk[] {
  return xs.map((x, i) => ({ group, seat: firstSeat + i, x, y, w: DESK_W, h, side: "s" as const }));
}

const LEFT = [60, 200, 340];
const RIGHT = [740, 880, 1020];

export const DESKS: Desk[] = [
  ...deskRow("coordinator", 0, [538], 130),
  ...deskRow("analyst", 0, LEFT, 490),
  ...deskRow("analyst", 3, LEFT, 640),
  ...deskRow("critic", 0, RIGHT, 490),
  ...deskRow("implementer", 0, RIGHT.slice(0, 2), 640),
  ...deskRow("qa", 0, LEFT, 930),
  ...deskRow("debug", 0, LEFT.slice(0, 2), 1080),
  ...deskRow("subagent", 0, RIGHT, 930),
];

export const WIDE: OfficeLayout = {
  scene: SCENE,
  door: DOOR,
  entrance: { x: 560, y: 1280, w: 80, h: 40 },
  rooms: ROOMS,
  links: [
    { a: "command", b: "hall", x: 570, y: 400, w: 60, h: 40 },
    { a: "analyst", b: "hall", x: 500, y: 760, w: 40, h: 60 },
    { a: "critic", b: "hall", x: 660, y: 760, w: 40, h: 60 },
    { a: "qa", b: "hall", x: 500, y: 1200, w: 40, h: 60 },
    { a: "subagent", b: "hall", x: 660, y: 1200, w: 40, h: 60 },
  ],
  desks: DESKS,
  plants: [{ x: 560, y: 530 }, { x: 640, y: 1240 }, { x: 1130, y: 70 }],
  standby: {
    command: { x: 400, y: 290, w: 400, h: 70 },
    hall: { x: 550, y: 670, w: 100, h: 40 },
    analyst: { x: 70, y: 760, w: 380, h: 70 },
    critic: { x: 730, y: 760, w: 380, h: 70 },
    qa: { x: 70, y: 1200, w: 380, h: 70 },
    subagent: { x: 730, y: 1200, w: 380, h: 70 },
  },
  standbyStagger: 14,
  entryPath: [{ x: 600, y: 1305 }, { x: 600, y: 1250 }],
  entryRooms: ["hall"],
  hallX: HALL_X,
  gates: {
    command: { x: 600, y: 350 },
    hall: { x: 600, y: 710 },
    analyst: { x: 482, y: 790 },
    critic: { x: 718, y: 790 },
    qa: { x: 482, y: 1230 },
    subagent: { x: 718, y: 1230 },
  },
  leisure: [
    { id: "lounge", room: "command", kind: "sofa", pose: "sofa", act: "resting", face: 1, pos: { x: 905, y: 90 }, access: [{ x: 880, y: 350 }, { x: 880, y: 150 }, { x: 905, y: 150 }, { x: 905, y: 90 }] },
    { id: "bed", room: "command", kind: "bed", pose: "lie", act: "sleeping", face: 1, pos: { x: 1050, y: 140 }, access: [{ x: 960, y: 350 }, { x: 960, y: 190 }, { x: 1050, y: 190 }, { x: 1050, y: 140 }] },
    { id: "kitchen", room: "command", kind: "kitchen", pose: "stand", act: "drinking", face: -1, pos: { x: 282, y: 100 }, access: [{ x: 600, y: 350 }, { x: 300, y: 350 }, { x: 300, y: 100 }, { x: 282, y: 100 }] },
    { id: "cooler", room: "hall", kind: "drink", pose: "stand", act: "drinking", face: -1, pos: { x: 594, y: 1023 }, access: [{ x: 600, y: 1023 }, { x: 594, y: 1023 }] },
    { id: "chat-a", room: "hall", kind: "chat", pose: "stand", act: "talking", face: 1, pos: { x: 584, y: 610 }, access: [{ x: 600, y: 610 }, { x: 584, y: 610 }] },
    { id: "chat-b", room: "hall", kind: "chat", pose: "stand", act: "talking", face: -1, pos: { x: 616, y: 610 }, access: [{ x: 600, y: 610 }, { x: 616, y: 610 }] },
    { id: "phone", room: "hall", kind: "phone", pose: "stand", act: "phone", face: 1, pos: { x: 628, y: 770 }, access: [{ x: 600, y: 770 }, { x: 628, y: 770 }] },
  ],
  furniture: {
    command: {
      ...EMPTY_FURNITURE,
      chairs: [{ x: 90, y: 250 }, { x: 230, y: 250 }, { x: 110, y: 166 }, { x: 240, y: 166 }],
      shelves: [{ x: 440, y: 46, w: 130, h: 26 }, { x: 100, y: 46, w: 130, h: 26 }, { x: 1010, y: 46, w: 90, h: 26 }],
      sofas: [{ x: 840, y: 60, w: 130, h: 40 }],
      beds: [{ x: 1000, y: 110, w: 100, h: 60 }],
      tables: [{ x: 100, y: 190, w: 160, h: 40 }, { x: 1000, y: 200, w: 70, h: 30 }],
      plants: [{ x: 1130, y: 330 }],
    },
    hall: {
      ...EMPTY_FURNITURE,
      sofas: [],
      coolers: [{ x: 546, y: 1010, w: 26, h: 26 }],
      plants: [{ x: 560, y: 870 }],
    },
    analyst: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 60, y: 450, w: 200, h: 26 }],
      plants: [{ x: 470, y: 460 }, { x: 480, y: 810 }],
    },
    critic: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 740, y: 450, w: 200, h: 26 }],
      plants: [{ x: 1130, y: 460 }, { x: 1130, y: 810 }],
    },
    qa: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 60, y: 890, w: 200, h: 26 }],
      plants: [{ x: 470, y: 900 }, { x: 480, y: 1250 }],
    },
    subagent: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 740, y: 890, w: 200, h: 26 }],
      plants: [{ x: 1130, y: 900 }, { x: 1130, y: 1250 }],
    },
  },
};

/**
 * Phone plan: 400 wide, the rooms stacked in one column (360 wide, 20 px wall gaps), each opening onto the next,
 * so every room keeps its desks side by side (two per row). The front door opens onto the last room.
 * Agents walk the free centre column (x = 200) and turn off it to their chair.
 */
const NX = { left: 40, right: 216 };
export const NARROW: OfficeLayout = {
  scene: { w: 400, h: 2405 },
  door: { x: 200, y: 2385 },
  entrance: { x: 160, y: 2325, w: 80, h: 30 },
  rooms: [
    { id: "command", x: 20, y: 40, w: 360, h: 375, groups: ["coordinator"], labelKey: "room_coordinator" },
    { id: "analyst", x: 20, y: 435, w: 360, h: 470, groups: ["analyst"], labelKey: "room_analyst" },
    { id: "critic", x: 20, y: 925, w: 360, h: 500, groups: ["critic", "implementer"], labelKey: "room_dev" },
    { id: "qa", x: 20, y: 1445, w: 360, h: 500, groups: ["qa", "debug"], labelKey: "room_debug" },
    { id: "subagent", x: 20, y: 1965, w: 360, h: 360, groups: ["subagent"], labelKey: "room_subagent" },
  ],
  links: [
    { a: "command", b: "analyst", x: 160, y: 415, w: 80, h: 20 },
    { a: "analyst", b: "critic", x: 160, y: 905, w: 80, h: 20 },
    { a: "critic", b: "qa", x: 160, y: 1425, w: 80, h: 20 },
    { a: "qa", b: "subagent", x: 160, y: 1945, w: 80, h: 20 },
  ],
  desks: [
    ...deskRow("coordinator", 0, [NX.left], 100),
    ...deskRow("analyst", 0, [NX.left, NX.right], 495),
    ...deskRow("analyst", 2, [NX.left, NX.right], 619),
    ...deskRow("analyst", 4, [NX.left, NX.right], 743),
    ...deskRow("critic", 0, [NX.left, NX.right], 985),
    ...deskRow("critic", 2, [NX.left], 1109),
    ...deskRow("implementer", 0, [NX.right], 1109),
    ...deskRow("implementer", 1, [NX.left], 1233),
    ...deskRow("qa", 0, [NX.left, NX.right], 1505),
    ...deskRow("qa", 2, [NX.left], 1629),
    ...deskRow("debug", 0, [NX.right], 1629),
    ...deskRow("debug", 1, [NX.left], 1753),
    ...deskRow("subagent", 0, [NX.left, NX.right], 2025),
    ...deskRow("subagent", 2, [NX.left], 2149),
  ],
  plants: [{ x: 364, y: 66 }, { x: 364, y: 460 }, { x: 364, y: 950 }, { x: 364, y: 1470 }, { x: 364, y: 1990 }],
  standby: {
    command: { x: 50, y: 331, w: 300, h: 70 },
    hall: { x: 50, y: 0, w: 300, h: 10 },
    analyst: { x: 50, y: 854, w: 300, h: 40 },
    critic: { x: 50, y: 1345, w: 300, h: 70 },
    qa: { x: 50, y: 1865, w: 300, h: 70 },
    subagent: { x: 50, y: 2260, w: 300, h: 55 },
  },
  standbyStagger: 20,
  entryPath: [{ x: 200, y: 2360 }, { x: 200, y: 2285 }],
  entryRooms: ["subagent"],
  hallX: null,
  gates: {
    command: { x: 200, y: 366 },
    hall: { x: 200, y: 0 },
    analyst: { x: 200, y: 874 },
    critic: { x: 200, y: 1385 },
    qa: { x: 200, y: 1905 },
    subagent: { x: 200, y: 2285 },
  },
  leisure: [],
  furniture: {
    command: {
      ...EMPTY_FURNITURE,
      sofas: [{ x: 36, y: 222, w: 130, h: 40 }],
      tables: [{ x: 50, y: 284, w: 80, h: 32 }],
      chairs: [{ x: 36, y: 300 }, { x: 150, y: 300 }],
      plants: [{ x: 186, y: 240 }],
    },
    hall: EMPTY_FURNITURE,
    analyst: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 346, y: 490, w: 26, h: 180 }],
      plants: [{ x: 366, y: 885 }],
    },
    critic: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 346, y: 985, w: 26, h: 100 }],
      plants: [{ x: 366, y: 1400 }],
    },
    qa: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 346, y: 1505, w: 26, h: 100 }],
      plants: [{ x: 366, y: 1920 }],
    },
    subagent: {
      ...EMPTY_FURNITURE,
      shelves: [{ x: 346, y: 2025, w: 26, h: 100 }],
      plants: [{ x: 366, y: 2300 }],
    },
  },
};

/** Pick the plan for a container width (CSS breakpoint 480 px, SPEC v1 §6.4). */
export function layoutFor(width: number): OfficeLayout {
  return width > 0 && width <= 480 ? NARROW : WIDE;
}

export const DESK_GROUPS: DeskGroup[] = ["coordinator", "analyst", "critic", "implementer", "qa", "debug", "subagent"];

/** Role name → room. Covers both role sets plus common synonyms; anything else is a subagent (subagent room). */
export function groupForRole(role: string): DeskGroup {
  const r = role.toLowerCase();
  if (r === "coordinator") return "coordinator";
  if (r.endsWith("-bot")) return "subagent";
  // coding set
  if (r.includes("analyst") || r.includes("plan")) return "analyst";
  if (r.includes("critic") || r.includes("review")) return "critic";
  if (r.includes("implement") || r.includes("coder") || r.includes("developer")) return "implementer";
  if (r.includes("debug")) return "debug";
  if (r === "qa" || r.startsWith("qa") || r.includes("test")) return "qa";
  // research set shares the rooms
  if (r.includes("search") || r.includes("analy")) return "analyst";
  if (r.includes("synth") || r.includes("writer")) return "implementer";
  return "subagent";
}

/** The room housing a desk group (falls back to the first room). */
export function roomOf(group: DeskGroup, layout: OfficeLayout = WIDE): Room {
  return layout.rooms.find((r) => r.groups.includes(group)) ?? layout.rooms[0]!;
}

export function deskFor(group: DeskGroup, seat: number, layout: OfficeLayout = WIDE): Desk | undefined {
  return layout.desks.find((d) => d.group === group && d.seat === seat);
}

/**
 * Where an agent stands/sits: in front of its desk, or a "standing" spot inside the room when seats are full.
 * Overflow spots are 16 slots in the room's standby band (k mod 16, never on a desk), staggered in y by column
 * (odd columns drop by `standbyStagger`). A later group in a shared room uses the next row (30 px lower) and
 * fills the slots from the right.
 */
export function spotFor(group: DeskGroup, seat: number, layout: OfficeLayout = WIDE): Point {
  const d = deskFor(group, seat, layout);
  if (d) return { x: d.x + d.w / 2, y: d.side === "s" ? d.y + d.h + 36 : d.y - 36 };
  const room = roomOf(group, layout);
  const gi = Math.max(0, room.groups.indexOf(group));
  const n = layout.desks.filter((x) => x.group === group).length;
  const k = seat - n;
  const band = layout.standby[room.id];
  const i = k % 16;
  const step = (band.w - 40) / 15;
  const col = gi === 0 ? i : 15 - i;
  return {
    x: band.x + 20 + col * step,
    y: band.y + 20 + 30 * gi + (col % 2 === 1 ? layout.standbyStagger : 0),
  };
}

function samePoint(a: Point, b: Point): boolean {
  return a.x === b.x && a.y === b.y;
}

const centreOf = (l: RoomLink): Point => ({ x: l.x + l.w / 2, y: l.y + l.h / 2 });

/** Shortest chain of rooms from any of `from` to `to` over the doorway links (BFS). Includes both ends. */
function roomPath(layout: OfficeLayout, from: readonly RoomId[], to: RoomId): Array<{ room: RoomId; via: RoomLink | null }> {
  const prev = new Map<RoomId, { from: RoomId; link: RoomLink } | null>();
  const queue: RoomId[] = [];
  for (const r of from) {
    prev.set(r, null);
    queue.push(r);
  }
  while (queue.length > 0 && !prev.has(to)) {
    const cur = queue.shift()!;
    for (const l of layout.links) {
      const next = l.a === cur ? l.b : l.b === cur ? l.a : undefined;
      if (next && !prev.has(next)) {
        prev.set(next, { from: cur, link: l });
        queue.push(next);
      }
    }
  }
  const out: Array<{ room: RoomId; via: RoomLink | null }> = [];
  let at: RoomId = to;
  for (let e = prev.get(at); ; e = prev.get(at)) {
    out.unshift({ room: at, via: e ? e.link : null });
    if (!e) break;
    at = e.from;
  }
  return out;
}

/**
 * Waypoints crossed when walking from room `from` to room `to`: for every doorway its centre, plus the point on the
 * lobby centre line (so people walk along the lobby, not through its walls). Does not include the gates.
 */
export function chainBetween(layout: OfficeLayout, from: readonly RoomId[], to: RoomId): Point[] {
  const path = roomPath(layout, from, to);
  const pts: Point[] = [];
  for (let i = 1; i < path.length; i++) {
    const link = path[i]!.via;
    if (!link) continue;
    const c = centreOf(link);
    const fromHall = layout.hallX !== null && path[i - 1]!.room === "hall";
    const toHall = layout.hallX !== null && path[i]!.room === "hall";
    if (fromHall) pts.push({ x: layout.hallX!, y: c.y });
    pts.push(c);
    if (toHall) pts.push({ x: layout.hallX!, y: c.y });
  }
  return pts;
}

/**
 * Points from a room's gate (just inside its doorway, on a clear lane) to the spot of a seat, in walking order,
 * ending at the spot. Desks with another desk right below them are reached through the aisle between the two rows;
 * everything else is reached straight from the lane. On the phone plan agents walk the centre column.
 */
export function accessFor(group: DeskGroup, seat: number, layout: OfficeLayout = WIDE): Point[] {
  const spot = spotFor(group, seat, layout);
  const room = roomOf(group, layout);
  const gate = layout.gates[room.id];
  if (layout.hallX === null) return [{ x: gate.x, y: spot.y }, spot];
  const d = deskFor(group, seat, layout);
  if (d) {
    const below = layout.desks
      .filter((o) => o !== d && roomOf(o.group, layout).id === room.id && Math.abs(o.x - d.x) < 1 && o.y > d.y)
      .sort((p, q) => p.y - q.y)[0];
    if (below) {
      const aisle = (spot.y + 17 + below.y) / 2;
      return [{ x: gate.x, y: aisle }, { x: spot.x, y: aisle }, spot];
    }
  }
  return [{ x: spot.x, y: gate.y }, spot];
}

/**
 * Walking route from the door to the agent's spot: door, entryPath, the doorways crossed between the entry rooms and
 * the target room (lobby centre line included), the room's gate, the aisle points, then the spot.
 * Consecutive duplicates are dropped.
 */
export function routeFor(group: DeskGroup, seat: number, layout: OfficeLayout = WIDE): Point[] {
  const target = roomOf(group, layout).id;
  const chain = layout.entryRooms.includes(target) ? [] : chainBetween(layout, layout.entryRooms, target);
  const gate = layout.hallX !== null ? [layout.gates[target]] : [];
  const out: Point[] = [];
  for (const p of [layout.door, ...layout.entryPath, ...chain, ...gate, ...accessFor(group, seat, layout)]) {
    if (out.length === 0 || !samePoint(out[out.length - 1]!, p)) out.push(p);
  }
  return out;
}

/** Walking time of one segment at 0.3 px/ms, clamped to [200, 2500] ms. */
export function segmentMs(a: Point, b: Point): number {
  return Math.min(2500, Math.max(200, Math.hypot(a.x - b.x, a.y - b.y) / 0.3));
}

export interface WalkStep {
  p: Point;
  ms: number;
  /** Delay (ms) from the start of the walk until this step is commanded (sum of the previous steps' ms). */
  at: number;
}

/**
 * Steps of a walk along `route`. "in": from route[fromIdx] to the last point. "out": back from route[fromIdx]
 * through route[fromIdx-1] ... route[0] (empty when fromIdx is 0).
 */
export function buildSteps(route: Point[], fromIdx: number, direction: "in" | "out"): WalkStep[] {
  const steps: WalkStep[] = [];
  let at = 0;
  const push = (from: Point, to: Point) => {
    const ms = segmentMs(from, to);
    steps.push({ p: to, ms, at });
    at += ms;
  };
  if (direction === "in") {
    for (let j = fromIdx + 1; j < route.length; j++) push(route[j - 1]!, route[j]!);
  } else {
    for (let j = fromIdx - 1; j >= 0; j--) push(route[j + 1]!, route[j]!);
  }
  return steps;
}

/** One work chair per desk, centred on the agent's spot (radius 17 in the scene). */
export function deskChairs(layout: OfficeLayout): Array<Point & { group: DeskGroup; seat: number }> {
  return layout.desks.map((d) => ({ ...spotFor(d.group, d.seat, layout), group: d.group, seat: d.seat }));
}

export const ROLE_COLORS: Record<DeskGroup, string> = {
  coordinator: "#2563eb",
  analyst: "#0e9f6e",
  critic: "#a855f7",
  implementer: "#ea580c",
  qa: "#0891b2",
  debug: "#e11d48",
  subagent: "#6b7280",
};

export const TOOL_ICONS: Record<string, string> = {
  WebSearch: "🔍",
  WebFetch: "🌐",
  Read: "📄",
  Write: "✍️",
  Edit: "✏️",
  Agent: "👥",
  Task: "👥",
  Bash: "⌨️",
  Glob: "🗂️",
  Grep: "🔎",
};

export function toolIcon(tool: string | undefined): string {
  if (!tool) return "🔧";
  const key = Object.keys(TOOL_ICONS).find((k) => tool.startsWith(k));
  return key ? TOOL_ICONS[key]! : "🔧";
}
