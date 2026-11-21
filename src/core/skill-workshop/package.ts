import path from "node:path";
import { validateInputsSchema } from "./inputs.js";

/** Error raised by the skill workshop core; `code` is machine readable, `message` is Vietnamese. */
export class SkillError extends Error {
  /** Per-field validation messages (answers API); sent to the client as `fields`/`errors`. */
  fields?: Record<string, string>;
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 = 400,
    public readonly code: string = "skill_invalid"
  ) {
    super(message);
  }
}

const KB = 1024;
export const LIMITS = {
  skillMdExclusiveMax: 64 * KB,
  rulesMd: 16 * KB,
  inputsJson: 32 * KB,
  metaJson: 32 * KB,
  rubricJson: 32 * KB,
  roundsJson: 1024 * KB,
  scriptFile: 32 * KB,
  scriptCount: 10,
  exampleFile: 64 * KB,
  exampleCount: 30,
  totalBytes: 2 * 1024 * KB,
  maxVersions: 20,
  titleMax: 80,
  goalMax: 1000,
  fieldsMax: 20,
  criteriaMin: 3,
  criteriaMax: 12
} as const;

export const SLUG_RE = /^[a-z0-9-]{1,40}$/;
const FIELD_NAME_RE = /^[a-z0-9_]{1,40}$/;
const SCRIPT_RE = /^scripts\/[^/\\:]+$/;
const EXAMPLE_RE = /^examples\/(train|holdout)-[1-9][0-9]*\.json$/;
const FIXED_PATHS = new Set(["SKILL.md", "rules.md", "inputs.json", "meta.json", "eval/rubric.json", "rounds.json"]);

export const DEFAULT_STATE = "idle";

export interface SkillMeta {
  slug: string;
  title: string;
  goal: string;
  state: string;
  bestScore: number;
  bestRound: number;
  createdAt: string;
  updatedAt: string;
  costUsdEstimate: number;
  version: number;
  config?: Record<string, unknown>;
  approvedAt?: string;
  paused?: boolean;
  lastError?: string;
}

export function validateSlug(slug: unknown): string {
  if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
    throw new SkillError("Mã skill không hợp lệ: chỉ dùng a-z, 0-9 và dấu gạch ngang, tối đa 40 ký tự.", 400, "skill_bad_slug");
  }
  return slug;
}

export function validateRelPath(rel: unknown): string {
  const bad = () => new SkillError(`Đường dẫn file không hợp lệ hoặc không được phép: ${String(rel).slice(0, 80)}`, 400, "skill_bad_path");
  if (typeof rel !== "string" || rel.length === 0 || rel.length > 120) throw bad();
  if (rel.includes("\0") || rel.includes("\\") || rel.includes(":") || rel.startsWith("/")) throw bad();
  if (rel.split("/").some((s) => s === "" || s === "." || s === "..")) throw bad();
  if (FIXED_PATHS.has(rel) || SCRIPT_RE.test(rel) || EXAMPLE_RE.test(rel)) return rel;
  throw bad();
}

/** Resolve `rel` under `root`; throws when the result escapes root (separator-aware prefix check). */
export function resolveInside(root: string, rel: string): string {
  const base = path.resolve(root);
  const full = path.resolve(base, rel);
  if (full !== base && !full.startsWith(base + path.sep)) {
    throw new SkillError("Đường dẫn nằm ngoài thư mục gói skill.", 400, "skill_bad_path");
  }
  return full;
}

// Convention: example attachments (examples/<train|holdout>-N/<input|expected>/<name>) are never part of SkillFiles:
// validateRelPath rejects those paths, so they never reach get/update/zip (see tests/skill-workshop-package.test.ts).
export function isZippable(rel: string): boolean {
  if (rel.startsWith("versions/")) return false;
  if (rel === "rounds.json") return false;
  if (/^examples\/holdout-[^/]*\.json$/.test(rel)) return false;
  return true;
}

function limitFor(rel: string): number {
  if (rel === "rules.md") return LIMITS.rulesMd;
  if (rel === "inputs.json") return LIMITS.inputsJson;
  if (rel === "meta.json") return LIMITS.metaJson;
  if (rel === "eval/rubric.json") return LIMITS.rubricJson;
  if (rel === "rounds.json") return LIMITS.roundsJson;
  if (rel.startsWith("scripts/")) return LIMITS.scriptFile;
  if (rel.startsWith("examples/")) return LIMITS.exampleFile;
  return Number.POSITIVE_INFINITY;
}

function fmtKb(n: number): string {
  return `${Math.round(n / KB)} KB`;
}

function parseJson(rel: string, text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    throw new SkillError(`File ${rel} không phải JSON hợp lệ.`, 400, "skill_bad_json");
  }
}

function fail(msg: string): never {
  throw new SkillError(msg, 400, "skill_bad_schema");
}

function checkInputs(text: string): void {
  const j = parseJson("inputs.json", text);
  if (!j || typeof j !== "object" || Array.isArray(j)) fail("inputs.json phải là một đối tượng JSON.");
  const isV2 =
    j.version === 2 ||
    (Array.isArray(j.fields) && j.fields.length > 0 && j.fields.every((f: any) => f && typeof f === "object" && "id" in f && !("name" in f)));
  if (isV2) {
    const r = validateInputsSchema(j);
    if (!r.ok) fail(`inputs.json: ${r.errors.slice(0, 3).join(" ")}`);
    return;
  }
  if (typeof j.description !== "string") fail("inputs.json: thiếu `description` (chuỗi).");
  if (!Array.isArray(j.fields)) fail("inputs.json: `fields` phải là mảng.");
  if (j.fields.length > LIMITS.fieldsMax) fail(`inputs.json: tối đa ${LIMITS.fieldsMax} trường đầu vào.`);
  for (const f of j.fields) {
    if (!f || typeof f !== "object") fail("inputs.json: mỗi trường phải là đối tượng.");
    if (typeof f.name !== "string" || !FIELD_NAME_RE.test(f.name)) fail("inputs.json: `name` của trường phải khớp [a-z0-9_]{1,40}.");
    if (typeof f.label !== "string") fail(`inputs.json: trường ${f.name} thiếu \`label\`.`);
    if (!["text", "longtext", "number", "choice"].includes(f.type)) fail(`inputs.json: trường ${f.name} có \`type\` không hợp lệ.`);
    if (f.type === "choice") {
      if (!Array.isArray(f.choices) || f.choices.length === 0 || f.choices.some((c: unknown) => typeof c !== "string")) {
        fail(`inputs.json: trường ${f.name} kiểu choice cần \`choices\` là mảng chuỗi không rỗng.`);
      }
    }
  }
}

function checkRubric(text: string): void {
  const j = parseJson("eval/rubric.json", text);
  if (!j || typeof j !== "object" || Array.isArray(j)) fail("eval/rubric.json phải là một đối tượng JSON.");
  if (!Number.isInteger(j.version)) fail("eval/rubric.json: `version` phải là số nguyên.");
  if (!Array.isArray(j.criteria) || j.criteria.length < LIMITS.criteriaMin || j.criteria.length > LIMITS.criteriaMax) {
    fail(`eval/rubric.json: cần ${LIMITS.criteriaMin} đến ${LIMITS.criteriaMax} tiêu chí.`);
  }
  const ids = new Set<string>();
  let sum = 0;
  for (const c of j.criteria) {
    if (!c || typeof c !== "object") fail("eval/rubric.json: mỗi tiêu chí phải là đối tượng.");
    if (typeof c.id !== "string" || c.id === "") fail("eval/rubric.json: tiêu chí thiếu `id`.");
    if (ids.has(c.id)) fail(`eval/rubric.json: id tiêu chí bị trùng: ${c.id}.`);
    ids.add(c.id);
    if (c.kind !== "code" && c.kind !== "ai") fail(`eval/rubric.json: tiêu chí ${c.id} có \`kind\` phải là "code" hoặc "ai".`);
    if (typeof c.weight !== "number" || !Number.isFinite(c.weight) || c.weight <= 0) fail(`eval/rubric.json: tiêu chí ${c.id} có \`weight\` phải là số lớn hơn 0.`);
    sum += c.weight;
  }
  if (Math.abs(sum - 100) > 1e-6) fail(`eval/rubric.json: tổng weight phải bằng 100 (hiện là ${sum}).`);
}

function checkRounds(text: string): void {
  const j = parseJson("rounds.json", text);
  if (!j || typeof j !== "object" || Array.isArray(j)) fail("rounds.json phải là một đối tượng JSON.");
  if (!Number.isInteger(j.version)) fail("rounds.json: `version` phải là số nguyên.");
  if (!Array.isArray(j.rounds)) fail("rounds.json: `rounds` phải là mảng.");
}

/** Validate a whole file set (relPath -> text). Throws SkillError 400 on the first problem. */
export function validatePackageInput(files: Record<string, string>): void {
  if (!files || typeof files !== "object" || Array.isArray(files)) fail("`files` phải là một đối tượng đường dẫn -> nội dung.");
  let total = 0;
  let scripts = 0;
  let examples = 0;
  for (const [rel, content] of Object.entries(files)) {
    validateRelPath(rel);
    if (typeof content !== "string") fail(`File ${rel} phải có nội dung dạng chuỗi.`);
    const size = Buffer.byteLength(content, "utf8");
    total += size;
    if (rel === "SKILL.md") {
      if (size >= LIMITS.skillMdExclusiveMax) fail(`SKILL.md quá lớn (giới hạn dưới ${fmtKb(LIMITS.skillMdExclusiveMax)}).`);
    } else if (size > limitFor(rel)) {
      fail(`File ${rel} quá lớn (giới hạn ${fmtKb(limitFor(rel))}).`);
    }
    if (rel.startsWith("scripts/") && ++scripts > LIMITS.scriptCount) fail(`scripts/ tối đa ${LIMITS.scriptCount} file.`);
    if (rel.startsWith("examples/") && ++examples > LIMITS.exampleCount) fail(`examples/ tối đa ${LIMITS.exampleCount} file.`);
  }
  if (total > LIMITS.totalBytes) fail(`Tổng dung lượng gói vượt giới hạn ${fmtKb(LIMITS.totalBytes)}.`);
  if (files["inputs.json"] !== undefined) checkInputs(files["inputs.json"]);
  if (files["eval/rubric.json"] !== undefined) checkRubric(files["eval/rubric.json"]);
  if (files["rounds.json"] !== undefined) checkRounds(files["rounds.json"]);
}

/** Validate user-editable meta fields (title, goal). */
export function validateMetaInput(input: { title?: unknown; goal?: unknown }, requireAll = true): void {
  if (requireAll || input.title !== undefined) {
    if (typeof input.title !== "string" || input.title.trim() === "") fail("Tiêu đề skill không được để trống.");
    if (input.title.length > LIMITS.titleMax) fail(`Tiêu đề skill tối đa ${LIMITS.titleMax} ký tự.`);
  }
  if (requireAll || input.goal !== undefined) {
    if (typeof input.goal !== "string") fail("Mục tiêu skill phải là chuỗi.");
    if (input.goal.length > LIMITS.goalMax) fail(`Mục tiêu skill tối đa ${LIMITS.goalMax} ký tự.`);
  }
}
