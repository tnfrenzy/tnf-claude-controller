// Decoration of the four-room office (WIDE plan): extra furniture and wall items that make rooms look used.
// Pure data. Floor items never block a seat, a standby strip, a doorway or a walking route (tests/office-decor.test.ts).
import type { OfficeLayout, Rect, RoomId } from "./layout.js";

export type DecorKind = "cabinet" | "rack" | "bench" | "counter" | "fridge" | "reception";

/** A box standing on the floor. `z` is its height in plan units. */
export interface DecorBox extends Rect {
  id: string;
  room: RoomId;
  kind: DecorKind;
  z: number;
  color: string;
}

export type WallKind = "whiteboard" | "screen" | "clock" | "poster";

/** Something hung on the north wall of a room between plan x `from` and `to`. */
export interface WallItem {
  id: string;
  room: RoomId;
  kind: WallKind;
  from: number;
  to: number;
}

/** A flat rug or runner on the floor. */
export interface Rug extends Rect {
  id: string;
  room: RoomId;
  color: string;
}

export interface Decor {
  boxes: DecorBox[];
  walls: WallItem[];
  rugs: Rug[];
}

const CABINET = "#8794ad";
const RACK = "#3b4258";
const BENCH = "#9aa5bd";

export const DECOR_WIDE: Decor = {
  boxes: [
    { id: "cab-analyst-1", room: "analyst", kind: "cabinet", x: 280, y: 452, w: 30, h: 30, z: 52, color: CABINET },
    { id: "cab-analyst-2", room: "analyst", kind: "cabinet", x: 316, y: 452, w: 30, h: 30, z: 52, color: CABINET },
    { id: "cab-critic-1", room: "critic", kind: "cabinet", x: 960, y: 452, w: 30, h: 30, z: 52, color: CABINET },
    { id: "cab-critic-2", room: "critic", kind: "cabinet", x: 996, y: 452, w: 30, h: 30, z: 52, color: CABINET },
    { id: "rack-qa-1", room: "qa", kind: "rack", x: 290, y: 888, w: 40, h: 34, z: 70, color: RACK },
    { id: "rack-qa-2", room: "qa", kind: "rack", x: 336, y: 888, w: 40, h: 34, z: 70, color: RACK },
    { id: "bench-sub-1", room: "subagent", kind: "bench", x: 960, y: 890, w: 50, h: 30, z: 30, color: BENCH },
    { id: "bench-sub-2", room: "subagent", kind: "bench", x: 1020, y: 890, w: 50, h: 30, z: 30, color: BENCH },
    { id: "kitchen-counter", room: "command", kind: "counter", x: 250, y: 48, w: 64, h: 28, z: 34, color: "#b9a487" },
    { id: "kitchen-fridge", room: "command", kind: "fridge", x: 320, y: 46, w: 30, h: 30, z: 62, color: "#cfd6e0" },
    { id: "kitchen-sink", room: "command", kind: "counter", x: 40, y: 48, w: 52, h: 28, z: 34, color: "#a9b6c4" },
    { id: "kitchen-hob", room: "command", kind: "counter", x: 356, y: 48, w: 40, h: 28, z: 36, color: "#2f3440" },
    { id: "rest-books", room: "command", kind: "cabinet", x: 806, y: 48, w: 30, h: 30, z: 40, color: "#a58b6f" },
    { id: "rest-coffee", room: "command", kind: "counter", x: 1092, y: 200, w: 36, h: 28, z: 34, color: "#b9a487" },
    { id: "rest-armchair", room: "command", kind: "bench", x: 1000, y: 252, w: 44, h: 34, z: 26, color: "#8a6fa0" },
    { id: "rest-lamp", room: "command", kind: "cabinet", x: 1132, y: 150, w: 16, h: 16, z: 90, color: "#d9c27a" },
    { id: "reception", room: "hall", kind: "reception", x: 544, y: 1115, w: 28, h: 56, z: 34, color: "#8a6a4a" },
  ],
  walls: [
    { id: "wb-analyst", room: "analyst", kind: "whiteboard", from: 360, to: 440 },
    { id: "clock-analyst", room: "analyst", kind: "clock", from: 120, to: 150 },
    { id: "wb-critic", room: "critic", kind: "whiteboard", from: 1040, to: 1110 },
    { id: "poster-critic", room: "critic", kind: "poster", from: 780, to: 830 },
    { id: "screen-qa", room: "qa", kind: "screen", from: 390, to: 470 },
    { id: "clock-qa", room: "qa", kind: "clock", from: 140, to: 170 },
    { id: "screen-sub", room: "subagent", kind: "screen", from: 1060, to: 1130 },
    { id: "poster-sub", room: "subagent", kind: "poster", from: 790, to: 840 },
    { id: "screen-command", room: "command", kind: "screen", from: 500, to: 700 },
    { id: "board-command", room: "command", kind: "whiteboard", from: 860, to: 960 },
  ],
  rugs: [
    { id: "rug-lounge", room: "command", x: 830, y: 110, w: 150, h: 90, color: "#6b4f8a" },
    { id: "runner-hall", room: "hall", x: 572, y: 450, w: 56, h: 820, color: "#3f5f8a" },
  ],
};

/** Decoration for a layout: only the desktop plan has any (the phone plan is a plain stack of rooms). */
export function decorFor(layout: OfficeLayout): Decor {
  return layout.hallX !== null ? DECOR_WIDE : { boxes: [], walls: [], rugs: [] };
}
