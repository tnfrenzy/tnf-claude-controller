import { describe, expect, it } from "vitest";
import { createW3DSim, directW3D, mulberry32, tickW3D, w3dClockText, type W3DLabels, type W3DSim } from "../../ui/src/office/workshop3d-scene.js";
import { W3D_JOBS, W3D_ROLE_IDS, type W3DPhase } from "../../ui/src/office/workshop3d.js";
import { W3D_STATIONS, W3D_ROOM } from "../../ui/src/office/workshop3d-layout.js";

const labels: W3DLabels = {
  drink: "Cà phê", stretch: "Vươn vai", chat: ["Chào"], phone: ["Tin nhắn"], rest: ["Nghỉ"], cheer: ["Xong!"], mark: ["Lỗi!"], place: ["Đặt mẫu"],
  say: Object.fromEntries(W3D_ROLE_IDS.map((r) => [r, `say ${r}`])),
};
const PHASES: W3DPhase[] = ["idle", "intake", "ask", "art", "plan", "model", "build", "material", "render", "review", "optimize", "present", "done", "rest", "failed"];

function run(sim: W3DSim, secs: number, onTick?: (s: W3DSim) => void): void {
  for (let t = 0; t < secs; t += 0.1) { tickW3D(sim, 0.1); onTick?.(sim); }
}
const agent = (s: W3DSim, id: string) => s.agents.find((a) => a.id === id)!;

describe("workshop3d scene", () => {
  it("has nine agents, all inside the room, with no NaN, in every phase", () => {
    for (const p of PHASES) {
      const sim = createW3DSim(mulberry32(7), labels, "idle");
      directW3D(sim, p, 2);
      run(sim, 40, (s) => {
        for (const a of s.agents) {
          expect(Number.isFinite(a.pos.u) && Number.isFinite(a.pos.v), `${p} ${a.id}`).toBe(true);
          expect(a.pos.u).toBeGreaterThanOrEqual(0);
          expect(a.pos.v).toBeGreaterThanOrEqual(0);
          expect(a.pos.u).toBeLessThanOrEqual(W3D_ROOM.W);
          expect(a.pos.v).toBeLessThanOrEqual(W3D_ROOM.D);
        }
      });
      expect(sim.agents.length, p).toBe(9);
    }
  });

  it("the working role reaches its station and performs its act", () => {
    const worker: Array<[W3DPhase, string]> = [
      ["intake", "tiep-nhan-3d"], ["art", "art-director"], ["plan", "detail-planner"], ["model", "cad-modeler"], ["material", "material-artist"],
      ["render", "render-director"], ["review", "visual-reviewer"], ["optimize", "ar-optimizer"], ["present", "render-presenter"],
    ];
    for (const [p, id] of worker) {
      const sim = createW3DSim(mulberry32(3), labels, "idle");
      directW3D(sim, p);
      const acts = new Set<string>();
      run(sim, 60, (s) => acts.add(agent(s, id).act));
      expect(acts.has(W3D_JOBS[id as keyof typeof W3D_JOBS].act), `${p}: ${[...acts].join(",")}`).toBe(true);
    }
  });

  it("the CAD modeler sits at the drafting desk to draw", () => {
    const sim = createW3DSim(mulberry32(1), labels, "idle");
    directW3D(sim, "model");
    let near = Infinity;
    const st = W3D_STATIONS.drafting.spot;
    run(sim, 30, (s) => { const a = agent(s, "cad-modeler"); if (a.act === "typing" && a.pose === "sit") near = Math.min(near, Math.hypot(a.pos.u - st.u, a.pos.v - st.v)); });
    expect(near).toBeLessThan(0.2);
  });

  it("the reviewer marks issues on the wall board when there are issues", () => {
    const sim = createW3DSim(mulberry32(5), labels, "idle", 3);
    directW3D(sim, "review", 3);
    const acts = new Set<string>();
    run(sim, 80, (s) => acts.add(agent(s, "visual-reviewer").act));
    expect(acts.has("write")).toBe(true);
    expect(acts.has("inspect")).toBe(true);
  });

  it("everyone claps on done", () => {
    const sim = createW3DSim(mulberry32(2), labels, "idle");
    directW3D(sim, "done");
    run(sim, 40);
    const clapping = sim.agents.filter((a) => a.act === "clap" || a.act === "walking");
    expect(clapping.length).toBeGreaterThanOrEqual(7);
    expect(sim.agents.some((a) => a.act === "clap")).toBe(true);
  });

  it("rest: some sit on the sofa, some fetch coffee, nobody works", () => {
    const sim = createW3DSim(mulberry32(11), labels, "idle");
    directW3D(sim, "rest");
    const acts = new Set<string>();
    run(sim, 120, (s) => s.agents.forEach((a) => acts.add(a.act)));
    expect(acts.has("resting") || acts.has("drinking")).toBe(true);
    for (const w of ["typing", "shoot", "compare", "inspect", "present"]) expect(acts.has(w), w).toBe(false);
  });

  it("is deterministic for the same seed", () => {
    const snap = (seed: number) => {
      const sim = createW3DSim(mulberry32(seed), labels, "idle");
      directW3D(sim, "render");
      run(sim, 30);
      return JSON.stringify(sim.agents.map((a) => [a.id, a.act, +a.pos.u.toFixed(3), +a.pos.v.toFixed(3)]));
    };
    expect(snap(9)).toBe(snap(9));
  });

  it("switching phases mid-way re-plans the new worker", () => {
    const sim = createW3DSim(mulberry32(4), labels, "idle");
    directW3D(sim, "model");
    run(sim, 20);
    directW3D(sim, "render");
    const acts = new Set<string>();
    run(sim, 40, (s) => acts.add(agent(s, "render-director").act));
    expect(acts.has("shoot")).toBe(true);
  });

  it("formats the clock", () => {
    expect(w3dClockText(75)).toBe("01:15");
    expect(w3dClockText(-4)).toBe("00:00");
  });
});
