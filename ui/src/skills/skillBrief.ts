/** Pure helpers: validate a brief draft and a 0-100 score, and decide "needs_training" vs "completed". */
import type { FieldIssue, FieldValidation } from "./skillCreate";

export interface BriefDraft {
  description: string;
  keywords: string[];
  costUsd?: number;
  timeMinutes?: number;
}

export const BRIEF_DESCRIPTION_MAX = 2000;
export const BRIEF_KEYWORDS_MAX = 10;
export const BRIEF_KEYWORD_MAX_LEN = 40;
export const BRIEF_COST_MAX_USD = 100;
export const BRIEF_TIME_MAX_MINUTES = 240;
export const DEFAULT_BRIEF_PASS_SCORE = 100;

export type BriefStatus = "completed" | "needs_training";

function build(issues: FieldIssue[]): FieldValidation {
  const byKey: Record<string, string> = {};
  for (const it of issues) if (!(it.key in byKey)) byKey[it.key] = it.message;
  return { issues, firstKey: issues[0]?.key, byKey };
}

/** Per-field validation of a brief draft (Vietnamese messages). An empty keywords list is valid. */
export function validateBriefDraft(d: BriefDraft): FieldValidation {
  const issues: FieldIssue[] = [];
  const add = (key: string, message: string) => issues.push({ key, message });
  const desc = d.description.trim();
  if (!desc) add("description", "Hãy nhập mô tả brief.");
  else if (desc.length > BRIEF_DESCRIPTION_MAX) add("description", `Mô tả tối đa ${BRIEF_DESCRIPTION_MAX} ký tự.`);
  if (d.keywords.length > BRIEF_KEYWORDS_MAX) add("keywords", `Tối đa ${BRIEF_KEYWORDS_MAX} từ khoá.`);
  const seen = new Set<string>();
  for (const raw of d.keywords) {
    const k = raw.trim();
    if (!k) {
      add("keywords", "Từ khoá không được để trống.");
      continue;
    }
    if (k.length > BRIEF_KEYWORD_MAX_LEN) add("keywords", `Từ khoá "${k}" dài quá ${BRIEF_KEYWORD_MAX_LEN} ký tự.`);
    const lower = k.toLowerCase();
    if (seen.has(lower)) add("keywords", `Từ khoá "${k}" bị trùng.`);
    seen.add(lower);
  }
  if (d.costUsd !== undefined && (!Number.isFinite(d.costUsd) || d.costUsd < 0 || d.costUsd > BRIEF_COST_MAX_USD)) {
    add("costUsd", `Chi phí phải từ 0 đến ${BRIEF_COST_MAX_USD} USD.`);
  }
  if (d.timeMinutes !== undefined && (!Number.isInteger(d.timeMinutes) || d.timeMinutes < 1 || d.timeMinutes > BRIEF_TIME_MAX_MINUTES)) {
    add("timeMinutes", `Thời gian phải là số nguyên phút từ 1 đến ${BRIEF_TIME_MAX_MINUTES}.`);
  }
  return build(issues);
}

/** Score must be an integer 0..100; below 100 requires feedback. Feedback length is not checked. */
export function validateScore(score: number, feedback: string): FieldValidation {
  const issues: FieldIssue[] = [];
  const valid = Number.isInteger(score) && score >= 0 && score <= 100;
  if (!valid) issues.push({ key: "score", message: "Điểm phải là số nguyên từ 0 đến 100." });
  else if (score < 100 && !feedback.trim()) issues.push({ key: "feedback", message: "Điểm dưới 100 cần có nhận xét." });
  return build(issues);
}

/** completed when score >= passScore, needs_training when below; null (with issues) if the score or passScore is invalid. */
export function briefStatus(
  score: number,
  feedback: string,
  passScore: number = DEFAULT_BRIEF_PASS_SCORE
): { status: BriefStatus | null; validation: FieldValidation } {
  const validation = validateScore(score, feedback);
  if (!Number.isInteger(passScore) || passScore < 0 || passScore > 100) {
    return { status: null, validation: build([...validation.issues, { key: "passScore", message: "Điểm đạt phải là số nguyên từ 0 đến 100." }]) };
  }
  if (validation.issues.some((i) => i.key === "score")) return { status: null, validation };
  return { status: score >= passScore ? "completed" : "needs_training", validation };
}
