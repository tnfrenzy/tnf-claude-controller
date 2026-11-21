// Isometric gym furniture and room shell (floor, walls, mirrors, boards). Pure SVG, same style as IsoFurniture:
// three shaded faces per box, drop shadows, metal / rubber colours. Machines that react to the skill take an
// `active` flag (CSS animations live in office/city.css under .iso-gym). Geometry comes from office/gym-layout.ts.
import { memo, type ReactElement } from "react";
import { project } from "../../office/iso/depth";
import { EQUIP_RECTS, GYM_ROOM, MAT_RECTS, type Rect } from "../../office/gym-layout";
import { isoBox, ptsStr, shade } from "./IsoFurniture";

const K = 1 / 42; // px of height to metres of floor (a person is ~74 px = 1.75 m)
type Axis = "u" | "v" | "z";
type Pt = { x: number; y: number };

function discPts(u: number, v: number, z: number, r: number, axis: Axis, n = 22): Pt[] {
  const out: Pt[] = [];
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2, c = Math.cos(a), s = Math.sin(a);
    out.push(axis === "v" ? project(u + K * r * c, v, z + r * s) : axis === "u" ? project(u, v + K * r * c, z + r * s) : project(u + K * r * c, v + K * r * s, z));
  }
  return out;
}

/** Flat disc in the plane perpendicular to `axis` (the viewer sits on the +u/+v side). */
function Disc({ u, v, z, r, axis, fill, stroke, opacity }: { u: number; v: number; z: number; r: number; axis: Axis; fill: string; stroke?: string; opacity?: number }): ReactElement {
  return <polygon points={ptsStr(discPts(u, v, z, r, axis))} fill={fill} {...(stroke ? { stroke, strokeWidth: 0.8 } : {})} {...(opacity !== undefined ? { opacity } : {})} />;
}

/** A weight plate: dark back, coloured front, rim and hub. */
function plate(u: number, v: number, z: number, r: number, axis: Axis, color: string, t = 0.06): ReactElement {
  const du = axis === "u" ? t : 0, dv = axis === "v" ? t : 0;
  return (
    <g>
      <Disc u={u - du} v={v - dv} z={z} r={r} axis={axis} fill={shade(color, 0.5)} />
      <Disc u={u} v={v} z={z} r={r} axis={axis} fill={color} stroke={shade(color, 1.4)} />
      <Disc u={u + du * 0.2} v={v + dv * 0.2} z={z} r={r * 0.42} axis={axis} fill={shade(color, 0.55)} />
      <Disc u={u + du * 0.3} v={v + dv * 0.3} z={z} r={Math.max(1.4, r * 0.16)} axis={axis} fill="#cfd6e0" />
    </g>
  );
}

const quad = (a: Pt, b: Pt, c: Pt, d: Pt, fill: string, extra: Record<string, string | number> = {}): ReactElement => <polygon points={ptsStr([a, b, c, d])} fill={fill} {...extra} />;
const line = (a: Pt, b: Pt, stroke: string, w = 1.2, extra: Record<string, string | number> = {}): ReactElement => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={w} strokeLinecap="round" {...extra} />;

/** Soft drop shadow of a footprint on the floor. */
function Shadow({ r, grow = 0.18 }: { r: Rect; grow?: number }): ReactElement {
  const { u, v, w, d } = r;
  return quad(project(u - grow * 0.3, v - grow * 0.3), project(u + w + grow, v - grow * 0.3), project(u + w + grow, v + d + grow), project(u - grow * 0.3, v + d + grow), "#000", { opacity: 0.28 });
}

/** Text lying on a wall or floor plane: skew follows the plane (u axis +30 deg, v axis -30 deg). */
function SkewText({ at, skew, size, fill, children, anchor = "middle", weight = 700 }: { at: Pt; skew: number; size: number; fill: string; children: string; anchor?: "start" | "middle" | "end"; weight?: number }): ReactElement {
  return <text transform={`translate(${at.x.toFixed(1)},${at.y.toFixed(1)}) skewY(${skew})`} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight} fontFamily="Consolas, 'Courier New', monospace">{children}</text>;
}

const STEEL = "#8e97ab";
const DARK = "#2b303c";
const RUBBER = "#1d2029";

// ---- room shell ---------------------------------------------------------------------------------

export const GymDefs = memo(function GymDefs() {
  return (
    <defs>
      <linearGradient id="gym-mirror" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0" stopColor="#d7ecff" stopOpacity="0.42" />
        <stop offset="0.45" stopColor="#8fb8e0" stopOpacity="0.16" />
        <stop offset="0.55" stopColor="#e6f3ff" stopOpacity="0.36" />
        <stop offset="1" stopColor="#7fa6cf" stopOpacity="0.12" />
      </linearGradient>
      <linearGradient id="gym-bagfill" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#8f2a20" />
        <stop offset="0.4" stopColor="#d4493a" />
        <stop offset="1" stopColor="#7c2018" />
      </linearGradient>
      <radialGradient id="gym-ballfill" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#6fe0d2" />
        <stop offset="1" stopColor="#0c7d73" />
      </radialGradient>
      <radialGradient id="gym-ballfill2" cx="0.35" cy="0.3" r="0.8">
        <stop offset="0" stopColor="#c9a7ff" />
        <stop offset="1" stopColor="#5b34a8" />
      </radialGradient>
      <linearGradient id="gym-steel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stopColor="#c9d1e0" />
        <stop offset="0.5" stopColor="#8e97ab" />
        <stop offset="1" stopColor="#59627a" />
      </linearGradient>
      <clipPath id="gym-clip-beltA"><polygon points={ptsStr(beltPoly(EQUIP_RECTS.treadmillA))} /></clipPath>
      <clipPath id="gym-clip-beltB"><polygon points={ptsStr(beltPoly(EQUIP_RECTS.treadmillB))} /></clipPath>
    </defs>
  );
});

function beltPoly(r: Rect): Pt[] {
  return [project(r.u + 0.2, r.v + 0.5, 10.4), project(r.u + r.w - 0.2, r.v + 0.5, 10.4), project(r.u + r.w - 0.2, r.v + r.d - 0.12, 10.4), project(r.u + 0.2, r.v + r.d - 0.12, 10.4)];
}

const WALL_H = GYM_ROOM.H;
const W = GYM_ROOM.W;
const D = GYM_ROOM.D;

/** Mirror on the right wall (u range) or the left wall (v range), z 24..120, with sheen and frame. */
function mirror(side: "left" | "right", from: number, to: number, z0 = 24, z1 = 120): ReactElement {
  const p = (a: number, z: number): Pt => (side === "right" ? project(a, 0, z) : project(0, a, z));
  const pts = [p(from, z0), p(to, z0), p(to, z1), p(from, z1)];
  const parts: ReactElement[] = [];
  const n = Math.max(2, Math.round((to - from) / 1.6));
  for (let i = 1; i < n; i++) {
    const a = from + ((to - from) * i) / n;
    parts.push(<g key={i}>{line(p(a, z0), p(a, z1), "#cfe6ff", 0.7, { opacity: 0.28 })}</g>);
  }
  return (
    <g>
      <polygon points={ptsStr(pts)} fill="#101a2c" />
      <polygon points={ptsStr(pts)} fill="url(#gym-mirror)" stroke="#cfe6ff" strokeOpacity={0.55} strokeWidth={1.2} />
      {parts}
    </g>
  );
}

export const GymShell = memo(function GymShell() {
  const left = [project(0, 0, 0), project(0, D, 0), project(0, D, WALL_H), project(0, 0, WALL_H)];
  const right = [project(0, 0, 0), project(W, 0, 0), project(W, 0, WALL_H), project(0, 0, WALL_H)];
  const base = (side: "left" | "right"): ReactElement => {
    const p = (a: number, z: number): Pt => (side === "right" ? project(a, 0, z) : project(0, a, z));
    const len = side === "right" ? W : D;
    return (
      <g>
        {quad(p(0, 0), p(len, 0), p(len, 12), p(0, 12), "#10151f")}
        {quad(p(0, 124), p(len, 124), p(len, 132), p(0, 132), "#0f766e", { opacity: 0.85 })}
        {quad(p(0, 132), p(len, 132), p(len, WALL_H), p(0, WALL_H), shade("#22304f", 0.7))}
        {line(p(0, 12), p(len, 12), "#394560", 1)}
      </g>
    );
  };
  // floor: rubber tiles, wood zone, tape lines
  const tiles: ReactElement[] = [];
  for (let u = 0; u < W; u++) {
    for (let v = 0; v < D; v++) {
      const wood = u >= 10 && v >= 7;
      const pts = [project(u, v), project(u + 1, v), project(u + 1, v + 1), project(u, v + 1)];
      const fill = wood ? ((u + v) % 2 ? "#8a6a45" : "#82633f") : (u + v) % 2 ? "#2a2e3a" : "#252935";
      tiles.push(<polygon key={`${u}-${v}`} points={ptsStr(pts)} fill={fill} />);
    }
  }
  const seams: ReactElement[] = [];
  for (let v = 7; v <= D; v += 0.5) seams.push(<g key={`s${v}`}>{line(project(10, v), project(W, v), "#5c4529", 0.6, { opacity: 0.55 })}</g>);
  const tape = (a: Pt, b: Pt, c: string, w = 1.6): ReactElement => line(a, b, c, w, { opacity: 0.8 });
  return (
    <g>
      <polygon points={ptsStr(left)} fill="#1b2640" />
      <polygon points={ptsStr(right)} fill="#22304f" />
      {base("left")}
      {base("right")}
      <g>{tiles}</g>
      <g>{seams}</g>
      <g>
        {tape(project(10, 7), project(W, 7), "#f2c230", 2)}
        {tape(project(10, 7), project(10, D), "#f2c230", 2)}
        {tape(project(4.4, 3.7), project(12.2, 3.7), "#f2c230", 1.8)}
        {tape(project(4.4, 3.7), project(4.4, 3.45), "#f2c230", 1.8)}
        {tape(project(1.6, 9.2), project(4.4, 9.2), "#e9eef8", 1.2)}
        {tape(project(1.6, 12.2), project(4.4, 12.2), "#e9eef8", 1.2)}
        {tape(project(1.6, 9.2), project(1.6, 12.2), "#e9eef8", 1.2)}
        {tape(project(4.4, 9.2), project(4.4, 12.2), "#e9eef8", 1.2)}
        {tape(project(10.6, 5.0), project(14.8, 5.0), "#e9eef8", 1.2)}
        {tape(project(10.6, 7.6), project(14.8, 7.6), "#e9eef8", 1.2)}
        {tape(project(10.6, 5.0), project(10.6, 7.6), "#e9eef8", 1.2)}
        {tape(project(14.8, 5.0), project(14.8, 7.6), "#e9eef8", 1.2)}
      </g>
      <g>
        {mirror("right", 4.3, 8.6)}
        {mirror("right", 8.7, 12.6)}
        {mirror("right", 0.6, 4.2, 70, 128)}
        {mirror("left", 8.0, 13.2)}
        {mirror("left", 5.6, 7.9, 24, 96)}
      </g>
      {/* left wall: poster band and corner */}
      <g>{line(project(0, 0, 0), project(0, 0, WALL_H), "#0b1020", 1.5)}</g>
    </g>
  );
});

/** Scoreboard on the left wall: title, round, score and a progress bar; plus the training clock under it. */
export const GymBoards = memo(function GymBoards({ title, roundText, scoreText, pct, clock, scoreLabel, timeLabel }: {
  title: string; roundText: string; scoreText: string; pct: number; clock: string; scoreLabel: string; timeLabel: string;
}) {
  const p = (v: number, z: number): Pt => project(0, v, z);
  const board = [p(1.1, 70), p(5.3, 70), p(5.3, 140), p(1.1, 140)];
  const barA = p(1.5, 80), barB = p(1.5 + 3.4 * (pct / 100), 80), barC = p(1.5 + 3.4 * (pct / 100), 86), barD = p(1.5, 86);
  const barE = p(4.9, 80), barF = p(4.9, 86);
  const timer = [p(5.7, 100), p(7.5, 100), p(7.5, 134), p(5.7, 134)];
  const shown = title.length > 22 ? `${title.slice(0, 21)}…` : title;
  return (
    <g>
      <polygon points={ptsStr(board)} fill="#0e1424" stroke="#5aa0ff" strokeOpacity={0.7} strokeWidth={1.6} />
      <SkewText at={p(3.2, 126)} skew={-30} size={12} fill="#e6edf8">{shown}</SkewText>
      <SkewText at={p(3.2, 112)} skew={-30} size={11} fill="#9fd0ff" weight={600}>{roundText}</SkewText>
      <SkewText at={p(3.2, 98)} skew={-30} size={13} fill="#4fd08a">{`${scoreLabel} ${scoreText}`}</SkewText>
      {quad(barA, barE, barF, barD, "#243049")}
      {quad(barA, barB, barC, barD, "#14b8a6")}
      <polygon points={ptsStr(timer)} fill="#10101a" stroke="#ff9f43" strokeOpacity={0.6} strokeWidth={1.4} />
      <SkewText at={p(6.6, 126)} skew={-30} size={8} fill="#ffb86b" weight={600}>{timeLabel}</SkewText>
      <SkewText at={p(6.6, 108)} skew={-30} size={15} fill="#ff7a3d">{clock}</SkewText>
    </g>
  );
});

/** Round wall clock on the right wall; hands follow the training clock. */
export const WallClock = memo(function WallClock({ clock }: { clock: number }) {
  const c = { u: 13.0, v: 0, z: 104 };
  const hand = (deg: number, len: number, w: number, color: string): ReactElement => {
    const a = (deg * Math.PI) / 180;
    return line(project(c.u, 0, c.z), project(c.u + K * len * Math.sin(a), 0, c.z + len * Math.cos(a)), color, w);
  };
  return (
    <g>
      <Disc u={c.u} v={0} z={c.z} r={17} axis="v" fill="#e9eef8" stroke="#394560" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        return <g key={i}>{line(project(c.u + K * 13 * Math.sin(a), 0, c.z + 13 * Math.cos(a)), project(c.u + K * 15.5 * Math.sin(a), 0, c.z + 15.5 * Math.cos(a)), "#394560", 1)}</g>;
      })}
      {hand((clock / 60) * 30, 9, 2, "#1a1f2e")}
      {hand(clock * 6, 13, 1.1, "#e24b4b")}
    </g>
  );
});

// ---- machines -----------------------------------------------------------------------------------

export const DumbbellRack = memo(function DumbbellRack() {
  const r = EQUIP_RECTS.dumbbells;
  const tiers: ReactElement[] = [];
  for (let t = 0; t < 3; t++) {
    const z = 14 + t * 18;
    const items: ReactElement[] = [];
    for (let i = 0; i < 7; i++) {
      const ux = r.u + 0.35 + i * 0.5;
      const size = 0.13 + (6 - i) * 0.012 + (2 - t) * 0.01;
      const hh = 5 + (6 - i) * 0.9 + (2 - t) * 0.6;
      const color = shade(t === 1 ? "#6b7490" : "#454c60", 0.85 + i * 0.05);
      items.push(
        <g key={i}>
          {isoBox({ r: { u: ux - 0.03, v: r.v + 0.32, w: 0.06, d: 0.56 }, h: 2, color: "#c9d1e0", lift: z + 3.2 })}
          {isoBox({ r: { u: ux - size / 2, v: r.v + 0.22, w: size, d: 0.14 }, h: hh, color, lift: z + 3 })}
          {isoBox({ r: { u: ux - size / 2, v: r.v + 0.7, w: size, d: 0.14 }, h: hh, color, lift: z + 3 })}
        </g>,
      );
    }
    tiers.push(
      <g key={t}>
        {isoBox({ r: { u: r.u, v: r.v, w: r.w, d: r.d - 0.1 }, h: 3, color: "#303648", lift: z })}
        {items}
      </g>,
    );
  }
  return (
    <g data-equip="dumbbells">
      <Shadow r={r} />
      {isoBox({ r: { u: r.u, v: r.v, w: 0.14, d: r.d - 0.1 }, h: 64, color: "#232836" })}
      {isoBox({ r: { u: r.u + r.w - 0.14, v: r.v, w: 0.14, d: r.d - 0.1 }, h: 64, color: "#232836" })}
      {isoBox({ r: { u: r.u + r.w / 2 - 0.07, v: r.v, w: 0.14, d: r.d - 0.1 }, h: 64, color: "#232836" })}
      {tiers}
    </g>
  );
});

export const Treadmill = memo(function Treadmill({ id, active, speed, dist }: { id: "A" | "B"; active: boolean; speed: string; dist: string }) {
  const r = id === "A" ? EQUIP_RECTS.treadmillA : EQUIP_RECTS.treadmillB;
  const { u, v, w, d } = r;
  const stripes: ReactElement[] = [];
  for (let i = 0; i < 9; i++) {
    const vv = v + 0.5 + i * 0.3;
    stripes.push(<g key={i}>{line(project(u + 0.2, vv, 10.5), project(u + w - 0.2, vv, 10.5), "#3a4458", 1.6)}</g>);
  }
  const scr = [project(u + 0.16, v + 0.52, 70), project(u + w - 0.16, v + 0.52, 70), project(u + w - 0.16, v + 0.52, 59), project(u + 0.16, v + 0.52, 59)];
  return (
    <g data-equip={`treadmill${id}`}>
      <Shadow r={r} />
      {isoBox({ r: { u, v: v + 0.3, w, d: d - 0.3 }, h: 10, color: DARK })}
      <polygon points={ptsStr(beltPoly(r))} fill="#10141c" />
      <g clipPath={`url(#gym-clip-belt${id})`}>
        <g className={active ? "gym-belt" : undefined}>{stripes}</g>
      </g>
      {isoBox({ r: { u, v: v + 0.3, w: 0.14, d: d - 0.3 }, h: 4, color: "#161a22", lift: 10 })}
      {isoBox({ r: { u: u + w - 0.14, v: v + 0.3, w: 0.14, d: d - 0.3 }, h: 4, color: "#161a22", lift: 10 })}
      {isoBox({ r: { u: u + 0.04, v: v + 0.28, w: 0.1, d: 0.1 }, h: 50, color: STEEL, lift: 10 })}
      {isoBox({ r: { u: u + w - 0.14, v: v + 0.28, w: 0.1, d: 0.1 }, h: 50, color: STEEL, lift: 10 })}
      {isoBox({ r: { u: u - 0.02, v: v + 0.18, w: w + 0.04, d: 0.36 }, h: 14, color: "#20242e", lift: 58 })}
      <polygon points={ptsStr(scr)} fill={active ? "#0b3a4a" : "#0b1620"} stroke="#3a4260" strokeWidth={0.8} />
      {active && <polygon points={ptsStr(scr)} fill="#74e0ff" opacity={0.18} />}
      <SkewText at={project(u + 0.2, v + 0.52, 63)} skew={30} size={6.2} fill={active ? "#8be9ff" : "#3d5566"} anchor="start">{active ? `${speed} km/h` : "0.0 km/h"}</SkewText>
      <SkewText at={project(u + 0.2, v + 0.52, 56)} skew={30} size={5} fill={active ? "#6bd0a0" : "#3d5566"} anchor="start">{active ? `${dist} m` : "0 m"}</SkewText>
      {line(project(u + 0.09, v + 0.4, 60), project(u + 0.09, v + 1.5, 44), "#c2cbe0", 2.4)}
      {line(project(u + w - 0.09, v + 0.4, 60), project(u + w - 0.09, v + 1.5, 44), "#c2cbe0", 2.4)}
      {isoBox({ r: { u: u + w / 2 - 0.08, v: v + 0.2, w: 0.16, d: 0.1 }, h: 4, color: "#e24b4b", lift: 66 })}
    </g>
  );
});

/** Cable machine: two posts with weight stacks and pulleys; the handles are drawn by CableHandles (after the person). */
export const CableMachine = memo(function CableMachine({ active }: { active: boolean }) {
  const r = EQUIP_RECTS.cable;
  const { u, v, w, d } = r;
  const stack = (ux: number): ReactElement => {
    const plates: ReactElement[] = [];
    for (let i = 0; i < 11; i++) {
      const el = isoBox({ r: { u: ux, v: v + 0.15, w: 0.5, d: 0.42 }, h: 5.4, color: i % 2 ? "#4a5468" : "#59647b", lift: 6 + i * 6.1 });
      plates.push(<g key={i}>{el}</g>);
    }
    return (
      <g>
        {plates.slice(0, 4)}
        <g className={active ? "gym-stack" : undefined}>{plates.slice(4)}</g>
        {line(project(ux + 0.12, v + 0.15 + 0.42, 6), project(ux + 0.12, v + 0.15 + 0.42, 74), "#c9d1e0", 1.2)}
      </g>
    );
  };
  return (
    <g data-equip="cable">
      <Shadow r={r} />
      {isoBox({ r: { u, v, w, d: d + 0.1 }, h: 5, color: "#20242e" })}
      {stack(u + 0.3)}
      {stack(u + w - 0.8)}
      {isoBox({ r: { u, v, w: 0.22, d: 0.5 }, h: 126, color: "#2a2f3d" })}
      {isoBox({ r: { u: u + w - 0.22, v, w: 0.22, d: 0.5 }, h: 126, color: "#2a2f3d" })}
      {isoBox({ r: { u, v, w, d: 0.5 }, h: 8, color: "#2f3547", lift: 120 })}
      {isoBox({ r: { u: u + 0.1, v: v + 0.5, w: 0.5, d: 0.08 }, h: 20, color: "#e24b4b", lift: 40 })}
      {plate(u + 0.5, v + 0.62, 122, 7, "v", "#9aa5bb", 0.05)}
      {plate(u + w - 0.5, v + 0.62, 122, 7, "v", "#9aa5bb", 0.05)}
    </g>
  );
});

/** Handle bar and cables of the cable machine (screen space around the person, pulleys fixed). */
export const CableHandles = memo(function CableHandles({ active, x, y }: { active: boolean; x: number; y: number }) {
  const r = EQUIP_RECTS.cable;
  const pl = project(r.u + 0.5, r.v + 0.7, 122), pr = project(r.u + r.w - 0.5, r.v + 0.7, 122);
  const up = { lx: x - 21, rx: x + 21, y: y - 54 };
  const down = { lx: x - 33, rx: x + 33, y: y - 30 };
  const dur = "1.4s";
  const ease = { calcMode: "spline", keySplines: "0.45 0 0.55 1;0.45 0 0.55 1", keyTimes: "0;0.5;1", dur, repeatCount: "indefinite" } as const;
  const lineAnim = (attr: string, a: number, b: number): ReactElement | null => (active ? <animate attributeName={attr} values={`${a};${b};${a}`} {...ease} /> : null);
  const cur = up;
  return (
    <g data-handles="1">
      <line x1={pl.x} y1={pl.y} x2={cur.lx} y2={cur.y} stroke="#cfd6e0" strokeWidth={1}>{lineAnim("x2", up.lx, down.lx)}{lineAnim("y2", up.y, down.y)}</line>
      <line x1={pr.x} y1={pr.y} x2={cur.rx} y2={cur.y} stroke="#cfd6e0" strokeWidth={1}>{lineAnim("x2", up.rx, down.rx)}{lineAnim("y2", up.y, down.y)}</line>
      <line x1={cur.lx} y1={cur.y} x2={cur.rx} y2={cur.y} stroke="#e9eef8" strokeWidth={2.6} strokeLinecap="round">
        {lineAnim("x1", up.lx, down.lx)}{lineAnim("x2", up.rx, down.rx)}{lineAnim("y1", up.y, down.y)}{lineAnim("y2", up.y, down.y)}
      </line>
    </g>
  );
});

/** Bench with pad, legs and the two J-hook posts. */
export const BenchStation = memo(function BenchStation() {
  const b = EQUIP_RECTS.bench;
  const pl = EQUIP_RECTS.postL, pr = EQUIP_RECTS.postR;
  return (
    <g data-equip="bench">
      <Shadow r={{ u: b.u, v: b.v - 0.2, w: b.w + 0.3, d: b.d + 0.4 }} />
      {isoBox({ r: { u: b.u + 0.15, v: b.v + 0.12, w: 0.1, d: b.d - 0.24 }, h: 12, color: "#20242e" })}
      {isoBox({ r: { u: b.u + b.w - 0.3, v: b.v + 0.12, w: 0.1, d: b.d - 0.24 }, h: 12, color: "#20242e" })}
      {isoBox({ r: b, h: 5, color: "#2d3446", lift: 11 })}
      {isoBox({ r: { u: b.u + 0.04, v: b.v + 0.04, w: b.w - 0.08, d: b.d - 0.08 }, h: 2, color: "#7a3b3b", lift: 16 })}
      {isoBox({ r: pl, h: 46, color: "#2a2f3d" })}
      {isoBox({ r: { u: pl.u - 0.04, v: pl.v - 0.06, w: 0.38, d: 0.12 }, h: 3, color: "#c9d1e0", lift: 36 })}
      {isoBox({ r: pr, h: 46, color: "#2a2f3d" })}
      {isoBox({ r: { u: pr.u - 0.04, v: pr.v + 0.24, w: 0.38, d: 0.12 }, h: 3, color: "#c9d1e0", lift: 36 })}
    </g>
  );
});

/** Barbell above the bench: bar along v with plates; lifts when active. */
export const Barbell = memo(function Barbell({ active }: { active: boolean }) {
  const u = 4.55, v0 = 5.45, v1 = 8.05, z = 40;
  const a = project(u, v0 - 0.2, z), b = project(u, v1 + 0.2, z);
  return (
    <g data-barbell="1">
      <g className={active ? "gym-bar" : undefined}>
        {plate(u, v0 + 0.05, z, 15, "v", "#2b2f3a")}
        {plate(u, v0 + 0.22, z, 11, "v", "#c9a227")}
        {line(a, b, "url(#gym-steel)", 3.4)}
        {line(a, b, "#e9eef8", 1, { opacity: 0.5 })}
        {plate(u, v1 - 0.22, z, 11, "v", "#c9a227")}
        {plate(u, v1 - 0.05, z, 15, "v", "#2b2f3a")}
        <Disc u={u} v={v0 + 0.3} z={z} r={3} axis="v" fill="#cfd6e0" />
        <Disc u={u} v={v1 - 0.3} z={z} r={3} axis="v" fill="#cfd6e0" />
      </g>
    </g>
  );
});

/** Pull-up rig, back half (left post). */
export const PullupBack = memo(function PullupBack() {
  const l = EQUIP_RECTS.pullupL;
  return (
    <g>
      <Shadow r={{ u: l.u - 0.1, v: l.v - 0.1, w: 2.5, d: 0.6 }} grow={0.1} />
      {isoBox({ r: { u: l.u - 0.1, v: l.v - 0.12, w: 0.45, d: 0.5 }, h: 3, color: "#20242e" })}
      {isoBox({ r: l, h: 102, color: "#6b7490" })}
    </g>
  );
});

/** Pull-up rig, front half: bar across and the right post (drawn after the person). */
export const PullupFront = memo(function PullupFront() {
  const l = EQUIP_RECTS.pullupL, r = EQUIP_RECTS.pullupR;
  const a = project(l.u + 0.12, l.v + 0.12, 96), b = project(r.u + 0.12, r.v + 0.12, 96);
  return (
    <g data-equip="pullup">
      {isoBox({ r: { u: r.u - 0.1, v: r.v - 0.12, w: 0.45, d: 0.5 }, h: 3, color: "#20242e" })}
      {isoBox({ r, h: 102, color: "#6b7490" })}
      {line(project(l.u + 0.12, l.v + 0.12, 100), project(r.u + 0.12, r.v + 0.12, 100), "#59627a", 5)}
      {line(a, b, "url(#gym-steel)", 3.4)}
      {line(project(l.u + 0.7, l.v + 0.12, 96), project(l.u + 1.0, l.v + 0.12, 96), "#1a1f2e", 3.6, { opacity: 0.8 })}
      {line(project(r.u - 0.8, r.v + 0.12, 96), project(r.u - 0.5, r.v + 0.12, 96), "#1a1f2e", 3.6, { opacity: 0.8 })}
    </g>
  );
});

/** Heavy bag on a post and boom; swings when active. */
export const PunchBag = memo(function PunchBag({ active }: { active: boolean }) {
  const post = EQUIP_RECTS.bagPost;
  const bb = EQUIP_RECTS.bagBody;
  const bu = bb.u + bb.w / 2, bv = bb.v + bb.d / 2;
  const hook = project(bu, bv, 120);
  const top = project(bu, bv, 80), mid = project(bu, bv, 48), bot = project(bu, bv, 16);
  return (
    <g data-equip="bag">
      <Shadow r={{ u: bu - 0.5, v: bv - 0.35, w: 1.0, d: 0.7 }} grow={0.05} />
      {isoBox({ r: { u: post.u - 0.2, v: post.v - 0.2, w: 0.65, d: 0.65 }, h: 4, color: "#20242e" })}
      {isoBox({ r: post, h: 124, color: "#6b7490" })}
      {line(project(post.u + 0.12, post.v + 0.12, 118), hook, "#59627a", 4)}
      <g className={active ? "gym-bag" : undefined}>
        {line(hook, top, "#8d97ad", 1.8)}
        <path d={`M${top.x - 13} ${top.y} L${top.x - 13} ${bot.y} A13 5 0 0 0 ${top.x + 13} ${bot.y} L${top.x + 13} ${top.y} A13 5 0 0 0 ${top.x - 13} ${top.y}Z`} fill="url(#gym-bagfill)" stroke="#6e1f19" strokeWidth={1} />
        <ellipse cx={top.x} cy={top.y} rx={13} ry={5} fill="#e0584a" stroke="#6e1f19" strokeWidth={0.8} />
        <rect x={mid.x - 13} y={mid.y - 4} width={26} height={7} fill="#e9c46a" opacity={0.9} />
        <rect x={mid.x - 13} y={mid.y + 14} width={26} height={2.5} fill="#2b2f3a" opacity={0.6} />
      </g>
    </g>
  );
});

/** Spin bike: heavy flywheel at the front, seat at the back, handlebar, rotating crank. */
export const SpinBike = memo(function SpinBike({ id, active }: { id: "A" | "B"; active: boolean }) {
  const r = id === "A" ? EQUIP_RECTS.bikeA : EQUIP_RECTS.bikeB;
  const cv = r.v + r.d / 2;
  const crank = project(r.u + 0.75, cv, 13);
  return (
    <g data-equip={`bike${id}`}>
      <Shadow r={r} />
      {isoBox({ r: { u: r.u + 0.05, v: cv - 0.28, w: 0.1, d: 0.56 }, h: 3, color: "#20242e" })}
      {isoBox({ r: { u: r.u + r.w - 0.2, v: cv - 0.28, w: 0.1, d: 0.56 }, h: 3, color: "#20242e" })}
      {isoBox({ r: { u: r.u + 0.1, v: cv - 0.04, w: r.w - 0.3, d: 0.08 }, h: 5, color: "#303648", lift: 3 })}
      {/* seat post and saddle */}
      {isoBox({ r: { u: r.u + 0.1, v: cv - 0.04, w: 0.08, d: 0.08 }, h: 28, color: STEEL, lift: 6 })}
      {isoBox({ r: { u: r.u - 0.04, v: cv - 0.15, w: 0.4, d: 0.3 }, h: 4, color: "#1a1f2e", lift: 34 })}
      {/* flywheel */}
      {plate(r.u + 1.45, cv, 18, 15, "v", "#3a4258", 0.1)}
      <Disc u={r.u + 1.45} v={cv + 0.12} z={18} r={5} axis="v" fill="#e24b4b" />
      {/* mast and handlebar */}
      {line(project(r.u + 1.2, cv, 6), project(r.u + 1.35, cv, 44), STEEL, 3.2)}
      {line(project(r.u + 1.35, cv - 0.25, 46), project(r.u + 1.35, cv + 0.25, 46), "#c9d1e0", 2.6)}
      {isoBox({ r: { u: r.u + 1.25, v: cv - 0.1, w: 0.2, d: 0.2 }, h: 4, color: "#0b1620", lift: 46 })}
      {/* crank and pedals */}
      <g className={active ? "gym-crank" : undefined} style={{ transformBox: "fill-box", transformOrigin: "50% 50%" }}>
        {line({ x: crank.x - 8, y: crank.y + 6 }, { x: crank.x + 8, y: crank.y - 6 }, "#c9d1e0", 2)}
        <rect x={crank.x - 11} y={crank.y + 4} width={7} height={3} fill="#1a1f2e" />
        <rect x={crank.x + 4} y={crank.y - 7} width={7} height={3} fill="#1a1f2e" />
      </g>
      <circle cx={crank.x} cy={crank.y} r={2.2} fill="#e9eef8" />
    </g>
  );
});

export const Lockers = memo(function Lockers() {
  const r = EQUIP_RECTS.lockers;
  const doors: ReactElement[] = [];
  const n = 6, dw = r.w / n;
  for (let i = 0; i < n; i++) {
    const u = r.u + i * dw;
    const color = i % 2 ? "#37566f" : "#2f6a5f";
    const fz = project(u + dw / 2, r.v + r.d, 82);
    doors.push(
      <g key={i}>
        {isoBox({ r: { u, v: r.v, w: dw, d: r.d }, h: 108, color })}
        {[0, 1, 2].map((k) => <g key={k}>{line(project(u + 0.06, r.v + r.d, 96 - k * 3), project(u + dw - 0.06, r.v + r.d, 96 - k * 3), shade(color, 0.4), 1)}</g>)}
        <rect x={fz.x + 5} y={fz.y} width={2.2} height={9} rx={1} fill="#d9dfeb" />
      </g>,
    );
  }
  return (
    <g data-equip="lockers">
      <Shadow r={r} />
      {doors}
    </g>
  );
});

export const WaterCooler = memo(function WaterCooler() {
  const r = EQUIP_RECTS.cooler;
  const p = project(r.u + r.w / 2, r.v + r.d / 2, 62);
  return (
    <g data-equip="cooler">
      <Shadow r={r} grow={0.1} />
      {isoBox({ r, h: 40, color: "#d9e2f2" })}
      {isoBox({ r: { u: r.u + 0.14, v: r.v + r.d, w: 0.22, d: 0.07 }, h: 5, color: "#2b6cb0", lift: 26 })}
      <ellipse cx={p.x} cy={p.y + 6} rx={11} ry={16} fill="#7cc4ff" opacity={0.6} stroke="#cfe6ff" />
      <ellipse cx={p.x} cy={p.y - 8} rx={6} ry={3} fill="#e9f4ff" opacity={0.7} />
    </g>
  );
});

export const TowelShelf = memo(function TowelShelf() {
  const r = EQUIP_RECTS.towels;
  const cols = ["#f4f6fa", "#14b8a6", "#c9d1e0", "#5aa0ff"];
  return (
    <g data-equip="towels">
      {isoBox({ r: { u: r.u, v: r.v, w: r.w, d: r.d }, h: 3, color: "#7a6148", lift: 34 })}
      {cols.map((c, i) => <g key={i}>{isoBox({ r: { u: r.u + 0.06, v: r.v + 0.04, w: 0.34, d: 0.3 }, h: 4, color: c, lift: 37 + i * 4 })}</g>)}
      {isoBox({ r: { u: r.u + 0.44, v: r.v + 0.04, w: 0.3, d: 0.3 }, h: 4, color: "#f4f6fa", lift: 37 })}
      {isoBox({ r: { u: r.u + 0.44, v: r.v + 0.04, w: 0.3, d: 0.3 }, h: 4, color: "#14b8a6", lift: 41 })}
    </g>
  );
});

export const PlateRack = memo(function PlateRack() {
  const r = EQUIP_RECTS.plateRack;
  const pegs: ReactElement[] = [];
  const cols = ["#b4382e", "#2b2f3a", "#c9a227", "#2f6fed", "#2b2f3a"];
  [8.75, 9.65].forEach((v, vi) => {
    [20, 40].forEach((z, zi) => {
      pegs.push(<g key={`${vi}${zi}`}>{line(project(0.35, v, z), project(1.0, v, z), "#c9d1e0", 2.2)}</g>);
      for (let k = 0; k < 4; k++) pegs.push(<g key={`p${vi}${zi}${k}`}>{plate(0.42 + k * 0.1, v, z, 12 - (k > 2 ? 2 : 0), "u", cols[(k + vi + zi) % cols.length]!, 0.05)}</g>);
    });
  });
  return (
    <g data-equip="plateRack">
      <Shadow r={r} grow={0.1} />
      {isoBox({ r: { u: r.u, v: r.v, w: 0.1, d: r.d }, h: 56, color: "#232836" })}
      {isoBox({ r: { u: r.u, v: r.v, w: r.w, d: r.d }, h: 5, color: "#232836" })}
      {pegs}
    </g>
  );
});

export const PlateTree = memo(function PlateTree() {
  const r = EQUIP_RECTS.plateTree;
  const cu = r.u + r.w / 2, cv = r.v + r.w / 2;
  return (
    <g>
      <Shadow r={r} grow={0.08} />
      {isoBox({ r, h: 3, color: "#20242e" })}
      {isoBox({ r: { u: cu - 0.05, v: cv - 0.05, w: 0.1, d: 0.1 }, h: 40, color: STEEL, lift: 3 })}
      {plate(cu, cv + 0.12, 10, 11, "v", "#b4382e", 0.05)}
      {plate(cu, cv + 0.12, 22, 9, "v", "#c9a227", 0.05)}
      {plate(cu, cv + 0.12, 33, 7, "v", "#2f6fed", 0.05)}
    </g>
  );
});

export const RestBench = memo(function RestBench() {
  const r = EQUIP_RECTS.restBench;
  const slats: ReactElement[] = [];
  for (let i = 1; i < 6; i++) slats.push(<g key={i}>{line(project(r.u + (i * r.w) / 6, r.v + r.d, 15), project(r.u + (i * r.w) / 6, r.v + r.d, 5), "#241d17", 0.8)}</g>);
  return (
    <g data-equip="restBench">
      <Shadow r={r} />
      {isoBox({ r: { u: r.u + 0.15, v: r.v + 0.1, w: 0.12, d: r.d - 0.2 }, h: 12, color: "#20242e" })}
      {isoBox({ r: { u: r.u + r.w - 0.27, v: r.v + 0.1, w: 0.12, d: r.d - 0.2 }, h: 12, color: "#20242e" })}
      {isoBox({ r, h: 5, color: "#6b5238", lift: 11 })}
      {slats}
      {/* towel and bottle */}
      {isoBox({ r: { u: r.u + 0.3, v: r.v + 0.18, w: 0.5, d: 0.34 }, h: 3, color: "#f4f6fa", lift: 16 })}
      {isoBox({ r: { u: r.u + r.w - 0.5, v: r.v + 0.24, w: 0.12, d: 0.12 }, h: 11, color: "#5aa0ff", lift: 16 })}
      {isoBox({ r: { u: r.u + r.w - 0.48, v: r.v + 0.26, w: 0.08, d: 0.08 }, h: 3, color: "#e9eef8", lift: 27 })}
    </g>
  );
});

/** Floor mats (flat items under the people). */
export const Mats = memo(function Mats() {
  const a = MAT_RECTS.matA, b = MAT_RECTS.matB;
  return (
    <g data-equip="mats">
      {isoBox({ r: a, h: 1.6, color: "#14b8a6" })}
      {quad(project(a.u + 0.1, a.v + 0.4, 1.8), project(a.u + a.w - 0.1, a.v + 0.4, 1.8), project(a.u + a.w - 0.1, a.v + 0.42, 1.8), project(a.u + 0.1, a.v + 0.42, 1.8), "#fff", { opacity: 0.25 })}
      {isoBox({ r: b, h: 1.6, color: "#7c4dff" })}
      {quad(project(b.u + 0.1, b.v + 0.4, 1.8), project(b.u + b.w - 0.1, b.v + 0.4, 1.8), project(b.u + b.w - 0.1, b.v + 0.42, 1.8), project(b.u + 0.1, b.v + 0.42, 1.8), "#fff", { opacity: 0.25 })}
    </g>
  );
});

export const GymBalls = memo(function GymBalls() {
  const ball = (r: Rect, fill: string, key: string): ReactElement => {
    const c = project(r.u + r.w / 2, r.v + r.d / 2, 14);
    const g = project(r.u + r.w / 2, r.v + r.d / 2, 0);
    return (
      <g key={key}>
        <ellipse cx={g.x} cy={g.y} rx={15} ry={6} fill="#000" opacity={0.3} />
        <circle cx={c.x} cy={c.y} r={14} fill={`url(#${fill})`} stroke="#0a3d38" strokeWidth={0.6} />
        <ellipse cx={c.x - 5} cy={c.y - 6} rx={3.6} ry={2.2} fill="#fff" opacity={0.35} />
      </g>
    );
  };
  return (
    <g>
      {ball(EQUIP_RECTS.ballA, "gym-ballfill", "a")}
      {ball(EQUIP_RECTS.ballB, "gym-ballfill2", "b")}
    </g>
  );
});

/** Three kettlebells on the floor next to the plate rack. */
export const Kettlebells = memo(function Kettlebells() {
  const bells = [{ u: 0.8, v: 10.5, c: "#b4382e", r: 8 }, { u: 1.2, v: 10.9, c: "#2f6fed", r: 9.5 }, { u: 0.6, v: 11.2, c: "#2b2f3a", r: 11 }];
  return (
    <g data-equip="kettlebells">
      {bells.map((b, i) => {
        const base = project(b.u, b.v, 0), body = project(b.u, b.v, b.r), top = project(b.u, b.v, b.r * 2 + 2);
        return (
          <g key={i}>
            <ellipse cx={base.x} cy={base.y} rx={b.r + 2} ry={(b.r + 2) / 2} fill="#000" opacity={0.3} />
            <circle cx={body.x} cy={body.y} r={b.r} fill={b.c} stroke={shade(b.c, 0.5)} strokeWidth={0.8} />
            <ellipse cx={body.x - b.r * 0.35} cy={body.y - b.r * 0.3} rx={b.r * 0.25} ry={b.r * 0.15} fill="#fff" opacity={0.3} />
            <path d={`M${top.x - b.r * 0.5} ${top.y + b.r * 0.5} q0 -${b.r * 0.9} ${b.r * 0.5} -${b.r * 0.9} q${b.r * 0.5} 0 ${b.r * 0.5} ${b.r * 0.9}`} fill="none" stroke={shade(b.c, 0.7)} strokeWidth={2.4} />
          </g>
        );
      })}
    </g>
  );
});
