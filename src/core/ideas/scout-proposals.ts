/**
 * Pure parser/validator for the JSON proposals block returned by the scout run.
 * Content is untrusted data: it is only length-checked and never interpreted.
 * This file must not import anything (the UI imports it by relative path).
 */

export const SCOUT_LIMITS = {
  title: 120,
  field: 600,
  maxProposals: 8,
  agent: 120,
  maxSources: 10,
  sourceTitle: 120,
} as const;

export type ScoutDifficulty = "low" | "medium" | "high";

export interface ScoutSource {
  url: string;
  title: string;
  stars: number;
  note: string;
}

export interface ScoutProposal {
  id: string;
  title: string;
  goal: string;
  reason: string;
  scope: string;
  risk: string;
  difficulty: ScoutDifficulty;
  agent?: string;
  feature?: string;
  security?: string;
  sources?: ScoutSource[];
}

export type ScoutParseResult =
  | { ok: true; proposals: ScoutProposal[] }
  | { ok: false; errors: string[] };

const ID_RE = /^[a-z0-9_-]{1,32}$/;
const DIFFICULTIES = ["low", "medium", "high"];
const PROPOSAL_KEYS = ["id", "title", "goal", "reason", "scope", "risk", "difficulty"];
const OPTIONAL_KEYS = ["agent", "feature", "security", "sources"];
const SOURCE_KEYS = ["url", "title", "stars", "note"];
const GITHUB_URL_RE = /^https:\/\/github\.com\/([A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)$/;

export function isGithubRepoUrl(u: string): boolean {
  const m = GITHUB_URL_RE.exec(u);
  if (!m) return false;
  return m[1] !== "." && m[1] !== ".." && m[2] !== "." && m[2] !== "..";
}

/** Validate the optional "sources" value; returns kept sources (bad urls dropped) and errors. */
function checkSources(raw: unknown, label: string, errors: string[]): ScoutSource[] {
  if (!Array.isArray(raw)) {
    errors.push(`${label}: trường "sources" phải là mảng.`);
    return [];
  }
  if (raw.length > SCOUT_LIMITS.maxSources) {
    errors.push(`${label}: có quá nhiều nguồn (tối đa ${SCOUT_LIMITS.maxSources}).`);
    return [];
  }
  const kept: ScoutSource[] = [];
  raw.forEach((s, j) => {
    const sl = `${label}, nguồn ${j + 1}`;
    if (typeof s !== "object" || s === null || Array.isArray(s)) {
      errors.push(`${sl}: phải là đối tượng.`);
      return;
    }
    const so = s as Record<string, unknown>;
    let bad = false;
    for (const k of Object.keys(so)) {
      if (!SOURCE_KEYS.includes(k)) {
        errors.push(`${sl}: khóa lạ "${k}".`);
        bad = true;
      }
    }
    for (const k of SOURCE_KEYS) {
      if (!(k in so)) {
        errors.push(`${sl}: thiếu trường "${k}".`);
        bad = true;
      }
    }
    if (bad) return;
    if (typeof so.url !== "string") {
      errors.push(`${sl}: trường "url" phải là chuỗi.`);
      bad = true;
    }
    for (const k of ["title", "note"] as const) {
      const v = so[k];
      if (typeof v !== "string") {
        errors.push(`${sl}: trường "${k}" phải là chuỗi.`);
        bad = true;
        continue;
      }
      const max = k === "title" ? SCOUT_LIMITS.sourceTitle : SCOUT_LIMITS.field;
      if (v.trim().length > max) {
        errors.push(`${sl}: trường "${k}" quá dài (tối đa ${max} ký tự).`);
        bad = true;
      }
    }
    const st = so.stars;
    if (typeof st !== "number" || !Number.isInteger(st) || st < 0) {
      errors.push(`${sl}: trường "stars" phải là số nguyên không âm.`);
      bad = true;
    }
    if (bad) return;
    const url = (so.url as string).trim();
    if (!isGithubRepoUrl(url)) return; // untrusted url: drop this source silently
    kept.push({
      url,
      title: (so.title as string).trim(),
      stars: st as number,
      note: (so.note as string).trim(),
    });
  });
  return kept;
}

const TEXT_FIELDS: Array<"title" | "goal" | "reason" | "scope" | "risk"> = [
  "title",
  "goal",
  "reason",
  "scope",
  "risk",
];

/** Check the text fields of a (possibly edited) proposal; returns Vietnamese error messages. */
export function validateProposalFields(p: Partial<Record<string, unknown>>): string[] {
  const errors: string[] = [];
  for (const k of TEXT_FIELDS) {
    if (!(k in p)) continue;
    const v = p[k];
    if (typeof v !== "string") {
      errors.push(`Trường "${k}" phải là chuỗi.`);
      continue;
    }
    const s = v.trim();
    if (s.length === 0) errors.push(`Trường "${k}" không được để trống.`);
    const max = k === "title" ? SCOUT_LIMITS.title : SCOUT_LIMITS.field;
    if (s.length > max) errors.push(`Trường "${k}" quá dài (tối đa ${max} ký tự).`);
  }
  return errors;
}

function lastJsonBlock(report: string): string | null {
  const re = /```json[ \t]*\r?\n([\s\S]*?)```/gi;
  let last: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = re.exec(report)) !== null) last = m[1] ?? "";
  return last;
}

export function parseScoutProposals(report: string): ScoutParseResult {
  if (typeof report !== "string") return { ok: false, errors: ["Báo cáo không phải văn bản."] };
  const block = lastJsonBlock(report);
  if (block === null) return { ok: false, errors: ["Không tìm thấy khối JSON đề xuất trong báo cáo."] };
  let data: unknown;
  try {
    data = JSON.parse(block);
  } catch {
    return { ok: false, errors: ["Khối JSON đề xuất bị hỏng hoặc bị cắt."] };
  }
  if (typeof data !== "object" || data === null || Array.isArray(data)) {
    return { ok: false, errors: ["Khối JSON phải là một đối tượng có khóa proposals."] };
  }
  const errors: string[] = [];
  const outer = data as Record<string, unknown>;
  for (const k of Object.keys(outer)) {
    if (k !== "proposals") errors.push(`Khóa lạ ở cấp ngoài: "${k}".`);
  }
  const arr = outer.proposals;
  if (!Array.isArray(arr)) {
    errors.push("Thiếu mảng proposals.");
    return { ok: false, errors };
  }
  if (arr.length === 0) errors.push("Mảng proposals đang rỗng.");
  if (arr.length > SCOUT_LIMITS.maxProposals) {
    errors.push(`Có quá nhiều đề xuất (tối đa ${SCOUT_LIMITS.maxProposals}).`);
  }
  const seen = new Set<string>();
  const proposals: ScoutProposal[] = [];
  arr.forEach((item, i) => {
    const label = `Đề xuất ${i + 1}`;
    if (typeof item !== "object" || item === null || Array.isArray(item)) {
      errors.push(`${label}: phải là đối tượng.`);
      return;
    }
    const o = item as Record<string, unknown>;
    for (const k of Object.keys(o)) {
      if (!PROPOSAL_KEYS.includes(k) && !OPTIONAL_KEYS.includes(k)) errors.push(`${label}: khóa lạ "${k}".`);
    }
    for (const k of PROPOSAL_KEYS) {
      if (!(k in o)) errors.push(`${label}: thiếu trường "${k}".`);
      else if (typeof o[k] !== "string") errors.push(`${label}: trường "${k}" phải là chuỗi.`);
    }
    for (const e of validateProposalFields(o)) errors.push(`${label}: ${e}`);
    const id = typeof o.id === "string" ? o.id.trim() : "";
    if (typeof o.id === "string") {
      if (!ID_RE.test(id)) errors.push(`${label}: id không đúng định dạng [a-z0-9_-]{1,32}.`);
      else if (seen.has(id)) errors.push(`${label}: id "${id}" bị trùng.`);
      seen.add(id);
    }
    const diff = typeof o.difficulty === "string" ? o.difficulty.trim() : "";
    if (typeof o.difficulty === "string" && !DIFFICULTIES.includes(diff)) {
      errors.push(`${label}: difficulty phải là low, medium hoặc high.`);
    }
    const extra: Partial<Pick<ScoutProposal, "agent" | "feature" | "security" | "sources">> = {};
    for (const k of ["agent", "feature", "security"] as const) {
      if (!(k in o)) continue;
      const v = o[k];
      if (typeof v !== "string") {
        errors.push(`${label}: trường "${k}" phải là chuỗi.`);
        continue;
      }
      const max = k === "agent" ? SCOUT_LIMITS.agent : SCOUT_LIMITS.field;
      if (v.trim().length > max) {
        errors.push(`${label}: trường "${k}" quá dài (tối đa ${max} ký tự).`);
        continue;
      }
      extra[k] = v.trim();
    }
    if ("sources" in o) {
      const kept = checkSources(o.sources, label, errors);
      if (kept.length > 0) extra.sources = kept;
    }
    proposals.push({
      id,
      title: String(o.title ?? "").trim(),
      goal: String(o.goal ?? "").trim(),
      reason: String(o.reason ?? "").trim(),
      scope: String(o.scope ?? "").trim(),
      risk: String(o.risk ?? "").trim(),
      difficulty: diff as ScoutDifficulty,
      ...extra,
    });
  });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, proposals };
}
