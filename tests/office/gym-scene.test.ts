import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";
import { GYM_TRAINER_IDS, gymBusy, gymExercise, type GymPhase } from "../../ui/src/office/gym";
import {
  BOARD_SPOT, buildGymGrid, COOLER_SPOT, findGymPath, GYM_ROOM, gymIsFree, REST_SPOTS, STATIONS, stationFor, TOWEL_SPOT, TRAINER_HOMES, type Pt,
} from "../../ui/src/office/gym-layout";
import { activeEquip, clockText, createGymSim, directGym, gymLabelsFrom, mulberry32, tickGym, treadmillReadout, type GymSim } from "../../ui/src/office/gym-scene";

const labels = gymLabelsFrom(dicts.vi as unknown as Record<string, string>);
const inRoom = (p: Pt): boolean => p.u >= 0 && p.v >= 0 && p.u <= GYM_ROOM.W && p.v <= GYM_ROOM.D;
const allStations = Object.values(STATIONS).flat();
const SPEAKING: Record<GymPhase, string[]> = {
  idle: [], interview: ["phong-van"], compose: ["phan-tich-mau", "soan-skill"], samples: ["soan-skill", "chay-thu"], trial: ["chay-thu"],
  grade: ["cham-diem", "phan-bien"], await_human: [], passed: [], rest: [],
};

function room(phase: GymPhase, round = 0, seed = 11): GymSim {
  const sim = createGymSim(mulberry32(seed), labels, phase, round);
  directGym(sim, phase, round, SPEAKING[phase], phase === "passed");
  return sim;
}
function run(sim: GymSim, seconds: number, each?: (s: GymSim) => void): void {
  for (let i = 0; i < seconds * 10; i++) { tickGym(sim, 0.1); each?.(sim); }
}

describe("gym layout", () => {
  it("the room has twice the area of the one-room office (12 x 9)", () => {
    expect(GYM_ROOM.W * GYM_ROOM.D).toBe(2 * 12 * 9);
  });
  it("every station, approach and spot lies in the room on free cells", () => {
    const g = buildGymGrid();
    for (const st of allStations) {
      expect(inRoom(st.spot)).toBe(true);
      if (st.approach) { expect(inRoom(st.approach)).toBe(true); expect(gymIsFree(g, st.approach.u, st.approach.v)).toBe(true); }
      else expect(gymIsFree(g, st.spot.u, st.spot.v)).toBe(true);
    }
    for (const sp of [COOLER_SPOT, TOWEL_SPOT, BOARD_SPOT, ...Object.values(TRAINER_HOMES), ...REST_SPOTS.map((r) => r.approach)]) expect(gymIsFree(g, sp.u, sp.v)).toBe(true);
    for (const r of REST_SPOTS) expect(inRoom(r.spot)).toBe(true);
  });
  it("paths avoid every machine and end on the target", () => {
    const g = buildGymGrid();
    const from = TRAINER_HOMES["phong-van"]!;
    const targets: Pt[] = [...allStations.map((s) => s.approach ?? s.spot), COOLER_SPOT, TOWEL_SPOT, BOARD_SPOT, ...REST_SPOTS.map((r) => r.approach)];
    for (const to of targets) {
      const path = findGymPath(g, from, to);
      expect(path, `${to.u},${to.v}`).not.toBeNull();
      const pts = path!;
      expect(pts[pts.length - 1]).toEqual({ u: to.u, v: to.v });
      for (const p of pts.slice(0, -1)) expect(gymIsFree(g, p.u, p.v)).toBe(true);
    }
  });
  it("a straight line through a machine is detoured", () => {
    const g = buildGymGrid();
    const path = findGymPath(g, { u: 3.2, v: 4.2 }, { u: 3.2, v: 8.6 })!;
    expect(path.length).toBeGreaterThan(8);
    for (const p of path) expect(gymIsFree(g, p.u, p.v)).toBe(true);
  });
  it("stations alternate between machines of the same kind per round", () => {
    expect(stationFor("treadmill", 0).key).toBe("treadmillA");
    expect(stationFor("treadmill", 1).key).toBe("treadmillB");
    expect(stationFor("bike", 3).key).toBe("bikeB");
    expect(stationFor("bench", 5).key).toBe("bench");
  });
});

describe("gym simulation", () => {
  it("is deterministic for a seed and stays finite and inside the room", () => {
    const a = room("trial", 0, 5), b = room("trial", 0, 5);
    run(a, 120, (s) => { for (const ag of s.agents) { expect(Number.isFinite(ag.pos.u) && Number.isFinite(ag.pos.v)).toBe(true); expect(inRoom(ag.pos)).toBe(true); } });
    run(b, 120);
    expect(a.agents.map((x) => [x.act, x.pos.u.toFixed(3), x.pos.v.toFixed(3)])).toEqual(b.agents.map((x) => [x.act, x.pos.u.toFixed(3), x.pos.v.toFixed(3)]));
  });
  it("walkers keep to free cells except the last step onto a machine", () => {
    const g = buildGymGrid();
    const sim = room("grade", 0, 3);
    const spots = [...allStations.map((s) => s.spot), ...REST_SPOTS.map((r) => r.spot)];
    run(sim, 150, (s) => {
      for (const a of s.agents) {
        if (a.act !== "walking" || gymIsFree(g, a.pos.u, a.pos.v)) continue;
        expect(spots.some((sp) => Math.hypot(sp.u - a.pos.u, sp.v - a.pos.v) < 1.7)).toBe(true);
      }
    });
  });
  it("the skill walks to the machine of its phase, takes the right pose and the machine reacts", () => {
    const cases: Array<[GymPhase, number, string, string, string]> = [
      ["trial", 0, "benchpress", "lie", "bench"],
      ["trial", 1, "hang", "stand", "pullup"],
      ["grade", 0, "punch", "stand", "bag"],
      ["samples", 0, "run", "stand", "treadmillA"],
      ["samples", 1, "pedal", "sit", "bikeB"],
      ["compose", 0, "curl", "stand", "dumbbells"],
      ["compose", 1, "pull", "stand", "cable"],
    ];
    for (const [phase, round, act, pose, equip] of cases) {
      const sim = room(phase, round, 21);
      let seen = false;
      run(sim, 90, (s) => {
        const sk = s.agents[0]!;
        if (sk.act === act && sk.pose === pose && sk.equip === equip) {
          seen = true;
          expect(activeEquip(s).has(equip as never)).toBe(true);
          const st = s.station;
          expect(Math.hypot(sk.pos.u - st.spot.u, sk.pos.v - st.spot.v)).toBeLessThan(0.05);
        }
      });
      expect(seen, `${phase}/${round} ${act}`).toBe(true);
    }
  });
  it("between sets the skill wipes sweat and drinks at the cooler, then returns to the machine", () => {
    const sim = room("trial", 0, 8);
    const acts = new Set<string>();
    run(sim, 200, (s) => acts.add(s.agents[0]!.act));
    for (const a of ["benchpress", "wipe", "drinking", "walking"]) expect(acts.has(a), a).toBe(true);
  });
  it("speaking trainers walk next to the machine, point and talk with Vietnamese bubbles", () => {
    const sim = room("grade", 0, 4);
    const acts = new Map<string, Set<string>>();
    const bubbles = new Set<string>();
    run(sim, 120, (s) => {
      for (const a of s.agents) {
        if (!a.trainer) continue;
        if (!acts.has(a.id)) acts.set(a.id, new Set());
        acts.get(a.id)!.add(a.act);
        if (a.bubble) bubbles.add(a.bubble);
      }
    });
    for (const id of ["cham-diem", "phan-bien"]) {
      expect(acts.get(id)!.has("point"), id).toBe(true);
      expect(acts.get(id)!.has("talking"), id).toBe(true);
    }
    expect(bubbles.has(dicts.vi["gym_say_cham-diem"])).toBe(true);
    for (const id of ["cham-diem", "phan-bien"]) {
      const a = sim.agents.find((x) => x.id === id)!;
      if (a.act === "point" || a.act === "talking") expect(Math.hypot(a.pos.u - sim.station.spot.u, a.pos.v - sim.station.spot.v)).toBeLessThan(5);
    }
  });
  it("standing coaches never share a cell", () => {
    const sim = room("trial", 0, 9);
    run(sim, 60, (s) => {
      const still = s.agents.filter((a) => a.trainer && a.act !== "walking");
      for (let i = 0; i < still.length; i++) for (let j = i + 1; j < still.length; j++) {
        expect(Math.hypot(still[i]!.pos.u - still[j]!.pos.u, still[i]!.pos.v - still[j]!.pos.v)).toBeGreaterThan(0.2);
      }
    });
  });
  it("trainers write on the board, drink, chat and walk about when they are free", () => {
    const sim = room("idle", 0, 2);
    const seen = new Set<string>();
    run(sim, 600, (s) => s.agents.forEach((a) => { if (a.trainer) seen.add(a.act); }));
    for (const a of ["write", "drinking", "talking", "walking"]) expect(seen.has(a), a).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(6);
  });
  it("everyone claps when the skill passed", () => {
    const sim = room("passed", 3, 6);
    const clapped = new Set<string>();
    run(sim, 60, (s) => s.agents.forEach((a) => { if (a.trainer && a.act === "clap") clapped.add(a.id); }));
    expect(clapped.size).toBe(GYM_TRAINER_IDS.length);
  });
  it("the resting skill sits on the bench and does other free-time things", () => {
    const sim = room("rest", 0, 13);
    const seen = new Set<string>();
    run(sim, 500, (s) => seen.add(s.agents[0]!.act));
    expect(seen.has("resting")).toBe(true);
    expect(seen.size).toBeGreaterThanOrEqual(4);
  });
  it("changing the phase re-plans: the skill leaves the mat for the new machine", () => {
    const sim = room("idle", 0, 17);
    run(sim, 20);
    directGym(sim, "trial", 0, SPEAKING.trial, false);
    expect(gymBusy("trial")).toBe(true);
    let onBench = false;
    run(sim, 40, (s) => { if (s.agents[0]!.equip === "bench") onBench = true; });
    expect(onBench).toBe(true);
    directGym(sim, "grade", 0, SPEAKING.grade, false);
    let atBag = false;
    run(sim, 40, (s) => { if (s.agents[0]!.equip === "bag") atBag = true; });
    expect(atBag).toBe(true);
    expect(gymExercise("grade")).toBe("bag");
  });
  it("await_human: nobody from the grader role talks", () => {
    const sim = room("await_human", 0, 21);
    run(sim, 60, (s) => {
      for (const a of s.agents) if (a.id === "cham-diem") expect(a.act).not.toBe("talking");
    });
  });
  it("labels, clock and treadmill display", () => {
    expect(labels.drink).toBe(dicts.vi.gym_say_drink);
    expect(labels.chat.length).toBeGreaterThanOrEqual(3);
    expect(labels.say["phong-van"]).toBe(dicts.vi["gym_say_phong-van"]);
    expect(clockText(0)).toBe("00:00");
    expect(clockText(125.9)).toBe("02:05");
    expect(Number(treadmillReadout(0).speed)).toBeGreaterThan(6);
    expect(Number(treadmillReadout(60).dist)).toBeGreaterThan(Number(treadmillReadout(10).dist));
  });
});
