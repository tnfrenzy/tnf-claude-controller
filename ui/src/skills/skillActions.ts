import { pick } from "../lib/lang";
// Pure button-state rules for the skill floor popup.
//
// state              stop  resume  trainMore  approve  restoreBest
// idle                -      -       yes        -      hasRounds
// composing/trial/    yes*   paused   -         -      paused && hasRounds
//   grading           (*only when not paused)
// passed              -      -       yes        yes    hasRounds
// awaiting_approval   -      -        -         yes    hasRounds
// failed_max_rounds   -      yes     yes        -      hasRounds
// stalled/cost_cap/   -      yes     yes        -      hasRounds
//   stopped
// awaiting_user       -      -        -         -      -   (openForm = true)
// unknown             nothing dangerous; zip only when hasRounds
// zip: hasRounds or state passed.

export interface SkillActionFlags {
  trainMore: boolean;
  stop: boolean;
  resume: boolean;
  approve: boolean;
  zip: boolean;
  restoreBest: boolean;
  openForm: boolean;
  /** The user grades the round outputs (state awaiting_score): the primary action. */
  grade: boolean;
  /** Delete the skill: locked only while a run is actually active (not paused). */
  delete: boolean;
}

const RUNNING = ["composing", "trial", "grading"];
const RESUMABLE = ["stalled", "failed_max_rounds", "cost_cap", "stopped"];
const TRAINABLE = ["idle", "passed", "failed_max_rounds", "stopped", "stalled", "cost_cap"];
const KNOWN = [...RUNNING, ...RESUMABLE, "idle", "passed", "awaiting_approval", "awaiting_score"];

/** Same rule as the generative flow: integer 0..100, feedback required below 100. Returns a Vietnamese error or null. */
export function validateGrade(score: unknown, feedback: string): string | null {
  const n = typeof score === "string" && score.trim() !== "" ? Number(score) : score;
  if (typeof n !== "number" || !Number.isInteger(n) || n < 0 || n > 100) return pick("Điểm phải là số nguyên từ 0 đến 100.", "The score must be a whole number from 0 to 100.");
  if (n < 100 && feedback.trim() === "") return pick("Cần nhận xét khi điểm dưới 100 để làm đầu vào cho vòng sau.", "Feedback is required when the score is below 100; it feeds the next round.");
  return null;
}

export function skillActions(state: string, paused: boolean, hasRounds: boolean): SkillActionFlags {
  const known = KNOWN.includes(state);
  const running = RUNNING.includes(state) && !paused;
  return {
    grade: state === "awaiting_score",
    trainMore: TRAINABLE.includes(state) && !paused,
    stop: (RUNNING.includes(state) && !paused) || state === "awaiting_score",
    resume: known && (paused || RESUMABLE.includes(state)),
    approve: state === "awaiting_approval" || state === "passed",
    zip: hasRounds || state === "passed",
    restoreBest: known && !running && hasRounds,
    openForm: state === "awaiting_user",
    delete: !running
  };
}
