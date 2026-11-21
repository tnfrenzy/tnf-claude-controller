/**
 * Pure role ranking by brief: no network, no disk. Matches brief tokens against role
 * keywords/tags (+5), description tokens (+2 each) and group (+3, once). Whole-token matching only.
 */
import type { TrainingBrief } from "../skill-workshop/brief.js";
import { fold } from "../app/util.js";
export { fold };

export interface MatchRole {
  id: string;
  description: string;
  name?: string;
  tags?: string[];
  group?: string;
  /** Full system prompt of an existing role (from the roles config), when known. */
  prompt?: string;
  tools?: string[];
}

export interface RoleMatch {
  id: string;
  score: number;
  reasons: string[];
}

export const KEYWORD_WEIGHT = 5;
export const DESCRIPTION_WEIGHT = 2;
export const GROUP_WEIGHT = 3;

const STOPWORDS = new Set([
  "the", "and", "for", "with", "from", "this", "that", "use", "after", "before", "are", "was", "not",
  "cho", "cac", "nhung", "mot", "voi", "trong", "cua", "va", "de", "khi", "nao", "duoc", "can", "den"
]);

/** Folded [a-z0-9]+ tokens, minus short (< 3 chars) and stopword tokens. */
export function tokenize(s: string): string[] {
  return (fold(s).match(/[a-z0-9]+/g) ?? []).filter((t) => t.length >= 3 && !STOPWORDS.has(t));
}

/** Assigns `group` = source when the role has none. */
export function withSource<T extends MatchRole>(roles: T[], source: "coding" | "training" | "library"): T[] {
  return roles.map((r) => (r.group ? r : { ...r, group: source }));
}

function briefText(brief: TrainingBrief | string): string {
  if (typeof brief === "string") return brief;
  return [brief.goal, ...Object.values(brief.inputs ?? {})].filter((v) => typeof v === "string").join(" ");
}

export function matchRoles(brief: TrainingBrief | string, roles: MatchRole[]): RoleMatch[] {
  const briefTokens = new Set(tokenize(briefText(brief ?? "")));
  if (briefTokens.size === 0) return [];
  const seen = new Set<string>();
  const out: RoleMatch[] = [];
  for (const role of roles) {
    if (seen.has(role.id)) continue;
    seen.add(role.id);
    const reasons: string[] = [];
    let score = 0;

    const keywords = new Set(
      role.tags && role.tags.length > 0
        ? role.tags.flatMap(tokenize)
        : [...tokenize(role.id), ...tokenize(role.name ?? "")]
    );
    for (const t of briefTokens) {
      if (keywords.has(t)) {
        score += KEYWORD_WEIGHT;
        reasons.push(`Khớp từ khóa "${t}"`);
      }
    }

    const descTokens = new Set(tokenize(role.description ?? ""));
    for (const t of briefTokens) {
      if (descTokens.has(t)) {
        score += DESCRIPTION_WEIGHT;
        reasons.push(`Mô tả chứa "${t}"`);
      }
    }

    if (role.group) {
      const g = tokenize(role.group).find((t) => briefTokens.has(t));
      if (g) {
        score += GROUP_WEIGHT;
        reasons.push(`Cùng nhóm "${g}"`);
      }
    }

    if (score > 0) out.push({ id: role.id, score, reasons });
  }
  return out.sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}
