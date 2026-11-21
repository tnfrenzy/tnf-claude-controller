/* Pure traffic / signal / pedestrian simulation ported from docs/design/single-screen.html (initTraffic, setLight, tickTraffic). No DOM. */

export type Rand = () => number;
export type Phase = "green" | "yellow" | "red";
export type CarKind = "sedan" | "suv" | "taxi" | "van" | "scooter";
export type Geom = { crossX: number; CURB: number; ROAD: number; ROAD_H: number };

export const LIGHT: Record<Phase, number> = { green: 13, yellow: 2.5, red: 10 }; // seconds; car red = pedestrian green
export const DEC = 150;
export const ACC = 45;
export const LOOK_KEYS = ["analyst", "planner", "critic", "implementer", "qa", "debug", "searcher", "analyzer", "synthesizer", "writer", "editor", "seo", "coordinator"];
const KINDS: CarKind[] = ["sedan", "sedan", "suv", "taxi", "van", "scooter"];
const COLORS = ["#2f5fe8", "#d8dee9", "#c0392b", "#1b1f2e", "#5aa0ff", "#8a1f2e", "#9aa3b5", "#2e6f5e"];

export type Car = { id: number; lane: "A" | "B"; x: number; len: number; kind: CarKind; color: string; v: number; vmax: number; rot: number; braking: boolean };
export type PedState = "walk" | "wait" | "cross" | "waitFar";
export type Ped = { id: number; x: number; y: number; dir: 1 | -1; crosser: boolean; state: PedState; face: 1 | -1; look: string; v: number; waitT: number; cool: number; yTo: number };
export type Sim = { cars: Car[]; peds: Ped[]; t: number; phase: Phase; phaseT: number; geom: Geom; laneY: { A: number; B: number }; stopA: number; stopB: number; nextId: number };

const rnd = (r: Rand, a: number, b: number) => a + r() * (b - a);
const pick = <T,>(r: Rand, arr: readonly T[]): T => arr[Math.floor(r() * arr.length)] as T;

export function vehicleLen(kind: CarKind): number {
  return kind === "scooter" ? 40 : 82;
}

function spawnCar(sim: Sim, r: Rand, lane: "A" | "B", x: number): Car {
  const kind = pick(r, KINDS);
  const color = kind === "taxi" ? "#ffc542" : kind === "scooter" ? "#e74c3c" : pick(r, COLORS);
  const c: Car = { id: sim.nextId++, lane, x, len: vehicleLen(kind), kind, color, v: 0, vmax: (kind === "scooter" ? 95 : 70) * rnd(r, 0.85, 1.15), rot: 0, braking: false };
  sim.cars.push(c);
  return c;
}

function spawnPed(sim: Sim, r: Rand, x: number, y: number, dir: 1 | -1, crosser: boolean): Ped {
  const p: Ped = { id: sim.nextId++, x, y, dir, crosser, state: "walk", face: dir, look: pick(r, LOOK_KEYS), v: rnd(r, 22, 32), waitT: 0, cool: 0, yTo: y };
  sim.peds.push(p);
  return p;
}

export function createSim(geom: Geom, r: Rand): Sim {
  const { crossX, CURB, ROAD } = geom;
  const sim: Sim = { cars: [], peds: [], t: 0, phase: "green", phaseT: 0, geom, laneY: { A: ROAD + 62, B: ROAD + 78 }, stopA: crossX - 58, stopB: crossX + 58, nextId: 1 };
  for (let i = 0; i < 4; i++) spawnCar(sim, r, "A", -200 - i * 170 + rnd(r, -30, 30));
  for (let i = 0; i < 4; i++) spawnCar(sim, r, "B", 1600 + i * 180 + rnd(r, -30, 30));
  spawnPed(sim, r, 100, CURB - 16, 1, false);
  spawnPed(sim, r, 1300, CURB - 30, -1, false);
  spawnPed(sim, r, 700, CURB - 22, 1, false);
  spawnPed(sim, r, 950, CURB - 12, -1, false);
  spawnPed(sim, r, 300, CURB - 14, 1, true);
  spawnPed(sim, r, 1100, CURB - 18, -1, true);
  return sim;
}

/** Advance the signal phase. Returns new phase and elapsed time in that phase. */
export function stepPhase(phase: Phase, phaseT: number, dt: number): { phase: Phase; phaseT: number } {
  let t = phaseT + dt;
  let p = phase;
  if (t > LIGHT[p]) {
    t = 0;
    p = p === "green" ? "yellow" : p === "yellow" ? "red" : "green";
  }
  return { phase: p, phaseT: t };
}

export function pedestriansMayGo(sim: Pick<Sim, "phase" | "phaseT">): boolean {
  return sim.phase === "red" && sim.phaseT < LIGHT.red - 2.5;
}

export type LightColors = { red: string; yellow: string; green: string; pedRed: string; pedGreen: string };
export function lightColors(sim: Pick<Sim, "phase" | "phaseT" | "t">): LightColors {
  const ph = sim.phase;
  const pedGo = ph === "red";
  const flash = pedGo && sim.phaseT > LIGHT.red - 3 && Math.floor(sim.t * 3) % 2 === 0;
  return {
    red: ph === "red" ? "#ff3b3b" : "#3a2a2e",
    yellow: ph === "yellow" ? "#ffc542" : "#3a3528",
    green: ph === "green" ? "#2ed47a" : "#243a2e",
    pedRed: pedGo ? "#3a2a2e" : "#ff3b3b",
    pedGreen: pedGo && !flash ? "#2ed47a" : "#243a2e",
  };
}

function stepCars(sim: Sim, dt: number, r: Rand): void {
  const stopForCars = sim.phase !== "green";
  (["A", "B"] as const).forEach((lane) => {
    const dir = lane === "A" ? 1 : -1;
    const stopLine = lane === "A" ? sim.stopA : sim.stopB;
    const cars = sim.cars.filter((c) => c.lane === lane).sort((a, b) => (b.x - a.x) * dir); // leader first
    cars.forEach((c, i) => {
      let target = c.vmax;
      const front = c.x + (dir * c.len) / 2;
      const dLine = (stopLine - front) * dir;
      if (stopForCars && dLine > -4 && (sim.phase === "red" || dLine > (c.v * c.v) / (2 * DEC) + 6)) target = Math.min(target, Math.sqrt(2 * DEC * Math.max(0, dLine - 4)));
      const ahead = cars[i - 1];
      if (ahead) {
        const gap = (ahead.x - c.x) * dir - (ahead.len + c.len) / 2 - 14;
        target = Math.min(target, ahead.v + Math.sqrt(2 * DEC * Math.max(0, gap)));
        if (gap < 0) target = 0;
      }
      if (target < c.v) c.v = Math.max(target, c.v - DEC * dt);
      else c.v = Math.min(target, c.v + ACC * dt);
      c.braking = target < c.v - 1 || (c.v < 2 && target < 1);
      c.x += dir * c.v * dt;
      c.rot += c.v * dt * 10;
      if ((dir > 0 && c.x > 1700) || (dir < 0 && c.x < -300)) {
        const xs = cars.filter((o) => o !== c).map((o) => o.x);
        const edge = dir > 0 ? Math.min(-300, ...xs) : Math.max(1700, ...xs);
        c.x = edge - dir * rnd(r, 160, 300); // respawn behind the last car, no overlap
        c.v = c.vmax * 0.6;
      }
    });
  });
}

function stepPeds(sim: Sim, dt: number, r: Rand): void {
  const { crossX, CURB, ROAD, ROAD_H } = sim.geom;
  const nearY = CURB - 14;
  const farY = ROAD + ROAD_H + 20;
  const go = pedestriansMayGo(sim);
  sim.peds.forEach((p) => {
    if (p.state === "walk") {
      p.x += p.dir * p.v * dt;
      if (p.x > 1500) p.dir = -1;
      if (p.x < -60) p.dir = 1;
      p.face = p.dir;
      if (p.crosser && Math.abs(p.x - crossX) < 2 && p.cool <= 0) {
        p.state = "wait";
        p.x = crossX;
      }
      p.cool -= dt;
    } else if (p.state === "wait") {
      if (go) {
        p.state = "cross";
        p.yTo = p.y < CURB ? farY : nearY;
      }
    } else if (p.state === "cross") {
      const dy = Math.sign(p.yTo - p.y);
      p.y += dy * p.v * 0.8 * dt;
      if (Math.abs(p.y - p.yTo) < 1) {
        p.y = p.yTo;
        if (p.y > CURB) {
          p.state = "waitFar";
          p.waitT = rnd(r, 3, 7);
          p.face = pick(r, [1, -1] as const);
        } else {
          p.state = "walk";
          p.dir = pick(r, [1, -1] as const);
          p.cool = rnd(r, 10, 20);
        }
      }
    } else if (p.state === "waitFar") {
      p.waitT -= dt;
      if (p.waitT <= 0 && go) {
        p.state = "cross";
        p.yTo = nearY;
      }
    }
  });
}

/** One simulation step; mutates and returns sim. */
export function tickSim(sim: Sim, dt: number, r: Rand): Sim {
  sim.t += dt;
  const ph = stepPhase(sim.phase, sim.phaseT, dt);
  sim.phase = ph.phase;
  sim.phaseT = ph.phaseT;
  stepCars(sim, dt, r);
  stepPeds(sim, dt, r);
  return sim;
}

/** Pedestrian is drawn in front of the curb line once it steps onto the road. */
export function pedInFront(p: Pick<Ped, "y">, CURB: number): boolean {
  return p.y > CURB - 4;
}

export function shade(hex: string, k: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, v * k)) | 0;
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
}
