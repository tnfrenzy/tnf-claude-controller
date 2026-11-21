import { useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { buildSteps, deskChairs, deskFor, ROLE_COLORS, roomOf, routeFor, toolIcon, WIDE, type Desk, type DeskGroup, type OfficeLayout, type Point } from "../../office/layout";
import { bubbleFor, visibleAgents, type OfficeAgent } from "../../office/model";
import { OfficeCharacter } from "./OfficeCharacter";
import { IsoPerson } from "./IsoPerson";

/** Vietnamese/English display name for a desk/agent: "Tìm kiếm 2", "Điều phối"… */
export function agentLabel(t: Record<string, string>, group: DeskGroup, role: string, seat: number, multi: boolean): string {
  const base = t[`role_${role.toLowerCase()}`] ?? (group === "subagent" ? role : (t[`role_${group}`] ?? role));
  return multi ? `${base} ${seat + 1}` : base;
}

/** Character origin sits this far below the spot (feet), so head/bubble/labels keep their old offsets. */
const FOOT = 14;
/** How long a finished agent stays visible while walking out. */
const LEAVE_LINGER_MS = 9000;

/**
 * The building plan of the office. The same plan is used on every screen: in the isometric view the stacked phone
 * plan becomes a thin diagonal strip that wastes the frame, while the full plan fills it; phones zoom and pan instead.
 */
export function useLayout(): OfficeLayout {
  return WIDE;
}

/** `project` maps plan points to screen points (2.5D view); `frame` is the visible x-range used to keep bubbles inside the scene. */
export function AgentView({ a, now, layout, label, project, frame, standAt }: { a: OfficeAgent; now: number; layout: OfficeLayout; label: string; project?: (p: Point) => Point; frame?: { x: number; w: number }; standAt?: Point }) {
  const standX = standAt?.x;
  const standY = standAt?.y;
  const route = useMemo(() => {
    const base = routeFor(a.group, a.seat, layout);
    if (standX === undefined || standY === undefined) return base;
    // Extra agent: walk in to the room's gate, then to a free standing spot instead of an occupied seat.
    const gate = layout.gates[roomOf(a.group, layout).id];
    const gi = base.findIndex((p) => p.x === gate.x && p.y === gate.y);
    const head = gi >= 0 ? base.slice(0, gi + 1) : base.slice(0, Math.max(1, base.length - 1));
    return [...head, { x: standX, y: standY }];
  }, [a.group, a.seat, layout, standX, standY]);
  const seatedHere = !standAt;
  // Index of the route point most recently commanded (0 = door). Mount at the door, walk in, sit; walk back out when done.
  const idxRef = useRef(0);
  const startedRef = useRef(false);
  const [move, setMove] = useState<{ p: Point; ms: number }>({ p: layout.door, ms: 0 });
  const [walking, setWalking] = useState(true);
  const phase = a.phase;
  useEffect(() => {
    const timers: ReturnType<typeof setTimeout>[] = [];
    const last = route.length - 1;
    if (phase === "working") {
      if (startedRef.current) {
        // Seat/layout changed after the first walk: place at the new spot at once (no walk from the door again).
        idxRef.current = last;
        setMove({ p: route[last]!, ms: 0 });
        setWalking(false);
        return;
      }
      startedRef.current = true;
      setWalking(true);
      const from = idxRef.current;
      const steps = buildSteps(route, from, "in");
      steps.forEach((s, j) => {
        timers.push(setTimeout(() => { idxRef.current = from + j + 1; setMove({ p: s.p, ms: s.ms }); }, s.at));
      });
      const total = steps.reduce((n, s) => n + s.ms, 0);
      timers.push(setTimeout(() => setWalking(false), total));
    } else {
      startedRef.current = true;
      const from = Math.min(idxRef.current, last);
      const steps = buildSteps(route, from, "out");
      if (steps.length === 0) { setWalking(false); return; }
      setWalking(true);
      steps.forEach((s, j) => {
        timers.push(setTimeout(() => { idxRef.current = from - j - 1; setMove({ p: s.p, ms: s.ms }); }, s.at));
      });
      const total = steps.reduce((n, s) => n + s.ms, 0);
      timers.push(setTimeout(() => setWalking(false), total));
    }
    return () => timers.forEach(clearTimeout);
  }, [phase, route, layout]);
  const pos = project ? project(move.p) : move.p;
  const bubble = a.phase === "working" ? bubbleFor(a, now) : a.bubble;
  const busy = a.phase === "working" && a.activity !== "idle";
  const icon = bubble?.kind === "tool" ? toolIcon(a.lastTool) : bubble?.kind === "done" ? "✓" : bubble?.kind === "error" ? "⚠" : bubble?.kind === "text" ? "💬" : "ℹ";
  // Keep the speech bubble inside the scene on the narrow plan (agents sit near both edges).
  const bw = 220;
  const fx = frame ? frame.x : 0;
  const fw = frame ? frame.w : layout.scene.w;
  const bx = Math.max(fx - pos.x + 4, Math.min(-bw / 2, fx + fw - pos.x - bw - 4));

  return (
    <g className={`agent-fig ${a.phase} ${a.activity}`} style={{ transform: `translate(${pos.x}px, ${pos.y}px)`, transition: `transform ${move.ms}ms linear, opacity .6s` }}>
      <g className={busy && !walking ? "bob" : ""}>
        <g transform={project ? `translate(0 ${FOOT}) scale(0.7)` : `translate(0 ${FOOT})`}>
          {project ? (
            <IsoPerson
              role={a.role}
              isCoord={a.group === "coordinator"}
              pose={seatedHere && a.phase === "working" && !walking && !!deskFor(a.group, a.seat, layout) ? "sit" : "stand"}
              act={walking ? "walking" : a.phase === "left" ? (a.ok ? "happy" : "idle") : standAt ? (bubble ? "talking" : "idle") : a.activity === "typing" || a.activity === "tool" ? "typing" : a.activity === "thinking" ? "thinking" : "idle"}
              face={1}
              back={seatedHere && a.phase === "working" && !walking && !!deskFor(a.group, a.seat, layout)}
            />
          ) : (
            <OfficeCharacter group={a.group} activity={a.activity} phase={a.phase} ok={a.ok} seated={a.phase === "working" && !walking && !!deskFor(a.group, a.seat, layout)} walking={walking} />
          )}
        </g>
        <circle cx={12} cy={-44} r={5} className={`state ${a.phase === "working" ? a.activity : a.ok ? "done" : "error"}`} />
      </g>
      <text textAnchor="middle" y={36} className="agent-name">{label}</text>
      {(a.tools > 0 || a.tag) && <text textAnchor="middle" y={50} className="agent-meta">{[a.tag, a.tools > 0 ? `${a.tools} tool${a.tokens ? ` · ${(a.tokens / 1000).toFixed(1)}k` : ""}` : ""].filter(Boolean).join(" · ")}</text>}
      {bubble && (
        <foreignObject x={bx} y={-96} width={bw} height={66}>
          <div className={`bubble ${bubble.kind}`} style={{ left: `${-bx}px` }}>
            <span className="icon">{icon}</span>
            <span>{bubble.text}</span>
          </div>
        </foreignObject>
      )}
    </g>
  );
}
