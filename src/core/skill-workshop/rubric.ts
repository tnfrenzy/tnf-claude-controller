// Rubric schema, validation and scoring (SKILL-WORKSHOP.md section 3).
// Pure module: no I/O. This is a fuller check than the private checkRubric in
// package.ts (which only guards package shape); this one collects every issue.
import { LIMITS, SLUG_RE } from "./package.js";
import { isObj } from "../app/util.js";

export type RubricCheck =
  | { type: "contains"; value: string }
  | { type: "not-contains"; value: string }
  | { type: "regex"; pattern: string; flags?: string }
  | { type: "max-length"; max: number }
  | { type: "min-length"; min: number }
  | { type: "json-schema"; schema: Record<string, unknown> }
  | { type: "section-present"; heading: string };

export interface RubricCriterion {
  id: string;
  label: string;
  weight: number;
  kind: "code" | "ai";
  check?: RubricCheck;
  prompt?: string;
}

export interface Rubric {
  version: number;
  criteria: RubricCriterion[];
  passScore?: number;
}

export interface RubricIssue {
  path: string;
  code: string;
  message: string;
}

export const DEFAULT_PASS_SCORE = 90;
export const MIN_CODE_WEIGHT = 60;
const EPS = 1e-9;

function nonEmptyStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}
function finiteNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function checkCheck(check: unknown, path: string, issues: RubricIssue[]): void {
  const add = (code: string, message: string, sub = "") => issues.push({ path: path + sub, code, message });
  if (!isObj(check)) {
    add("check-missing", "Tiêu chí code cần đối tượng check.");
    return;
  }
  const t = check.type;
  switch (t) {
    case "contains":
    case "not-contains":
      if (!nonEmptyStr(check.value)) add("check-param", `check ${t} cần value là chuỗi không rỗng.`, ".value");
      break;
    case "regex":
      if (!nonEmptyStr(check.pattern)) {
        add("check-param", "check regex cần pattern là chuỗi không rỗng.", ".pattern");
      } else {
        try {
          new RegExp(check.pattern, typeof check.flags === "string" ? check.flags : undefined);
        } catch {
          add("regex-invalid", "Biểu thức chính quy không biên dịch được.", ".pattern");
        }
      }
      break;
    case "max-length":
      if (!finiteNum(check.max) || check.max < 0) add("check-param", "check max-length cần max là số >= 0.", ".max");
      break;
    case "min-length":
      if (!finiteNum(check.min) || check.min < 0) add("check-param", "check min-length cần min là số >= 0.", ".min");
      break;
    case "json-schema":
      if (!isObj(check.schema)) add("check-param", "check json-schema cần schema là đối tượng.", ".schema");
      break;
    case "section-present":
      if (!nonEmptyStr(check.heading)) add("check-param", "check section-present cần heading không rỗng.", ".heading");
      break;
    default:
      add("check-type", "Loại check không được hỗ trợ.", ".type");
  }
}

export function validateRubric(input: unknown): { ok: boolean; errors: RubricIssue[] } {
  const errors: RubricIssue[] = [];
  const add = (path: string, code: string, message: string) => errors.push({ path, code, message });

  if (!isObj(input)) {
    add("", "not-object", "Rubric phải là một đối tượng JSON.");
    return { ok: false, errors };
  }
  if (input.version !== 1 || !Number.isInteger(input.version)) {
    add("version", "version", "version phải là số nguyên 1.");
  }
  if (input.passScore !== undefined) {
    if (!finiteNum(input.passScore) || input.passScore < 50 || input.passScore > 100) {
      add("passScore", "pass-score", "passScore phải nằm trong khoảng 50-100.");
    }
  }
  if (!Array.isArray(input.criteria)) {
    add("criteria", "criteria-not-array", "criteria phải là một mảng.");
    return { ok: false, errors };
  }
  const list = input.criteria as unknown[];
  if (list.length < LIMITS.criteriaMin || list.length > LIMITS.criteriaMax) {
    add("criteria", "criteria-count", `Cần ${LIMITS.criteriaMin} đến ${LIMITS.criteriaMax} tiêu chí.`);
  }

  const seen = new Set<string>();
  let total = 0;
  let codeTotal = 0;
  list.forEach((c, i) => {
    const p = `criteria[${i}]`;
    if (!isObj(c)) {
      add(p, "criterion-not-object", "Tiêu chí phải là đối tượng.");
      return;
    }
    if (typeof c.id !== "string" || !SLUG_RE.test(c.id)) {
      add(`${p}.id`, "id-format", "id phải khớp [a-z0-9-]{1,40}.");
    } else if (seen.has(c.id)) {
      add(`${p}.id`, "id-duplicate", `id "${c.id}" bị trùng.`);
    } else {
      seen.add(c.id);
    }
    if (!nonEmptyStr(c.label)) add(`${p}.label`, "label-empty", "label không được rỗng.");
    const kindOk = c.kind === "code" || c.kind === "ai";
    if (!kindOk) add(`${p}.kind`, "kind", 'kind phải là "code" hoặc "ai".');
    if (!finiteNum(c.weight) || c.weight <= 0) {
      add(`${p}.weight`, "weight", "weight phải là số hữu hạn lớn hơn 0.");
    } else {
      total += c.weight;
      if (c.kind === "code") codeTotal += c.weight;
    }
    if (c.kind === "code") checkCheck(c.check, `${p}.check`, errors);
    if (c.kind === "ai" && !nonEmptyStr(c.prompt)) {
      add(`${p}.prompt`, "prompt-missing", "Tiêu chí ai cần prompt không rỗng.");
    }
  });

  if (Math.abs(total - 100) > EPS) {
    add("criteria", "weight-sum", `Tổng weight phải bằng 100 (hiện ${total}).`);
  }
  if (codeTotal < MIN_CODE_WEIGHT - EPS) {
    add("criteria", "code-weight", `Tổng weight tiêu chí code phải >= ${MIN_CODE_WEIGHT} (hiện ${codeTotal}).`);
  }
  return { ok: errors.length === 0, errors };
}

export interface CriterionScore {
  id: string;
  ratio: number;
  points: number;
}

export function computeScore(
  rubric: Rubric,
  ratios: Record<string, number>
): { total: number; perCriterion: CriterionScore[]; errors: string[]; passed: boolean } {
  const errors: string[] = [];
  const perCriterion: CriterionScore[] = [];
  let sum = 0;
  const ids = new Set<string>();
  for (const c of rubric.criteria) {
    ids.add(c.id);
    const raw = Object.prototype.hasOwnProperty.call(ratios, c.id) ? ratios[c.id] : undefined;
    let ratio = 0;
    if (raw === undefined) {
      errors.push(`Thiếu điểm cho tiêu chí "${c.id}", tính 0.`);
    } else if (typeof raw !== "number" || !Number.isFinite(raw)) {
      errors.push(`Ratio của tiêu chí "${c.id}" không hợp lệ, tính 0.`);
    } else {
      ratio = Math.min(1, Math.max(0, raw));
    }
    const points = ratio * c.weight;
    sum += points;
    perCriterion.push({ id: c.id, ratio, points });
  }
  for (const k of Object.keys(ratios)) {
    if (!ids.has(k)) errors.push(`Id thừa "${k}" không có trong rubric.`);
  }
  const clamped = Math.min(100, Math.max(0, Number.isFinite(sum) ? sum : 0));
  const total = Math.round(clamped * 10) / 10;
  const pass = rubric.passScore ?? DEFAULT_PASS_SCORE;
  return { total, perCriterion, errors, passed: total >= pass };
}
