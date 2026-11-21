// Isometric furniture and room shell of the 3D workshop room. Pure SVG, same style as GymEquipment / IsoFurniture:
// three shaded faces per box, drop shadows. Moving parts take flags (`printing`, `shooting`); their CSS animations
// live in office/city.css under .iso-w3r. Geometry comes from office/workshop3d-layout.ts.
import { memo, type ReactElement } from "react";
import { project } from "../../office/iso/depth";
import { STUDIO_PATCH, W3D_RECTS, W3D_ROOM, type Rect } from "../../office/workshop3d-layout";
import type { W3DStage } from "../../office/workshop3d";
import { isoBox, Monitor, ptsStr, shade } from "../office/IsoFurniture";

type Pt = { x: number; y: number };
const quad = (a: Pt, b: Pt, c: Pt, d: Pt, fill: string, extra: Record<string, string | number> = {}): ReactElement => <polygon points={ptsStr([a, b, c, d])} fill={fill} {...extra} />;
const line = (a: Pt, b: Pt, stroke: string, w = 1.2, extra: Record<string, string | number> = {}): ReactElement => <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={w} strokeLinecap="round" {...extra} />;
const WALL_H = 150;
const W = W3D_ROOM.W;
const D = W3D_ROOM.D;

function Shadow({ r, grow = 0.18 }: { r: Rect; grow?: number }): ReactElement {
  const { u, v, w, d } = r;
  return quad(project(u - grow * 0.3, v - grow * 0.3), project(u + w + grow, v - grow * 0.3), project(u + w + grow, v + d + grow), project(u - grow * 0.3, v + d + grow), "#000", { opacity: 0.26 });
}

/** Text lying on a wall plane: skew follows the plane (back wall +30, left wall -30). */
function SkewText({ at, skew, size, fill, children, anchor = "middle", weight = 700 }: { at: Pt; skew: number; size: number; fill: string; children: string; anchor?: "start" | "middle" | "end"; weight?: number }): ReactElement {
  return <text transform={`translate(${at.x.toFixed(1)},${at.y.toFixed(1)}) skewY(${skew})`} fontSize={size} fill={fill} textAnchor={anchor} fontWeight={weight} fontFamily="Consolas, 'Courier New', monospace">{children}</text>;
}

const back = (u: number, z: number): Pt => project(u, 0, z);
const left = (v: number, z: number): Pt => project(0, v, z);

// ---- shell --------------------------------------------------------------------------------------

export const W3DShell = memo(function W3DShell() {
  const wallL = [project(0, 0, 0), project(0, D, 0), project(0, D, WALL_H), project(0, 0, WALL_H)];
  const wallR = [project(0, 0, 0), project(W, 0, 0), project(W, 0, WALL_H), project(0, 0, WALL_H)];
  const tiles: ReactElement[] = [];
  for (let u = 0; u < W; u++) {
    for (let v = 0; v < D; v++) {
      const pts = [project(u, v), project(u + 1, v), project(u + 1, v + 1), project(u, v + 1)];
      tiles.push(<polygon key={`${u}-${v}`} points={ptsStr(pts)} fill={(u + v) % 2 ? "#3a4152" : "#353c4c"} />);
    }
  }
  const P = STUDIO_PATCH;
  const rug = { u: 7.4, v: 5.0, w: 3.4, d: 3.4 };
  const plate = (r: Rect, fill: string, op = 1): ReactElement => quad(project(r.u, r.v), project(r.u + r.w, r.v), project(r.u + r.w, r.v + r.d), project(r.u, r.v + r.d), fill, { opacity: op });
  return (
    <g>
      <polygon points={ptsStr(wallL)} fill="#1b2640" />
      <polygon points={ptsStr(wallR)} fill="#243456" />
      {quad(back(0, 0), back(W, 0), back(W, 12), back(0, 12), "#10151f")}
      {quad(left(0, 0), left(D, 0), left(D, 12), left(0, 12), "#10151f")}
      {quad(back(0, 138), back(W, 138), back(W, WALL_H), back(0, WALL_H), "#7c4dff", { opacity: 0.55 })}
      {quad(left(0, 138), left(D, 138), left(D, WALL_H), left(0, WALL_H), "#7c4dff", { opacity: 0.4 })}
      <g>{tiles}</g>
      {plate(P, "#f2f5fb", 0.94)}
      {line(project(P.u, P.v), project(P.u + P.w, P.v), "#f2c230", 1.6, { opacity: 0.85 })}
      {line(project(P.u, P.v), project(P.u, P.v + P.d), "#f2c230", 1.6, { opacity: 0.85 })}
      {plate(rug, "#4a3f78", 0.55)}
      {line(back(0, 0), back(0, WALL_H), "#0b1020", 1.5)}
    </g>
  );
});

// ---- walls --------------------------------------------------------------------------------------

const REF_COLORS = ["#c9a46a", "#6fa7d6", "#9aa5b5", "#b0523c", "#5f8f6a", "#d9cdb8"];
const PALETTE = ["#c9d1e0", "#b5835a", "#8a8f99", "#9cd3e6", "#1f2a44"];

/** Mood-board on the back wall: reference photos and a colour palette. */
export const W3DMoodboard = memo(function W3DMoodboard({ label }: { label: string }) {
  const u0 = 0.6, u1 = 4.8, z0 = 38, z1 = 138;
  const frame = [back(u0, z0), back(u1, z0), back(u1, z1), back(u0, z1)];
  const photos: ReactElement[] = [];
  const grid: Array<[number, number, number, number]> = [[0.9, 2.1, 84, 130], [2.3, 3.4, 96, 130], [3.5, 4.5, 88, 128], [0.9, 1.9, 58, 80], [2.1, 3.3, 58, 92]];
  grid.forEach(([a, b, c, d], i) => {
    const col = REF_COLORS[i % REF_COLORS.length]!;
    photos.push(<g key={i}>{quad(back(a, c), back(b, c), back(b, d), back(a, d), col, { stroke: "#f4f6fa", strokeWidth: 1.4 })}{quad(back(a + 0.1, c + 5), back((a + b) / 2, c + 5), back((a + b) / 2, c + (d - c) / 2), back(a + 0.1, c + (d - c) / 2), shade(col, 0.7))}</g>);
  });
  const chips = PALETTE.map((c, i) => <g key={c}>{quad(back(3.45 + i * 0.26, 46), back(3.45 + (i + 1) * 0.26 - 0.04, 46), back(3.45 + (i + 1) * 0.26 - 0.04, 62), back(3.45 + i * 0.26, 62), c, { stroke: "#fff", strokeWidth: 0.6 })}</g>);
  return (
    <g data-wall="moodboard">
      <polygon points={ptsStr(frame)} fill="#6b5238" stroke="#a87a45" strokeWidth={1.6} />
      {quad(back(u0 + 0.12, z0 + 6), back(u1 - 0.12, z0 + 6), back(u1 - 0.12, z1 - 6), back(u0 + 0.12, z1 - 6), "#b58f5c")}
      {photos}
      {chips}
      <SkewText at={back(2.0, 46)} skew={30} size={9} fill="#2b1d14">{label}</SkewText>
    </g>
  );
});

/** Big wall screen on the back wall: title, phase, round and the progress of the model (stage 0..4). */
export const W3DWallScreen = memo(function W3DWallScreen({ title, phaseText, roundText, stage, clock }: { title: string; phaseText: string; roundText: string; stage: W3DStage; clock: string }) {
  const u0 = 6.7, u1 = 10.3, z0 = 70, z1 = 140;
  const shown = title.length > 24 ? `${title.slice(0, 23)}…` : title;
  const barA = 6.95, barB = 10.05;
  const fillU = barA + (barB - barA) * (stage / 4);
  return (
    <g data-wall="screen">
      {quad(back(u0, z0), back(u1, z0), back(u1, z1), back(u0, z1), "#0b1020", { stroke: "#5aa0ff", strokeOpacity: 0.75, strokeWidth: 1.8 })}
      <SkewText at={back((u0 + u1) / 2, 126)} skew={30} size={11} fill="#e6edf8">{shown}</SkewText>
      <SkewText at={back((u0 + u1) / 2, 110)} skew={30} size={10} fill="#74e0ff">{phaseText}</SkewText>
      <SkewText at={back((u0 + u1) / 2, 96)} skew={30} size={8} fill="#9fb0c8" weight={600}>{`${roundText}  ${clock}`}</SkewText>
      {quad(back(barA, 78), back(barB, 78), back(barB, 85), back(barA, 85), "#243049")}
      {quad(back(barA, 78), back(fillU, 78), back(fillU, 85), back(barA, 85), "#4fd08a")}
      {[1, 2, 3].map((i) => <g key={i}>{line(back(barA + ((barB - barA) * i) / 4, 78), back(barA + ((barB - barA) * i) / 4, 85), "#0b1020", 1)}</g>)}
    </g>
  );
});

/** Review board on the left wall: one red pin per open issue (max 8 drawn, the rest as "+n"). */
export const W3DIssueBoard = memo(function W3DIssueBoard({ issues, title }: { issues: number; title: string }) {
  const v0 = 5.8, v1 = 9.0, z0 = 56, z1 = 132;
  const n = Math.max(0, Math.floor(issues));
  const pins: ReactElement[] = [];
  for (let i = 0; i < Math.min(8, n); i++) {
    const c = i % 4, r = Math.floor(i / 4);
    const p = left(6.2 + c * 0.7, 98 - r * 22);
    pins.push(
      <g key={i} data-issue-pin="1" className="w3r-pin" style={{ animationDelay: `${-i * 0.35}s` }}>
        <rect x={p.x - 7} y={p.y - 8} width={14} height={13} rx={1.5} fill="#fff4c2" stroke="#d9b26a" strokeWidth={0.6} />
        <circle cx={p.x} cy={p.y - 8} r={3} fill="#e24b4b" stroke="#7a1f1f" strokeWidth={0.6} />
        <path d={`M${p.x - 4} ${p.y - 2} h8 M${p.x - 4} ${p.y + 1.5} h5`} stroke="#8b6a2a" strokeWidth={0.7} />
      </g>,
    );
  }
  return (
    <g data-wall="issues" data-issues={n}>
      {quad(left(v0, z0), left(v1, z0), left(v1, z1), left(v0, z1), "#f4f6fa", { stroke: "#8b96a8", strokeWidth: 1.6 })}
      {quad(left(v0, z1 - 16), left(v1, z1 - 16), left(v1, z1), left(v0, z1), n ? "#c0392b" : "#2f9e6f")}
      <SkewText at={left((v0 + v1) / 2, z1 - 11)} skew={-30} size={9} fill="#fff">{`${title} ${n}`}</SkewText>
      {pins}
      {n > 8 && <SkewText at={left(8.5, 64)} skew={-30} size={10} fill="#c0392b">{`+${n - 8}`}</SkewText>}
    </g>
  );
});

// ---- furniture ----------------------------------------------------------------------------------

export const W3DReception = memo(function W3DReception() {
  const c = W3D_RECTS.counter, g = W3D_RECTS.guestChair;
  return (
    <g data-equip="reception">
      <Shadow r={c} />
      {isoBox({ r: c, h: 30, color: "#7c4dff" })}
      {isoBox({ r: { u: c.u - 0.05, v: c.v - 0.05, w: c.w + 0.1, d: c.d + 0.1 }, h: 3, color: "#e9eef8", lift: 30 })}
      <Monitor u={c.u} v={c.v + 0.4} w={0.55} on />
      {isoBox({ r: { u: c.u + 0.3, v: c.v + 1.7, w: 0.35, d: 0.5 }, h: 8, color: "#ffc542", lift: 33 })}
      <Shadow r={g} />
      {isoBox({ r: { u: g.u, v: g.v, w: g.w, d: g.d }, h: 14, color: "#d9b26a" })}
      {isoBox({ r: { u: g.u + g.w - 0.1, v: g.v, w: 0.1, d: g.d }, h: 32, color: "#b8924a" })}
    </g>
  );
});

export const W3DDraftingDesk = memo(function W3DDraftingDesk() {
  const r = W3D_RECTS.draftDesk;
  return (
    <g data-equip="drafting">
      <Shadow r={r} />
      {isoBox({ r, h: 22, color: "#d8dde8" })}
      {isoBox({ r: { u: r.u + 0.1, v: r.v + 0.1, w: 0.5, d: r.d - 0.2 }, h: 20, color: "#aab3c6" })}
      <Monitor u={r.u + 0.7} v={r.v} w={0.75} on big />
      <Monitor u={r.u + 1.6} v={r.v} w={0.75} on big />
      {isoBox({ r: { u: r.u + 1.2, v: r.v + 0.55, w: 0.6, d: 0.22 }, h: 2, color: "#2a3147", lift: 22 })}
    </g>
  );
});

/** Rack of rolled blueprints. */
export const W3DDrawingRack = memo(function W3DDrawingRack() {
  const r = W3D_RECTS.draftRack;
  const rolls: ReactElement[] = [];
  for (let i = 0; i < 6; i++) rolls.push(<g key={i}>{isoBox({ r: { u: r.u + 0.1, v: r.v + 0.12 + i * 0.25, w: 0.3, d: 0.16 }, h: 5, color: ["#f4f6fa", "#8ab4ff", "#f4f6fa", "#ffd27a"][i % 4]!, lift: 36 + (i % 2) * 6 })}</g>);
  return (
    <g data-equip="rack">
      <Shadow r={r} />
      {isoBox({ r, h: 34, color: "#59627a" })}
      {isoBox({ r: { u: r.u + 0.04, v: r.v + 0.04, w: r.w - 0.08, d: r.d - 0.08 }, h: 3, color: "#8e97ab", lift: 34 })}
      {rolls}
    </g>
  );
});

export const W3DPlanTable = memo(function W3DPlanTable() {
  const r = W3D_RECTS.planTable;
  return (
    <g data-equip="planTable">
      <Shadow r={r} />
      {isoBox({ r: { u: r.u + 0.1, v: r.v + 0.1, w: 0.12, d: r.d - 0.2 }, h: 24, color: "#59627a" })}
      {isoBox({ r: { u: r.u + r.w - 0.22, v: r.v + 0.1, w: 0.12, d: r.d - 0.2 }, h: 24, color: "#59627a" })}
      {isoBox({ r, h: 4, color: "#d8dde8", lift: 24 })}
      {quad(project(r.u + 0.2, r.v + 0.15, 28.5), project(r.u + r.w - 0.2, r.v + 0.15, 28.5), project(r.u + r.w - 0.2, r.v + r.d - 0.15, 28.5), project(r.u + 0.2, r.v + r.d - 0.15, 28.5), "#2f6fed", { opacity: 0.9 })}
      {line(project(r.u + 0.4, r.v + 0.35, 29), project(r.u + r.w - 0.5, r.v + 0.35, 29), "#e6f0ff", 0.8, { opacity: 0.8 })}
      {line(project(r.u + 0.4, r.v + 0.7, 29), project(r.u + r.w - 0.9, r.v + 0.7, 29), "#e6f0ff", 0.8, { opacity: 0.8 })}
      {line(project(r.u + 0.6, r.v + 0.3, 29), project(r.u + 0.6, r.v + r.d - 0.3, 29), "#e6f0ff", 0.8, { opacity: 0.6 })}
      {isoBox({ r: { u: r.u + r.w - 0.5, v: r.v + 0.2, w: 0.14, d: 0.14 }, h: 8, color: "#ffc542", lift: 28 })}
    </g>
  );
});

export const W3DCoffeeMachine = memo(function W3DCoffeeMachine() {
  const r = W3D_RECTS.coffee;
  return (
    <g data-equip="coffee">
      <Shadow r={r} />
      {isoBox({ r, h: 26, color: "#4a3a2c" })}
      {isoBox({ r: { u: r.u + 0.15, v: r.v + 0.1, w: 0.7, d: 0.5 }, h: 30, color: "#d8dde8", lift: 26 })}
      {isoBox({ r: { u: r.u + 0.3, v: r.v + 0.4, w: 0.18, d: 0.18 }, h: 8, color: "#fff", lift: 26 })}
      {quad(project(r.u + 0.22, r.v + 0.62, 70), project(r.u + 0.78, r.v + 0.62, 70), project(r.u + 0.78, r.v + 0.62, 60), project(r.u + 0.22, r.v + 0.62, 60), "#0b3a4a", { stroke: "#3a4260", strokeWidth: 0.6 })}
    </g>
  );
});

const SWATCHES: Array<[string, string]> = [["#c9d1e0", "inox"], ["#b5835a", "wood"], ["#8a8f99", "stone"], ["#9cd3e6", "glass"]];

/** Shelf of material samples: stainless, wood, stone, glass. */
export const W3DMaterialShelf = memo(function W3DMaterialShelf({ active }: { active: boolean }) {
  const r = W3D_RECTS.shelf;
  const tiers: ReactElement[] = [];
  for (let t = 0; t < 3; t++) {
    const z = 16 + t * 28;
    const items: ReactElement[] = [];
    for (let i = 0; i < 8; i++) {
      const [col, kind] = SWATCHES[(i + t) % 4]!;
      const ux = r.u + 0.22 + i * 0.4;
      items.push(
        <g key={i} data-swatch={kind}>
          {isoBox({ r: { u: ux, v: r.v + 0.18, w: 0.3, d: 0.46 }, h: 12 + (i % 3) * 3, color: col, lift: z + 3 })}
          {kind === "inox" && line(project(ux + 0.05, r.v + 0.64, z + 17), project(ux + 0.25, r.v + 0.64, z + 11), "#fff", 0.9, { opacity: 0.6 })}
          {kind === "glass" && <polygon points={ptsStr([project(ux, r.v + 0.64, z + 15), project(ux + 0.3, r.v + 0.64, z + 15), project(ux + 0.3, r.v + 0.64, z + 3), project(ux, r.v + 0.64, z + 3)])} fill="#fff" opacity={0.25} />}
        </g>,
      );
    }
    tiers.push(<g key={t}>{isoBox({ r: { u: r.u, v: r.v, w: r.w, d: r.d - 0.1 }, h: 3, color: "#4a3a2c", lift: z })}{items}</g>);
  }
  return (
    <g data-equip="shelf" data-active={active ? "1" : "0"}>
      <Shadow r={r} />
      {isoBox({ r: { u: r.u, v: r.v, w: 0.14, d: r.d - 0.1 }, h: 90, color: "#2f3548" })}
      {isoBox({ r: { u: r.u + r.w - 0.14, v: r.v, w: 0.14, d: r.d - 0.1 }, h: 90, color: "#2f3548" })}
      {tiers}
    </g>
  );
});

/** 3D printer on a small table; the head moves while printing. */
export const W3DPrinter = memo(function W3DPrinter({ printing }: { printing: boolean }) {
  const r = W3D_RECTS.printer;
  return (
    <g data-equip="printer" data-printing={printing ? "1" : "0"}>
      <Shadow r={r} />
      {isoBox({ r, h: 22, color: "#2f3548" })}
      {isoBox({ r: { u: r.u + 0.1, v: r.v + 0.12, w: 0.9, d: 0.9 }, h: 5, color: "#161a22", lift: 22 })}
      {[0.1, 0.9].flatMap((du) => [0.12, 0.9].map((dv) => <g key={`${du}${dv}`}>{isoBox({ r: { u: r.u + du, v: r.v + dv, w: 0.1, d: 0.1 }, h: 42, color: "#c9d1e0", lift: 22 })}</g>))}
      {isoBox({ r: { u: r.u + 0.1, v: r.v + 0.12, w: 0.9, d: 0.1 }, h: 4, color: "#e24b4b", lift: 64 })}
      {isoBox({ r: { u: r.u + 0.4, v: r.v + 0.4, w: 0.3, d: 0.3 }, h: printing ? 16 : 9, color: "#74e0ff", lift: 27 })}
      <g className={printing ? "w3r-head" : undefined}>{isoBox({ r: { u: r.u + 0.4, v: r.v + 0.12, w: 0.24, d: 0.16 }, h: 7, color: "#ffc542", lift: printing ? 50 : 56 })}</g>
    </g>
  );
});

const hexProj = (u: number, v: number, z: number): Pt => project(u, v, z);

/** Wireframe cube edges of a box (for stage 1). */
function wire(r: Rect, h: number, lift: number, color: string): ReactElement {
  const c = (du: number, dv: number, z: number): Pt => hexProj(r.u + du * r.w, r.v + dv * r.d, lift + z * h);
  const edges: Array<[Pt, Pt]> = [];
  for (const z of [0, 1]) edges.push([c(0, 0, z), c(1, 0, z)], [c(1, 0, z), c(1, 1, z)], [c(1, 1, z), c(0, 1, z)], [c(0, 1, z), c(0, 0, z)]);
  for (const [a, b] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) edges.push([c(a, b, 0), c(a, b, 1)]);
  return <g>{edges.map(([a, b], i) => <g key={i}>{line(a, b, color, 1.3)}</g>)}</g>;
}

/** Display podium with the object being built: empty, wireframe, solids, materials, final (stage 0..4). */
export const W3DPodium = memo(function W3DPodium({ stage }: { stage: W3DStage }) {
  const r = W3D_RECTS.podium;
  const m: Rect = { u: r.u + 0.55, v: r.v + 0.55, w: 1.1, d: 1.1 };
  const top = 12;
  return (
    <g data-equip="podium" data-stage={stage}>
      <Shadow r={r} grow={0.3} />
      {isoBox({ r, h: 10, color: "#4a5170" })}
      {isoBox({ r: { u: r.u + 0.15, v: r.v + 0.15, w: r.w - 0.3, d: r.d - 0.3 }, h: 2.5, color: "#2f3548", lift: 10 })}
      <ellipse className="w3r-ring" cx={project(r.u + r.w / 2, r.v + r.d / 2, top).x} cy={project(r.u + r.w / 2, r.v + r.d / 2, top).y} rx={46} ry={23} fill="none" stroke="#74e0ff" strokeWidth={1.4} strokeDasharray="6 8" opacity={stage ? 0.9 : 0.35} />
      {stage === 0 && <g data-model="none">{isoBox({ r: { u: m.u + 0.3, v: m.v + 0.3, w: 0.5, d: 0.5 }, h: 4, color: "#74e0ff", lift: top })}</g>}
      {stage === 1 && <g data-model="wire" className="w3r-model">{wire(m, 34, top, "#74e0ff")}{wire({ u: m.u + 0.2, v: m.v + 0.2, w: 0.7, d: 0.7 }, 14, top + 34, "#74e0ff")}</g>}
      {stage === 2 && (
        <g data-model="solid" className="w3r-model">
          {isoBox({ r: m, h: 34, color: "#8b96a8", lift: top })}
          {isoBox({ r: { u: m.u + 0.2, v: m.v + 0.2, w: 0.7, d: 0.7 }, h: 14, color: "#6b7490", lift: top + 34 })}
        </g>
      )}
      {stage >= 3 && (
        <g data-model={stage === 3 ? "material" : "final"} className="w3r-model">
          {isoBox({ r: m, h: 34, color: "#c9d1e0", lift: top })}
          {isoBox({ r: { u: m.u + 0.08, v: m.v + 0.08, w: 0.4, d: 0.94 }, h: 26, color: "#b5835a", lift: top + 4 })}
          {isoBox({ r: { u: m.u + 0.56, v: m.v + 0.08, w: 0.46, d: 0.94 }, h: 26, color: "#1f2a44", lift: top + 4 })}
          {isoBox({ r: { u: m.u + 0.2, v: m.v + 0.2, w: 0.7, d: 0.7 }, h: 14, color: "#e9eef8", lift: top + 34 })}
          {stage === 4 && (
            <g data-glint="1" className="w3r-glint">
              {line(hexProj(m.u + 0.1, m.v + m.d, top + 30), hexProj(m.u + 0.5, m.v + m.d, top + 6), "#fff", 2, { opacity: 0.7 })}
              <circle cx={hexProj(m.u + 1.1, m.v, top + 56).x} cy={hexProj(m.u + 1.1, m.v, top + 56).y} r={3} fill="#ffe08a" />
              <circle cx={hexProj(m.u, m.v + 1.1, top + 50).x} cy={hexProj(m.u, m.v + 1.1, top + 50).y} r={2.2} fill="#ffe08a" />
            </g>
          )}
        </g>
      )}
    </g>
  );
});

/** Photo studio: softboxes, white backdrop, tripod with a camera, a small turntable with the model. */
export const W3DStudio = memo(function W3DStudio({ shooting, stage }: { shooting: boolean; stage: W3DStage }) {
  const { softboxA: a, softboxB: b, backdrop: bd, tripod: tp, turntable: tt } = W3D_RECTS;
  const soft = (r: Rect, k: string): ReactElement => (
    <g key={k} data-equip={k}>
      <Shadow r={r} />
      {isoBox({ r: { u: r.u + 0.2, v: r.v + 0.2, w: 0.1, d: 0.1 }, h: 60, color: "#2f3548" })}
      {isoBox({ r: { u: r.u - 0.1, v: r.v - 0.1, w: 0.7, d: 0.7 }, h: 26, color: "#f4f6fa", lift: 56 })}
      <g className={shooting ? "w3r-flash" : undefined}>{isoBox({ r: { u: r.u - 0.04, v: r.v - 0.04, w: 0.58, d: 0.58 }, h: 3, color: "#fff4c2", lift: 54 })}</g>
    </g>
  );
  return (
    <g data-equip="studio" data-shooting={shooting ? "1" : "0"}>
      <Shadow r={bd} />
      {isoBox({ r: bd, h: 92, color: "#f4f6fa" })}
      {soft(a, "softboxA")}
      <Shadow r={tt} />
      {isoBox({ r: tt, h: 8, color: "#2f3548" })}
      {isoBox({ r: { u: tt.u + 0.1, v: tt.v + 0.1, w: 0.6, d: 0.6 }, h: 2, color: "#e9eef8", lift: 8 })}
      {stage >= 1 && isoBox({ r: { u: tt.u + 0.2, v: tt.v + 0.2, w: 0.4, d: 0.4 }, h: stage >= 3 ? 22 : 18, color: stage >= 3 ? "#c9d1e0" : "#8b96a8", lift: 10 })}
      <Shadow r={tp} />
      {isoBox({ r: { u: tp.u + 0.18, v: tp.v + 0.18, w: 0.12, d: 0.12 }, h: 46, color: "#2f3548" })}
      {isoBox({ r: { u: tp.u, v: tp.v + 0.05, w: 0.5, d: 0.4 }, h: 14, color: "#1d2029", lift: 46 })}
      {isoBox({ r: { u: tp.u + 0.36, v: tp.v + 0.12, w: 0.28, d: 0.26 }, h: 10, color: "#0b1020", lift: 48 })}
      {soft(b, "softboxB")}
    </g>
  );
});

export const W3DReviewDesk = memo(function W3DReviewDesk() {
  const r = W3D_RECTS.reviewDesk;
  return (
    <g data-equip="reviewDesk">
      <Shadow r={r} />
      {isoBox({ r, h: 22, color: "#5e4a38" })}
      <Monitor u={r.u + 0.15} v={r.v} w={0.8} on big />
      {isoBox({ r: { u: r.u + 1.1, v: r.v + 0.3, w: 0.5, d: 0.4 }, h: 3, color: "#f4f6fa", lift: 22 })}
      {isoBox({ r: { u: r.u + 1.2, v: r.v + 0.4, w: 0.12, d: 0.12 }, h: 7, color: "#6b4a2a", lift: 25 })}
    </g>
  );
});

export const W3DSofa = memo(function W3DSofa() {
  const r = W3D_RECTS.sofa;
  const col = "#d6456f";
  return (
    <g data-equip="sofa">
      <Shadow r={r} />
      {isoBox({ r: { u: r.u, v: r.v, w: r.w, d: 0.22 }, h: 40, color: shade(col, 0.85) })}
      {isoBox({ r: { u: r.u, v: r.v, w: 0.25, d: r.d }, h: 24, color: shade(col, 0.9) })}
      {isoBox({ r: { u: r.u + r.w - 0.25, v: r.v, w: 0.25, d: r.d }, h: 24, color: shade(col, 0.9) })}
      {isoBox({ r: { u: r.u + 0.25, v: r.v + 0.22, w: r.w - 0.5, d: r.d - 0.22 }, h: 15, color: col })}
      {isoBox({ r: { u: r.u + 0.35, v: r.v + 0.3, w: 0.3, d: 0.3 }, h: 8, color: "#ffc542", lift: 15 })}
    </g>
  );
});

export const W3DPlant = memo(function W3DPlant({ r }: { r: Rect }) {
  const c = project(r.u + r.w / 2, r.v + r.d / 2, 20);
  return (
    <g data-furn="plant">
      <Shadow r={r} />
      {isoBox({ r, h: 18, color: "#8a5a3a" })}
      {[[0, 0, 9, "#3f8a50"], [-6, -8, 8, "#4f9d5d"], [6, -10, 8, "#5fb06c"], [0, -18, 7, "#6cc27a"]].map(([dx, dy, rr, col], i) => (
        <ellipse key={i} cx={c.x + (dx as number)} cy={c.y + (dy as number)} rx={(rr as number) + 3} ry={rr as number} fill={col as string} />
      ))}
    </g>
  );
});
