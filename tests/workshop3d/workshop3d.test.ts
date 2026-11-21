import { describe, expect, it } from "vitest";
import {
  W3D_JOBS, W3D_ROLE_IDS, WORKSHOP3D_LOOKS, w3dBusy, w3dFreeChoices, w3dPhase, w3dScene, w3dStage, type W3DPhase,
} from "../../ui/src/office/workshop3d.js";

const STATES = ["intake", "awaiting_user", "art", "planning", "modeling", "building", "materials", "rendering", "reviewing", "optimizing", "presenting", "done", "paused", "stopped", "failed", "waiting_quota"];

describe("w3dPhase", () => {
  it("maps every session state to a phase", () => {
    const expected: Record<string, W3DPhase> = {
      intake: "intake", awaiting_user: "ask", art: "art", planning: "plan", modeling: "model", building: "build", materials: "material",
      rendering: "render", reviewing: "review", optimizing: "optimize", presenting: "present", done: "done",
      paused: "rest", stopped: "rest", waiting_quota: "rest", failed: "failed",
    };
    for (const s of STATES) expect(w3dPhase(s), s).toBe(expected[s]);
  });
  it("treats unknown, empty and nullish as idle and the paused flag as rest", () => {
    expect(w3dPhase("weird")).toBe("idle");
    expect(w3dPhase("")).toBe("idle");
    expect(w3dPhase(null)).toBe("idle");
    expect(w3dPhase(undefined)).toBe("idle");
    expect(w3dPhase("modeling", true)).toBe("rest");
  });
});

describe("nine characters", () => {
  it("has the nine roles of the spec", () => {
    expect([...W3D_ROLE_IDS]).toEqual(["tiep-nhan-3d", "art-director", "detail-planner", "cad-modeler", "material-artist", "render-director", "visual-reviewer", "ar-optimizer", "render-presenter"]);
  });
  it("gives each a distinct look (suit colour unique, accessories as in the spec)", () => {
    const suits = W3D_ROLE_IDS.map((r) => WORKSHOP3D_LOOKS[r].suit);
    expect(new Set(suits).size).toBe(9);
    expect(WORKSHOP3D_LOOKS["tiep-nhan-3d"].headgear).toBe("headset");
    expect(WORKSHOP3D_LOOKS["art-director"].headgear).toBe("beret");
    expect(WORKSHOP3D_LOOKS["cad-modeler"].headgear).toBe("glasses");
    expect(WORKSHOP3D_LOOKS["material-artist"].neckwear).toBe("apron");
    expect(WORKSHOP3D_LOOKS["render-director"].holding).toBe("camera");
    expect(WORKSHOP3D_LOOKS["visual-reviewer"].holding).toBe("loupe");
    expect(WORKSHOP3D_LOOKS["ar-optimizer"].headgear).toBe("ar");
    expect(WORKSHOP3D_LOOKS["render-presenter"].holding).toBe("tablet");
    expect(WORKSHOP3D_LOOKS["detail-planner"].holding).toBe("clipboard");
  });
  it("every role has a job (station + act)", () => {
    for (const r of W3D_ROLE_IDS) {
      expect(W3D_JOBS[r].station.length).toBeGreaterThan(0);
      expect(W3D_JOBS[r].act.length).toBeGreaterThan(0);
    }
  });
});

describe("w3dScene", () => {
  it("one role works per working phase and it speaks", () => {
    const want: Array<[W3DPhase, string]> = [
      ["intake", "tiep-nhan-3d"], ["ask", "tiep-nhan-3d"], ["art", "art-director"], ["plan", "detail-planner"], ["model", "cad-modeler"],
      ["build", "cad-modeler"], ["material", "material-artist"], ["render", "render-director"], ["review", "visual-reviewer"],
      ["optimize", "ar-optimizer"], ["present", "render-presenter"],
    ];
    for (const [p, r] of want) {
      const sc = w3dScene(p);
      expect(sc.active, p).toEqual([r]);
      expect(sc.speaking, p).toContain(r);
      expect(w3dBusy(p), p).toBe(p !== "ask");
    }
  });
  it("done cheers, rest/idle/failed have nobody working", () => {
    expect(w3dScene("done").cheering).toBe(true);
    expect(w3dScene("done").active).toEqual([]);
    for (const p of ["rest", "idle", "failed"] as W3DPhase[]) {
      expect(w3dScene(p).active).toEqual([]);
      expect(w3dScene(p).cheering).toBe(false);
    }
    expect(w3dScene("rest").resting).toBe(true);
  });
  it("podium stage grows: empty, wireframe, solids, materials, final", () => {
    expect(["intake", "ask", "art", "plan"].map((p) => w3dStage(p as W3DPhase))).toEqual([0, 0, 0, 0]);
    expect(w3dStage("model")).toBe(1);
    expect(w3dStage("build")).toBe(2);
    expect(["material", "render", "review"].map((p) => w3dStage(p as W3DPhase))).toEqual([3, 3, 3]);
    expect(["optimize", "present", "done"].map((p) => w3dStage(p as W3DPhase))).toEqual([4, 4, 4]);
    expect(w3dScene("build").stage).toBe(2);
  });
  it("free choices include coffee for idle roles and clapping on done", () => {
    expect(w3dFreeChoices("model", false)).toContain("coffee");
    expect(w3dFreeChoices("done", false)).toEqual(["cheer"]);
    expect(w3dFreeChoices("rest", false)).toContain("sofa");
    for (const p of ["idle", "intake", "rest", "failed", "done", "review"] as W3DPhase[]) expect(w3dFreeChoices(p, false).length).toBeGreaterThan(0);
  });
});
