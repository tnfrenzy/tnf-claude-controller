/**
 * Pure assembly of a skill "agent set" from a role ranking: no I/O, never throws.
 * Error messages are Vietnamese; code is English.
 */
import { DEFAULT_EXTRA_TOOLS, MAX_DESCRIPTION, MAX_PROMPT, MAX_EXTRA_AGENTS } from "../run/extras.js";
import { KEYWORD_WEIGHT, type MatchRole, type RoleMatch } from "./role-match.js";
import { SkillError, validateSlug } from "../skill-workshop/package.js";

export interface NewAgentInput {
  id: string;
  description: string;
  prompt: string;
  tools?: string[];
}

export interface SkillAgent {
  id: string;
  description: string;
  prompt?: string;
  tools: string[];
  source: "existing" | "new";
}

/**
 * Tools that a NEW agent may never get (also matched in the `Name(...)` form).
 * Intentional: the allowlist for new agents is read/search only (no Edit/Write), which is
 * stricter than SAFE_AGENT_TOOLS in extras.ts on purpose.
 */
export const FORBIDDEN_AGENT_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit", "Agent"] as const;
export const ALLOWED_NEW_AGENT_TOOLS = ["Read", "Grep", "Glob", "WebSearch", "WebFetch"] as const;

const EXISTING_PROMPT_MAX = 4000;

export type ValidateNewAgentResult = { ok: true; agent: SkillAgent } | { ok: false; errors: string[] };

export function validateNewAgent(input: NewAgentInput, takenIds: Iterable<string> = []): ValidateNewAgentResult {
  const errors: string[] = [];
  const raw = (input ?? {}) as Partial<NewAgentInput>;

  let id = "";
  try {
    id = validateSlug(raw.id);
  } catch (e) {
    errors.push(`Mã agent không hợp lệ: ${e instanceof SkillError ? e.message : "sai định dạng"}`);
  }
  if (id) {
    const lower = id.toLowerCase();
    for (const t of takenIds) {
      if (String(t).toLowerCase() === lower) {
        errors.push(`Mã agent "${id}" đã tồn tại.`);
        break;
      }
    }
  }

  const label = id || "(không hợp lệ)";
  const description = typeof raw.description === "string" ? raw.description.trim() : "";
  if (!description) errors.push(`Agent "${label}": mô tả không được để trống.`);
  else if (description.length > MAX_DESCRIPTION) errors.push(`Agent "${label}": mô tả quá dài (tối đa ${MAX_DESCRIPTION} ký tự).`);

  const prompt = typeof raw.prompt === "string" ? raw.prompt.trim() : "";
  if (!prompt) errors.push(`Agent "${label}": prompt không được để trống.`);
  else if (prompt.length > MAX_PROMPT) errors.push(`Agent "${label}": prompt quá dài (tối đa ${MAX_PROMPT} ký tự).`);

  let tools: string[] = [...DEFAULT_EXTRA_TOOLS];
  if (raw.tools !== undefined) {
    if (!Array.isArray(raw.tools)) {
      errors.push(`Agent "${label}": danh sách công cụ phải là mảng.`);
    } else {
      const seen: string[] = [];
      for (const t of raw.tools) {
        const name = typeof t === "string" ? t.trim() : "";
        const base = name.replace(/\(.*$/s, "");
        if ((FORBIDDEN_AGENT_TOOLS as readonly string[]).includes(base)) {
          errors.push(`Agent "${label}": công cụ nguy hiểm không được cấp: ${name}.`);
        } else if (!(ALLOWED_NEW_AGENT_TOOLS as readonly string[]).includes(name)) {
          errors.push(`Agent "${label}": công cụ không nằm trong danh sách cho phép: ${String(t).slice(0, 40)}.`);
        } else if (!seen.includes(name)) {
          seen.push(name);
        }
      }
      tools = seen.length ? seen : tools;
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, agent: { id, description, prompt, tools, source: "new" } };
}

export interface BuildSkillAgentSetInput {
  matches: RoleMatch[];
  roles: MatchRole[];
  newAgents?: NewAgentInput[];
  /** Minimum score to select an existing role (default KEYWORD_WEIGHT = 5). */
  minScore?: number;
  /** Max existing roles selected (default MAX_EXTRA_AGENTS = 5). */
  maxRoles?: number;
}

export type BuildSkillAgentSetResult =
  | {
      ok: true;
      agents: SkillAgent[];
      selectedIds: string[];
      addedIds: string[];
      /** True when no existing role reached minScore. */
      missing: boolean;
      warnings: string[];
    }
  | { ok: false; errors: string[] };

/**
 * Convention: missing=true with no new agents is NOT an error: returns ok:true, agents=[]
 * and a warning, so the caller decides whether to ask for new agents.
 * The number of new agents is capped by MAX_EXTRA_AGENTS on its own (not added to maxRoles).
 * Existing roles get tools=[]: MatchRole has no tools field; their permissions come from the role config.
 */
export function buildSkillAgentSet(input: BuildSkillAgentSetInput): BuildSkillAgentSetResult {
  const matches = Array.isArray(input?.matches) ? input.matches : [];
  const roles = Array.isArray(input?.roles) ? input.roles : [];
  const newAgents = Array.isArray(input?.newAgents) ? input.newAgents : [];
  const minScore = input?.minScore ?? KEYWORD_WEIGHT;
  const maxRoles = input?.maxRoles ?? MAX_EXTRA_AGENTS;
  const warnings: string[] = [];
  const errors: string[] = [];

  const roleById = new Map(roles.map((r) => [r.id, r]));
  const ranked = matches
    .map((m, i) => ({ m, i }))
    .filter(({ m }) => m.score >= minScore)
    .sort((a, b) => b.m.score - a.m.score || a.i - b.i);

  const agents: SkillAgent[] = [];
  const selectedIds: string[] = [];
  for (const { m } of ranked) {
    if (selectedIds.length >= maxRoles) break;
    if (selectedIds.includes(m.id)) continue;
    const role = roleById.get(m.id);
    if (!role) {
      warnings.push(`Bỏ qua vai "${m.id}": không có trong danh sách vai.`);
      continue;
    }
    selectedIds.push(role.id);
    const rolePrompt = typeof role.prompt === "string" ? role.prompt.trim().slice(0, EXISTING_PROMPT_MAX) : "";
    const roleTools = Array.isArray(role.tools)
      ? [...new Set(role.tools.filter((t): t is string => typeof t === "string").map((t) => t.trim()).filter((t) => t && !(FORBIDDEN_AGENT_TOOLS as readonly string[]).includes(t.replace(/\(.*$/s, ""))))]
      : [];
    agents.push({ id: role.id, description: role.description, ...(rolePrompt ? { prompt: rolePrompt } : {}), tools: roleTools, source: "existing" });
  }
  const missing = selectedIds.length === 0;

  if (newAgents.length > MAX_EXTRA_AGENTS) {
    errors.push(`Quá nhiều agent mới: tối đa ${MAX_EXTRA_AGENTS}, nhận ${newAgents.length}.`);
  } else {
    const taken = new Set<string>([...selectedIds, ...roles.map((r) => r.id)]);
    const addedIds: string[] = [];
    for (const na of newAgents) {
      const r = validateNewAgent(na, taken);
      if (r.ok) {
        taken.add(r.agent.id);
        addedIds.push(r.agent.id);
        agents.push(r.agent);
      } else {
        errors.push(...r.errors);
      }
    }
    if (errors.length === 0) {
      if (missing && addedIds.length === 0) {
        warnings.push("Không có vai nào đủ điểm và chưa thêm agent mới: bộ agent đang rỗng.");
      }
      return { ok: true, agents, selectedIds, addedIds, missing, warnings };
    }
  }
  return { ok: false, errors };
}
