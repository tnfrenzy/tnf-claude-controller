import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useT } from "../../i18n";
import { getAvatarMap, lookWithFallback } from "../../skills/avatars";
import { personDepth, project, sortedDrawList } from "../../office/iso/depth";
import { SEAT_SURFACE_Z } from "../../office/iso/pose-geom";
import {
  W3D_JOBS, W3D_PERSON_SCALE, W3D_ROLE_IDS, WORKSHOP3D_LOOKS, w3dBusy, w3dPhase, w3dScene, type W3DPhase, type W3DRoleId, type W3DStage,
} from "../../office/workshop3d";
import { W3D_RECTS } from "../../office/workshop3d-layout";
import { createW3DSim, directW3D, mulberry32, tickW3D, w3dClockText, w3dLabelsFrom, type W3DAgent, type W3DSim } from "../../office/workshop3d-scene";
import { chairItems, type FurnNode } from "../office/IsoFurniture";
import { IsoPerson } from "../office/IsoPerson";
import {
  W3DCoffeeMachine, W3DDraftingDesk, W3DDrawingRack, W3DIssueBoard, W3DMaterialShelf, W3DMoodboard, W3DPlanTable, W3DPlant, W3DPodium,
  W3DPrinter, W3DReception, W3DReviewDesk, W3DShell, W3DSofa, W3DStudio, W3DWallScreen,
} from "./Workshop3DEquipment";

const TICK_MS = 100;
/** Depth key of the sofa (u + v + d): a person in pose sofa draws at this + 0.05. */
const SOFA_KEY = W3D_RECTS.sofa.u + W3D_RECTS.sofa.v + W3D_RECTS.sofa.d;
/** Acts whose arms swing toward the facing direction (the sprite mirrors with `fl`). */
const DIRECTIONAL = new Set(["point"]);

interface Item { id: string; depth: number; node: ReactElement }

/** Two material chips held up while comparing samples. */
function Chips({ f }: { f: 1 | -1 }): ReactElement {
  return (
    <g transform={`translate(${20 * f},-58)`} data-chips="1">
      <g className="w3r-chips">
        <rect x={-9} y={-5} width={8} height={10} rx={1} fill="#c9d1e0" stroke="#fff" strokeWidth={0.6} />
        <rect x={1} y={-5} width={8} height={10} rx={1} fill="#b5835a" stroke="#fff" strokeWidth={0.6} />
      </g>
    </g>
  );
}

function personNode(a: W3DAgent, x: number, y: number, working: boolean): ReactElement {
  const lift = a.pose === "sofa" ? SEAT_SURFACE_Z : 0;
  const act = DIRECTIONAL.has(a.act) && a.face < 0 ? `${a.act} fl` : a.act;
  const person = (
    <IsoPerson role={a.id} lookOverride={lookWithFallback(a.id, getAvatarMap(), WORKSHOP3D_LOOKS[a.id])}
      x={x} y={y} face={a.face} back={a.back} pose={a.pose} lieAxis="u" act={act} {...(a.bubble ? { bubble: a.bubble } : {})} />
  );
  const overlays = (
    <g transform={`translate(${x},${y})`}>
      {working && a.act !== "walking" && (
        <>
          <ellipse cx={0} cy={2} rx={24} ry={9.5} fill="#74e0ff" opacity={0.13} pointerEvents="none" />
          <ellipse className="w3r-active" cx={0} cy={2} rx={20} ry={8} fill="none" stroke="#74e0ff" strokeWidth={1.6} />
        </>
      )}
      {a.act === "compare" && <Chips f={a.face} />}
    </g>
  );
  const inner = <g transform={`translate(${x},${y}) scale(${W3D_PERSON_SCALE}) translate(${-x},${-y})`} data-w3r-person={a.id}>{person}{overlays}</g>;
  return lift ? <g transform={`translate(0,${-lift})`}>{inner}</g> : <g>{inner}</g>;
}

export interface Workshop3DRoomProps {
  /** Session state of GET /api/workshop3d/:slug (`snapshot.state`). */
  state: string;
  paused?: boolean;
  title: string;
  round?: number | undefined;
  /** Open review issues (`snapshot.issues.length`); each is a pin on the wall board. */
  issues?: number | undefined;
  /** Short status line (`snapshot.note`) and error (`snapshot.error`). */
  note?: string | undefined;
  error?: string | undefined;
  /** Questions of the intake role while the state is awaiting_user. */
  questions?: string[] | undefined;
}

export function Workshop3DRoom({ state, paused = false, title, round, issues = 0, note, error, questions }: Workshop3DRoomProps) {
  const { t } = useT();
  const dict = t as unknown as Record<string, string>;
  const phase: W3DPhase = w3dPhase(state, paused);
  const scene = w3dScene(phase);
  const issueCount = Math.max(0, Math.floor(issues));
  const labels = useMemo(() => w3dLabelsFrom(dict), [dict]);
  const simRef = useRef<W3DSim | null>(null);
  const stageRef = useRef<W3DStage>(0);
  const [, setFrame] = useState(0);
  if (!simRef.current) {
    simRef.current = createW3DSim(mulberry32(20261110), labels, phase, issueCount);
    directW3D(simRef.current, phase, issueCount);
  }
  const sim = simRef.current;
  sim.labels = labels;
  // paused / stopped / quota keep the model as it was; failed and idle fall back to what was reached
  if (phase !== "rest" && phase !== "idle" && phase !== "failed") stageRef.current = scene.stage;
  const stage = phase === "rest" || phase === "failed" ? stageRef.current : scene.stage;

  useEffect(() => {
    directW3D(sim, phase, issueCount);
  }, [sim, phase, issueCount]);
  useEffect(() => {
    const timer = setInterval(() => { tickW3D(sim, TICK_MS / 1000); setFrame((n) => (n + 1) % 1_000_000); }, TICK_MS);
    return () => clearInterval(timer);
  }, [sim]);

  const printing = phase === "build" || phase === "optimize";
  const shooting = phase === "render";
  const staticItems = useMemo<Item[]>(() => {
    const furn: FurnNode[] = chairItems("draft", { u: 1.9, v: 4.9 });
    return [
      { id: "reception", depth: 2.4 + 10.2 + 2.6, node: <W3DReception /> },
      { id: "draftDesk", depth: 0.6 + 3.2 + 1.0, node: <W3DDraftingDesk /> },
      ...furn.map((f) => ({ id: f.id, depth: f.depth, node: f.node() })),
      { id: "rack", depth: 3.5 + 3.2 + 1.6, node: <W3DDrawingRack /> },
      { id: "planTable", depth: 5.0 + 3.6 + 1.2, node: <W3DPlanTable /> },
      { id: "coffee", depth: 5.2 + 0.3 + 0.7, node: <W3DCoffeeMachine /> },
      { id: "reviewDesk", depth: 5.0 + 11.8 + 0.9, node: <W3DReviewDesk /> },
      { id: "sofa", depth: SOFA_KEY, node: <W3DSofa /> },
      { id: "plantA", depth: 11.0 + 12.4 + 0.6, node: <W3DPlant r={W3D_RECTS.plantA} /> },
      { id: "plantB", depth: 15.0 + 12.5 + 0.6, node: <W3DPlant r={W3D_RECTS.plantB} /> },
      { id: "plantC", depth: 0.4 + 12.9 + 0.5, node: <W3DPlant r={W3D_RECTS.plantC} /> },
    ];
  }, []);
  const items: Item[] = [
    ...staticItems,
    { id: "shelf", depth: 10.6 + 0.3 + 0.8, node: <W3DMaterialShelf active={phase === "material"} /> },
    { id: "printer", depth: 14.3 + 0.3 + 1.2, node: <W3DPrinter printing={printing} /> },
    { id: "podium", depth: 8.0 + 5.6 + 2.2, node: <W3DPodium stage={stage} /> },
    { id: "studio", depth: 23, node: <W3DStudio shooting={shooting} stage={stage} /> },
  ];
  for (const a of sim.agents) {
    const p = project(a.pos.u, a.pos.v);
    items.push({ id: `p:${a.id}`, depth: personDepth(a.pose, a.pos, a.pose === "sofa" ? SOFA_KEY : undefined), node: personNode(a, p.x, p.y, scene.active.includes(a.id)) });
  }

  const phaseText = t[`w3r_phase_${phase}` as keyof typeof t] as string;
  const roundText = round !== undefined ? `${t.w3r_round} ${round}` : "";
  const busy = w3dBusy(phase);
  const speaking = scene.speaking[0];
  const shownQuestions = (questions ?? []).filter(Boolean).slice(0, 5);
  return (
    <div className="gym-room w3r-room" data-phase={phase} data-stage={stage}>
      <svg viewBox="-80 -50 1160 836" preserveAspectRatio="xMidYMid meet" className="iso-office iso-gym iso-w3r" role="img" aria-label={t.w3r_title}>
        <W3DShell />
        <W3DMoodboard label={t.w3r_moodboard} />
        <W3DWallScreen title={title} phaseText={phaseText} roundText={roundText} stage={stage} clock={w3dClockText(sim.clock)} />
        <W3DIssueBoard issues={issueCount} title={t.w3r_issues} />
        {sortedDrawList(items).map((it) => <g key={it.id}>{it.node}</g>)}
      </svg>
      <div className="gym-hud w3r-hud">
        <span className="gym-phase">{phaseText}</span>
        {speaking ? <span className="w3r-speaker">{dict[`w3r_role_${speaking}`]}</span> : null}
        {roundText ? <span>{roundText}</span> : null}
        {issueCount > 0 ? <span className="w3r-issue-count">{t.w3r_issues}: {issueCount}</span> : null}
        <span className="gym-meter" role="progressbar" aria-valuemin={0} aria-valuemax={4} aria-valuenow={stage} aria-label={t.w3r_progress}>
          <span className={`gym-meter-fill${busy ? " w3r-busy" : ""}`} style={{ width: `${stage * 25}%` }} />
        </span>
      </div>
      {note ? <div className="fine w3r-note">{note}</div> : null}
      {error ? <div className="error w3r-error">{error}</div> : null}
      {phase === "ask" && shownQuestions.length > 0 ? (
        <div className="w3r-questions">
          <div className="fine">{t.w3r_questions}</div>
          <ol>{shownQuestions.map((q, i) => <li key={i}>{q}</li>)}</ol>
        </div>
      ) : null}
      <div className="gym-trainers fine">
        {W3D_ROLE_IDS.map((id: W3DRoleId) => (
          <span key={id} className={`gym-trainer${scene.active.includes(id) ? " on" : ""}`} data-job={W3D_JOBS[id].station}>{dict[`w3r_role_${id}`]}</span>
        ))}
      </div>
    </div>
  );
}

/** Friendly empty room (no session yet or the API is not available): the room with nobody working. */
export function Workshop3DEmpty(): ReactElement {
  const { t } = useT();
  return (
    <div className="w3r-empty">
      <Workshop3DRoom state="" title={t.w3r_empty_title} />
      <div className="fine">{t.w3r_empty_hint}</div>
    </div>
  );
}
