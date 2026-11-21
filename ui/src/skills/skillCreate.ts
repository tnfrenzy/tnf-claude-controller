/** Pure helpers for the "add training floor" form: validate a draft and build the skill package files. */

/** Attached file metadata (the File object itself is kept separately by the form). */
export interface AttachedFile {
  name: string;
  size: number;
}

/**
 * Attachment limits and the text-extension list are copied from src/core/skill-workshop/attachments.ts
 * (and the name rule from validateInboxName in src/core/run/inbox.ts); keep them in sync
 * (tests/skill-create.test.ts compares them).
 */
export const ATTACH_FILE_MAX_BYTES = 1024 * 1024;
export const ATTACH_TOTAL_MAX_BYTES = 4 * 1024 * 1024;
export const ATTACH_MAX_PER_SIDE = 10;
export const TEXT_FILE_EXTENSIONS = [".txt", ".md", ".json", ".csv", ".tsv", ".log", ".xml", ".yaml", ".yml", ".html"] as const;
const ATTACH_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

export function isBinaryFileName(name: string): boolean {
  const lower = name.toLowerCase();
  return !TEXT_FILE_EXTENSIONS.some((ext) => lower.endsWith(ext));
}

export function isValidAttachName(name: string): boolean {
  return ATTACH_NAME_RE.test(name) && !name.includes("..");
}

export interface SkillExample {
  input: string;
  expected: string;
  inputFiles?: AttachedFile[];
  expectedFiles?: AttachedFile[];
  /** true = kept back for grading, never shown to the AI while it learns. */
  holdout: boolean;
}

export interface SkillDraft {
  title: string;
  inputDesc: string;
  outputDesc: string;
  examples: SkillExample[];
  passScore: number;
  maxRounds: number;
}

export const DEFAULT_PASS_SCORE = 90;
export const DEFAULT_MAX_ROUNDS = 5;
export const MAX_SKILL_FILES = 30;
export const MAX_FILE_BYTES = 64 * 1024;
export const TITLE_MAX = 80;
export const GOAL_MAX = 1000;
/** Hint threshold only (never blocks). */
export const RECOMMENDED_HOLDOUT = 3;

export function emptyDraft(): SkillDraft {
  return {
    title: "",
    inputDesc: "",
    outputDesc: "",
    examples: [{ input: "", expected: "", holdout: false }, { input: "", expected: "", holdout: true }],
    passScore: DEFAULT_PASS_SCORE,
    maxRounds: DEFAULT_MAX_ROUNDS
  };
}

function bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}

function exampleJson(e: SkillExample): string {
  const o: { input: string; expected?: string } = { input: e.input };
  if (e.expected.trim()) o.expected = e.expected;
  return JSON.stringify(o, null, 2);
}

export interface FieldIssue {
  /** Field key: title, inputDesc, outputDesc, examples, holdout, passScore, maxRounds, ex.<i>.input, ex.<i>.expected. */
  key: string;
  message: string;
}

export interface FieldValidation {
  /** Issues in form order (top to bottom). */
  issues: FieldIssue[];
  /** First missing/invalid field key in form order, for scroll/focus. */
  firstKey: string | undefined;
  /** Message by field key (first message wins). */
  byKey: Record<string, string>;
}

/** Pure per-field validation (Vietnamese messages). Every input is required. */
export function validateSkillDraftFields(d: SkillDraft): FieldValidation {
  const issues: FieldIssue[] = [];
  const add = (key: string, message: string) => issues.push({ key, message });
  const title = d.title.trim();
  if (!title) add("title", "Hãy nhập tên skill.");
  else if (title.length > TITLE_MAX) add("title", `Tên skill tối đa ${TITLE_MAX} ký tự.`);
  if (!d.inputDesc.trim()) add("inputDesc", "Hãy mô tả đầu vào.");
  if (!d.outputDesc.trim()) add("outputDesc", "Hãy mô tả đầu ra.");
  if (d.examples.length < 1) add("examples", "Cần ít nhất một cặp tệp mẫu.");
  if (d.examples.length > MAX_SKILL_FILES - 1) add("examples", `Tối đa ${MAX_SKILL_FILES - 1} cặp tệp mẫu.`);
  let attachTotal = 0;
  d.examples.forEach((e, i) => {
    const inF = e.inputFiles ?? [];
    const exF = e.expectedFiles ?? [];
    // "Or" rule: each side needs non-empty text OR at least one file.
    if (!e.input.trim() && inF.length === 0) add(`ex.${i}.input`, `Cặp mẫu ${i + 1} chưa có đầu vào (nhập văn bản hoặc thêm tệp).`);
    if (!e.expected.trim() && exF.length === 0) add(`ex.${i}.expected`, `Cặp mẫu ${i + 1} chưa có đầu ra mong muốn (nhập văn bản hoặc thêm tệp).`);
    let total = 0;
    for (const [side, list] of [["input", inF], ["expected", exF]] as const) {
      const key = `ex.${i}.${side}`;
      if (list.length > ATTACH_MAX_PER_SIDE) add(key, `Cặp mẫu ${i + 1}: tối đa ${ATTACH_MAX_PER_SIDE} tệp mỗi bên.`);
      for (const f of list) {
        total += f.size;
        if (!isValidAttachName(f.name)) add(key, `Tên tệp "${f.name}" không hợp lệ: chỉ chữ cái không dấu, số, dấu chấm, gạch dưới, gạch ngang; không có dấu cách.`);
        if (f.size > ATTACH_FILE_MAX_BYTES) add(key, `Tệp "${f.name}" vượt 1 MB.`);
      }
    }
    attachTotal += total;
    if (bytes(exampleJson(e)) > MAX_FILE_BYTES) add(`ex.${i}.input`, `Cặp mẫu ${i + 1} quá lớn (tối đa 64 KB).`);
  });
  if (attachTotal > ATTACH_TOTAL_MAX_BYTES) add("examples", "Tổng dung lượng tệp đính kèm vượt 4 MB.");
  if (d.examples.length >= 1 && !d.examples.some((e) => e.holdout)) add("holdout", "Cần giữ lại ít nhất một cặp để chấm điểm.");
  if (!Number.isFinite(d.passScore) || d.passScore < 1 || d.passScore > 100) add("passScore", "Điểm đạt phải từ 1 đến 100.");
  if (!Number.isInteger(d.maxRounds) || d.maxRounds < 1 || d.maxRounds > 20) add("maxRounds", "Số vòng tối đa phải từ 1 đến 20.");
  if (d.examples.length + 2 > MAX_SKILL_FILES) add("examples", `Tổng số tệp vượt ${MAX_SKILL_FILES}.`);
  const byKey: Record<string, string> = {};
  for (const it of issues) if (!(it.key in byKey)) byKey[it.key] = it.message;
  return { issues, firstKey: issues[0]?.key, byKey };
}

/** Returns Vietnamese error messages; empty array = valid. */
export function validateSkillDraft(d: SkillDraft): string[] {
  return validateSkillDraftFields(d).issues.map((i) => i.message);
}

/** DOM id for a field key (used for scroll/focus). */
export function skillFieldId(key: string): string {
  return `skillf-${key.replace(/\./g, "-")}`;
}

export function holdoutCount(d: Pick<SkillDraft, "examples">): number {
  return d.examples.filter((e) => e.holdout).length;
}

/** Default rubric: 4 criteria, weights sum to 100 (matches the server's checkRubric). */
export function defaultRubric(): string {
  return JSON.stringify(
    {
      version: 1,
      criteria: [
        { id: "correct", kind: "ai", weight: 40, description: "Kết quả đúng với đầu ra mong đợi." },
        { id: "complete", kind: "ai", weight: 25, description: "Đầy đủ, không thiếu phần nào của yêu cầu." },
        { id: "format", kind: "ai", weight: 20, description: "Đúng định dạng đầu ra đã mô tả." },
        { id: "clear", kind: "ai", weight: 15, description: "Rõ ràng, ngắn gọn, dễ dùng." }
      ]
    },
    null,
    2
  );
}

export function buildSkillFiles(d: SkillDraft): { title: string; goal: string; files: Record<string, string> } {
  const title = d.title.trim();
  const goal = `Đầu vào: ${d.inputDesc.trim()}. Đầu ra: ${d.outputDesc.trim()}.`.slice(0, GOAL_MAX);
  const skillMd = [
    `# ${title}`,
    "",
    "## Đầu vào",
    d.inputDesc.trim(),
    "",
    "## Đầu ra",
    d.outputDesc.trim(),
    ""
  ].join("\n");
  const files: Record<string, string> = { "SKILL.md": skillMd, "eval/rubric.json": defaultRubric() };
  let tn = 0;
  let hn = 0;
  for (const e of d.examples) {
    files[e.holdout ? `examples/holdout-${++hn}.json` : `examples/train-${++tn}.json`] = exampleJson(e);
  }
  return { title, goal, files };
}

export interface AttachmentPlanItem {
  pair: string;
  side: "input" | "expected";
  names: string[];
}

/** Which files go to which pair, using the same train-N/holdout-N naming as buildSkillFiles. */
export function buildAttachmentPlan(examples: SkillExample[]): AttachmentPlanItem[] {
  const plan: AttachmentPlanItem[] = [];
  let tn = 0;
  let hn = 0;
  for (const e of examples) {
    const pair = e.holdout ? `holdout-${++hn}` : `train-${++tn}`;
    for (const [side, list] of [["input", e.inputFiles], ["expected", e.expectedFiles]] as const) {
      if (list && list.length) plan.push({ pair, side, names: list.map((f) => f.name) });
    }
  }
  return plan;
}

/** Map a server error (HTTP status + code + message) to Vietnamese text. */
export function skillCreateError(status: number | undefined, code: string | undefined, message: string): string {
  if (status === 409 || code === "skill_exists") return "Đã có skill trùng tên. Hãy đổi tên khác.";
  if (code === "skill_bad_slug" || code === "bad_slug") return "Tên skill không tạo được mã hợp lệ. Hãy dùng tên có chữ cái hoặc số (a-z, 0-9).";
  return message;
}
