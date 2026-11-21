import fs from "node:fs";
import path from "node:path";
import { isObj } from "../app/util.js";

/** 3D agent kit: role ids (must exist in the role catalog) + elevator prompt templates (config/design3d-kit.json). */

export const MAX_TEMPLATE_LABEL = 80;
export const MAX_TEMPLATE_PROMPT = 2000;
export const MIN_TEMPLATES = 4;
export const MAX_TEMPLATES = 6;
export const MAX_MATERIAL = 40;
export const MAX_DIMENSION_MM = 20000;

export const KIT_FORMATS = ["step", "stl", "glb"] as const;
export type KitFormat = (typeof KIT_FORMATS)[number];
export const KIT_PARAMS = ["width", "depth", "height", "material"] as const;
export type KitParam = (typeof KIT_PARAMS)[number];

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const PLACEHOLDER_RE = /\{\{([^{}]*)\}\}/g;
const DIGITS_RE = /^[0-9]+$/;
const MATERIAL_RE = /^[\p{L}\p{N} -]+$/u;

export interface KitTemplate {
  id: string;
  label: string;
  prompt: string;
  formats: KitFormat[];
}

export interface Design3dKit {
  roles: string[];
  templates: KitTemplate[];
}

export type KitParams = Record<string, unknown>;

export function kitFile(repoRoot: string): string {
  return path.join(repoRoot, "config", "design3d-kit.json");
}

/** Pure check + normalisation of a parsed kit; throws a Vietnamese Error when invalid. */
export function validateKit(raw: unknown, catalogRoleIds: ReadonlySet<string>): Design3dKit {
  if (!isObj(raw)) throw new Error("Bộ 3D: nội dung phải là một đối tượng JSON.");
  const rolesRaw = raw.roles;
  if (!Array.isArray(rolesRaw) || rolesRaw.length === 0) throw new Error("Bộ 3D: 'roles' phải là mảng không rỗng.");
  const roles: string[] = [];
  for (const r of rolesRaw) {
    if (typeof r !== "string" || !ID_RE.test(r)) throw new Error(`Bộ 3D: id vai không hợp lệ: ${JSON.stringify(r)}.`);
    if (roles.includes(r)) throw new Error(`Bộ 3D: id vai bị trùng: ${r}.`);
    if (!catalogRoleIds.has(r)) throw new Error(`Bộ 3D: vai '${r}' không có trong danh mục vai.`);
    roles.push(r);
  }
  const tplRaw = raw.templates;
  if (!Array.isArray(tplRaw) || tplRaw.length < MIN_TEMPLATES || tplRaw.length > MAX_TEMPLATES) {
    throw new Error(`Bộ 3D: 'templates' phải có từ ${MIN_TEMPLATES} đến ${MAX_TEMPLATES} mẫu.`);
  }
  const templates: KitTemplate[] = [];
  for (const t of tplRaw) {
    if (!isObj(t)) throw new Error("Bộ 3D: mỗi mẫu phải là một đối tượng.");
    const { id, label, prompt, formats } = t;
    if (typeof id !== "string" || !ID_RE.test(id)) throw new Error(`Bộ 3D: id mẫu không hợp lệ: ${JSON.stringify(id)}.`);
    if (templates.some((x) => x.id === id)) throw new Error(`Bộ 3D: id mẫu bị trùng: ${id}.`);
    if (typeof label !== "string" || !label.trim() || label.length > MAX_TEMPLATE_LABEL) {
      throw new Error(`Bộ 3D: nhãn mẫu '${id}' phải có 1..${MAX_TEMPLATE_LABEL} ký tự.`);
    }
    if (typeof prompt !== "string" || !prompt.trim() || prompt.length > MAX_TEMPLATE_PROMPT) {
      throw new Error(`Bộ 3D: prompt mẫu '${id}' phải có 1..${MAX_TEMPLATE_PROMPT} ký tự.`);
    }
    const found = new Set<string>();
    for (const m of prompt.matchAll(PLACEHOLDER_RE)) {
      const name = m[1] ?? "";
      if (!(KIT_PARAMS as readonly string[]).includes(name)) throw new Error(`Bộ 3D: mẫu '${id}' có tham số lạ {{${name}}}.`);
      found.add(name);
    }
    for (const p of KIT_PARAMS) {
      if (!found.has(p)) throw new Error(`Bộ 3D: mẫu '${id}' thiếu chỗ điền {{${p}}}.`);
    }
    if (/\{\{|\}\}/.test(prompt.replace(PLACEHOLDER_RE, ""))) throw new Error(`Bộ 3D: mẫu '${id}' có dấu {{ }} sai cú pháp.`);
    if (!Array.isArray(formats) || formats.length === 0) throw new Error(`Bộ 3D: mẫu '${id}' cần ít nhất một định dạng.`);
    const fs2: KitFormat[] = [];
    for (const f of formats) {
      if (typeof f !== "string" || !(KIT_FORMATS as readonly string[]).includes(f)) {
        throw new Error(`Bộ 3D: mẫu '${id}' có định dạng lạ ${JSON.stringify(f)} (chỉ ${KIT_FORMATS.join(", ")}).`);
      }
      if (fs2.includes(f as KitFormat)) throw new Error(`Bộ 3D: mẫu '${id}' có định dạng trùng: ${f}.`);
      fs2.push(f as KitFormat);
    }
    templates.push({ id, label, prompt, formats: fs2 });
  }
  return { roles, templates };
}

function readJson(file: string, what: string): unknown {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`Không đọc được ${what} (${file}): ${(e as Error).message}`);
  }
  try {
    return JSON.parse(text) as unknown;
  } catch (e) {
    throw new Error(`${what} (${file}) không phải JSON hợp lệ: ${(e as Error).message}`);
  }
}

/** Load config/design3d-kit.json and check its roles against config/roles-catalog.json. */
export function loadKit(repoRoot: string): Design3dKit {
  const kitRaw = readJson(kitFile(repoRoot), "file bộ 3D");
  const catRaw = readJson(path.join(repoRoot, "config", "roles-catalog.json"), "danh mục vai");
  if (!Array.isArray(catRaw)) throw new Error("Danh mục vai phải là một mảng.");
  const ids = new Set<string>();
  for (const r of catRaw) {
    if (isObj(r) && typeof r.id === "string") ids.add(r.id);
  }
  return validateKit(kitRaw, ids);
}

function checkDimension(name: string, v: unknown): string {
  let s: string;
  if (typeof v === "number") {
    if (!Number.isSafeInteger(v) || v < 0) throw new Error(`Tham số '${name}' phải là số nguyên dương (mm).`);
    s = String(v);
  } else if (typeof v === "string") {
    if (!DIGITS_RE.test(v)) throw new Error(`Tham số '${name}' chỉ được gồm chữ số (mm).`);
    s = v;
  } else {
    throw new Error(`Tham số '${name}' phải là số nguyên dương (mm).`);
  }
  const n = Number(s);
  if (!Number.isSafeInteger(n) || n < 1 || n > MAX_DIMENSION_MM) {
    throw new Error(`Tham số '${name}' phải nằm trong 1..${MAX_DIMENSION_MM} mm.`);
  }
  return String(n);
}

function checkMaterial(v: unknown): string {
  if (typeof v !== "string") throw new Error("Tham số 'material' phải là chữ.");
  const s = v.trim();
  if (!s || s.length > MAX_MATERIAL) throw new Error(`Tham số 'material' phải có 1..${MAX_MATERIAL} ký tự.`);
  if (!MATERIAL_RE.test(s)) throw new Error("Tham số 'material' chỉ được gồm chữ, số, khoảng trắng và gạch ngang.");
  return s;
}

/** Fill a template's {{width}}/{{depth}}/{{height}}/{{material}}; rejects missing, extra or odd values. */
export function fillTemplate(
  kit: Design3dKit,
  templateId: string,
  params: KitParams,
): { prompt: string; formats: KitFormat[] } {
  const tpl = kit.templates.find((t) => t.id === templateId);
  if (!tpl) throw new Error(`Không có mẫu lệnh '${templateId}'.`);
  if (!isObj(params)) throw new Error("Tham số phải là một đối tượng.");
  for (const k of Object.keys(params)) {
    if (!(KIT_PARAMS as readonly string[]).includes(k)) throw new Error(`Tham số lạ: '${k}'.`);
  }
  for (const k of KIT_PARAMS) {
    if (!Object.prototype.hasOwnProperty.call(params, k) || params[k] === undefined) throw new Error(`Thiếu tham số '${k}'.`);
  }
  const values: Record<KitParam, string> = {
    width: checkDimension("width", params.width),
    depth: checkDimension("depth", params.depth),
    height: checkDimension("height", params.height),
    material: checkMaterial(params.material),
  };
  const prompt = tpl.prompt.replace(PLACEHOLDER_RE, (_m, name: string) => values[name as KitParam] ?? "");
  return { prompt, formats: [...tpl.formats] };
}
