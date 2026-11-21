// Pure logic of the AI-training gym (no React, no DOM, no timers): which exercise the skill performs and which
// trainers speak, derived from the training state. Used by components/GymRoom.tsx.
import type { Look } from "../components/office/IsoPerson";
import type { GymExercise } from "./gym-layout";
export type { GymExercise } from "./gym-layout";

/** What the gym shows. */
export type GymPhase = "idle" | "interview" | "compose" | "trial" | "grade" | "await_human" | "samples" | "passed" | "rest";

/** Trainer roles of skill training (src/core/skill-workshop/role-output.ts ROLE_NAMES), in room order. */
export const GYM_TRAINER_IDS = ["phong-van", "phan-tich-mau", "soan-skill", "chay-thu", "cham-diem", "phan-bien"] as const;
/** Gym people are drawn 10% smaller than IsoPerson's native size. */
export const GYM_PERSON_SCALE = 0.9;
export type GymTrainerId =(typeof GYM_TRAINER_IDS)[number];

/** Distinct sports look per trainer (the sprite falls back to one grey look for unknown roles). */
export const GYM_TRAINER_LOOKS: Record<GymTrainerId, Look> = {
  "phong-van": { tie: "#ffc542", hairStyle: 1, hair: "#2b1d14", skin: "#f3cdb0", suit: "#8b5cf6", headgear: "headset" },
  "phan-tich-mau": { tie: "#2ed47a", hairStyle: 3, hair: "#111", skin: "#d9a983", suit: "#2f9e6f", headgear: "glasses" },
  "soan-skill": { tie: "#ff9f43", hairStyle: 0, hair: "#5a2a1a", skin: "#e8b894", suit: "#e0662b" },
  "chay-thu": { tie: "#5aa0ff", hairStyle: 2, hair: "#3a2416", skin: "#f3cdb0", suit: "#2f6fed", headgear: "cap" },
  "cham-diem": { tie: "#ff5c5c", hairStyle: 1, hair: "#111", skin: "#d9a983", suit: "#c0392b", neckwear: "badge" },
  "phan-bien": { tie: "#d9b26a", hairStyle: 2, hair: "#6b4a2a", skin: "#e8b894", suit: "#6b5b3a", headgear: "hardhat" },
};

/** The skill being trained wears a bright tracksuit. */
export const GYM_SKILL_LOOK: Look = { tie: "#ffffff", hairStyle: 0, hair: "#2b1d14", skin: "#f3cdb0", suit: "#14b8a6", headgear: "cap" };

const PASSED = ["passed", "awaiting_approval", "completed"];
const RESTING = ["stopped", "stalled", "failed_max_rounds", "cost_cap", "exhausted", "paused"];

/** Map a training state (skill workshop or generative session vocabulary) to a gym phase. Unknown states are "idle". */
export function gymPhase(state: string | null | undefined, paused = false): GymPhase {
  const s = state ?? "";
  if (paused || RESTING.includes(s)) return "rest";
  if (PASSED.includes(s)) return "passed";
  switch (s) {
    case "awaiting_user": return "interview";
    case "composing": return "compose";
    case "trial": return "trial";
    case "grading": return "grade";
    case "awaiting_score": return "await_human";
    case "generating": return "samples";
    default: return "idle";
  }
}

export interface GymScene {
  exercise: GymExercise;
  /** IsoPerson act of the skill character (used by the static summary; the live room runs office/gym-scene.ts). */
  skillAct: "idle" | "walking" | "stretch" | "talking" | "happy" | "resting";
  /** Trainers that speak (act "talking"); the others stand and watch (all cheer when the skill passed). */
  speaking: GymTrainerId[];
  cheering: boolean;
}

const SCENES: Record<GymPhase, GymScene> = {
  idle: { exercise: "mat", skillAct: "stretch", speaking: [], cheering: false },
  interview: { exercise: "mat", skillAct: "idle", speaking: ["phong-van"], cheering: false },
  compose: { exercise: "dumbbell", skillAct: "walking", speaking: ["phan-tich-mau", "soan-skill"], cheering: false },
  samples: { exercise: "treadmill", skillAct: "walking", speaking: ["soan-skill", "chay-thu"], cheering: false },
  trial: { exercise: "bench", skillAct: "stretch", speaking: ["chay-thu"], cheering: false },
  grade: { exercise: "bag", skillAct: "talking", speaking: ["cham-diem", "phan-bien"], cheering: false },
  await_human: { exercise: "mat", skillAct: "idle", speaking: [], cheering: false },
  passed: { exercise: "mat", skillAct: "happy", speaking: [], cheering: true },
  rest: { exercise: "mat", skillAct: "resting", speaking: [], cheering: false },
};

/** Exercises a working phase can use, in order; the round number picks one (the discipline changes between rounds). */
const PHASE_EXERCISES: Record<GymPhase, GymExercise[]> = {
  idle: ["mat"],
  interview: ["mat"],
  compose: ["dumbbell", "cable"],
  samples: ["treadmill", "bike"],
  trial: ["bench", "pullup"],
  grade: ["bag"],
  await_human: ["mat"],
  passed: ["mat"],
  rest: ["mat"],
};

/** Discipline of the skill for a phase and round (pure; compose = dumbbells/cable, samples = run/bike, trial = bench/pull-ups, grade = bag). */
export function gymExercise(phase: GymPhase, round = 0): GymExercise {
  const list = PHASE_EXERCISES[phase];
  const i = Math.abs(Math.floor(Number.isFinite(round) ? round : 0)) % list.length;
  return list[i] ?? list[0]!;
}

export function gymScene(phase: GymPhase, round = 0): GymScene {
  return { ...SCENES[phase], exercise: gymExercise(phase, round) };
}

/** What the skill (and the idle trainers) do in their free time, by phase. Pure; the scene picks one with its rng. */
export type GymFreeChoice = "stretch" | "drink" | "wipe" | "phone" | "sit" | "chat" | "wander" | "board" | "watch" | "cheer" | "listen";
export function gymFreeChoices(phase: GymPhase, trainer: boolean): GymFreeChoice[] {
  if (trainer) {
    if (phase === "passed") return ["cheer"];
    // Waiting for the human grader: the trainers stay quiet (no chatter, nobody "grades").
    if (phase === "await_human") return ["watch", "board", "drink", "phone", "sit", "wander", "wipe"];
    return gymBusy(phase)
      ? ["watch", "board", "drink", "chat", "wipe", "phone", "wander", "sit"]
      : ["watch", "board", "drink", "chat", "phone", "sit", "wander", "wipe"];
  }
  switch (phase) {
    case "idle": return ["stretch", "stretch", "drink", "wipe", "wander"];
    case "interview": return ["listen", "listen", "phone", "drink", "wipe"];
    case "rest": return ["sit", "sit", "drink", "phone", "wipe", "stretch"];
    case "passed": return ["cheer", "cheer", "stretch", "drink"];
    default: return ["wipe", "drink"];
  }
}

/** Share of the pass mark reached by the best score, 0–100 (no score = 0). Pure. */
export function scorePercent(best: number | null | undefined): number {
  if (typeof best !== "number" || !Number.isFinite(best)) return 0;
  return Math.max(0, Math.min(100, Math.round(best)));
}

/** True when the skill is working out right now (drives the animated progress strip). */
export function gymBusy(phase: GymPhase): boolean {
  return phase === "compose" || phase === "trial" || phase === "grade" || phase === "samples";
}
