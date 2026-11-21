/**
 * inputs.json schema v2 (skill input form) and pure answer validation.
 * ui/src/skills/skillForm.ts is a verbatim duplicate of this logic (UI cannot import src/core); keep both in sync.
 *
 * Answer shapes: text -> string; number -> finite number; select -> one of options (string);
 * bool -> boolean (for a required bool, `false` is valid); file -> array of file names (string[]),
 * required file needs a non-empty array. `options` is allowed only on kind "select".
 */

export type InputKind = "text" | "number" | "select" | "bool" | "file";

export interface InputField {
  id: string;
  label: string;
  kind: InputKind;
  unit?: string;
  options?: string[];
  required: boolean;
  reason: string;
  suggested?: string | number | boolean | string[];
  group: string;
}

export interface InputsSchema {
  version: 2;
  fields: InputField[];
}

export type SchemaResult = { ok: true; schema: InputsSchema } | { ok: false; errors: string[] };
export type AnswersResult = { ok: boolean; errors: Record<string, string> };

export const INPUT_FIELDS_MAX = 20;
const ID_RE = /^[a-z][a-z0-9_]{0,39}$/;
const KINDS = ["text", "number", "select", "bool", "file"];

const isStr = (v: unknown): v is string => typeof v === "string";

export function validateInputsSchema(raw: unknown): SchemaResult {
  const errors: string[] = [];
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ok: false, errors: ["inputs.json phải là một đối tượng."] };
  const r = raw as Record<string, unknown>;
  if (r["version"] !== 2) errors.push("`version` phải bằng 2.");
  const fields = r["fields"];
  if (!Array.isArray(fields) || fields.length === 0) return { ok: false, errors: [...errors, "`fields` phải là mảng không rỗng."] };
  if (fields.length > INPUT_FIELDS_MAX) errors.push(`Tối đa ${INPUT_FIELDS_MAX} trường.`);
  const seen = new Set<string>();
  fields.forEach((rawField: unknown, i: number) => {
    const at = `Trường #${i + 1}`;
    if (!rawField || typeof rawField !== "object" || Array.isArray(rawField)) {
      errors.push(`${at}: phải là đối tượng.`);
      return;
    }
    const f = rawField as Record<string, unknown>;
    if (!isStr(f["id"]) || !ID_RE.test(f["id"])) errors.push(`${at}: \`id\` phải khớp [a-z][a-z0-9_]{0,39}.`);
    else if (seen.has(f["id"])) errors.push(`${at}: id bị trùng: ${f["id"]}.`);
    else seen.add(f["id"]);
    if (!isStr(f["label"]) || f["label"].trim() === "") errors.push(`${at}: thiếu \`label\`.`);
    if (!isStr(f["kind"]) || !KINDS.includes(f["kind"])) errors.push(`${at}: \`kind\` không hợp lệ.`);
    if (typeof f["required"] !== "boolean") errors.push(`${at}: \`required\` phải là true/false.`);
    if (!isStr(f["reason"]) || f["reason"].trim() === "") errors.push(`${at}: \`reason\` (lý do cần) không được rỗng.`);
    if (!isStr(f["group"]) || f["group"].trim() === "") errors.push(`${at}: thiếu \`group\`.`);
    if (f["unit"] !== undefined && (f["kind"] !== "number" || !isStr(f["unit"]))) errors.push(`${at}: \`unit\` chỉ dùng cho kiểu number (chuỗi).`);
    if (f["kind"] === "select") {
      if (!Array.isArray(f["options"]) || f["options"].length === 0 || f["options"].some((o: unknown) => !isStr(o))) {
        errors.push(`${at}: kiểu select cần \`options\` là mảng chuỗi không rỗng.`);
      }
    } else if (f["options"] !== undefined) {
      errors.push(`${at}: \`options\` chỉ dùng cho kiểu select.`);
    }
    if (f["suggested"] !== undefined) {
      const s = f["suggested"];
      let ok = true;
      if (f["kind"] === "text") ok = isStr(s);
      else if (f["kind"] === "number") ok = typeof s === "number" && Number.isFinite(s);
      else if (f["kind"] === "bool") ok = typeof s === "boolean";
      else if (f["kind"] === "file") ok = Array.isArray(s) && s.every(isStr);
      else if (f["kind"] === "select") ok = isStr(s) && Array.isArray(f["options"]) && f["options"].includes(s);
      if (!ok) errors.push(`${at}: \`suggested\` không đúng kiểu hoặc ngoài options.`);
    }
  });
  return errors.length ? { ok: false, errors } : { ok: true, schema: r as unknown as InputsSchema };
}

export function validateAnswers(schema: InputsSchema, answers: Record<string, unknown>): AnswersResult {
  const errors: Record<string, string> = {};
  const a = answers && typeof answers === "object" ? answers : {};
  for (const f of schema.fields) {
    const v = (a as Record<string, unknown>)[f.id];
    const empty = v === undefined || v === null || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);
    if (empty) {
      if (f.required) errors[f.id] = "Trường bắt buộc, chưa có câu trả lời.";
      continue;
    }
    if (f.kind === "text" && !isStr(v)) errors[f.id] = "Phải là chuỗi.";
    else if (f.kind === "number" && (typeof v !== "number" || !Number.isFinite(v))) errors[f.id] = "Phải là số hợp lệ.";
    else if (f.kind === "select" && (!isStr(v) || !(f.options ?? []).includes(v))) errors[f.id] = "Giá trị không nằm trong các lựa chọn.";
    else if (f.kind === "bool" && typeof v !== "boolean") errors[f.id] = "Phải là đúng/sai.";
    else if (f.kind === "file" && (!Array.isArray(v) || v.some((x) => !isStr(x) || x === ""))) errors[f.id] = "Phải là danh sách tên tệp.";
  }
  return { ok: Object.keys(errors).length === 0, errors };
}

export function groupFields(schema: InputsSchema): { group: string; fields: InputField[] }[] {
  const out: { group: string; fields: InputField[] }[] = [];
  for (const f of schema.fields) {
    let g = out.find((x) => x.group === f.group);
    if (!g) out.push((g = { group: f.group, fields: [] }));
    g.fields.push(f);
  }
  return out;
}

export function suggestedAnswers(schema: InputsSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const f of schema.fields) if (f.suggested !== undefined) out[f.id] = f.suggested;
  return out;
}
