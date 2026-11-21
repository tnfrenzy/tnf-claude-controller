import { memo, type ReactElement, type ReactNode } from "react";
import { CHAIR_BACK_BIAS, CHAIR_BASE_BIAS, furnitureDepth, project } from "../../office/iso/depth";
import { FURN, type Rect } from "../../office/iso/grid";

// Furniture drawing helpers ported from docs/design/single-screen.html (box, dropShadow, shade).
// No text on any furniture.

/** Scale a #rrggbb colour by k, clamped to 0-255 (same as the sample's shade()). */
export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number): number => Math.max(0, Math.min(255, v * k)) | 0;
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}

type Pt = { x: number; y: number };
export const ptsStr = (a: Pt[]): string => a.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");

export interface IsoBoxProps { r: Rect; h: number; color: string; lift?: number }

/** Box with three shaded faces (top 1.18, left .62, right .82) and a light edge along e-c-b. */
export const isoBox = ({ r, h, color, lift = 0 }: IsoBoxProps) => {
  const { u, v, w, d } = r;
  const a = project(u, v, h + lift), b = project(u + w, v, h + lift), c = project(u + w, v + d, h + lift), e = project(u, v + d, h + lift);
  const a0 = project(u, v + d, lift), b0 = project(u + w, v + d, lift), c0 = project(u + w, v, lift);
  return (
    <g>
      <polygon points={ptsStr([e, c, b0, a0])} fill={shade(color, 0.62)} />
      <polygon points={ptsStr([b, c, b0, c0])} fill={shade(color, 0.82)} />
      <polygon points={ptsStr([a, b, c, e])} fill={shade(color, 1.18)} />
      <polyline points={ptsStr([e, c, b])} fill="none" stroke="#fff" strokeWidth={0.8} opacity={0.18} />
    </g>
  );
};

export const IsoBox = memo(function IsoBox(p: IsoBoxProps) { return isoBox(p); });

/** Furniture node for the depth-sorted list (IsoOffice adds the placement). */
export interface FurnNode { id: string; depth: number; node: () => ReactElement }

export type BeaconKind = "idle" | "working" | "done";

/**
 * Beacon colour from IsoState: idle grey, working blue, done green.
 * "summoned" and "reporting" are still busy, so they read as working (blue) until the agent is done.
 */
export function beaconKind(state: string): BeaconKind {
  if (state === "done") return "done";
  if (state === "working" || state === "summoned" || state === "reporting") return "working";
  return "idle";
}
export const BEACON_COLOR: Record<BeaconKind, string> = { idle: "#8b98b3", working: "#5aa0ff", done: "#4fd08a" };

const MUGS = ["#d9b26a", "#e9eef8", "#5aa0ff"];

/** Monitor with stand, bezel, screen and fake text lines (lit when on). */
export function Monitor({ u, v, w = 0.7, on, big = false }: { u: number; v: number; w?: number; on: boolean; big?: boolean }) {
  const z0 = 40, z1 = z0 + (big ? 24 : 20);
  const bez = [project(u, v + 0.2, z1), project(u + w, v + 0.2, z1), project(u + w, v + 0.2, z0), project(u, v + 0.2, z0)];
  const sc = [project(u + 0.04, v + 0.2, z1 - 2), project(u + w - 0.04, v + 0.2, z1 - 2), project(u + w - 0.04, v + 0.2, z0 + 2), project(u + 0.04, v + 0.2, z0 + 2)];
  const lines: Array<[number, number, number]> = [[0.1, 0.55, 4], [0.1, 0.8, 8], [0.1, 0.45, 12], [0.1, 0.7, 16]];
  return (
    <g data-monitor={on ? "on" : "off"}>
      {isoBox({ r: { u: u + w / 2 - 0.12, v: v + 0.1, w: 0.24, d: 0.18 }, h: 6, color: "#30364a", lift: 22 })}
      {isoBox({ r: { u: u + w / 2 - 0.04, v: v + 0.16, w: 0.08, d: 0.06 }, h: 14, color: "#30364a", lift: 28 })}
      <polygon points={ptsStr(bez)} fill="#0b0f18" stroke="#3a4260" strokeWidth={0.8} />
      <polygon data-screen="1" className={on ? "mon" : undefined} points={ptsStr(sc)} fill={on ? "#8ab4ff" : "#182033"} />
      {on && lines.map(([a, b, dz], i) => (
        <polyline key={i} points={ptsStr([project(u + a * w, v + 0.2, z1 - 4 - dz), project(u + b * w, v + 0.2, z1 - 4 - dz)])} stroke="#fff" strokeWidth={1.2} opacity={0.55} fill="none" />
      ))}
    </g>
  );
}

/** Status beacon on the desk corner. */
export const Beacon = memo(function Beacon({ r, kind }: { r: Rect; kind: BeaconKind }) {
  const p = project(r.u + 0.12, r.v + r.d - 0.12, 23);
  return <circle data-beacon={kind} cx={p.x} cy={p.y} r={2.2} fill={BEACON_COLOR[kind]} />;
});

/** Two-tone wood desk with gold-handled drawer, monitor, keyboard, mouse and mug. */
export const Desk = memo(function Desk({ r, on, kind, idx }: { r: Rect; on: boolean; kind: BeaconKind; idx: number }) {
  const { u, v, w, d } = r;
  const hp = project(u + w - 0.4, v + d, 8);
  return (
    <g data-desk={idx}>
      <DropShadow r={r} />
      {isoBox({ r, h: 22, color: "#5e4a38" })}
      <polygon points={ptsStr([project(u + 0.05, v + 0.05, 22.5), project(u + w - 0.05, v + 0.05, 22.5), project(u + w - 0.05, v + d - 0.05, 22.5), project(u + 0.05, v + d - 0.05, 22.5)])} fill="#7a6148" />
      {isoBox({ r: { u: u + w - 0.7, v: v + 0.1, w: 0.6, d: d - 0.2 }, h: 16, color: "#4a3a2c" })}
      <rect x={hp.x - 4} y={hp.y} width={8} height={1.5} fill="#d9b26a" />
      <Monitor u={u + 0.45} v={v} on={on} />
      {isoBox({ r: { u: u + 0.5, v: v + 0.5, w: 0.6, d: 0.22 }, h: 2, color: "#2a3147", lift: 22 })}
      {isoBox({ r: { u: u + 1.25, v: v + 0.5, w: 0.14, d: 0.2 }, h: 2, color: "#cfd6e0", lift: 22 })}
      {isoBox({ r: { u: u + 0.15, v: v + 0.45, w: 0.18, d: 0.18 }, h: 7, color: MUGS[idx % MUGS.length]!, lift: 22 })}
      {on && <ellipse cx={project(u + w / 2, v + 0.4, 36).x} cy={project(u + w / 2, v + 0.4, 36).y} rx={36} ry={18} fill="#8ab4ff" opacity={0.12} />}
      <Beacon r={r} kind={kind} />
    </g>
  );
});

/** Large coordinator desk: two big monitors, desk lamp, keyboard, mouse, mug and status beacon. */
export const CoordDesk = memo(function CoordDesk({ r, on, kind }: { r: Rect; on: boolean; kind: BeaconKind }) {
  const { u, v, w, d } = r;
  const hp = project(u + w - 0.4, v + d, 8);
  const lp = project(u + 2.15, v + 0.3, 22);
  return (
    <g data-desk="coordinator">
      <DropShadow r={r} />
      {isoBox({ r, h: 22, color: "#5e4a38" })}
      <polygon points={ptsStr([project(u + 0.05, v + 0.05, 22.5), project(u + w - 0.05, v + 0.05, 22.5), project(u + w - 0.05, v + d - 0.05, 22.5), project(u + 0.05, v + d - 0.05, 22.5)])} fill="#7a6148" />
      {isoBox({ r: { u: u + w - 0.7, v: v + 0.1, w: 0.6, d: d - 0.2 }, h: 16, color: "#4a3a2c" })}
      <rect x={hp.x - 4} y={hp.y} width={8} height={1.5} fill="#d9b26a" />
      <Monitor u={u + 0.2} v={v} w={0.8} on={on} big />
      <Monitor u={u + 1.15} v={v} w={0.8} on={on} big />
      {isoBox({ r: { u: u + 0.75, v: v + 0.5, w: 0.6, d: 0.22 }, h: 2, color: "#2a3147", lift: 22 })}
      {isoBox({ r: { u: u + 1.5, v: v + 0.5, w: 0.14, d: 0.2 }, h: 2, color: "#cfd6e0", lift: 22 })}
      {isoBox({ r: { u: u + 0.1, v: v + 0.5, w: 0.18, d: 0.18 }, h: 7, color: "#e9eef8", lift: 22 })}
      <g data-lamp="1">
        <line x1={lp.x} y1={lp.y} x2={lp.x + 6} y2={lp.y - 26} stroke="#d9b26a" strokeWidth={1.5} />
        <path d={`M${(lp.x - 2).toFixed(1)} ${(lp.y - 30).toFixed(1)} h16 l-4 8 h-8z`} fill="#d9b26a" />
      </g>
      {on && <ellipse cx={project(u + w / 2, v + 0.4, 40).x} cy={project(u + w / 2, v + 0.4, 40).y} rx={50} ry={22} fill="#8ab4ff" opacity={0.12} />}
      <Beacon r={r} kind={kind} />
    </g>
  );
});

/** Coordinator desk and its split chair (the coordinator seat is FURN.coordSeat). */
export function coordDeskItems(desk: Rect, seat: { u: number; v: number }, on: boolean, state: string): FurnNode[] {
  const kind = beaconKind(state);
  return [
    { id: "coordDesk", depth: furnitureDepth(desk), node: () => <CoordDesk r={desk} on={on} kind={kind} /> },
    ...chairItems("coordDesk", seat),
  ];
}

/** Swivel chair, base part (shadow, post, seat at h7): drawn before the seated person. */
export const ChairBase = memo(function ChairBase({ seat }: { seat: { u: number; v: number } }) {
  const c = project(seat.u, seat.v);
  return (
    <g data-chair="base">
      <ellipse cx={c.x} cy={c.y + 2} rx={14} ry={6} fill="#1a1f2e" />
      <rect x={c.x - 1.5} y={c.y - 14} width={3} height={14} fill="#5b6480" />
      {isoBox({ r: { u: seat.u - 0.32, v: seat.v - 0.32, w: 0.64, d: 0.64 }, h: 7, color: "#2d3a5e", lift: 14 })}
    </g>
  );
});

/** Swivel chair back (h34): drawn after the seated person so it covers them. */
export const ChairBack = memo(function ChairBack({ seat }: { seat: { u: number; v: number } }) {
  return <g data-chair="back">{isoBox({ r: { u: seat.u - 0.32, v: seat.v + 0.22, w: 0.64, d: 0.12 }, h: 34, color: "#34436d", lift: 21 })}</g>;
});

/** Chair base and back as two separate draw items around a seat (sample keys: seat key -0.01 / +0.06). */
export function chairItems(key: string, seat: { u: number; v: number }): FurnNode[] {
  const k = seat.u + seat.v;
  return [
    { id: `${key}:chair`, depth: k + CHAIR_BASE_BIAS, node: () => <ChairBase seat={seat} /> },
    { id: `${key}:chairback`, depth: k + CHAIR_BACK_BIAS, node: () => <ChairBack seat={seat} /> },
  ];
}

/** Desk i: the desk itself (key = furnitureDepth) plus the two chair parts. */
export function deskChairItems(i: number, desk: Rect & { seat: { u: number; v: number } }, on: boolean, state: string): FurnNode[] {
  const kind = beaconKind(state);
  return [
    { id: `desk${i}`, depth: furnitureDepth(desk), node: () => <Desk r={desk} on={on} kind={kind} idx={i} /> },
    ...chairItems(`desk${i}`, desk.seat),
  ];
}

/** Three-cushion sofa with armrests, backrest, gold pillow and gold feet. */
export const Sofa = memo(function Sofa({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  const cw = (w - 0.5) / 3;
  const col = "#7d8fb3";
  const feet = [[u + 0.1, v + 0.1], [u + w - 0.2, v + 0.1], [u + 0.1, v + d - 0.2], [u + w - 0.2, v + d - 0.2]] as const;
  const pil = project(u + 0.5, v + 0.45, 30);
  return (
    <g data-furn="sofa">
      <DropShadow r={r} />
      {feet.map(([fu, fv], i) => <g key={i}>{isoBox({ r: { u: fu, v: fv, w: 0.1, d: 0.1 }, h: 4, color: "#d9b26a" })}</g>)}
      {isoBox({ r: { u, v, w, d: 0.3 }, h: 34, color: "#6a7ca0", lift: 4 })}
      {isoBox({ r: { u, v: v + 0.3, w: 0.25, d: d - 0.3 }, h: 22, color: "#6a7ca0", lift: 4 })}
      {[0, 1, 2].map((i) => (
        <g key={i} data-cushion={i}>{isoBox({ r: { u: u + 0.25 + i * cw, v: v + 0.3, w: cw - 0.02, d: d - 0.3 }, h: 12, color: col, lift: 4 })}</g>
      ))}
      {isoBox({ r: { u: u + w - 0.25, v: v + 0.3, w: 0.25, d: d - 0.3 }, h: 22, color: "#6a7ca0", lift: 4 })}
      <ellipse cx={pil.x} cy={pil.y} rx={7} ry={5} fill="#d9b26a" />
    </g>
  );
});

/** Glass-top coffee table with a magazine and a mug. */
export const CoffeeTable = memo(function CoffeeTable({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  const mg = [project(u + 0.2, v + 0.15, 14.6), project(u + 0.7, v + 0.15, 14.6), project(u + 0.7, v + 0.5, 14.6), project(u + 0.2, v + 0.5, 14.6)];
  return (
    <g data-furn="table">
      <DropShadow r={r} />
      {[[u + 0.05, v + 0.05], [u + w - 0.15, v + 0.05], [u + 0.05, v + d - 0.15], [u + w - 0.15, v + d - 0.15]].map(([fu, fv], i) => (
        <g key={i}>{isoBox({ r: { u: fu!, v: fv!, w: 0.1, d: 0.1 }, h: 12, color: "#d9b26a" })}</g>
      ))}
      {isoBox({ r, h: 14, color: "#8fb8c9", lift: 0 })}
      <polygon points={ptsStr(mg)} fill="#d9534f" />
      {isoBox({ r: { u: u + w - 0.5, v: v + 0.25, w: 0.16, d: 0.16 }, h: 6, color: "#e9eef8", lift: 14 })}
    </g>
  );
});

/** Lounge set: sofa and coffee table as two depth-sorted items (sofa key also keys the lying person). */
export function loungeItems(): FurnNode[] {
  return [
    { id: "sofa", depth: furnitureDepth(FURN.sofa), node: () => <Sofa r={FURN.sofa} /> },
    { id: "table", depth: furnitureDepth(FURN.table), node: () => <CoffeeTable r={FURN.table} /> },
  ];
}

/** Kitchen counter: light stone top, gold-handled lower cabinets, sink with tap, coffee machine with red light, cups, hanging cabinet. */
export const Counter = memo(function Counter({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  const sink = [project(u + 0.5, v + 0.2, 26.4), project(u + 1.2, v + 0.2, 26.4), project(u + 1.2, v + d - 0.2, 26.4), project(u + 0.5, v + d - 0.2, 26.4)];
  const tap = project(u + 0.85, v + 0.25, 26);
  const mu = u + 2.2;
  const led = project(mu + 0.3, v + d - 0.1, 38);
  return (
    <g data-furn="counter">
      <DropShadow r={r} />
      {isoBox({ r, h: 22, color: "#5e4a38" })}
      {isoBox({ r: { u: u - 0.02, v: v - 0.02, w: w + 0.04, d: d + 0.04 }, h: 4, color: "#e6e1d6", lift: 22 })}
      {[0.4, 1.2, 2.0, 2.8].map((o, i) => { const hp = project(u + o, v + d, 14); return <rect key={i} x={hp.x - 3} y={hp.y} width={6} height={1.5} fill="#d9b26a" />; })}
      <polygon points={ptsStr(sink)} fill="#9aa6b8" />
      <path data-tap="1" d={`M${tap.x.toFixed(1)} ${tap.y.toFixed(1)} v-8 q0 -4 4 -4`} fill="none" stroke="#cfd6e0" strokeWidth={1.8} />
      {isoBox({ r: { u: mu, v: v + 0.2, w: 0.5, d: 0.5 }, h: 12, color: "#3a4256", lift: 26 })}
      <circle data-machine-led="1" cx={led.x} cy={led.y} r={1.6} fill="#ff4d4d" />
      {isoBox({ r: { u: mu + 0.7, v: v + 0.4, w: 0.14, d: 0.14 }, h: 5, color: "#e9eef8", lift: 26 })}
      {isoBox({ r: { u: mu + 0.95, v: v + 0.5, w: 0.14, d: 0.14 }, h: 5, color: "#d9b26a", lift: 26 })}
      {isoBox({ r: { u: u + 0.3, v: v + 0.05, w: 2.8, d: 0.3 }, h: 24, color: "#5e4a38", lift: 70 })}
    </g>
  );
});

/** Two-door fridge with handles. */
export const Fridge = memo(function Fridge({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  const h1 = project(u + w - 0.1, v + d, 40), h2 = project(u + w - 0.1, v + d, 20);
  const split = [project(u, v + d, 34), project(u + w, v + d, 34)];
  return (
    <g data-furn="fridge">
      <DropShadow r={r} />
      {isoBox({ r, h: 56, color: "#f1f3f5" })}
      <polyline points={ptsStr(split)} stroke="#9aa6b8" strokeWidth={1} fill="none" />
      <rect data-handle="1" x={h1.x - 1} y={h1.y - 5} width={2} height={8} fill="#8b98b3" />
      <rect data-handle="2" x={h2.x - 1} y={h2.y - 5} width={2} height={8} fill="#8b98b3" />
    </g>
  );
});

/** Water cooler: blue bottle on a light body with a tap. */
export const Cooler = memo(function Cooler({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  const tap = project(u + w / 2, v + d, 18);
  return (
    <g data-furn="cooler">
      <DropShadow r={r} />
      {isoBox({ r, h: 28, color: "#dfe6ee" })}
      {isoBox({ r: { u: u + 0.1, v: v + 0.1, w: w - 0.2, d: d - 0.2 }, h: 22, color: "#8fd0e8", lift: 28 })}
      <rect data-tap="1" x={tap.x - 1.5} y={tap.y} width={3} height={3} fill="#5aa0ff" />
    </g>
  );
});

/** Potted plant with layered leaves. */
export const Plant = memo(function Plant({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  const c = project(u + w / 2, v + d / 2, 20);
  return (
    <g data-furn="plant">
      <DropShadow r={r} />
      {isoBox({ r, h: 18, color: "#8a5a3a" })}
      {[[0, 0, 9, "#3f8a50"], [-6, -8, 8, "#4f9d5d"], [6, -10, 8, "#5fb06c"], [0, -18, 7, "#6cc27a"]].map(([dx, dy, rr, col], i) => (
        <ellipse key={i} data-leaf={i} cx={c.x + (dx as number)} cy={c.y + (dy as number)} rx={(rr as number) + 3} ry={rr as number} fill={col as string} />
      ))}
    </g>
  );
});

/** Kitchen and greenery items keyed by furnitureDepth. */
export function kitchenItems(): FurnNode[] {
  const mk = (id: string, r: Rect, C: (p: { r: Rect }) => ReactNode): FurnNode => ({ id, depth: furnitureDepth(r), node: () => <C r={r} /> });
  return [
    mk("cooler", FURN.cooler, Cooler),
    mk("counter", FURN.counter, Counter),
    mk("fridge", FURN.fridge, Fridge),
    ...FURN.plants.map((r, i) => mk(`plant${i}`, r, Plant)),
  ];
}

/** Soft floor shadow under a footprint (dropShadow() of the sample). */
export const DropShadow = memo(function DropShadow({ r }: { r: Rect }) {
  const { u, v, w, d } = r;
  return (
    <polygon
      points={ptsStr([project(u - 0.1, v - 0.1), project(u + w + 0.15, v - 0.1), project(u + w + 0.15, v + d + 0.15), project(u - 0.1, v + d + 0.15)])}
      fill="#000"
      opacity={0.28}
    />
  );
});
