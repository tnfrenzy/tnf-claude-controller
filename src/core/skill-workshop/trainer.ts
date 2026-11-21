// Pure state machine for the skill training loop (compose -> trial -> grade).
// No I/O, no clock, no randomness.

export type TrainerState =
  | "idle"
  | "composing"
  | "trial"
  | "grading"
  | "passed"
  | "awaiting_approval"
  | "awaiting_score"
  | "failed_max_rounds"
  | "stalled"
  | "cost_cap"
  | "stopped";

export interface TrainerConfig {
  passScore: number;
  maxRounds: number;
  costCapUsd: number;
}

export const DEFAULT_TRAINER_CONFIG: Readonly<TrainerConfig> = Object.freeze({
  passScore: 90,
  maxRounds: 5,
  costCapUsd: 3,
});

export interface RoundSummary {
  n: number;
  score: number;
  costUsd: number;
}

export interface TrainerSnapshot {
  state: TrainerState;
  round: number;
  rounds: RoundSummary[];
  totalCostUsd: number;
  bestScore: number | null;
  bestRound: number | null;
  config: TrainerConfig;
  paused: boolean;
  /** ISO time supplied by the caller (keeps this module pure). */
  approvedAt?: string;
}

function validNumber(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v) && v > 0;
}

/** Merge overrides over defaults; invalid values and unknown keys are ignored. */
export function resolveConfig(overrides?: Record<string, unknown> | null): TrainerConfig {
  const cfg: TrainerConfig = { ...DEFAULT_TRAINER_CONFIG };
  if (!overrides || typeof overrides !== "object") return cfg;
  if (validNumber(overrides.passScore)) cfg.passScore = overrides.passScore;
  if (validNumber(overrides.maxRounds)) cfg.maxRounds = Math.floor(overrides.maxRounds) || cfg.maxRounds;
  if (validNumber(overrides.costCapUsd)) cfg.costCapUsd = overrides.costCapUsd;
  return cfg;
}

export function initialSnapshot(overrides?: Record<string, unknown> | null): TrainerSnapshot {
  return {
    state: "composing",
    round: 1,
    rounds: [],
    totalCostUsd: 0,
    bestScore: null,
    bestRound: null,
    config: resolveConfig(overrides),
    paused: false,
  };
}

function isStalled(scores: number[]): boolean {
  const n = scores.length;
  if (n < 3) return false;
  const prior = Math.max(...scores.slice(0, n - 2));
  const last = scores[n - 1] as number;
  const before = scores[n - 2] as number;
  return last <= prior && before <= prior;
}

/** Apply the result of grading the current round. Order: pass, stalled, max rounds, next round. */
export function afterGrading(snap: TrainerSnapshot, roundScore: number, roundCostUsd = 0): TrainerSnapshot {
  const entry: RoundSummary = { n: snap.round, score: roundScore, costUsd: roundCostUsd };
  const rounds = [...snap.rounds, entry];
  let bestScore = snap.bestScore;
  let bestRound = snap.bestRound;
  if (bestScore === null || roundScore > bestScore) {
    bestScore = roundScore;
    bestRound = snap.round;
  }
  const base: TrainerSnapshot = {
    ...snap,
    rounds,
    totalCostUsd: snap.totalCostUsd + roundCostUsd,
    bestScore,
    bestRound,
    config: { ...snap.config },
  };
  if (roundScore >= snap.config.passScore) return { ...base, state: "awaiting_approval" };
  if (isStalled(rounds.map((r) => r.score))) return { ...base, state: "stalled" };
  if (snap.round >= snap.config.maxRounds) return { ...base, state: "failed_max_rounds" };
  return { ...base, state: "composing", round: snap.round + 1 };
}

const RUNNING_STATES: readonly TrainerState[] = ["composing", "trial", "grading"];
const RESUMABLE_STATES: readonly TrainerState[] = ["stalled", "failed_max_rounds", "cost_cap", "stopped"];

export function isRunning(state: TrainerState): boolean {
  return RUNNING_STATES.includes(state);
}

/** Set the pause flag; the runner stops before the next step. State is unchanged. */
export function requestPause(snap: TrainerSnapshot): TrainerSnapshot {
  if (!isRunning(snap.state)) return snap;
  return { ...snap, paused: true };
}

/** Resume from a paused run (clear flag) or from a terminal stop state (back to composing). */
export function resume(snap: TrainerSnapshot, overrides?: Record<string, unknown> | null): TrainerSnapshot {
  if (RESUMABLE_STATES.includes(snap.state)) {
    const raised = resolveConfig(overrides);
    const config: TrainerConfig = { ...snap.config };
    if (overrides) {
      if (overrides.passScore !== undefined) config.passScore = raised.passScore;
      if (overrides.maxRounds !== undefined) config.maxRounds = raised.maxRounds;
      if (overrides.costCapUsd !== undefined) config.costCapUsd = raised.costCapUsd;
    }
    return { ...snap, state: "composing", round: snap.rounds.length + 1, config, paused: false };
  }
  if (snap.paused) return { ...snap, paused: false };
  return snap;
}

/** Stop a running or waiting snapshot. An approved snapshot is left alone. */
export function stop(snap: TrainerSnapshot): TrainerSnapshot {
  if (snap.approvedAt) return snap;
  const stoppable = isRunning(snap.state) || snap.state === "idle" || snap.state === "passed" || snap.state === "awaiting_approval" || snap.state === "awaiting_score";
  if (!stoppable) return snap;
  return { ...snap, state: "stopped", paused: false };
}

export class TrainerError extends Error {
  constructor(public code: "not_awaiting_approval" | "not_awaiting_score" | "invalid_grade", message: string) {
    super(message);
    this.name = "TrainerError";
  }
}

/**
 * Apply a grade given by the human after a round's outputs were written to files. 100 goes to approval, anything lower
 * starts the next round (maxRounds is only a reminder here; no stall or pass-score rule applies).
 */
export function applyHumanGrade(snap: TrainerSnapshot, grade: { score: number; feedback: string }, roundCostUsd = 0): TrainerSnapshot {
  if (snap.state !== "awaiting_score") throw new TrainerError("not_awaiting_score", "Vòng hiện tại chưa có đầu ra chờ chấm.");
  const score = grade.score;
  if (typeof score !== "number" || !Number.isInteger(score) || score < 0 || score > 100) {
    throw new TrainerError("invalid_grade", "Điểm phải là số nguyên từ 0 đến 100.");
  }
  const feedback = (typeof grade.feedback === "string" ? grade.feedback : "").trim().slice(0, 2000);
  if (score < 100 && feedback === "") {
    throw new TrainerError("invalid_grade", "Cần nhận xét khi điểm dưới 100 để làm đầu vào cho vòng sau.");
  }
  const rounds = [...snap.rounds, { n: snap.round, score, costUsd: roundCostUsd }];
  let bestScore = snap.bestScore;
  let bestRound = snap.bestRound;
  if (bestScore === null || score > bestScore) {
    bestScore = score;
    bestRound = snap.round;
  }
  const base: TrainerSnapshot = { ...snap, rounds, totalCostUsd: snap.totalCostUsd + roundCostUsd, bestScore, bestRound, config: { ...snap.config } };
  if (score === 100) return { ...base, state: "awaiting_approval" };
  return { ...base, state: "composing", round: snap.round + 1 };
}

/** The user's final approval. Only valid in awaiting_approval; never automatic. */
export function approve(snap: TrainerSnapshot, nowIso: string): TrainerSnapshot {
  if (snap.state !== "awaiting_approval") {
    throw new TrainerError("not_awaiting_approval", "Chưa thể duyệt: skill chưa ở trạng thái chờ duyệt.");
  }
  return { ...snap, approvedAt: nowIso };
}

/** Before each step: stop when the estimated total cost reached the cap. */
export function checkCostCap(snap: TrainerSnapshot): TrainerSnapshot {
  if (snap.totalCostUsd >= snap.config.costCapUsd) return { ...snap, state: "cost_cap" };
  return snap;
}
