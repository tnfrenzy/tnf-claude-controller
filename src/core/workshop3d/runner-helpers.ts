// src/core/workshop3d/runner-helpers.ts — pure helpers of the session runner (no I/O).
import type { Parsed } from "../skill-workshop/round-steps.js";
import type { W3DPromptCtx } from "./prompts.js";
import type { W3DMaterial, W3DPlan } from "./role-output.js";
import { HQ_STATES, isRunning, PIPELINE } from "./state.js";
import { isW3DState, type W3DBrief, type W3DIssue, type W3DSnapshot, type W3DState } from "./types.js";

export const COST_NOTE_PREFIX = "Chi phí ước tính đã vượt";
const MAX_LISTED = 30;

const list = (ids: string[]): string => (ids.length > MAX_LISTED ? `${ids.slice(0, MAX_LISTED).join(", ")}, … (${ids.length} id)` : ids.join(", "));

/**
 * Materials must cover every part id of the plan. Missing ids fail the step (the message goes back to the role);
 * ids the plan does not know are dropped with a note.
 */
export function crossCheckMaterials(plan: W3DPlan, materials: Record<string, W3DMaterial>, modelParts: readonly string[] = []): Parsed<{ materials: Record<string, W3DMaterial>; note?: string }> {
  const ids = plan.parts.map((p) => p.id);
  const missing = ids.filter((id) => !Object.prototype.hasOwnProperty.call(materials, id));
  if (missing.length > 0) return { ok: false, error: `Thiếu vật liệu cho bộ phận: ${list(missing)}. Hãy gán vật liệu cho đủ mọi id trong bảng chi tiết.` };
  // Parts the CAD script added (outputs/parts/*.stl, not in the plan) are optional: kept when given, inherited otherwise.
  const known = new Set([...ids, ...modelParts]);
  const extra = Object.keys(materials).filter((id) => !known.has(id));
  const kept: Record<string, W3DMaterial> = {};
  for (const id of known) if (Object.prototype.hasOwnProperty.call(materials, id)) kept[id] = materials[id]!;
  return extra.length > 0
    ? { ok: true, value: { materials: kept, note: `Bỏ vật liệu của id không có trong bảng chi tiết: ${list(extra)}.` } }
    : { ok: true, value: { materials: kept } };
}

/** States in which the loop has work to do: pipeline steps before done, plus the quota wait. Anything else (unknown included) stops the loop. */
const WORKING: readonly string[] = [...PIPELINE.filter((s) => s !== "done"), ...HQ_STATES, "waiting_quota"];
export const isWorking = (state: unknown): state is W3DState => typeof state === "string" && WORKING.includes(state);

const COUNTERS = ["round", "fixRounds", "maxFixRounds", "buildRetries", "stepFailures", "costUsd"] as const;
/** A snapshot the runner can act on: an object with a known state and finite numeric counters. */
export function isValidSnapshot(s: unknown): s is W3DSnapshot {
  if (!s || typeof s !== "object" || Array.isArray(s)) return false;
  const o = s as Record<string, unknown>;
  return isW3DState(o["state"]) && COUNTERS.every((k) => typeof o[k] === "number" && Number.isFinite(o[k]));
}

export const withCost =(s: W3DSnapshot, cost: number): W3DSnapshot => ({ ...s, costUsd: s.costUsd + (Number.isFinite(cost) && cost > 0 ? cost : 0) });

/** Still at this step: running it, or paused while it ran. */
export const atStep = (s: W3DSnapshot | null | undefined, state: W3DState): boolean => !!s && (s.state === state || (s.state === "paused" && s.resumeState === state));

/**
 * Apply a finished step to the snapshot currently in the store (pause/stop by other callers win):
 * - still at the step: `fn(cur)`;
 * - paused while the step ran: the result is kept and the session stays paused at the next step
 *   (a quota hit keeps it paused at this step; a terminal result such as failed/done is kept as is);
 * - stopped or moved elsewhere: the result is dropped (`applied: false`), only its cost is counted.
 */
export function applyStepResult(cur: W3DSnapshot, state: W3DState, cost: number, fn: (s: W3DSnapshot) => W3DSnapshot): { applied: boolean; next: W3DSnapshot } {
  if (!atStep(cur, state)) return { applied: false, next: cost > 0 ? withCost(cur, cost) : cur };
  if (cur.state === state) return { applied: true, next: fn(cur) };
  const next = fn({ ...cur, state, resumeState: null });
  if (next.state === "waiting_quota") return { applied: true, next: { ...cur, costUsd: next.costUsd } };
  if (isRunning(next.state)) return { applied: true, next: { ...next, state: "paused", resumeState: next.state, waitUntil: null } };
  return { applied: true, next };
}

export interface CtxInput {
  brief: W3DBrief;
  plan?: W3DPlan | undefined;
  art?: W3DPromptCtx["art"] | undefined;
  issues?: W3DIssue[] | undefined;
  /** Current model.py, or null when there is none yet. */
  script?: string | null | undefined;
  buildStats?: string | null | undefined;
  renders?: string[] | undefined;
  answers?: W3DPromptCtx["answers"] | undefined;
  references?: string[] | undefined;
  reviewMode?: W3DPromptCtx["reviewMode"] | undefined;
  modelParts?: string[] | undefined;
  palette?: string | null | undefined;
  colorDelta?: string | null | undefined;
  skills?: string | undefined;
  best?: W3DPromptCtx["best"] | undefined;
  lessons?: string | undefined;
}

/** Prompt context without missing pieces (exactOptionalPropertyTypes: absent, never undefined). */
export function promptCtx(i: CtxInput): Omit<W3DPromptCtx, "round"> {
  const c: Omit<W3DPromptCtx, "round"> = { brief: i.brief };
  if (i.plan) c.plan = i.plan;
  if (i.art) c.art = i.art;
  if (i.issues) c.issues = i.issues;
  if (typeof i.script === "string") c.files = { "model.py": i.script };
  if (typeof i.buildStats === "string") c.buildStats = i.buildStats;
  if (i.renders) c.renders = i.renders;
  if (i.answers) c.answers = i.answers;
  if (i.references && i.references.length > 0) c.references = i.references;
  if (i.reviewMode && i.reviewMode !== "full") c.reviewMode = i.reviewMode;
  if (i.modelParts && i.modelParts.length > 0) c.modelParts = i.modelParts;
  if (i.palette) c.palette = i.palette;
  if (i.colorDelta) c.colorDelta = i.colorDelta;
  if (i.skills) c.skills = i.skills;
  if (i.best) c.best = i.best;
  if (i.lessons) c.lessons = i.lessons;
  return c;
}

/** Brief confirmed by the intake role: its fields win, params are merged, staged attachments are kept. */
export function mergeBrief(old: W3DBrief, confirmed: W3DBrief): W3DBrief {
  const out: W3DBrief = { ...old, ...confirmed, params: { ...old.params, ...confirmed.params }, attachments: old.attachments };
  if (confirmed.material === undefined && old.material !== undefined) out.material = old.material;
  if (confirmed.purpose === undefined && old.purpose !== undefined) out.purpose = old.purpose;
  // Slots the user filled in the request sheet survive an intake answer that has none.
  if ((confirmed.slots === undefined || confirmed.slots.length === 0) && old.slots !== undefined && old.slots.length > 0) out.slots = old.slots;
  return out;
}

/** Append a line to a note, skipping a line that is already there. */
export function addNote(prev: string | null, line: string | null | undefined): string | null {
  if (!line) return prev;
  if (!prev) return line;
  return prev.split("\n").includes(line) ? prev : `${prev}\n${line}`;
}

/** Keep the old note lines when a transition replaced the note with a new one. */
export function keepNotes(prev: string | null, next: string | null): string | null {
  if (!prev || next === prev) return next ?? prev;
  if (!next) return prev;
  return next.split("\n").reduce<string | null>((acc, line) => addNote(acc, line), prev);
}

/** Note once that the estimated cost passed the warning threshold; never stops the session. */
export function withCostWarning(s: W3DSnapshot, warnUsd: number): W3DSnapshot {
  if (!(warnUsd > 0) || s.costUsd <= warnUsd || (s.note ?? "").includes(COST_NOTE_PREFIX)) return s;
  return { ...s, note: addNote(s.note, `${COST_NOTE_PREFIX} ${warnUsd} USD (hiện ${s.costUsd.toFixed(2)} USD, chỉ là ước tính); phiên vẫn chạy tiếp.`) };
}

/**
 * Role failures worth an automatic resume: the CLI cut the role off, or a temporary infrastructure error.
 * Logic errors (bad output, refused tool, not logged in) are never transient.
 */
const TRANSIENT = /\b(?:ECONNRESET|ETIMEDOUT|ECONNREFUSED|EPIPE|EAI_AGAIN)\b|socket hang up|network error|overloaded|\b529\b|API Error: 5\d\d|internal server error|service unavailable|Run không hoàn tất/i;
export function isTransientFailure(r: { interrupted?: boolean; error?: string | undefined }): boolean {
  return !!r.interrupted || (typeof r.error === "string" && TRANSIENT.test(r.error));
}

/** Image types accepted as reference images (the Read tool can show them). */
export const W3D_IMAGE_RE = /\.(?:png|jpe?g|webp)$/i;

const UNKNOWN_RE = /chưa rõ/i;
/**
 * Intake may finish with "chưa rõ" values only after it asked the user at least once: a first-round brief with an
 * unknown key value, or a request cut before it reached the role, must become questions. Returns the error that goes
 * back to the role (lastError), or null when the brief is acceptable.
 */
export function intakeMustAsk(v: { done: boolean; brief?: W3DBrief | undefined }, info: { answered: number; truncated: boolean }): string | null {
  if (!v.done || info.answered > 0) return null;
  if (info.truncated) return "Mô tả vật thể bị cắt nên chưa đủ thông tin: hãy đặt done=false và hỏi lại người dùng (tối đa 5 câu) về phần bị mất.";
  const unknown = Object.entries(v.brief?.params ?? {}).filter(([, val]) => typeof val === "string" && UNKNOWN_RE.test(val)).map(([k]) => k);
  if (unknown.length === 0) return null;
  return `Còn thông số "chưa rõ" (${unknown.slice(0, 10).join(", ")}): hãy đặt done=false và hỏi người dùng các thông số này (tối đa 5 câu, cụ thể, trả lời được).`;
}
