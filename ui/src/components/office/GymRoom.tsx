import { useEffect, useMemo, useRef, useState, type ReactElement } from "react";
import { useT } from "../../i18n";
import { personDepth, project, sortedDrawList } from "../../office/iso/depth";
import { SEAT_SURFACE_Z } from "../../office/iso/pose-geom";
import { getAvatarMap, lookWithFallback } from "../../skills/avatars";
import { GYM_PERSON_SCALE, GYM_SKILL_LOOK,GYM_TRAINER_IDS, GYM_TRAINER_LOOKS, gymPhase, gymScene, scorePercent, type GymPhase } from "../../office/gym";
import { EQUIP_RECTS } from "../../office/gym-layout";
import { activeEquip, clockText, createGymSim, directGym, gymLabelsFrom, mulberry32, SKILL_ID, tickGym, treadmillReadout, type GymAgent, type GymSim } from "../../office/gym-scene";
import {
  Barbell, BenchStation, CableHandles, CableMachine, DumbbellRack, GymBalls, GymBoards, GymDefs, GymShell, Kettlebells, Lockers, Mats, PlateRack, PlateTree, PullupBack, PullupFront,
  PunchBag, RestBench, SpinBike, TowelShelf, Treadmill, WallClock, WaterCooler,
} from "./GymEquipment";
import { IsoPerson } from "./IsoPerson";

const TICK_MS = 100;

interface Item { id: string; depth: number; node: ReactElement }

/** Acts whose arms swing toward the facing direction (the sprite mirrors with `fl`). */
const DIRECTIONAL = new Set(["point"]);
const SWEATY = new Set(["run", "pedal", "pull", "hang", "curl", "benchpress", "punch", "situp"]);
/** Extra height of the person above the floor (seat of the bike, pad of the bench). */
const LIFT: Record<string, number> = { pedal: 12, benchpress: 14 };
/** Depth key of the rest bench (u 7.0 + v 12.0 + d 0.7); a person in pose sofa draws at this + 0.05. */
const REST_BENCH_KEY = 7.0 + 12.0 + 0.7;
// Lift: benchpress anchors at 14 (pad top ~16) and IsoPerson's own LIE_LIFT raises the torso centre, so it is
// not lifted twice; pose sofa sits on the rest bench cushion, anchored at SEAT_SURFACE_Z; sit-up on the mat stays on the floor.
const liftFor = (act: string, pose: string): number => LIFT[act] ?? (pose === "sofa" ? SEAT_SURFACE_Z : 0);

function Sweat({ f, lie }: { f: 1 | -1; lie: boolean }): ReactElement {
  return (
    <g transform={lie ? `translate(60,-6)` : `translate(${13 * f},-66)`} data-sweat="1">
      {[0, 1, 2].map((i) => (
        <path key={i} className="gym-sweat" style={{ animationDelay: `${-i * 0.5}s` }} d={`M${i * 3 * f} 0 q-2 4 0 6 q2 -2 0 -6z`} fill="#8fd3ff" />
      ))}
    </g>
  );
}

function Towel({ f }: { f: 1 | -1 }): ReactElement {
  const hx = f > 0 ? 25 : -7;
  return (
    <g transform={`translate(${hx},-52)`} data-towel="1">
      <g className="gym-towel">
        <rect x={-8} y={-3} width={16} height={7} rx={2} fill="#f4f6fa" stroke="#aeb8cc" strokeWidth={0.6} />
        <rect x={-8} y={0} width={16} height={1.4} fill="#14b8a6" opacity={0.8} />
      </g>
    </g>
  );
}

function Dumbbells(): ReactElement {
  const one = (side: 1 | -1): ReactElement => (
    <g transform={`translate(${16 * side},-17)`}>
      <g className={side < 0 ? "gym-curl-l" : "gym-curl-r"}>
        <rect x={-7} y={-1} width={14} height={2.4} fill="#c9d1e0" />
        <rect x={-9} y={-4} width={4} height={8} rx={1} fill="#2b2f3a" stroke="#59627a" strokeWidth={0.6} />
        <rect x={5} y={-4} width={4} height={8} rx={1} fill="#2b2f3a" stroke="#59627a" strokeWidth={0.6} />
      </g>
    </g>
  );
  return <g data-dumbbells="1">{one(-1)}{one(1)}</g>;
}

function personNode(a: GymAgent, x: number, y: number): ReactElement {
  const lift = liftFor(a.act, a.pose);
  const act = DIRECTIONAL.has(a.act) && a.face < 0 ? `${a.act} fl` : a.act;
  const person = (
    <IsoPerson role={a.id} lookOverride={lookWithFallback(a.id, getAvatarMap(), a.trainer ? GYM_TRAINER_LOOKS[a.id as (typeof GYM_TRAINER_IDS)[number]] : GYM_SKILL_LOOK)}
      x={x} y={y} face={a.face} back={a.back} pose={a.pose} lieAxis="u" act={act} {...(a.bubble ? { bubble: a.bubble } : {})} />
  );
  const overlays = (
    <g transform={`translate(${x},${y})`}>
      {SWEATY.has(a.act) && <ellipse cx={0} cy={2} rx={22} ry={8} fill="#5aa0ff" opacity={0.14} pointerEvents="none" />}
      {SWEATY.has(a.act) && <Sweat f={a.face} lie={a.pose === "lie"} />}
      {a.act === "wipe" && <Towel f={a.face} />}
      {a.act === "curl" && <Dumbbells />}
    </g>
  );
  const inner = <g transform={`translate(${x},${y}) scale(${GYM_PERSON_SCALE}) translate(${-x},${-y})`} data-gym-person="1">{person}{overlays}</g>;
  if (a.act === "hang") return <g className="gym-hang">{inner}</g>;
  return lift ? <g transform={`translate(0,${-lift})`}>{inner}</g> : <g>{inner}</g>;
}

export function GymRoom({ state, paused = false, title, round, maxRounds, best, generating = false }: {
  state: string;
  paused?: boolean;
  title: string;
  round?: number | undefined;
  maxRounds?: number | undefined;
  best?: number | null | undefined;
  /** True while sample files are being generated (the generative session). */
  generating?: boolean | undefined;
}) {
  const { t } = useT();
  const phase: GymPhase = gymPhase(generating ? "generating" : state, paused);
  const pct = scorePercent(best);
  const dict = t as unknown as Record<string, string>;
  const roundNo = round ?? 0;
  const scene = gymScene(phase, roundNo);
  const labels = useMemo(() => gymLabelsFrom(dict), [dict]);
  const simRef = useRef<GymSim | null>(null);
  const [, setFrame] = useState(0);
  if (!simRef.current) {
    simRef.current = createGymSim(mulberry32(20260711), labels, phase, roundNo);
    directGym(simRef.current, phase, roundNo, scene.speaking, scene.cheering);
  }
  const sim = simRef.current;
  sim.labels = labels;

  const speakingKey = scene.speaking.join("|");
  useEffect(() => {
    directGym(sim, phase, roundNo, scene.speaking, scene.cheering);
    // scene.speaking is represented by speakingKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sim, phase, roundNo, speakingKey, scene.cheering]);
  useEffect(() => {
    const timer = setInterval(() => { tickGym(sim, TICK_MS / 1000); setFrame((n) => (n + 1) % 1_000_000); }, TICK_MS);
    return () => clearInterval(timer);
  }, [sim]);

  const on = activeEquip(sim);
  const read = treadmillReadout(sim.clock);
  // Furniture that never changes is built once, so each 100 ms frame only re-renders the moving parts.
  const staticItems = useMemo<Item[]>(() => [
    { id: "mats", depth: 0, node: <Mats /> },
    { id: "dumbbells", depth: 0.6 + 0.3 + 0.9, node: <DumbbellRack /> },
    { id: "cooler", depth: 12.3 + 0.3 + 0.5, node: <WaterCooler /> },
    { id: "towels", depth: 13.0 + 0.3 + 0.4, node: <TowelShelf /> },
    { id: "lockers", depth: 14.0 + 0.2 + 0.8, node: <Lockers /> },
    { id: "plateRack", depth: 0.3 + 8.4 + 1.6, node: <PlateRack /> },
    { id: "plateTree", depth: 1.4 + 5.2 + 0.6, node: <PlateTree /> },
    { id: "bench", depth: EQUIP_RECTS.bench.u + EQUIP_RECTS.bench.v + EQUIP_RECTS.bench.d, node: <BenchStation /> },
    { id: "pullupBack", depth: 8.0 + 4.6 + 0.25, node: <PullupBack /> },
    { id: "pullupFront", depth: 14.5, node: <PullupFront /> },
    { id: "balls", depth: 17.5, node: <GymBalls /> },
    { id: "kettlebells", depth: 0.6 + 11.2, node: <Kettlebells /> },
    { id: "restBench", depth: REST_BENCH_KEY, node: <RestBench /> },
  ], []);
  const items: Item[] = [
    ...staticItems,
    { id: "treadmillA", depth: 5.0 + 0.3 + 1.2, node: <Treadmill id="A" active={on.has("treadmillA")} speed={read.speed} dist={read.dist} /> },
    { id: "treadmillB", depth: 6.6 + 0.3 + 1.2, node: <Treadmill id="B" active={on.has("treadmillB")} speed={read.speed} dist={read.dist} /> },
    { id: "cable", depth: 9.2 + 0.3 + 0.8, node: <CableMachine active={on.has("cable")} /> },
    { id: "bag", depth: 12.4 + 6.1 + 0.5, node: <PunchBag active={on.has("bag")} /> },
    { id: "bikeA", depth: 11.6 + 9.2 + 0.7, node: <SpinBike id="A" active={on.has("bikeA")} /> },
    { id: "bikeB", depth: 11.6 + 10.9 + 0.7, node: <SpinBike id="B" active={on.has("bikeB")} /> },
  ];
  for (const a of sim.agents) {
    const p = project(a.pos.u, a.pos.v);
    items.push({ id: `p:${a.id}`, depth: personDepth(a.pose, a.pos, a.pose === "sofa" ? REST_BENCH_KEY : undefined), node: personNode(a, p.x, p.y) });
    if (a.id === SKILL_ID && a.act === "benchpress") {
      items.push({ id: "barbell", depth: personDepth("lie", a.pos) + 0.01, node: <Barbell active /> });
    }
    if (a.id === SKILL_ID && a.act === "pull") {
      items.push({ id: "cableHandles", depth: personDepth("stand", a.pos) + 0.01, node: <CableHandles active x={p.x} y={p.y} /> });
    }
  }
  if (!items.some((i) => i.id === "barbell")) items.push({ id: "barbell", depth: 10.4, node: <Barbell active={false} /> });

  return (
    <div className="gym-room" data-phase={phase}>
      <svg viewBox="-80 -50 1160 836" preserveAspectRatio="xMidYMid meet" className="iso-office iso-gym" role="img" aria-label={t.gym_title}>
        <GymDefs />
        <GymShell />
        <GymBoards
          title={title}
          roundText={`${t.gym_round} ${roundNo}${maxRounds ? `/${maxRounds}` : ""}`}
          scoreText={best === null || best === undefined ? "–" : String(best)}
          pct={pct}
          clock={clockText(sim.clock)}
          scoreLabel={t.gym_score}
          timeLabel={t.gym_board_time}
        />
        <WallClock clock={sim.clock} />
        {sortedDrawList(items).map((it) => <g key={it.id}>{it.node}</g>)}
      </svg>
      <div className="gym-hud">
        <span className="gym-phase">{t[`gym_phase_${phase}` as const]}</span>
        <span className="gym-exercise">{t[`gym_ex_${scene.exercise}` as const]}</span>
        {round !== undefined ? <span>{t.gym_round} {round}{maxRounds ? `/${maxRounds}` : ""}</span> : null}
        <span className="gym-meter" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t.gym_score}>
          <span className="gym-meter-fill" style={{ width: `${pct}%` }} />
        </span>
        <span>{t.gym_score}: {best ?? "–"}</span>
      </div>
      <div className="gym-trainers fine">
        {GYM_TRAINER_IDS.map((id) => (
          <span key={id} className={`gym-trainer${scene.speaking.includes(id) ? " on" : ""}`}>{dict[`gym_role_${id}`]}</span>
        ))}
      </div>
    </div>
  );
}
