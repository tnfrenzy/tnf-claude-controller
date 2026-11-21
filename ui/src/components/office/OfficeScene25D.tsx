import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { roleLabel, useT } from "../../i18n";
import { deskChairs, deskFor, roomOf, routeFor, spotFor, ROLE_COLORS, type DeskGroup, type Desk,type OfficeLayout, type Point, type Rect } from "../../office/layout";
import { boxFaces, ISO_K, isoBounds, isoDepth, isoPoint, LOW_WALL_H, pointsAttr, shade, wallPieces, WALL_H, type DoorFrame, type WallPiece } from "../../office/iso4";
import { visibleAgents, type OfficeAgent } from "../../office/model";
import { isoLabelsFrom } from "../../office/iso/scene";
import { placeEmployees } from "../../office/api-staff";
import type { Employee } from "../../../../src/core/shared-types";
import { assignJobs, createStaff, ensureExtras, releaseExtras, seededRng, staffView, tickStaff, waitingSpots, type Resident, type StaffState, type StaffView } from "../../office/staff";
import { gapBlocks, gapRects, type GapBlock } from "../../office/gaps";
import { decorFor, type DecorBox, type Rug, type WallItem } from "../../office/decor";
import { AgentView, agentLabel, useLayout } from "./OfficeScene";
import { Cooler, Desk as IsoDesk, Plant as IsoPlant, Sofa as IsoSofa, CoffeeTable, beaconKind } from "./IsoFurniture";
import { IsoPerson } from "./IsoPerson";
import { staffDepth } from "../../office/iso/depth";

/** How long a finished agent stays visible while walking out. */
const LEAVE_LINGER_MS = 9000;
/** Resident staff are redrawn at this interval (ms). */
const STAFF_TICK_MS = 120;

const C = { shelf: "#a8855f" };

/** Staff sprites are drawn smaller (about the feet) so a seated or walking person never clips a wall. */
export const STAFF_SCALE = 0.63;

/**
 * Screen px a seated person is raised so the hips rest on the seat (staff are drawn at STAFF_SCALE, the chair seat top is
 * CHAIR_SEAT_Z plan units high). Sofa cushion and bed surface are higher; standing is 0.
 */
export const CHAIR_SEAT_Z = 16;
export const SEAT_LIFT_PX: Record<string, number> = { sit: 6, sofa: 11, lie: 14, stand: 0 };

/** Plan units to the tile units of the isometric furniture set (IsoFurniture, 44 px per tile). */
const TILE = ISO_K / 44;
/** IsoFurniture projects with a fixed origin; shift it back so it lines up with isoPoint. */
const ISO_ORIGIN_FIX = "translate(-450 -118)";
const tile = (r: Rect) => ({ u: r.x * TILE, v: r.y * TILE, w: r.w * TILE, d: r.h * TILE });

interface Drawable {
  key: string;
  depth: number;
  node: ReactElement;
}

function Box({ x, y, w, h, z0 = 0, z1, fill }: { x: number; y: number; w: number; h: number; z0?: number; z1: number; fill: string }) {
  const f = boxFaces(x, y, w, h, z0, z1);
  const line = "rgba(0,0,0,.28)";
  return (
    <g className="iso4-box">
      <polygon points={pointsAttr(f.south)} fill={shade(fill, 0.8)} stroke={line} strokeWidth={0.6} />
      <polygon points={pointsAttr(f.east)} fill={shade(fill, 0.62)} stroke={line} strokeWidth={0.6} />
      <polygon points={pointsAttr(f.top)} fill={fill} stroke={line} strokeWidth={0.6} />
    </g>
  );
}

/** Work chair in plan units: post and seat; the backrest is a separate drawable so it sorts against the seated person. */
function ChairSeat({ x, y }: { x: number; y: number }) {
  return (
    <g data-chair="base">
      <ellipse cx={isoPoint(x, y).x} cy={isoPoint(x, y).y + 1} rx={11} ry={5} fill="#1a1f2e" opacity={0.6} />
      <Box x={x - 3} y={y - 3} w={6} h={6} z1={CHAIR_SEAT_Z - 4} fill="#5b6480" />
      <Box x={x - 14} y={y - 13} w={28} h={26} z0={CHAIR_SEAT_Z - 4} z1={CHAIR_SEAT_Z} fill="#2d3a5e" />
    </g>
  );
}

/** Backrest on the side opposite the desk: low enough to cover only the lower back of a person sitting in front of it. */
function ChairRest({ x, y, side }: { x: number; y: number; side: "n" | "s" }) {
  const by = side === "s" ? y + 12 : y - 16;
  return <Box x={x - 14} y={by} w={28} h={4} z0={CHAIR_SEAT_Z} z1={CHAIR_SEAT_Z + 14} fill="#34436d" />;
}

/** Rest bed: wooden frame, mattress, pillow at the east (head) end and a folded blanket. */
function BedNode({ b }: { b: Rect }) {
  return (
    <g className="iso4-bed" data-bed="1">
      <Box x={b.x} y={b.y} w={b.w} h={b.h} z1={8} fill="#8a6a4a" />
      <Box x={b.x + 3} y={b.y + 3} w={b.w - 6} h={b.h - 6} z0={8} z1={14} fill="#dfe6f2" />
      <Box x={b.x + b.w - 28} y={b.y + 8} w={22} h={b.h - 16} z0={14} z1={18} fill="#ffffff" />
      <Box x={b.x + 5} y={b.y + 5} w={b.w * 0.45} h={b.h - 10} z0={14} z1={16} fill="#6f8fc4" />
    </g>
  );
}

/** Solid wall mass in the strip between two rooms (low, flush with the cutaway walls of the rooms). */
function GapBlockNode({ g }: { g: GapBlock }) {
  const f = boxFaces(g.x, g.y, g.w, g.h, 0, LOW_WALL_H);
  return (
    <g className="iso4-gapblock" data-gapblock="1">
      <polygon points={pointsAttr(f.south)} className="iso4-gapblock-side" />
      <polygon points={pointsAttr(f.east)} className="iso4-gapblock-side dark" />
      <polygon points={pointsAttr(f.top)} className="iso4-gapblock-top" />
    </g>
  );
}

function Floor({ rect, className }: { rect: Rect; className: string }) {
  const pts = [isoPoint(rect.x, rect.y), isoPoint(rect.x + rect.w, rect.y), isoPoint(rect.x + rect.w, rect.y + rect.h), isoPoint(rect.x, rect.y + rect.h)];
  return <polygon points={pointsAttr(pts)} className={className} />;
}

function WallNode({ w, color }: { w: WallPiece; color: string }) {
  const pts = [isoPoint(w.a.x, w.a.y), isoPoint(w.b.x, w.b.y), isoPoint(w.b.x, w.b.y, w.h), isoPoint(w.a.x, w.a.y, w.h)];
  const tall = w.h >= WALL_H;
  const top0 = isoPoint(w.a.x, w.a.y, w.h);
  const top1 = isoPoint(w.b.x, w.b.y, w.h);
  return (
    <g data-wall={`${w.roomId}-${w.side}`}>
      <polygon points={pointsAttr(pts)} className={`iso4-wall ${w.side}${tall ? "" : " low"}`} />
      {tall && <line x1={top0.x} y1={top0.y} x2={top1.x} y2={top1.y} stroke={color} strokeWidth={3} strokeLinecap="round" />}
    </g>
  );
}

/** Door frame: two posts and a lintel over a doorway cut into a tall wall. */
function DoorNode({ f }: { f: DoorFrame }) {
  const H = WALL_H;
  const post = (p: Point) => (
    <line x1={isoPoint(p.x, p.y).x} y1={isoPoint(p.x, p.y).y} x2={isoPoint(p.x, p.y, H).x} y2={isoPoint(p.x, p.y, H).y} className="iso4-door-post" />
  );
  const a = isoPoint(f.a.x, f.a.y, H);
  const b = isoPoint(f.b.x, f.b.y, H);
  return (
    <g data-door={`${f.roomId}-${f.side}`}>
      {post(f.a)}
      {post(f.b)}
      <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="iso4-door-lintel" />
    </g>
  );
}

const BOOK_COLORS = ["#c0504d", "#4f81bd", "#9bbb59", "#f79646", "#8064a2", "#4bacc6", "#e6b84a"];

/** Bookcase: a wooden box with rows of coloured book spines on its south face. */
function Bookcase({ s }: { s: Rect }) {
  const H = 46;
  const vertical = s.h > s.w;
  const along = vertical ? s.h : s.w;
  const n = Math.max(3, Math.floor(along / 9));
  const rows = [8, 22, 36];
  const face = boxFaces(s.x, s.y, s.w, s.h, 0, H);
  const books: ReactElement[] = [];
  if (!vertical) {
    rows.forEach((z, ri) => {
      for (let i = 0; i < n; i++) {
        const x0 = s.x + 3 + (i * (s.w - 6)) / n;
        const x1 = x0 + (s.w - 6) / n - 1.2;
        const y = s.y + s.h;
        const pts = [isoPoint(x0, y, z), isoPoint(x1, y, z), isoPoint(x1, y, z + 10 - (i % 3)), isoPoint(x0, y, z + 10 - (i % 3))];
        books.push(<polygon key={`${ri}-${i}`} points={pointsAttr(pts)} fill={BOOK_COLORS[(i + ri * 2) % BOOK_COLORS.length]} />);
      }
    });
  }
  return (
    <g className="iso4-bookcase">
      <Box x={s.x} y={s.y} w={s.w} h={s.h} z1={H} fill={C.shelf} />
      {books}
      <polygon points={pointsAttr(face.top)} fill="none" stroke="rgba(0,0,0,.25)" strokeWidth={0.6} />
    </g>
  );
}

/** Floor-standing decoration by kind (cabinet drawers, server LEDs, ...). */
function DecorBoxNode({ b }: { b: DecorBox }) {
  const front = (z0: number, z1: number, x0 = b.x + 3, x1 = b.x + b.w - 3) => [isoPoint(x0, b.y + b.h, z0), isoPoint(x1, b.y + b.h, z0), isoPoint(x1, b.y + b.h, z1), isoPoint(x0, b.y + b.h, z1)];
  const detail: ReactElement[] = [];
  if (b.kind === "cabinet") {
    [0.28, 0.62].forEach((f, i) => detail.push(<polygon key={i} points={pointsAttr(front(b.z * f, b.z * f + 2))} fill="rgba(0,0,0,.35)" />));
    [0.15, 0.5, 0.82].forEach((f, i) => {
      const c = isoPoint(b.x + b.w / 2, b.y + b.h, b.z * f);
      detail.push(<circle key={`k${i}`} cx={c.x} cy={c.y} r={0.9} fill="#e8d28a" />);
    });
  } else if (b.kind === "rack") {
    for (let i = 0; i < 5; i++) {
      const p = isoPoint(b.x + 8, b.y + b.h, 10 + i * 11);
      detail.push(<rect key={`l${i}`} className="iso4-led" x={p.x} y={p.y - 1} width={3} height={1.6} fill={i % 2 ? "#4fd08a" : "#5aa0ff"} style={{ animationDelay: `${i * 0.37}s` }} />);
      const q = isoPoint(b.x + 18, b.y + b.h, 10 + i * 11);
      detail.push(<polygon key={`d${i}`} points={pointsAttr([q, isoPoint(b.x + b.w - 5, b.y + b.h, 10 + i * 11), isoPoint(b.x + b.w - 5, b.y + b.h, 14 + i * 11), isoPoint(b.x + 18, b.y + b.h, 14 + i * 11)])} fill="rgba(255,255,255,.12)" />);
    }
  } else if (b.kind === "fridge") {
    detail.push(<polygon key="f" points={pointsAttr(front(b.z * 0.62, b.z * 0.64))} fill="rgba(0,0,0,.35)" />);
    const h = isoPoint(b.x + b.w - 7, b.y + b.h, b.z * 0.5);
    detail.push(<rect key="h" x={h.x} y={h.y - 4} width={1.6} height={8} fill="#7d8798" />);
  } else if (b.kind === "counter") {
    const m = isoPoint(b.x + 14, b.y + b.h / 2, b.z + 8);
    detail.push(<rect key="m" x={m.x - 4} y={m.y - 6} width={8} height={9} rx={1.5} fill="#2a3147" />);
    const c = isoPoint(b.x + b.w - 14, b.y + b.h / 2, b.z + 4);
    detail.push(<ellipse key="c" cx={c.x} cy={c.y} rx={3.5} ry={1.8} fill="#f1f4fa" />);
  } else if (b.kind === "bench") {
    [0.2, 0.62].forEach((f, i) => {
      const p = isoPoint(b.x + b.w * f + 4, b.y + b.h / 2, b.z + 5);
      detail.push(<rect key={i} x={p.x - 4} y={p.y - 7} width={8} height={9} rx={1} fill="#1d2335" stroke="#5aa0ff" strokeWidth={0.6} />);
    });
  } else if (b.kind === "reception") {
    const p = isoPoint(b.x + b.w / 2, b.y + b.h / 2, b.z + 5);
    detail.push(<rect key="s" x={p.x - 6} y={p.y - 8} width={12} height={9} rx={1.5} fill="#2a3147" stroke="#9cc4ff" strokeWidth={0.6} />);
  }
  return (
    <g className={`iso4-decor ${b.kind}`} data-decor={b.id}>
      <Box x={b.x} y={b.y} w={b.w} h={b.h} z1={b.z} fill={b.color} />
      {detail}
    </g>
  );
}

/** Whiteboard, wall screen, clock or poster hung on a room's north wall. */
function WallItemNode({ w, y }: { w: WallItem; y: number }) {
  const q = (x0: number, x1: number, z0: number, z1: number) => [isoPoint(x0, y, z0), isoPoint(x1, y, z0), isoPoint(x1, y, z1), isoPoint(x0, y, z1)];
  if (w.kind === "clock") {
    const c = isoPoint((w.from + w.to) / 2, y, 44);
    return (
      <g data-wall-item={w.id}>
        <circle cx={c.x} cy={c.y} r={5.5} fill="#f1f4fa" stroke="#7d8798" strokeWidth={1} />
        <line x1={c.x} y1={c.y} x2={c.x} y2={c.y - 3.6} stroke="#222" strokeWidth={0.9} />
        <line x1={c.x} y1={c.y} x2={c.x + 2.6} y2={c.y + 0.6} stroke="#222" strokeWidth={0.9} />
      </g>
    );
  }
  const fillOf = w.kind === "whiteboard" ? "#f4f6fa" : w.kind === "screen" ? "#101828" : "#c9825b";
  const lines: ReactElement[] = [];
  const n = w.kind === "poster" ? 2 : 4;
  for (let i = 0; i < n; i++) {
    const z = 40 - i * 5;
    const x1 = w.from + 6 + (w.to - w.from - 12) * (0.5 + 0.5 * (((i * 7) % 5) / 5));
    lines.push(<polygon key={i} points={pointsAttr(q(w.from + 6, x1, z, z + 1.8))} fill={w.kind === "screen" ? (i % 2 ? "#4fd08a" : "#5aa0ff") : w.kind === "poster" ? "#fff3" : "#4f81bd"} opacity={0.85} />);
  }
  return (
    <g data-wall-item={w.id} className={`iso4-wallitem ${w.kind}`}>
      <polygon points={pointsAttr(q(w.from, w.to, 18, 50))} fill={fillOf} stroke="#6b7488" strokeWidth={1.2} />
      {lines}
    </g>
  );
}

/** Window on a tall wall piece: a light glass panel in its middle. */
function WindowNode({ w }: { w: WallPiece }) {
  const t0 = 0.22, t1 = 0.78;
  const lerp = (t: number) => ({ x: w.a.x + (w.b.x - w.a.x) * t, y: w.a.y + (w.b.y - w.a.y) * t });
  const a = lerp(t0), b = lerp(t1);
  const pts = [isoPoint(a.x, a.y, 24), isoPoint(b.x, b.y, 24), isoPoint(b.x, b.y, 54), isoPoint(a.x, a.y, 54)];
  const mid = [isoPoint((a.x + b.x) / 2, (a.y + b.y) / 2, 24), isoPoint((a.x + b.x) / 2, (a.y + b.y) / 2, 54)];
  return (
    <g data-window="1">
      <polygon points={pointsAttr(pts)} className="iso4-window" />
      <line x1={mid[0]!.x} y1={mid[0]!.y} x2={mid[1]!.x} y2={mid[1]!.y} className="iso4-window-bar" />
    </g>
  );
}

/** Light tile lines on a room floor. */
function TileLines({ r }: { r: Rect }) {
  const step = 80;
  const out: ReactElement[] = [];
  for (let x = r.x + step; x < r.x + r.w - 1; x += step) {
    const a = isoPoint(x, r.y), b = isoPoint(x, r.y + r.h);
    out.push(<line key={`x${x}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="iso4-tile" />);
  }
  for (let y = r.y + step; y < r.y + r.h - 1; y += step) {
    const a = isoPoint(r.x, y), b = isoPoint(r.x + r.w, y);
    out.push(<line key={`y${y}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} className="iso4-tile" />);
  }
  return <g className="iso4-tiles">{out}</g>;
}

/** Agent depth: where it ends up (its seat or standby spot), so it sorts with the furniture around it. */
function agentDepth(a: OfficeAgent, layout: OfficeLayout): number {
  const route = routeFor(a.group, a.seat, layout);
  const end = route[route.length - 1];
  const desk = deskFor(a.group, a.seat, layout);
  if (desk) return isoDepth(desk.x + desk.w / 2, desk.y + desk.h + 10);
  return end ? isoDepth(end.x, end.y) : 0;
}

/**
 * Staff: every role is one person. Free people go about their leisure; when a run agent of their group works, the
 * person sits at their desk and works as the agent does. Agents beyond the people of a group are not claimed (the
 * scene draws them walking in from the door). Simulated with injected time and rng, redrawn on a timer.
 */
/** Bring in extra people for agents without a person, send finished ones home, and claim the agents they took. */
function syncExtras(list: StaffState[], claimed: Set<string>, agents: OfficeAgent[], layout: OfficeLayout, now: number, labels: ReturnType<typeof isoLabelsFrom>, roleName: (r: string) => string): void {
  ensureExtras(list, agents, layout, now, labels, roleName);
  releaseExtras(list, layout, now);
  for (const s of list) if (s.extra && s.job) claimed.add(s.job);
}

function useStaff(layout: OfficeLayout, labels: ReturnType<typeof isoLabelsFrom>, agents: OfficeAgent[], enabled: boolean, residentList?: readonly Resident[]): { views: StaffView[]; claimed: Set<string> } {
  const { lang } = useT();
  const stateRef = useRef<{ key: string; list: StaffState[]; rng: () => number; claimed: Set<string> } | null>(null);
  const agentsRef = useRef(agents);
  agentsRef.current = agents;
  const [, setFrame] = useState(0);
  const key = `${layout.scene.w}x${layout.scene.h}|${residentList ? residentList.map((r) => `${r.id}:${r.group}${r.seat}`).join(",") : ""}`;
  if (!stateRef.current || stateRef.current.key !== key) {
    const rng = seededRng(20261102);
    stateRef.current = { key, list: createStaff(layout, Date.now(), rng, residentList), rng, claimed: new Set() };
  }
  const cur = stateRef.current;
  useEffect(() => {
    if (!enabled) return;
    const id = setInterval(() => {
      const s = stateRef.current;
      if (!s) return;
      const now = Date.now();
      assignJobs(s.list, agentsRef.current, s.claimed, now, labels, (r) => roleLabel(r, lang));
      syncExtras(s.list, s.claimed, agentsRef.current, layout, now, labels, (r) => roleLabel(r, lang));
      tickStaff(s.list, layout, now, s.rng, labels);
      setFrame((n) => n + 1);
    }, STAFF_TICK_MS);
    return () => clearInterval(id);
  }, [layout, labels, enabled, lang]);
  if (!enabled) return { views: [], claimed: cur.claimed };
  const now = Date.now();
  // Claim in render too, so an agent never shows up as a walking-in stranger for one frame before its person takes it.
  assignJobs(cur.list, agents, cur.claimed, now, labels, (r) => roleLabel(r, lang));
  syncExtras(cur.list, cur.claimed, agents, layout, now, labels, (r) => roleLabel(r, lang));
  const views = cur.list.map((st) => {
    const job = st.job ? agents.find((a) => a.id === st.job) ?? null : null;
    return staffView(st, now, job, labels, roleLabel(st.resident.role, lang));
  });
  return { views, claimed: cur.claimed };
}

/**
 * Isometric (2.5D) rendering of the four-room plan: a coordination room on top, a lobby down the middle to the front
 * door and four work rooms with a doorway each. Geometry, seats, gates, aisles and routes come from office/layout.ts;
 * furniture and people use the isometric set (IsoFurniture, IsoPerson). Resident staff live here all the time
 * (desk work, drink, rest, chat, phone, stretch); run agents walk in from the front door to their seats.
 */
/**
 * `employees` switches the building to API-floor mode: one resident per employee at their own desk, working ones sit and
 * type, run agents are ignored (see office/api-staff.ts).
 */
export function OfficeScene25D({ agents: allRun, running, residents = true, layout, employees }: { agents: OfficeAgent[]; running: boolean; residents?: boolean; layout?: OfficeLayout; employees?: readonly Employee[] }) {
  const { t } = useT();
  const dict = t as unknown as Record<string, string>;
  const defaultLayout = useLayout();
  const L = layout ?? defaultLayout;
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, []);
  const labels = useMemo(() => isoLabelsFrom(dict), [dict]);
  const placement = useMemo(() => (employees ? placeEmployees(employees, L) : null), [employees, L]);
  const all = placement ? placement.agents : allRun;
  const bounds = useMemo(() => isoBounds(L.scene), [L]);
  const walls = useMemo(() => wallPieces(L), [L]);
  const blocks = useMemo(() => gapBlocks(L), [L]);
  const shown = visibleAgents({ runId: null, status: running ? "running" : "idle", agents: all, lastEventTs: 0 }, now, LEAVE_LINGER_MS);
  const { views: staff, claimed } = useStaff(L, labels, shown, residents, placement?.residents);
  // Agents without a person of their group free walk in from the front door.
  const agents = shown.filter((a) => !claimed.has(a.id));
  const seatCount = (g: Desk["group"]) => L.desks.filter((d) => d.group === g).length;
  const project = (p: Point): Point => isoPoint(p.x, p.y);
  const accentOf = (roomId: string) => {
    const room = L.rooms.find((r) => r.id === roomId);
    return room && room.groups[0] ? ROLE_COLORS[room.groups[0]] : "#7a8499";
  };

  const drawables: Drawable[] = [];
  const decor = decorFor(L);
  walls.pieces.forEach((w, i) => {
    drawables.push({ key: `wall-${i}`, depth: w.depth, node: <WallNode w={w} color={accentOf(w.roomId)} /> });
    // Windows on full-height wall pieces that carry nothing else.
    const lo = Math.min(w.a.x, w.b.x), hi = Math.max(w.a.x, w.b.x);
    const hung = w.side === "north" && decor.walls.some((d) => d.room === w.roomId && d.from < hi && d.to > lo);
    if (w.h >= WALL_H && !hung && Math.hypot(w.b.x - w.a.x, w.b.y - w.a.y) > 45) drawables.push({ key: `win-${i}`, depth: w.depth + 0.1, node: <WindowNode w={w} /> });
  });
  blocks.forEach((g, i) => {
    drawables.push({ key: `gb-${i}`, depth: isoDepth(g.x + g.w / 2, g.y + g.h / 2), node: <GapBlockNode g={g} /> });
    // Full-height wall continues across the strip where it lines up with a room's north / west wall.
    for (const side of g.tall) {
      const a = side === "north" ? { x: g.x, y: g.y } : { x: g.x, y: g.y };
      const b = side === "north" ? { x: g.x + g.w, y: g.y } : { x: g.x, y: g.y + g.h };
      const piece: WallPiece = { roomId: "gap", side, a, b, h: WALL_H, depth: isoDepth((a.x + b.x) / 2, (a.y + b.y) / 2) };
      drawables.push({ key: `gbw-${i}-${side}`, depth: piece.depth, node: <WallNode w={piece} color="#7a8499" /> });
    }
  });
  decor.walls.forEach((d) => {
    const room = L.rooms.find((r) => r.id === d.room);
    if (room) drawables.push({ key: `wi-${d.id}`, depth: isoDepth((d.from + d.to) / 2, room.y) + 0.15, node: <WallItemNode w={d} y={room.y} /> });
  });
  decor.boxes.forEach((b) => drawables.push({ key: `dec-${b.id}`, depth: isoDepth(b.x + b.w / 2, b.y + b.h / 2), node: <DecorBoxNode b={b} /> }));
  walls.frames.forEach((f, i) => drawables.push({ key: `door-${i}`, depth: isoDepth((f.a.x + f.b.x) / 2, (f.a.y + f.b.y) / 2) + 0.2, node: <DoorNode f={f} /> }));
  for (const c of deskChairs(L)) {
    const side = deskFor(c.group, c.seat, L)?.side ?? "s";
    drawables.push({ key: `chair-${c.group}-${c.seat}`, depth: isoDepth(c.x, c.y) - 0.01, node: <g data-chair={`${c.group}-${c.seat}`}><ChairSeat x={c.x} y={c.y} /></g> });
    // The backrest is on the camera side when the person sits south of the desk: it draws after the person and covers only the lower back.
    drawables.push({ key: `chairrest-${c.group}-${c.seat}`, depth: isoDepth(c.x, c.y) + (side === "s" ? 0.8 : -0.3), node: <g data-chair-back={`${c.group}-${c.seat}`}><ChairRest x={c.x} y={c.y} side={side} /></g> });
  }
  L.desks.forEach((d, i) => {
    const live = agents.find((a) => a.group === d.group && a.seat === d.seat && a.phase === "working") ?? staff.find((s) => s.working && s.deskGroup === d.group && s.deskSeat === d.seat);
    drawables.push({
      key: `desk-${d.group}-${d.seat}`,
      depth: isoDepth(d.x + d.w / 2, d.y + d.h / 2),
      node: (
        <g className={`iso4-desk${live ? " active" : ""}`} data-desk-group={d.group} transform={ISO_ORIGIN_FIX}>
          <IsoDesk r={tile(d)} on={!!live} kind={beaconKind(live ? "working" : "idle")} idx={i} />
        </g>
      ),
    });
  });
  for (const r of L.rooms) {
    const f = L.furniture[r.id];
    f.shelves.forEach((s, i) => drawables.push({ key: `sh-${r.id}-${i}`, depth: isoDepth(s.x + s.w / 2, s.y + s.h / 2), node: <Bookcase s={s} /> }));
    f.sofas.forEach((s, i) => drawables.push({ key: `so-${r.id}-${i}`, depth: isoDepth(s.x + s.w / 2, s.y + s.h / 2), node: <g transform={ISO_ORIGIN_FIX}><IsoSofa r={tile(s)} /></g> }));
    f.tables.forEach((s, i) => drawables.push({ key: `ta-${r.id}-${i}`, depth: isoDepth(s.x + s.w / 2, s.y + s.h / 2), node: <g transform={ISO_ORIGIN_FIX}><CoffeeTable r={tile(s)} /></g> }));
    (f.beds ?? []).forEach((s, i) => drawables.push({ key: `bed-${r.id}-${i}`, depth: isoDepth(s.x + s.w / 2, s.y + s.h / 2), node: <BedNode b={s} /> }));
    f.coolers.forEach((s, i) => drawables.push({ key: `co-${r.id}-${i}`, depth: isoDepth(s.x + s.w / 2, s.y + s.h / 2), node: <g transform={ISO_ORIGIN_FIX}><Cooler r={{ u: s.x * TILE, v: s.y * TILE, w: 0.5, d: 0.5 }} /></g> }));
    f.chairs.forEach((c, i) => drawables.push({ key: `ch-${r.id}-${i}`, depth: isoDepth(c.x, c.y), node: <Box x={c.x - 10} y={c.y - 10} w={20} h={20} z1={13} fill="#7886a6" /> }));
    f.plants.forEach((p, i) => drawables.push({ key: `pl-${r.id}-${i}`, depth: isoDepth(p.x, p.y), node: <PlantNode x={p.x} y={p.y} /> }));
  }
  L.plants.forEach((p, i) => drawables.push({ key: `plant-${i}`, depth: isoDepth(p.x, p.y), node: <PlantNode x={p.x} y={p.y} /> }));
  const restPlaces = Object.values(L.furniture).flatMap((f) => [...f.sofas, ...(f.beds ?? [])]);
  for (const s of staff) {
    const p = project(s.pos);
    // Sit on the seat, sofa cushion or bed surface instead of sinking into it (eases in while sitting down / standing up).
    const lift = (SEAT_LIFT_PX[s.pose] ?? 0) * (s.pose === "stand" ? 0 : Math.max(s.sitT, 0.5));
    drawables.push({
      key: `staff-${s.id}`,
      // A seated person draws just after their chair; a walking one by position.
      depth: staffDepth(s.pose, s.pos, restPlaces),
      node: (
        <g className="iso4-staff" data-staff={s.id} transform={`translate(${p.x.toFixed(1)} ${(p.y - lift).toFixed(1)})`}>
          <g className="iso4-staff-body" transform={`scale(${STAFF_SCALE})`}>
            <IsoPerson role={s.role} isCoord={s.isCoord} pose={s.pose} act={s.act} face={s.face} back={s.back} {...(s.bubble ? { bubble: s.bubble } : {})} />
          </g>
        </g>
      ),
    });
  }
  // Extra agents (their group's people are all busy) wait at free spots, never on a seated person.
  const standing = new Map<string, Point>();
  if (residents) {
    const byGroup = new Map<DeskGroup, OfficeAgent[]>();
    for (const a of agents) byGroup.set(a.group, [...(byGroup.get(a.group) ?? []), a]);
    const seats = L.desks.map((d) => spotFor(d.group, d.seat, L));
    byGroup.forEach((list, group) => {
      const occupied = [...staff.map((s) => s.pos), ...seats];
      const spots = waitingSpots(group, list.length, L, occupied);
      list.forEach((a, i) => { const p = spots[i]; if (p) standing.set(a.id, p); });
    });
  }
  for (const a of agents) {
    const stand = standing.get(a.id);
    drawables.push({
      key: `agent-${a.id}`,
      depth: (stand ? isoDepth(stand.x, stand.y) : agentDepth(a, L)) + 0.5,
      node: <AgentView a={a} now={now} layout={L} label={agentLabel(dict, a.group, a.role, a.seat, seatCount(a.group) > 1)} project={project} frame={{ x: bounds.x, w: bounds.w }} {...(stand ? { standAt: stand } : {})} />,
    });
  }
  drawables.sort((p, q) => p.depth - q.depth);

  void roomOf;

  return (
    <svg className="office-scene iso4 iso-office" viewBox={`${bounds.x.toFixed(1)} ${bounds.y.toFixed(1)} ${bounds.w.toFixed(1)} ${bounds.h.toFixed(1)}`} role="img" aria-label={t.nav_office} data-iso4="1">
      <Floor rect={{ x: 0, y: 0, w: L.scene.w, h: L.scene.h }} className="iso4-ground" />
      {gapRects(L).map((g) => (
        <Floor key={`gap-${g.x}-${g.y}`} rect={g} className="iso4-gap" />
      ))}
      {L.rooms.map((r) => (
        <g key={r.id} className={`iso4-room ${r.id}`} data-room={r.id} aria-label={dict[r.labelKey]}>
          <Floor rect={r} className="iso4-floor" />
        </g>
      ))}
      {L.rooms.map((r) => <TileLines key={`tl-${r.id}`} r={r} />)}
      {decor.rugs.map((g: Rug) => (
        <g key={g.id} data-rug={g.id}>
          <Floor rect={g} className="iso4-rug" />
          <polygon points={pointsAttr([isoPoint(g.x + 5, g.y + 5), isoPoint(g.x + g.w - 5, g.y + 5), isoPoint(g.x + g.w - 5, g.y + g.h - 5), isoPoint(g.x + 5, g.y + g.h - 5)])} fill="none" stroke={g.color} strokeWidth={1.4} opacity={0.9} />
        </g>
      ))}
      {L.links.map((k) => (
        <g key={`${k.a}-${k.b}`} data-link={`${k.a}-${k.b}`}>
          <Floor rect={{ x: k.x, y: k.y, w: k.w, h: k.h }} className="iso4-link" />
        </g>
      ))}
      <g data-entrance="1">
        <Floor rect={L.entrance} className="iso4-link entrance" />
      </g>
      {drawables.map((d) => <g key={d.key}>{d.node}</g>)}
    </svg>
  );
}

function PlantNode({ x, y }: Point) {
  return (
    <g className="iso4-plant" transform={ISO_ORIGIN_FIX}>
      <IsoPlant r={{ u: (x - 14) * TILE, v: (y - 14) * TILE, w: 0.6, d: 0.6 }} />
    </g>
  );
}
