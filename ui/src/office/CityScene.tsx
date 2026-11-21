import { useEffect, useMemo, useRef, useState } from "react";
import type { KeyboardEvent, ReactNode, RefObject } from "react";
import { useT } from "../i18n";
import { startCitySim } from "./city-sim-dom";
import { MAX_SKILL_FLOORS, canAddSkillFloor } from "./floors";
import type { SkillBadge, SkillFloor } from "./floors";
import { canAddDesign3DFloor, workshop3dTowerFloors } from "./design3d-floors";
import type { Design3DBadge } from "./design3d-floors";
import { canAddVideoStudio } from "./videostudio-floors";
import type { VsBadge, VsDisplayFloor } from "./videostudio-floors";
import type { Design3DFloor, Workshop3DListItem } from "../types.js";
import "./city.css";

/* Static city scene ported from docs/design/single-screen.html (SVG lines 186-217, buildTowers, buildPlaza). */

export type CityFloor = { id: string; name: string; running: boolean; sub?: string };
export type CityApiFloor = { id: string; name: string; badge: keyof typeof API_COLOR; text: string };
export type CityNodes = { veh: RefObject<SVGGElement | null>; pedBack: RefObject<SVGGElement | null>; pedFront: RefObject<SVGGElement | null> };
export const CITY_GEOM = { crossX: 590, CURB: 712, ROAD: 716, ROAD_H: 84 } as const;

const T1 = { x: 440, w: 300, base: 560, lobby: 84, floorH: 72, crown: 40 };
const T2 = { x: 810, w: 220, base: 560, crown: 30 };
const T3 = { x: 1100, w: 190, base: 560, crown: 30 };
const API_FLOOR_H = 62;
const API_BOTTOM = 50;
const API_COLOR = { ok: "#4fd18b", working: "#5aa0ff", attention: "#ff5c5c", down: "#8b98b3" } as const;
const STATUS = { free: "#8b98b3", doing: "#5aa0ff" };
const SKILL_FLOOR_H = 62;
const SKILL_BOTTOM = 50;
const BADGE_COLOR: Record<SkillBadge, string> = { training: "#5aa0ff", waiting: "#ffb15c", passed: "#4fd18b", failed: "#ff5c5c", idle: "#8b98b3" };

function seeded(seed: number) {
  let r = seed;
  return () => {
    r = (r * 9301 + 49297) % 233280;
    return r / 233280;
  };
}

function glassBlock(x: number, y: number, w: number, h: number, fill: string, side = 28): ReactNode {
  return (
    <g>
      <polygon points={`${x + w},${y} ${x + w + side},${y - side * 0.55} ${x + w + side},${y + h - side * 0.55} ${x + w},${y + h}`} fill="url(#gSideT)" />
      <rect x={x} y={y} width={w} height={h} fill={fill} />
    </g>
  );
}

function windows(x: number, y: number, w: number, h: number, cols: number, rows: number, seed: number, dim: boolean): ReactNode[] {
  const rr = seeded(seed);
  const cw = w / cols;
  const rh = h / rows;
  const out: ReactNode[] = [];
  for (let i = 0; i < cols; i++) {
    for (let k = 0; k < rows; k++) {
      const lit = rr() > (dim ? 0.8 : 0.45);
      const fill = lit ? (rr() > 0.5 ? "#ffd9a3" : "#cfe3ff") : "#0b1428";
      const delay = Math.floor(rr() * 11);
      // Some lit windows blink, some dark ones wake up now and then: the towers look alive at night.
      const blink = lit && rr() < 0.4;
      const wake = !lit && rr() < 0.22;
      const dur = (2.5 + rr() * 5).toFixed(1);
      const cls = blink ? "win win-blink" : wake ? "win-wake" : lit ? "win" : undefined;
      const style = blink || wake ? { animationDelay: `-${delay}s`, animationDuration: `${dur}s` } : { animationDelay: `-${delay}s` };
      out.push(
        <rect key={`${i}-${k}`} className={cls} x={x + i * cw + 3} y={y + k * rh + 3} width={cw - 6} height={rh - 6} rx={1} fill={fill} opacity={lit ? 0.85 : 0.9} style={style} />,
      );
    }
  }
  return out;
}

/**
 * One floor of a side tower in the style of the main TNF Tower: a full-width row of lit windows (some blink, some wake
 * up now and then) behind a rounded plate that carries the floor text.
 */
function floorGlass(x: number, y: number, w: number, h: number, seed: number): ReactNode {
  return (
    <g>
      <rect className="glass" x={x + 2} y={y} width={w - 4} height={h} fill="#5aa0ff" opacity={0} />
      <g className="glass">{windows(x + 4, y + 4, w - 8, h - 8, Math.max(4, Math.round((w - 8) / 32)), 2, seed, false)}</g>
      <rect className="plate" x={x + 8} y={y + 6} width={w - 16} height={h - 12} rx={8} fill="#0b1020" fillOpacity={0.82} stroke="#243049" />
    </g>
  );
}

/**
 * Night details of a side tower, like the TNF Tower: gold crown line, moving sheen, bulbs on the crown, red roof
 * beacon, lit lobby with a warm glow at the door. `accent` tints the bulbs and the sign glow.
 */
function TowerLights({ x, w, top, base, crown, bottom, accent }: { x: number; w: number; top: number; base: number; crown: number; bottom: number; accent: string }) {
  const bulbs = Math.max(3, Math.floor((w - 16) / 18));
  return (
    <g className="tower-lights" pointerEvents="none">
      <rect x={x} y={top + crown - 2} width={w} height={2} fill="url(#gGold)" />
      <ellipse cx={x + w / 2} cy={top + 14} rx={w * 0.42} ry={9} fill={accent} opacity={0.14} filter="url(#glowG)" />
      {Array.from({ length: bulbs }, (_, i) => (
        <circle key={`b${i}`} className={i % 2 === 0 ? "win win-blink" : "win"} cx={x + 14 + i * ((w - 28) / Math.max(1, bulbs - 1))} cy={top + 3} r={1.8} fill={i % 3 === 0 ? "#ffd9a3" : accent} style={{ animationDelay: `-${(i * 3) % 11}s` }} />
      ))}
      <rect x={x + w / 2 - 1.5} y={top - 22} width={3} height={22} fill="#8b96a8" />
      <circle className="beacon" cx={x + w / 2} cy={top - 24} r={4} fill="#ff5c5c" />
      {Array.from({ length: 4 }, (_, i) => (
        <rect key={`l${i}`} x={x + 10 + i * ((w - 20) / 4)} y={base - bottom + 8} width={(w - 20) / 4 - 6} height={bottom - 12} fill="#ffe2b8" opacity={i === 1 ? 0.32 : 0.16} />
      ))}
      <rect x={x - 6} y={base - bottom + 8} width={w + 12} height={3} fill="url(#gGold)" />
      <ellipse cx={x + w / 2} cy={base + 2} rx={w * 0.7} ry={9} fill="#ffd9a3" opacity={0.12} filter="url(#glowG)" />
      <rect className="sheen" x={x} y={top} width={48} height={base - top} fill="url(#gSheen)" opacity={0.3} />
    </g>
  );
}

function Sky() {
  const stars = useMemo(() => {
    const rr = seeded(77);
    return Array.from({ length: 90 }, (_, i) => ({ i, cx: rr() * 1400, cy: rr() * 300, r: rr() * 1.3 + 0.3, d: (rr() * 3).toFixed(1) }));
  }, []);
  const skyline = useMemo(() => {
    const out: ReactNode[] = [];
    const rr = seeded(9);
    let x = -200;
    let n = 0;
    while (x < 1700) {
      const w = 30 + rr() * 60;
      const h = 40 + rr() * 170;
      out.push(<rect key={`b${n++}`} x={x} y={560 - h} width={w} height={h} fill="#0e1530" />);
      for (let wy = 560 - h + 8; wy < 550; wy += 12) {
        for (let wx = x + 5; wx < x + w - 6; wx += 10) {
          if (rr() > 0.6) out.push(<rect key={`w${n++}`} x={wx} y={wy} width={4} height={6} fill={rr() > 0.5 ? "#ffd9a3" : "#9cc4ff"} opacity={0.35} />);
        }
      }
      x += w + 3 + rr() * 14;
    }
    return out;
  }, []);
  return (
    <>
      <g>{stars.map((s) => <circle key={s.i} className="star" cx={s.cx} cy={s.cy} r={s.r} fill="#fff" style={{ animationDelay: `-${s.d}s` }} />)}</g>
      <circle cx={1180} cy={120} r={70} fill="url(#gMoon)" opacity={0.5} />
      <circle cx={1180} cy={120} r={26} fill="#fff5d6" />
      <g className="cloud" style={{ animationDuration: "160s" }}><ellipse cx={0} cy={150} rx={160} ry={10} fill="#fff" opacity={0.05} /></g>
      <rect x={-3000} y={420} width={7200} height={150} fill="#32508c" opacity={0.14} pointerEvents="none" />
      <g>{skyline}</g>
    </>
  );
}

function Plaza() {
  const { crossX: lobbyT, CURB, ROAD, ROAD_H } = CITY_GEOM;
  const lobbyB = T2.x + T2.w / 2;
  const lobbyC = T3.x + T3.w / 2;
  const Y0 = T1.base;
  const rows: ReactNode[] = [];
  for (let y = Y0 + 18; y < CURB; y += 18) rows.push(<line key={`h${y}`} x1={-3000} y1={y} x2={4200} y2={y} stroke="#1c2339" strokeWidth={1} />);
  for (let x = -3000; x < 4200; x += 46) rows.push(<line key={`v${x}`} x1={x} y1={Y0} x2={x} y2={CURB} stroke="#1c2339" strokeWidth={1} />);
  return (
    <g>
      <rect x={-3000} y={Y0} width={7200} height={CURB - Y0} fill="#262f4b" />
      {rows}
      {([[lobbyT, 0.09], [lobbyB, 0.06], [lobbyC, 0.06]] as const).map(([cx, o]) => (
        <g key={cx}>
          <rect x={cx - 70} y={Y0} width={140} height={CURB - Y0} fill="#fff" opacity={o} />
          <ellipse cx={cx} cy={Y0 + 30} rx={190} ry={46} fill="#ffd9a3" opacity={o * 2.2} filter="url(#glowG)" />
        </g>
      ))}
      <polygon points={`${lobbyT - 18},${Y0 + 2} ${lobbyT + 18},${Y0 + 2} ${lobbyT + 30},${Y0 + 96} ${lobbyT - 30},${Y0 + 96}`} fill="#8a1f2e" opacity={0.9} />
      {([[-34, 26], [34, 26], [-42, 70], [42, 70]] as const).map(([dx, dy]) => (
        <g key={`${dx}${dy}`}>
          <rect x={lobbyT + dx - 1.5} y={Y0 + dy - 20} width={3} height={20} fill="#d9b26a" />
          <circle cx={lobbyT + dx} cy={Y0 + dy - 21} r={2.6} fill="#f0d58f" />
        </g>
      ))}
      <path d={`M${lobbyT - 34} ${Y0 + 8} q34 10 68 0`} stroke="#8a1f2e" strokeWidth={2} fill="none" />
      <path d={`M${lobbyT - 42} ${Y0 + 52} q42 10 84 0`} stroke="#8a1f2e" strokeWidth={2} fill="none" />
      {([[lobbyB, "#2a4f8a", "#7fb2ff"], [lobbyC, "#1f6a5e", "#6fe0c4"]] as const).map(([cx, color, glow]) => (
        <g key={`walk-${cx}`} data-walkway="1">
          <polygon points={`${cx - 16},${Y0 + 2} ${cx + 16},${Y0 + 2} ${cx + 30},${CURB - 2} ${cx - 30},${CURB - 2}`} fill={color} opacity={0.6} />
          <polygon points={`${cx - 6},${Y0 + 2} ${cx + 6},${Y0 + 2} ${cx + 11},${CURB - 2} ${cx - 11},${CURB - 2}`} fill="#fff" opacity={0.1} />
          {[28, 64, 100, 134].map((dy) => {
            const off = 20 + (dy / (CURB - Y0)) * 12;
            return [-off, off].map((dx) => (
              <g key={`${dy}${dx}`}>
                <ellipse cx={cx + dx} cy={Y0 + dy + 2} rx={16} ry={6} fill={glow} opacity={0.22} filter="url(#glowG)" />
                <rect x={cx + dx - 1.5} y={Y0 + dy - 12} width={3} height={12} fill="#8b96a8" />
                <circle className="beacon" cx={cx + dx} cy={Y0 + dy - 13} r={2.8} fill={glow} style={{ animationDelay: `-${(dy % 7) / 3}s` }} />
              </g>
            ));
          })}
        </g>
      ))}
      <rect x={-3000} y={CURB - 4} width={7200} height={4} fill="#8b96a8" />
      <rect x={-3000} y={CURB} width={7200} height={4} fill="#3a4360" />
      <rect x={-3000} y={ROAD} width={7200} height={ROAD_H} fill="#161b2c" />
      <line x1={-3000} y1={ROAD + 70} x2={4400} y2={ROAD + 70} stroke="#f0c36a" strokeWidth={2} strokeDasharray="30 26" opacity={0.45} />
      {Array.from({ length: 7 }, (_, i) => <rect key={i} x={lobbyT - 44 + i * 14} y={ROAD + 6} width={8} height={ROAD_H - 12} fill="#fff" opacity={0.3} />)}
      <rect x={-3000} y={ROAD + ROAD_H} width={7200} height={4} fill="#3a4360" />
      <rect x={-3000} y={ROAD + ROAD_H + 4} width={7200} height={40} fill="#1f2740" />
    </g>
  );
}

function Hedge({ x0, x1 }: { x0: number; x1: number }) {
  const Y0 = T1.base;
  const leaves: ReactNode[] = [];
  for (let x = x0 + 8; x < x1 - 6; x += 14) leaves.push(<ellipse key={x} cx={x} cy={Y0 - 2} rx={9} ry={8} fill="url(#gLeaf)" />);
  return (
    <g>
      <rect x={x0} y={Y0 + 4} width={x1 - x0} height={10} rx={2} fill="#121a2e" />
      <rect x={x0} y={Y0 + 3} width={x1 - x0} height={2} fill="#d9b26a" opacity={0.8} />
      {leaves}
    </g>
  );
}

function Tree({ x, y, s, i }: { x: number; y: number; s: number; i: number }) {
  return (
    <g transform={`translate(${x},${y}) scale(${s})`}>
      <ellipse cx={0} cy={2} rx={22} ry={6} fill="#000" opacity={0.35} />
      <rect x={-10} y={-4} width={20} height={6} rx={1} fill="#121a2e" />
      <rect x={-11} y={-6} width={22} height={2} fill="#8b96a8" />
      <g className="tree" style={{ animationDelay: `-${i}s` }}>
        <path d="M-2.5 -4 q-1 -26 0 -50 h5 q1 24 0 50z" fill="#2a1d14" />
        <path d="M0 -40 q-9 -6 -15 -2 M0 -46 q9 -6 15 0" stroke="#2a1d14" strokeWidth={2} fill="none" />
        {([[-13, -58, 15], [13, -57, 14], [0, -76, 16], [-7, -68, 12], [8, -70, 12], [0, -56, 15]] as const).map(([cx, cy, r]) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r={r} fill="url(#gLeaf)" />)}
        {([[-15, -66], [4, -84], [14, -62]] as const).map(([cx, cy]) => <circle key={`${cx}${cy}`} cx={cx} cy={cy} r={1.8} fill="#bff0cf" opacity={0.6} />)}
      </g>
    </g>
  );
}

function Lamp({ x }: { x: number }) {
  const CURB = CITY_GEOM.CURB;
  return (
    <g>
      <rect x={x - 2} y={CURB - 96} width={4} height={92} fill="#8b96a8" />
      <path d={`M${x} ${CURB - 96} q0 -10 10 -10 h8`} stroke="#8b96a8" strokeWidth={3} fill="none" />
      <ellipse cx={x + 18} cy={CURB - 104} rx={7} ry={3} fill="#ffe2b8" />
      <ellipse cx={x + 18} cy={CURB - 60} rx={44} ry={60} fill="url(#gLampU)" opacity={0.35} />
    </g>
  );
}

function Parked({ x, color }: { x: number; color: string }) {
  return (
    <g transform={`translate(${x},${CITY_GEOM.ROAD + 14})`}>
      <ellipse cx={36} cy={10} rx={40} ry={4} fill="#000" opacity={0.45} />
      <path d="M4 8 q-4 0 -4 -4 v-6 q0 -5 6 -6 l12 -2 q6 -9 16 -9 h16 q10 0 16 9 l12 2 q6 1 6 6 v6 q0 4 -4 4z" fill={color} />
      <path d="M20 -10 q5 -7 14 -7 h14 q9 0 14 7z" fill="#dbe7ff" opacity={0.5} />
      <rect x={2} y={-2} width={70} height={1.5} fill="#fff" opacity={0.25} />
      {[16, 58].map((wx) => (
        <g key={wx}>
          <circle cx={wx} cy={10} r={5.5} fill="#111" />
          <circle cx={wx} cy={10} r={2.5} fill="#777" />
        </g>
      ))}
    </g>
  );
}

function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** Keyboard + click activation for SVG role="button" elements (Enter or Space). */
function activate(fn?: (() => void) | undefined) {
  return {
    role: "button" as const,
    tabIndex: 0,
    onClick: () => fn?.(),
    onKeyDown: (e: KeyboardEvent<SVGGElement>) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fn?.();
      }
    },
  };
}

function Towers({ names, floors, onFloorClick, onAddFloor, skillFloors, onSkillFloorClick, onAddSkillFloor, onGroundFloorClick, canAdd }: { onGroundFloorClick?: (() => void) | undefined; names: [string, string]; floors: CityFloor[]; onFloorClick?: ((id: string) => void) | undefined; onAddFloor?: (() => void) | undefined; skillFloors: SkillFloor[]; onSkillFloorClick?: ((id: string) => void) | undefined; onAddSkillFloor?: (() => void) | undefined; canAdd: boolean }) {
  const { t } = useT();
  const canAddSkill = canAddSkillFloor(skillFloors.length);
  const n = floors.length;
  const top = T1.base - T1.lobby - T1.floorH * n - T1.crown;
  const cx1 = T1.x + T1.w / 2;
  const ly = T1.base - T1.lobby;
  const cx2 = T2.x + T2.w / 2;
  const shown = skillFloors.slice(0, MAX_SKILL_FLOORS);
  const t2top = T2.base - SKILL_BOTTOM - SKILL_FLOOR_H * shown.length - T2.crown;
  const t2ly = T2.base - SKILL_BOTTOM;
  return (
    <g>
      <g filter="url(#shadow)">{glassBlock(T1.x, top, T1.w, T1.base - top, "url(#gGlass)")}</g>
      <rect x={T1.x} y={top} width={2} height={T1.base - top} fill="url(#gGold)" opacity={0.8} />
      <rect x={T1.x + T1.w - 2} y={top} width={2} height={T1.base - top} fill="url(#gGold)" opacity={0.8} />
      <rect x={T1.x} y={top} width={T1.w} height={T1.crown} fill="#0b1020" />
      <rect x={T1.x} y={top + T1.crown - 2} width={T1.w} height={2} fill="url(#gGold)" />
      <text x={cx1} y={top + 22} className="lbl" textAnchor="middle" fontSize={names[0].length > 12 ? 11 : 15} fontWeight={800} letterSpacing={names[0].length > 12 ? 2 : 4} fill="url(#gGold)">{names[0].toUpperCase()}</text>
      <rect x={cx1 - 1.5} y={top - 70} width={3} height={70} fill="#8b96a8" />
      <circle className="beacon" cx={cx1} cy={top - 72} r={4} fill="#ff5c5c" />
      {canAdd ? (
        <g className="floor-band" {...activate(onAddFloor)}>
          <rect x={T1.x + 6} y={top - 46} width={T1.w - 12} height={36} rx={4} fill="#5aa0ff" opacity={0.06} stroke="#5aa0ff" strokeDasharray="6 5" strokeOpacity={0.5} />
          <text x={cx1} y={top - 24} className="sub" textAnchor="middle" fill="#9cc4ff" fontSize={11}>{t.city_add_floor}</text>
        </g>
      ) : null}
      {floors.map((f, i) => {
        const y = T1.base - T1.lobby - T1.floorH * (i + 1);
        const px = T1.x + 12;
        const py = y + (T1.floorH - 36) / 2;
        return (
          <g key={f.id} className={f.running ? "floor-band floor-running" : "floor-band"} {...activate(() => onFloorClick?.(f.id))}>
            <rect className="glass" x={T1.x + 2} y={y} width={T1.w - 4} height={T1.floorH} fill="#5aa0ff" opacity={f.running ? 0.14 : 0} />
            <g className="glass">{windows(T1.x + 4, y + 4, T1.w - 8, T1.floorH - 8, 9, 2, 11 + i * 7, false)}</g>
            <rect x={T1.x} y={y + T1.floorH - 1} width={T1.w} height={1.5} fill="#0b1020" />
            <rect className="plate" x={px} y={py} width={T1.w - 24} height={36} rx={8} fill="#0b1020" fillOpacity={0.88} stroke={f.running ? "#5aa0ff" : "#2c3b5c"} strokeWidth={f.running ? 1.4 : 1} />
            {f.running && <rect x={px + 1} y={py + 6} width={3} height={24} rx={1.5} fill="#5aa0ff" />}
            <circle className={f.running ? "beacon" : undefined} cx={px + 14} cy={py + 18} r={4} fill={f.running ? STATUS.doing : STATUS.free} />
            <text x={px + 26} y={py + 15} className="lbl" textAnchor="start" fontSize={11}>{clip(f.id === "default" ? t.city_ground_floor : `${t.city_floor} ${i} · ${f.name}`, 32)}</text>
            <text x={px + 26} y={py + 29} className="sub" textAnchor="start" fontSize={10}>{clip(f.sub ?? (f.running ? t.city_running : t.city_idle), 34)}</text>
          </g>
        );
      })}
      <rect x={T1.x + 2} y={ly} width={T1.w - 4} height={T1.lobby} fill="#ffd9a3" opacity={0.12} />
      {Array.from({ length: 7 }, (_, i) => <rect key={i} x={T1.x + 10 + i * 41} y={ly + 6} width={32} height={T1.lobby - 8} fill="#ffe2b8" opacity={i === 3 ? 0.32 : 0.16} />)}
      <rect x={T1.x - 10} y={ly + 8} width={T1.w + 20} height={4} fill="url(#gGold)" />
      <ellipse cx={cx1} cy={T1.base + 2} rx={150} ry={10} fill="#ffd9a3" opacity={0.12} filter="url(#glowG)" />
      <rect className="sheen" x={T1.x} y={top} width={70} height={T1.base - top} fill="url(#gSheen)" opacity={0.3} />
      <g className="training-tower">
        <g filter="url(#shadow)">{glassBlock(T2.x, t2top, T2.w, T2.base - t2top, "url(#gGlassDim)", 24)}</g>
        <rect x={T2.x} y={t2top} width={T2.w} height={T2.crown} fill="#0b1020" />
        <g className="floor-band ground-floor" {...activate(onGroundFloorClick)}>
          <rect x={T2.x + 2} y={t2ly} width={T2.w - 4} height={SKILL_BOTTOM} fill="#ffd9a3" opacity={0.12} />
          <text x={cx2} y={t2ly + 30} className="lbl" textAnchor="middle" fontSize={11}>{t.city_ground_floor}</text>
        </g>
        <text x={cx2} y={t2top + 20} className="lbl" textAnchor="middle" fontSize={names[1].length > 12 ? 10 : 12} fontWeight={800} letterSpacing={3} fill="#9cc4ff">{names[1].toUpperCase()}</text>
        {canAddSkill ? (
          <g className="floor-band" {...activate(onAddSkillFloor)}>
            <rect x={T2.x + 6} y={t2top - 46} width={T2.w - 12} height={36} rx={4} fill="#5aa0ff" opacity={0.06} stroke="#5aa0ff" strokeDasharray="6 5" strokeOpacity={0.5} />
            <text x={cx2} y={t2top - 24} className="sub" textAnchor="middle" fill="#9cc4ff" fontSize={11}>{t.city_skill_add}</text>
          </g>
        ) : null}
        {shown.map((f, i) => {
          const y = T2.base - SKILL_BOTTOM - SKILL_FLOOR_H * (i + 1);
          const color = BADGE_COLOR[f.badge];
          const label = t[`skill_badge_${f.badge}` as const];
          const extra = f.sub && f.state === "awaiting_approval" ? ` · ${t.skill_pending_approval}` : "";
          return (
            <g key={f.id} className="floor-band" {...activate(() => onSkillFloorClick?.(f.id))}>
              {floorGlass(T2.x, y, T2.w, SKILL_FLOOR_H, 31 + i * 7)}
              <rect x={T2.x} y={y + SKILL_FLOOR_H - 1} width={T2.w} height={1.5} fill="#0b1020" />
              <circle className={f.running ? "beacon" : undefined} cx={T2.x + 14} cy={y + 16} r={4} fill={color} />
              <text x={T2.x + 26} y={y + 20} className="lbl" textAnchor="start" fontSize={11}>{clip(f.name, 24)}</text>
              <text x={T2.x + 26} y={y + 36} className="sub" textAnchor="start" fontSize={10} fill={color}>{clip(`${label}${extra}`, 30)}</text>
              <text x={T2.x + 26} y={y + 50} className="sub" textAnchor="start" fontSize={10}>{`${t.skill_best}: ${f.score ?? "–"}`}</text>
            </g>
          );
        })}
        <TowerLights x={T2.x} w={T2.w} top={t2top} base={T2.base} crown={T2.crown} bottom={SKILL_BOTTOM} accent="#9cc4ff" />
      </g>
    </g>
  );
}

/** Third tower: one floor per API connection; the colour shows its health, the plate its numbers. */
function ApiTower({ floors, max, onFloorClick, onAdd }: { floors: CityApiFloor[]; max: number; onFloorClick?: ((id: string) => void) | undefined; onAdd?: (() => void) | undefined }) {
  const { t } = useT();
  const shown = floors.slice(0, max);
  const top = T3.base - API_BOTTOM - API_FLOOR_H * shown.length - T3.crown;
  const ly = T3.base - API_BOTTOM;
  const cx = T3.x + T3.w / 2;
  return (
    <g className="api-tower">
      <g filter="url(#shadow)">{glassBlock(T3.x, top, T3.w, T3.base - top, "url(#gGlassDim)", 24)}</g>
      <rect x={T3.x} y={top} width={T3.w} height={T3.crown} fill="#0b1020" />
      <text x={cx} y={top + 20} className="lbl" textAnchor="middle" fontSize={12} fontWeight={800} letterSpacing={3} fill="#9cc4ff">{t.tower_api.toUpperCase()}</text>
      <g className="floor-band ground-floor">
        <rect x={T3.x + 2} y={ly} width={T3.w - 4} height={API_BOTTOM} fill="#ffd9a3" opacity={0.12} />
        <text x={cx} y={ly + 30} className="lbl" textAnchor="middle" fontSize={11}>{t.city_ground_floor}</text>
      </g>
      {floors.length < max ? (
        <g className="floor-band" {...activate(onAdd)}>
          <rect x={T3.x + 6} y={top - 46} width={T3.w - 12} height={36} rx={4} fill="#5aa0ff" opacity={0.06} stroke="#5aa0ff" strokeDasharray="6 5" strokeOpacity={0.5} />
          <text x={cx} y={top - 24} className="sub" textAnchor="middle" fill="#9cc4ff" fontSize={11}>{t.city_api_add}</text>
        </g>
      ) : null}
      {shown.map((f, i) => {
        const y = T3.base - API_BOTTOM - API_FLOOR_H * (i + 1);
        const color = API_COLOR[f.badge];
        return (
          <g key={f.id} className="floor-band" {...activate(() => onFloorClick?.(f.id))}>
            {floorGlass(T3.x, y, T3.w, API_FLOOR_H, 47 + i * 7)}
            <rect x={T3.x} y={y + API_FLOOR_H - 1} width={T3.w} height={1.5} fill="#0b1020" />
            <circle className={f.badge === "working" ? "beacon" : undefined} cx={T3.x + 14} cy={y + 18} r={4} fill={color} />
            <text x={T3.x + 26} y={y + 22} className="lbl" textAnchor="start" fontSize={11}>{clip(f.name, 20)}</text>
            <text x={T3.x + 26} y={y + 40} className="sub" textAnchor="start" fontSize={10} fill={color}>{clip(f.text, 26)}</text>
          </g>
        );
      })}
      <TowerLights x={T3.x} w={T3.w} top={top} base={T3.base} crown={T3.crown} bottom={API_BOTTOM} accent="#9cc4ff" />
    </g>
  );
}

const D3 = { x: 10, w: 170, base: 560, crown: 30 };
const D3_COLOR: Record<Design3DBadge, string> = { running: "#5aa0ff", done: "#4fd18b", failed: "#ff5c5c", idle: "#8b98b3" };

/** Left tower: one floor per 3D workshop session (then old 3D design runs); ground floor opens the request sheet. */
function Design3DTower({ floors, sessions, onFloorClick, onSessionClick, onAdd, onGroundClick }: { floors: readonly Design3DFloor[]; sessions?: readonly Workshop3DListItem[] | undefined; onFloorClick?: ((id: string) => void) | undefined; onSessionClick?: ((slug: string) => void) | undefined; onAdd?: (() => void) | undefined; onGroundClick?: (() => void) | undefined }) {
  const { t } = useT();
  const shown = workshop3dTowerFloors(sessions ?? [], floors);
  const top = D3.base - API_BOTTOM - API_FLOOR_H * shown.length - D3.crown;
  const ly = D3.base - API_BOTTOM;
  const cx = D3.x + D3.w / 2;
  const labels: Record<Design3DBadge, string> = { running: t.d3_status_building, done: t.d3_status_done, failed: t.d3_status_error, idle: t.d3_status_queued };
  return (
    <g className="design3d-tower">
      <g filter="url(#shadow)">{glassBlock(D3.x, top, D3.w, D3.base - top, "url(#gGlassDim)", 24)}</g>
      <rect x={D3.x} y={top} width={D3.w} height={D3.crown} fill="#0b1020" />
      <text x={cx} y={top + 20} className="lbl" textAnchor="middle" fontSize={12} fontWeight={800} letterSpacing={2} fill="#9cc4ff">{t.d3_building_name.toUpperCase()}</text>
      <g className="floor-band ground-floor" {...activate(onGroundClick)}>
        <rect x={D3.x + 2} y={ly} width={D3.w - 4} height={API_BOTTOM} fill="#ffd9a3" opacity={0.12} />
        <text x={cx} y={ly + 30} className="lbl" textAnchor="middle" fontSize={11}>{t.city_ground_floor}</text>
      </g>
      {canAddDesign3DFloor(shown.length) ? (
        <g className="floor-band" {...activate(onAdd)}>
          <rect x={D3.x + 6} y={top - 46} width={D3.w - 12} height={36} rx={4} fill="#5aa0ff" opacity={0.06} stroke="#5aa0ff" strokeDasharray="6 5" strokeOpacity={0.5} />
          <text x={cx} y={top - 24} className="sub" textAnchor="middle" fill="#9cc4ff" fontSize={11}>{t.d3_new_model}</text>
        </g>
      ) : null}
      {shown.map((f, i) => {
        const y = D3.base - API_BOTTOM - API_FLOOR_H * (i + 1);
        const color = D3_COLOR[f.badge];
        return (
          <g key={`${f.kind}:${f.id}`} className="floor-band" data-floor-kind={f.kind} {...activate(() => (f.kind === "session" ? onSessionClick?.(f.id) : onFloorClick?.(f.id)))}>
            {floorGlass(D3.x, y, D3.w, API_FLOOR_H, 59 + i * 7)}
            <rect x={D3.x} y={y + API_FLOOR_H - 1} width={D3.w} height={1.5} fill="#0b1020" />
            <circle className={f.running ? "beacon" : undefined} cx={D3.x + 14} cy={y + 18} r={4} fill={color} />
            <text x={D3.x + 26} y={y + 22} className="lbl" textAnchor="start" fontSize={11}>{clip(f.name, 20)}</text>
            <text x={D3.x + 26} y={y + 40} className="sub" textAnchor="start" fontSize={10} fill={color}>{clip([f.kind === "session" && f.wait ? t[f.wait] : labels[f.badge], f.sub].filter(Boolean).join(" · "), 24)}</text>
          </g>
        );
      })}
      <TowerLights x={D3.x} w={D3.w} top={top} base={D3.base} crown={D3.crown} bottom={API_BOTTOM} accent="#5aa0ff" />
    </g>
  );
}

/** 5th tower, between the 3D tower (x 10-180) and the main tower (x 440-740): one floor per Video Studio project. */
const VS = { x: 215, w: 180, base: 560, crown: 30 };
const VS_COLOR: Record<VsBadge, string> = { running: "#5aa0ff", done: "#4fd18b", failed: "#ff5c5c", idle: "#8b98b3" };

function VideoStudioTower({ floors, onFloorClick, onAdd, onGroundClick }: { floors: readonly VsDisplayFloor[]; onFloorClick?: ((slug: string) => void) | undefined; onAdd?: (() => void) | undefined; onGroundClick?: (() => void) | undefined }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const shown = floors.slice(0, 5);
  const top = VS.base - API_BOTTOM - API_FLOOR_H * shown.length - VS.crown;
  const ly = VS.base - API_BOTTOM;
  const cx = VS.x + VS.w / 2;
  const labels: Record<VsBadge, string> = { running: t["vs_status_running"] ?? "", done: t["vs_status_done"] ?? "", failed: t["vs_status_failed"] ?? "", idle: t["vs_status_idle"] ?? "" };
  return (
    <g className="videostudio-tower">
      <g filter="url(#shadow)">{glassBlock(VS.x, top, VS.w, VS.base - top, "url(#gGlassDim)", 24)}</g>
      <rect x={VS.x} y={top} width={VS.w} height={VS.crown} fill="#0b1020" />
      <text x={cx} y={top + 20} className="lbl" textAnchor="middle" fontSize={12} fontWeight={800} letterSpacing={2} fill="#f0b8ff">{(t["vs_building_name"] ?? "").toUpperCase()}</text>
      <g className="floor-band ground-floor" {...activate(onGroundClick)}>
        <rect x={VS.x + 2} y={ly} width={VS.w - 4} height={API_BOTTOM} fill="#ffd9a3" opacity={0.12} />
        <text x={cx} y={ly + 30} className="lbl" textAnchor="middle" fontSize={11}>{t["city_ground_floor"]}</text>
      </g>
      {canAddVideoStudio(shown.length) ? (
        <g className="floor-band" {...activate(onAdd)}>
          <rect x={VS.x + 6} y={top - 46} width={VS.w - 12} height={36} rx={4} fill="#c77dff" opacity={0.06} stroke="#c77dff" strokeDasharray="6 5" strokeOpacity={0.5} />
          <text x={cx} y={top - 24} className="sub" textAnchor="middle" fill="#f0b8ff" fontSize={11}>{t["vs_new_project"]}</text>
        </g>
      ) : null}
      {shown.map((f, i) => {
        const y = VS.base - API_BOTTOM - API_FLOOR_H * (i + 1);
        const color = VS_COLOR[f.badge];
        return (
          <g key={f.slug} className="floor-band" data-floor-kind="videostudio" {...activate(() => onFloorClick?.(f.slug))}>
            {floorGlass(VS.x, y, VS.w, API_FLOOR_H, 71 + i * 7)}
            <rect x={VS.x} y={y + API_FLOOR_H - 1} width={VS.w} height={1.5} fill="#0b1020" />
            <circle className={f.running ? "beacon" : undefined} cx={VS.x + 14} cy={y + 18} r={4} fill={color} />
            <text x={VS.x + 26} y={y + 22} className="lbl" textAnchor="start" fontSize={11}>{clip(f.name, 20)}</text>
            <text x={VS.x + 26} y={y + 40} className="sub" textAnchor="start" fontSize={10} fill={color}>{clip(t[`vs_state_${f.state}`] ?? labels[f.badge], 24)}</text>
          </g>
        );
      })}
      <TowerLights x={VS.x} w={VS.w} top={top} base={VS.base} crown={VS.crown} bottom={API_BOTTOM} accent="#c77dff" />
    </g>
  );
}

/** Pure viewBox choice. Narrow screens crop to the towers; the 3D tower (x 10-200) widens the frame to the left. */
export function cityViewBox(narrow: boolean, hasApi: boolean, hasD3: boolean): string {
  if (!narrow) return "0 0 1400 846";
  const w = hasApi ? 1120 : 900;
  return hasD3 ? `0 150 ${w + 200} 696` : `200 150 ${w} 696`;
}

export function CityScene(props: {
  design3dFloors?: readonly Design3DFloor[] | undefined;
  onDesign3DFloorClick?: ((runId: string) => void) | undefined;
  /** 3D workshop sessions (GET /api/workshop3d), shown above the old run floors. */
  design3dSessions?: readonly Workshop3DListItem[] | undefined;
  onDesign3DSessionClick?: ((slug: string) => void) | undefined;
  onAddDesign3DFloor?: (() => void) | undefined;
  onDesign3DGroundClick?: (() => void) | undefined;
  /** Video Studio projects (5th tower); undefined = the tower is not drawn. */
  videoStudioFloors?: readonly VsDisplayFloor[] | undefined;
  onVideoStudioFloorClick?: ((slug: string) => void) | undefined;
  onAddVideoStudio?: (() => void) | undefined;
  onVideoStudioGroundClick?: (() => void) | undefined;
  apiFloors?: CityApiFloor[] | undefined;
  maxApiFloors?: number | undefined;
  onApiFloorClick?: ((id: string) => void) | undefined;
  onAddApiFloor?: (() => void) | undefined;
  towers: [string, string];
  floors: CityFloor[];
  maxFloors?: number;
  onFloorClick?: ((floorId: string) => void) | undefined;
  onAddFloor?: (() => void) | undefined;
  skillFloors?: SkillFloor[] | undefined;
  onSkillFloorClick?: ((skillId: string) => void) | undefined;
  onAddSkillFloor?: (() => void) | undefined;
  onGroundFloorClick?: (() => void) | undefined;
  onReady?: ((nodes: CityNodes) => void) | undefined;
}) {
  const { t } = useT();
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && window.innerWidth < 760);
  const veh = useRef<SVGGElement>(null);
  const pedBack = useRef<SVGGElement>(null);
  const pedFront = useRef<SVGGElement>(null);
  const { onReady } = props;
  useEffect(() => {
    const onResize = () => setNarrow(window.innerWidth < 760);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  const light = useRef<SVGGElement>(null);
  useEffect(() => {
    onReady?.({ veh, pedBack, pedFront });
  }, [onReady]);
  useEffect(() => {
    if (!veh.current || !pedBack.current || !pedFront.current || !light.current) return;
    return startCitySim({ veh: veh.current, pedBack: pedBack.current, pedFront: pedFront.current, light: light.current }, CITY_GEOM);
  }, []);

  const { crossX: lobbyT, CURB } = CITY_GEOM;
  const lobbyB = T2.x + T2.w / 2;
  const Y0 = T1.base;
  const slots: number[] = [];
  for (let x = 60; x < 1360; x += 148) slots.push(x);
  const canAdd = props.floors.filter((f) => f.id !== "default").length < (props.maxFloors ?? 5);

  return (
    <main className="scene">
      <div className="hint">{t.city_hint}</div>
      <svg className="city" viewBox={cityViewBox(narrow, (props.apiFloors?.length ?? 0) > 0, props.design3dFloors !== undefined)} preserveAspectRatio="xMidYMax meet" aria-label={t.city_aria}>
        <defs>
          <linearGradient id="gGlass" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#1d3a6b" /><stop offset=".5" stopColor="#15294d" /><stop offset="1" stopColor="#0f1d3a" /></linearGradient>
          <linearGradient id="gGlassDim" x1="0" x2="1" y1="0" y2="1"><stop offset="0" stopColor="#1a2440" /><stop offset="1" stopColor="#0d1326" /></linearGradient>
          <linearGradient id="gSideT" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#0c1630" /><stop offset="1" stopColor="#060b1a" /></linearGradient>
          <linearGradient id="gGold" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#b8924a" /><stop offset=".5" stopColor="#f0d58f" /><stop offset="1" stopColor="#b8924a" /></linearGradient>
          <linearGradient id="gGround" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#121a30" /><stop offset="1" stopColor="#05080f" /></linearGradient>
          <linearGradient id="gSheen" x1="0" x2="1" y1="0" y2="0"><stop offset="0" stopColor="#fff" stopOpacity="0" /><stop offset=".5" stopColor="#fff" stopOpacity=".5" /><stop offset="1" stopColor="#fff" stopOpacity="0" /></linearGradient>
          <radialGradient id="gLampU"><stop offset="0" stopColor="#d9b26a" stopOpacity=".55" /><stop offset="1" stopColor="#d9b26a" stopOpacity="0" /></radialGradient>
          <linearGradient id="gCarShade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#fff" stopOpacity=".22" /><stop offset=".45" stopColor="#fff" stopOpacity="0" /><stop offset="1" stopColor="#000" stopOpacity=".28" /></linearGradient>
          <radialGradient id="gLeaf" cx=".35" cy=".3" r=".75"><stop offset="0" stopColor="#4fbf7f" /><stop offset=".55" stopColor="#2a7a52" /><stop offset="1" stopColor="#143826" /></radialGradient>
          <radialGradient id="gMoon"><stop offset="0" stopColor="#fff5d6" /><stop offset=".55" stopColor="#f3e3b5" /><stop offset="1" stopColor="#f3e3b5" stopOpacity="0" /></radialGradient>
          <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%"><feDropShadow dx="0" dy="18" stdDeviation="16" floodColor="#000" floodOpacity=".6" /></filter>
          <filter id="glowG" x="-50%" y="-50%" width="200%" height="200%"><feGaussianBlur stdDeviation="6" /></filter>
        </defs>
        <Sky />
        <rect x={-3000} y={560} width={7200} height={3000} fill="url(#gGround)" />
        <Plaza />
        {props.design3dFloors !== undefined ? <Design3DTower floors={props.design3dFloors} sessions={props.design3dSessions} onFloorClick={props.onDesign3DFloorClick} onSessionClick={props.onDesign3DSessionClick} onAdd={props.onAddDesign3DFloor} onGroundClick={props.onDesign3DGroundClick} /> : null}
        {props.videoStudioFloors !== undefined ? <VideoStudioTower floors={props.videoStudioFloors} onFloorClick={props.onVideoStudioFloorClick} onAdd={props.onAddVideoStudio} onGroundClick={props.onVideoStudioGroundClick} /> : null}
        <ApiTower floors={props.apiFloors ?? []} max={props.maxApiFloors ?? 5} onFloorClick={props.onApiFloorClick} onAdd={props.onAddApiFloor} />
        <Towers names={props.towers} floors={props.floors} onFloorClick={props.onFloorClick} onAddFloor={props.onAddFloor} skillFloors={props.skillFloors ?? []} onSkillFloorClick={props.onSkillFloorClick} onAddSkillFloor={props.onAddSkillFloor} onGroundFloorClick={props.onGroundFloorClick} canAdd={canAdd} />
        <g>
          <g ref={pedBack} />
          <Hedge x0={T1.x + 6} x1={lobbyT - 60} />
          <Hedge x0={lobbyT + 60} x1={T1.x + T1.w - 6} />
          {(() => {
            const gx = (lobbyT + lobbyB) / 2;
            return (
              <g>
                <rect x={gx - 54} y={Y0 + 60} width={108} height={26} rx={3} fill="#0b1020" stroke="#d9b26a" strokeWidth={1} />
                <text x={gx} y={Y0 + 77} className="sub" textAnchor="middle" fill="#d9b26a" fontSize={10} letterSpacing={3} fontWeight={700}>{t.city_district}</text>
                <rect x={gx - 60} y={Y0 + 86} width={120} height={6} fill="#121a2e" />
              </g>
            );
          })()}
          {slots.map((x, i) => (Math.abs(x - lobbyT) < 80 || Math.abs(x - lobbyB) < 70 ? null : <Tree key={x} x={x} y={CURB - 10} s={0.9} i={i} />))}
          {[lobbyT - 110, lobbyT + 110, lobbyB - 100, lobbyB + 100, T3.x + T3.w / 2 - 100, 120, 1300].map((x) => <Lamp key={x} x={x} />)}
          <Parked x={lobbyT - 230} color="#e9eef8" />
          <Parked x={lobbyT - 140} color="#1b1f2e" />
          <Parked x={lobbyB + 120} color="#8a1f2e" />
          <Parked x={lobbyB + 220} color="#cfd6e0" />
          <g ref={light} />
          <g ref={veh} />
          <g ref={pedFront} />
        </g>
      </svg>
    </main>
  );
}
