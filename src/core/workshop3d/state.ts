// src/core/workshop3d/state.ts
// Pure state machine of the 3D workshop session: no I/O, no clock. Every function returns a new snapshot.
import type { W3DHqMode, W3DIssue, W3DReviewMode, W3DScores, W3DSnapshot, W3DState } from "./types.js";

export class W3DError extends Error {}

export const MAX_STEP_FAILURES = 3;
export const DEFAULT_MAX_FIX_ROUNDS = 6;
export const MAX_BUILD_RETRIES = 4;
/** Fix rounds in a row without a better review total before the loop stops and the best version is used (0 = never). */
export const DEFAULT_MAX_NO_IMPROVE = 1;
/**
 * Automatic resumes after a step failed MAX_STEP_FAILURES times in a row because the role was interrupted
 * (timeout, subagent_interrupted, temporary infrastructure error): delay before each resume, in order; then failed for good.
 */
export const AUTO_RESUME_DELAYS_MS: readonly number[] = [30_000, 120_000, 300_000, 600_000, 900_000];
export const MAX_AUTO_RESUMES = AUTO_RESUME_DELAYS_MS.length;

/** Linear order of working states. */
export const PIPELINE: readonly W3DState[] = [
  "intake", "art", "planning", "modeling", "building", "materials", "rendering", "reviewing", "optimizing", "presenting", "done",
];

/** Blender high-quality states (two-phase review); outside PIPELINE, their transitions are explicit below. */
export const HQ_STATES: readonly W3DState[] = ["hqrender", "hqreview", "hqmaterials"];
/** Default and ceiling of the targeted fix rounds after the final review (workshop3d.blender.finalFixRounds). */
export const DEFAULT_HQ_FIX_ROUNDS = 0;
export const MAX_HQ_FIX_ROUNDS = 3;

const NOT_RUNNING: readonly W3DState[] = ["awaiting_user", "paused", "stopped", "failed", "done"];
export function isRunning(state: W3DState): boolean {
  return !NOT_RUNNING.includes(state);
}

export interface W3DLoopLimits {
  maxFixRounds?: number;
  maxNoImprove?: number;
  maxAutoResumes?: number;
  /** Blender mode of new sessions (only when Blender was found at creation); missing = off. */
  hqMode?: W3DHqMode;
  maxHqFixRounds?: number;
}

const clampInt = (v: number | undefined, lo: number, hi: number, dflt: number): number =>
  typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.floor(v))) : dflt;

export function initialSnapshot(limits: number | W3DLoopLimits = {}): W3DSnapshot {
  const l: W3DLoopLimits = typeof limits === "number" ? { maxFixRounds: limits } : limits;
  return {
    state: "intake", resumeState: null, round: 0, fixRounds: 0, maxFixRounds: clampInt(l.maxFixRounds, 0, 50, DEFAULT_MAX_FIX_ROUNDS),
    buildRetries: 0, stepFailures: 0, costUsd: 0, error: null, note: null, waitUntil: null, questions: [], issues: [],
    waitReason: null, autoResumes: 0, bestScore: null, bestRound: null, noImprove: 0,
    maxNoImprove: clampInt(l.maxNoImprove, 0, 50, DEFAULT_MAX_NO_IMPROVE),
    maxAutoResumes: clampInt(l.maxAutoResumes, 0, MAX_AUTO_RESUMES, MAX_AUTO_RESUMES),
    ...(l.hqMode && l.hqMode !== "off"
      ? { hqMode: l.hqMode, hqFixRounds: 0, maxHqFixRounds: clampInt(l.maxHqFixRounds, 0, MAX_HQ_FIX_ROUNDS, DEFAULT_HQ_FIX_ROUNDS), hqRedo: null, backlog: [] }
      : {}),
  };
}

function nextOf(state: W3DState): W3DState {
  if (state === "hqmaterials") return "hqrender";
  if (state === "hqrender") return "hqreview";
  const i = PIPELINE.indexOf(state);
  if (i < 0 || i >= PIPELINE.length - 1) throw new W3DError(`Trạng thái "${state}" không có bước kế tiếp.`);
  return PIPELINE[i + 1]!;
}

function addCost(s: W3DSnapshot, cost: number): number {
  return s.costUsd + (Number.isFinite(cost) && cost > 0 ? cost : 0);
}

export function afterIntake(s: W3DSnapshot, r: { done: boolean; questions: string[] }, cost: number): W3DSnapshot {
  if (s.state !== "intake") throw new W3DError("Chỉ vai tiếp nhận mới trả lời ở bước tiếp nhận.");
  const base = { ...s, costUsd: addCost(s, cost), stepFailures: 0, autoResumes: 0 };
  return r.done ? { ...base, state: "art", questions: [] } : { ...base, state: "awaiting_user", questions: r.questions };
}

export function answered(s: W3DSnapshot): W3DSnapshot {
  if (s.state !== "awaiting_user") throw new W3DError("Phiên không đang chờ câu trả lời.");
  return { ...s, state: "intake", questions: [] };
}

/** Review issues the material step still has to handle (a mixed review goes through modeling first). */
export const nonGeometry = (issues: W3DIssue[]): W3DIssue[] => issues.filter((i) => i.target !== "geometry");

/** Success of a plain step (art, planning, modeling, materials, rendering, optimizing, presenting). */
export function afterStepOk(s: W3DSnapshot, cost: number): W3DSnapshot {
  // modeling handled the geometry issues; material/render ones stay for the material step, which clears them.
  const issues = s.state === "modeling" ? nonGeometry(s.issues) : s.state === "materials" || s.state === "hqmaterials" ? [] : s.issues;
  return { ...s, state: nextOf(s.state), costUsd: addCost(s, cost), stepFailures: 0, autoResumes: 0, issues };
}

/** Result of the controller-run build step (a model failure; environment failures never reach this). */
export function afterBuild(s: W3DSnapshot, r: { ok: boolean; error?: string }): W3DSnapshot {
  if (s.state !== "building") throw new W3DError("Không ở bước dựng.");
  if (r.ok) return { ...s, state: "materials", buildRetries: 0, stepFailures: 0, issues: nonGeometry(s.issues) };
  const retries = s.buildRetries + 1;
  const text = r.error ?? "Script lỗi.";
  if (retries >= MAX_BUILD_RETRIES) {
    return { ...s, state: "failed", resumeState: "modeling", buildRetries: retries, error: `Script không dựng được sau ${retries} lần sửa: ${text}` };
  }
  return { ...s, state: "modeling", buildRetries: retries, issues: [...nonGeometry(s.issues), { target: "geometry", text }] };
}

export type W3DReviewScores = W3DScores;

/** How visual-reviewer judges this review: phase 1 of a two-phase session looks at geometry only (fast renders). */
export function reviewModeOf(s: W3DSnapshot): W3DReviewMode {
  if (s.state === "hqreview") return "final";
  return s.hqMode === "final" ? "geometry" : "full";
}

/** Review total used to compare rounds; likeness counts only when the reviewer gave it (reference images). */
export function reviewTotal(scores: W3DReviewScores): number {
  return scores.beauty + scores.detail + scores.proportion + (typeof scores.likeness === "number" ? scores.likeness : 0);
}

/**
 * Review result. With scores it tracks the best total (bestScore/bestRound) and stops the fix loop early after
 * maxNoImprove reviews in a row that did not beat it. When the loop ends on a round worse than the best one,
 * `shouldUseBest` tells the runner to restore the saved best version.
 */
export function afterReview(s: W3DSnapshot, r: { ok: boolean; issues: W3DIssue[]; scores?: W3DReviewScores }, cost: number): W3DSnapshot {
  if (s.state !== "reviewing") throw new W3DError("Không ở bước rà soát.");
  if (s.hqMode === "final") {
    // Phase 1: the fast renderer's mirrors, light and textures are not judged; only geometry issues loop.
    const geo = r.issues.filter((i) => i.target === "geometry");
    r = { ...r, issues: geo, ok: r.ok || geo.length === 0 };
  }
  // A two-phase session leaves the geometry loop for the Blender render instead of optimizing.
  const exit: W3DState = s.hqMode === "final" ? "hqrender" : "optimizing";
  const leave = exit === "hqrender" ? { hqRedo: null } : {};
  let base: W3DSnapshot = { ...s, costUsd: addCost(s, cost), stepFailures: 0, autoResumes: 0 };
  if (r.scores) {
    const total = reviewTotal(r.scores);
    const best = typeof s.bestScore === "number" ? s.bestScore : null;
    base = best === null || total > best
      ? { ...base, bestScore: total, bestRound: s.round, noImprove: 0 }
      : { ...base, noImprove: (s.noImprove ?? 0) + 1 };
  }
  if (r.ok) return { ...base, state: exit, issues: [], ...leave };
  const limit = s.maxNoImprove ?? DEFAULT_MAX_NO_IMPROVE;
  if (r.scores && limit > 0 && (base.noImprove ?? 0) >= limit) {
    return {
      ...base, state: exit, issues: [], ...leave,
      note: `Dừng sửa sớm: ${limit} vòng liên tiếp không tăng tổng điểm (tốt nhất ${base.bestScore} ở vòng ${base.bestRound}, vòng này ${reviewTotal(r.scores)}); dùng bản tốt nhất.`,
    };
  }
  if (s.fixRounds >= s.maxFixRounds) {
    return { ...base, state: exit, issues: [], ...leave, note: `Đã đạt số vòng sửa tối đa (${s.maxFixRounds}); dùng bản tốt nhất hiện có.` };
  }
  const toMaterial = r.issues.length > 0 && r.issues.every((i) => i.target === "material" || i.target === "render");
  return { ...base, state: toMaterial ? "materials" : "modeling", fixRounds: s.fixRounds + 1, round: s.round + 1, issues: r.issues };
}

/** True when the fix loop ended on a round worse than the best one (the runner then restores the saved best files). */
export function shouldUseBest(s: W3DSnapshot): boolean {
  return typeof s.bestRound === "number" && s.bestRound !== s.round;
}

/** Blender render finished: images go to the final review; none (no Blender, every view failed) skips it, never fails. */
export function afterHqRender(s: W3DSnapshot, r: { images: number; note?: string | null }): W3DSnapshot {
  if (s.state !== "hqrender") throw new W3DError("Không ở bước render chất lượng cao.");
  const base: W3DSnapshot = { ...s, stepFailures: 0, autoResumes: 0, hqRedo: null };
  const note = r.note ? (s.note ? `${s.note}\n${r.note}` : r.note) : s.note;
  if (r.images > 0) return { ...base, state: "hqreview", note };
  return { ...base, state: "optimizing", issues: [], note: note ?? "Không có ảnh chất lượng cao: bỏ qua bước duyệt lần cuối." };
}

/** Default views rendered again when no issue says (or lets us guess) where its defect shows: never the whole set. */
export const HQ_REDO_DEFAULT = ["overview", "door"] as const;

/** Keyword (accent-free, lower case) -> high-quality views showing that place. The first match order is kept. */
const VIEW_HINTS: readonly [RegExp, readonly string[]][] = [
  [/\b(san|floor|ton nham|caro|gan chong truot)\b/, ["floor", "door"]],
  [/\b(tran|ceiling|den am tran|downlight)\b/, ["ceiling"]],
  [/\b(vach (hong )?trai|left wall|wall_left|ben trai)\b/, ["wall_left"]],
  [/\b(vach (hong )?phai|right wall|wall_right|ben phai)\b/, ["wall_right"]],
  [/\b(vach hau|back wall|wall_back)\b/, ["overview"]],
  [/\b(bumper|thanh chan|thanh bao ve)\b/, ["wall_left", "wall_right"]],
  [/\b(cop|bang dieu khien|nut bam|man hinh|man led)\b/, ["cop"]],
  [/\b(cua|door|canh cua|nguong)\b/, ["door"]],
  [/\b(tong the|toan canh|overview|toan bo)\b/, ["overview"]],
];

function plainText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();
}

/** Views a final-review issue points at: its own `views`, else views guessed from its text, else none. */
export function issueViews(i: W3DIssue): string[] {
  if (Array.isArray(i.views) && i.views.length > 0) return [...i.views];
  const t = plainText(i.text);
  return VIEW_HINTS.flatMap(([re, views]) => (re.test(t) ? [...views] : []));
}

/**
 * Views to render again after the final material fix: the union of the issues' named or guessed views. Only when no
 * issue can be placed at all do the two default views go again (a whole Blender set is ~12 minutes on this machine).
 */
export function hqRedoFor(issues: readonly W3DIssue[]): string[] {
  const views = [...new Set(issues.flatMap(issueViews))];
  return views.length > 0 ? views : [...HQ_REDO_DEFAULT];
}

/**
 * Final review on the Blender images. Approved -> optimizing. Otherwise, while final fix rounds are left, material /
 * render issues go to hqmaterials (material-artist only, then only the named views are rendered again); geometry issues
 * go back to modeling only when maxHqFixRounds >= 2, else they are kept in `backlog` for the report.
 */
export function afterFinalReview(s: W3DSnapshot, r: { ok: boolean; issues: W3DIssue[]; scores?: W3DReviewScores }, cost: number): W3DSnapshot {
  if (s.state !== "hqreview") throw new W3DError("Không ở bước duyệt lần cuối.");
  const used = s.hqFixRounds ?? 0;
  let base: W3DSnapshot = { ...s, costUsd: addCost(s, cost), stepFailures: 0, autoResumes: 0, finalScores: r.scores ?? null };
  if (r.scores) {
    const total = reviewTotal(r.scores);
    const best = typeof s.bestFinalScore === "number" ? s.bestFinalScore : null;
    if (best === null || total > best) base = { ...base, bestFinalScore: total, bestFinalRound: used };
  }
  if (r.ok) return { ...base, state: "optimizing", issues: [], backlog: [] };
  const geo = r.issues.filter((i) => i.target === "geometry");
  const mat = nonGeometry(r.issues);
  const max = s.maxHqFixRounds ?? DEFAULT_HQ_FIX_ROUNDS;
  if (used < max) {
    if (geo.length > 0 && max >= 2) {
      return { ...base, state: "modeling", issues: r.issues, hqFixRounds: used + 1, round: s.round + 1, backlog: [], hqRedo: null };
    }
    if (mat.length > 0) {
      const redo = hqRedoFor(mat);
      return { ...base, state: "hqmaterials", issues: mat, hqFixRounds: used + 1, round: s.round + 1, backlog: geo, hqRedo: redo };
    }
  }
  const why = used >= max ? `hết ${max} lượt sửa lần cuối` : "chỉ còn lỗi hình học, không quay lại vòng CAD";
  return {
    ...base, state: "optimizing", issues: [], backlog: r.issues,
    note: `${s.note ? `${s.note}\n` : ""}Duyệt lần cuối chưa đạt (${why}); ${r.issues.length} lỗi còn tồn đọng ghi trong báo cáo, dùng bản tốt nhất.`,
  };
}

/** The final loop ended on a version worse than the best final one (the runner restores best-final/). */
export function shouldUseBestFinal(s: W3DSnapshot): boolean {
  return typeof s.bestFinalRound === "number" && s.bestFinalRound !== (s.hqFixRounds ?? 0);
}

/**
 * A step failed. After MAX_STEP_FAILURES in a row the session fails, unless the failure is transient (interruption,
 * temporary infrastructure error) and automatic resumes are left: then it waits AUTO_RESUME_DELAYS_MS[n] in
 * waiting_quota (waitReason "retry") and resumes by itself. `now` is the caller's clock (this module has none).
 */
export function afterStepFailed(s: W3DSnapshot, message: string, opts: { transient?: boolean; now?: number } = {}): W3DSnapshot {
  const n = s.stepFailures + 1;
  if (n < MAX_STEP_FAILURES) return { ...s, stepFailures: n };
  const used = s.autoResumes ?? 0;
  const max = Math.min(s.maxAutoResumes ?? MAX_AUTO_RESUMES, MAX_AUTO_RESUMES);
  if (opts.transient && typeof opts.now === "number" && Number.isFinite(opts.now) && used < max) {
    const delay = AUTO_RESUME_DELAYS_MS[used]!;
    const when = delay >= 60_000 ? `${Math.round(delay / 60_000)} phút` : `${Math.round(delay / 1000)} giây`;
    return {
      ...s, state: "waiting_quota", waitReason: "retry", resumeState: s.state, stepFailures: n, waitUntil: opts.now + delay, autoResumes: used + 1,
      note: `Vai bị ngắt ${n} lần liên tiếp ở bước "${s.state}": tự tiếp tục sau ${when} (lần ${used + 1}/${max}). Lỗi: ${message.slice(0, 300)}`,
    };
  }
  const tail = opts.transient && used > 0 ? ` (đã tự tiếp tục ${used} lần, hết lượt tự tiếp tục)` : "";
  return { ...s, state: "failed", resumeState: s.state, stepFailures: n, error: `${message}${tail}` };
}

export function pause(s: W3DSnapshot): W3DSnapshot {
  if (!isRunning(s.state)) throw new W3DError("Chỉ tạm dừng được phiên đang chạy.");
  return { ...s, state: "paused", resumeState: s.state === "waiting_quota" ? s.resumeState : s.state, waitUntil: null, waitReason: null };
}

export function stop(s: W3DSnapshot): W3DSnapshot {
  if (s.state === "done" || s.state === "stopped") throw new W3DError("Phiên đã kết thúc.");
  return { ...s, state: "stopped", resumeState: s.resumeState ?? (isRunning(s.state) ? s.state : null), waitUntil: null, waitReason: null };
}

/** Resume from paused, stopped or failed: back to the state it was in, failure, build and auto-resume counters cleared. */
export function resume(s: W3DSnapshot): W3DSnapshot {
  if (s.state !== "paused" && s.state !== "stopped" && s.state !== "failed") throw new W3DError("Chỉ tiếp tục được phiên đã tạm dừng, đã dừng hoặc bị lỗi.");
  return { ...s, state: s.resumeState ?? "intake", resumeState: null, stepFailures: 0, buildRetries: 0, error: null, waitUntil: null, waitReason: null, autoResumes: 0 };
}

export function waitQuota(s: W3DSnapshot, untilMs: number): W3DSnapshot {
  return { ...s, state: "waiting_quota", resumeState: s.state === "waiting_quota" ? s.resumeState : s.state, waitUntil: untilMs, waitReason: "quota" };
}

/** End of a wait in waiting_quota. An automatic retry starts the step afresh; autoResumes is kept until a step succeeds. */
export function quotaReady(s: W3DSnapshot): W3DSnapshot {
  if (s.state !== "waiting_quota") throw new W3DError("Phiên không đang chờ hạn mức.");
  const retry = s.waitReason === "retry";
  return { ...s, state: s.resumeState ?? "intake", resumeState: null, waitUntil: null, waitReason: null, ...(retry ? { stepFailures: 0 } : {}) };
}
