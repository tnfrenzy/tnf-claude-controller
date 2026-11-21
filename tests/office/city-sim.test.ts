import { describe, expect, it } from "vitest";
import { LIGHT, createSim, pedestriansMayGo, stepPhase, tickSim } from "../../ui/src/office/city-sim.js";

const geom = { crossX: 590, CURB: 712, ROAD: 716, ROAD_H: 84 };
function lcg(seed: number) {
  let s = seed;
  return () => {
    s = (s * 9301 + 49297) % 233280;
    return s / 233280;
  };
}

describe("city-sim", () => {
  it("signal phases change on the configured cycle", () => {
    let st = { phase: "green" as const, phaseT: 0 } as { phase: "green" | "yellow" | "red"; phaseT: number };
    st = stepPhase(st.phase, st.phaseT, LIGHT.green - 0.1);
    expect(st.phase).toBe("green");
    st = stepPhase(st.phase, st.phaseT, 0.2);
    expect(st.phase).toBe("yellow");
    st = stepPhase(st.phase, st.phaseT, LIGHT.yellow + 0.1);
    expect(st.phase).toBe("red");
    st = stepPhase(st.phase, st.phaseT, LIGHT.red + 0.1);
    expect(st.phase).toBe("green");
  });

  it("cars stop before the line on red and move again on green", () => {
    const sim = createSim(geom, lcg(3));
    sim.phase = "red";
    sim.phaseT = 0;
    // freeze the phase while we measure
    for (let i = 0; i < 600; i++) {
      sim.phaseT = 0;
      tickSim(sim, 0.05, lcg(i + 1));
      sim.phase = "red";
    }
    const a = sim.cars.filter((c) => c.lane === "A");
    for (const c of a) expect(c.x + c.len / 2).toBeLessThanOrEqual(sim.stopA + 1);
    const lead = a.reduce((m, c) => (c.x > m.x ? c : m));
    expect(lead.v).toBeLessThan(1);
    sim.phase = "green";
    sim.phaseT = 0;
    const x0 = lead.x;
    for (let i = 0; i < 40; i++) tickSim(sim, 0.05, lcg(i + 100));
    expect(lead.x).toBeGreaterThan(x0 + 5);
  });

  it("pedestrians only cross when allowed", () => {
    const sim = createSim(geom, lcg(5));
    const p = sim.peds.find((q) => q.crosser)!;
    p.state = "wait";
    p.y = geom.CURB - 14;
    sim.phase = "green";
    sim.phaseT = 0;
    tickSim(sim, 0.05, lcg(1));
    expect(p.state).toBe("wait");
    expect(pedestriansMayGo({ phase: "red", phaseT: 1 })).toBe(true);
    expect(pedestriansMayGo({ phase: "red", phaseT: LIGHT.red - 1 })).toBe(false);
    sim.phase = "red";
    sim.phaseT = 0.5;
    tickSim(sim, 0.05, lcg(1));
    expect(p.state).toBe("cross");
  });

  it("is deterministic for the same rand", () => {
    const run = () => {
      const s = createSim(geom, lcg(9));
      const r = lcg(11);
      for (let i = 0; i < 400; i++) tickSim(s, 0.05, r);
      return JSON.stringify([s.cars, s.peds, s.phase]);
    };
    expect(run()).toBe(run());
  });
});
