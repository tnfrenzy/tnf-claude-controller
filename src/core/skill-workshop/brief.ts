/**
 * Training brief for the "create new" training mode (no fixed expected output): a goal, key-value inputs and a pass score.
 * Pure module (no UI, no InputsSchema). Limits are measured with .length, like ui/src/skills/skillCreate.ts.
 *
 * NOTE: the default pass score here is 100 on purpose (create mode has no reference output to
 * compare against, so only a perfect score counts); it differs from DEFAULT_PASS_SCORE = 90 in skillCreate.ts.
 * Input keys follow the same rule as field ids in inputs.ts: [a-z][a-z0-9_]{0,39}.
 */

export const BRIEF_DEFAULT_PASS_SCORE = 100;
export const BRIEF_GOAL_MAX = 1000;
export const BRIEF_INPUTS_MAX = 20;
export const BRIEF_INPUT_KEY_MAX = 40;
export const BRIEF_INPUT_VALUE_MAX = 500;

// Single source of truth: the regex is built from BRIEF_INPUT_KEY_MAX (equals /^[a-z][a-z0-9_]{0,39}$/).
const ID_RE = new RegExp(`^[a-z][a-z0-9_]{0,${BRIEF_INPUT_KEY_MAX - 1}}$`);

export interface TrainingBrief {
  goal: string;
  inputs: Record<string, string>;
  passScore: number;
}

export type BriefResult = { ok: true; brief: TrainingBrief } | { ok: false; errors: string[] };

const isPlainObject = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/**
 * Applies defaults: trims a string goal, missing inputs -> {}, missing passScore -> 100.
 * Wrongly typed values are passed through unchanged so validateBrief can report them.
 */
export function normalizeBrief(raw: unknown): TrainingBrief {
  const r = isPlainObject(raw) ? raw : {};
  return {
    goal: typeof r.goal === "string" ? r.goal.trim() : (r.goal as string),
    inputs: r.inputs === undefined ? {} : (r.inputs as Record<string, string>),
    passScore: r.passScore === undefined ? BRIEF_DEFAULT_PASS_SCORE : (r.passScore as number)
  };
}

/** Validates after normalizing; returns Vietnamese error messages. */
export function validateBrief(raw: unknown): BriefResult {
  if (!isPlainObject(raw)) return { ok: false, errors: ["Brief phải là một đối tượng."] };
  const brief = normalizeBrief(raw);
  const errors: string[] = [];

  if (typeof brief.goal !== "string") errors.push("Mục tiêu phải là chuỗi.");
  else if (brief.goal === "") errors.push("Mục tiêu không được để trống.");
  else if (brief.goal.length > BRIEF_GOAL_MAX) errors.push(`Mục tiêu tối đa ${BRIEF_GOAL_MAX} ký tự.`);

  if (!isPlainObject(brief.inputs)) errors.push("Thông tin đầu vào phải là một đối tượng.");
  else {
    const entries = Object.entries(brief.inputs);
    if (entries.length > BRIEF_INPUTS_MAX) errors.push(`Tối đa ${BRIEF_INPUTS_MAX} thông tin đầu vào.`);
    for (const [k, v] of entries) {
      if (!ID_RE.test(k)) errors.push(`Khoá đầu vào \`${k}\` phải khớp [a-z][a-z0-9_]{0,${BRIEF_INPUT_KEY_MAX - 1}}.`);
      const value: unknown = v;
      if (typeof value !== "string") errors.push(`Giá trị của \`${k}\` phải là chuỗi.`);
      else if (value.trim() === "") errors.push(`Giá trị của \`${k}\` không được để trống.`);
      else if (value.length > BRIEF_INPUT_VALUE_MAX) errors.push(`Giá trị của \`${k}\` tối đa ${BRIEF_INPUT_VALUE_MAX} ký tự.`);
    }
  }

  const p: unknown = brief.passScore;
  if (typeof p !== "number" || !Number.isFinite(p) || !Number.isInteger(p) || p < 1 || p > 100) {
    errors.push("Điểm đạt phải là số nguyên từ 1 đến 100.");
  }

  return errors.length ? { ok: false, errors } : { ok: true, brief };
}
