// Pure logic of the 3D workshop room (no React, no DOM, no timers): which phase a workshop3d session is in, who
// works on it, what the display podium shows and what idle people do. Same layering as office/gym.ts.
// Used by components/Workshop3DRoom.tsx and office/workshop3d-scene.ts.
import type { Look } from "../components/office/IsoPerson";

/** What the room shows. */
export type W3DPhase = "idle" | "intake" | "ask" | "art" | "plan" | "model" | "build" | "material" | "render" | "review" | "optimize" | "present" | "done" | "rest" | "failed";

/** The nine roles of a session (src/core/workshop3d), in room order. */
export const W3D_ROLE_IDS = [
  "tiep-nhan-3d", "art-director", "detail-planner", "cad-modeler", "material-artist", "render-director", "visual-reviewer", "ar-optimizer", "render-presenter",
] as const;
export type W3DRoleId = (typeof W3D_ROLE_IDS)[number];
export const isW3DRole = (id: string): id is W3DRoleId => (W3D_ROLE_IDS as readonly string[]).includes(id);

/** Workshop people are drawn 10% smaller than IsoPerson's native size (like the gym). */
export const W3D_PERSON_SCALE = 0.9;

/** One distinct look per role; accessories follow the spec (headset, beret, glasses, apron, camera, loupe, AR visor, tablet, clipboard). */
export const WORKSHOP3D_LOOKS: Record<W3DRoleId, Look> = {
  "tiep-nhan-3d": { tie: "#ffc542", hairStyle: 1, hair: "#2b1d14", skin: "#f3cdb0", suit: "#8b5cf6", headgear: "headset" },
  "art-director": { tie: "#ff6fa8", hairStyle: 4, hair: "#5a2a1a", skin: "#e8b894", suit: "#d6456f", headgear: "beret" },
  "detail-planner": { tie: "#5aa0ff", hairStyle: 2, hair: "#111", skin: "#d9a983", suit: "#2f6fed", holding: "clipboard" },
  "cad-modeler": { tie: "#2ed47a", hairStyle: 0, hair: "#3a2416", skin: "#f3cdb0", suit: "#2f9e6f", headgear: "glasses" },
  "material-artist": { tie: "#ff9f43", hairStyle: 3, hair: "#6b4a2a", skin: "#e8b894", suit: "#c77b2b", neckwear: "apron" },
  "render-director": { tie: "#e6edf8", hairStyle: 5, hair: "#111", skin: "#d9a983", suit: "#475569", holding: "camera" },
  "visual-reviewer": { tie: "#ff5c5c", hairStyle: 1, hair: "#6b4a2a", skin: "#f3cdb0", suit: "#a83232", holding: "loupe" },
  "ar-optimizer": { tie: "#74e0ff", hairStyle: 2, hair: "#2b1d14", skin: "#e8b894", suit: "#0e8aa6", headgear: "ar" },
  "render-presenter": { tie: "#d9b26a", hairStyle: 0, hair: "#5a2a1a", skin: "#f3cdb0", suit: "#6b5b3a", holding: "tablet" },
};

/** Where a role works (a station id of workshop3d-layout.ts) and the IsoPerson act it performs there. */
export type W3DStationId = "reception" | "moodboard" | "plan" | "drafting" | "shelf" | "studio" | "review" | "printer" | "presenter";
export const W3D_JOBS: Record<W3DRoleId, { station: W3DStationId; act: string }> = {
  "tiep-nhan-3d": { station: "reception", act: "talking" },
  "art-director": { station: "moodboard", act: "write" },
  "detail-planner": { station: "plan", act: "write" },
  "cad-modeler": { station: "drafting", act: "typing" },
  "material-artist": { station: "shelf", act: "compare" },
  "render-director": { station: "studio", act: "shoot" },
  "visual-reviewer": { station: "review", act: "inspect" },
  "ar-optimizer": { station: "printer", act: "point" },
  "render-presenter": { station: "presenter", act: "present" },
};

const PHASES: Record<string, W3DPhase> = {
  intake: "intake", awaiting_user: "ask", art: "art", planning: "plan", modeling: "model", building: "build", materials: "material",
  rendering: "render", reviewing: "review", optimizing: "optimize", presenting: "present", done: "done",
  hqrender: "render", hqreview: "review", hqmaterials: "material",
  paused: "rest", stopped: "rest", waiting_quota: "rest", failed: "failed",
};

/** Map a session state to a room phase. Unknown / empty states are "idle"; `paused` forces rest. */
export function w3dPhase(state: string | null | undefined, paused = false): W3DPhase {
  if (paused) return "rest";
  return PHASES[state ?? ""] ?? "idle";
}

/** Role that works in a phase. */
const WORKER: Partial<Record<W3DPhase, W3DRoleId>> = {
  intake: "tiep-nhan-3d", ask: "tiep-nhan-3d", art: "art-director", plan: "detail-planner", model: "cad-modeler", build: "cad-modeler",
  material: "material-artist", render: "render-director", review: "visual-reviewer", optimize: "ar-optimizer", present: "render-presenter",
};

/** Display podium of the object being built: 0 empty, 1 wireframe, 2 solids, 3 materials, 4 final. */
export type W3DStage = 0 | 1 | 2 | 3 | 4;
export function w3dStage(phase: W3DPhase): W3DStage {
  switch (phase) {
    case "model": return 1;
    case "build": return 2;
    case "material": case "render": case "review": return 3;
    case "optimize": case "present": case "done": return 4;
    default: return 0;
  }
}

export interface W3DScene {
  /** Roles that work at their station. */
  active: W3DRoleId[];
  /** Roles that speak (act talking / bubble). */
  speaking: W3DRoleId[];
  stage: W3DStage;
  cheering: boolean;
  resting: boolean;
}

export function w3dScene(phase: W3DPhase): W3DScene {
  const w = WORKER[phase];
  return {
    active: w ? [w] : [],
    speaking: w ? [w] : [],
    stage: w3dStage(phase),
    cheering: phase === "done",
    resting: phase === "rest",
  };
}

/** True when someone is working right now (the progress strip animates). "ask" waits for the human. */
export function w3dBusy(phase: W3DPhase): boolean {
  return WORKER[phase] !== undefined && phase !== "ask";
}

/** What people do in their free time, by phase. Pure; the scene picks one with its rng. */
export type W3DFreeChoice = "coffee" | "wander" | "sofa" | "chat" | "phone" | "watch" | "cheer" | "stretch";
export function w3dFreeChoices(phase: W3DPhase, _working: boolean): W3DFreeChoice[] {
  switch (phase) {
    case "done": return ["cheer"];
    case "rest": return ["sofa", "sofa", "coffee", "phone", "chat"];
    case "failed": return ["chat", "phone", "wander", "watch", "coffee"];
    case "idle": return ["coffee", "wander", "chat", "sofa", "stretch"];
    case "ask": return ["watch", "coffee", "phone", "sofa", "wander"];
    default: return ["watch", "coffee", "chat", "wander", "phone", "sofa", "stretch"];
  }
}
