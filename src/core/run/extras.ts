import fs from "node:fs";
import { SKILL_NAME_RE } from "./permissions.js";

/** Per-run extra subagent, as accepted by the API (`agents: Record<name, def>`) and written into the run's roles.json. */
export interface ExtraAgentDef {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

/** Tools an extra agent may use. No Bash (not even scoped), no `*`, no Agent. */
export const SAFE_AGENT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "WebSearch", "WebFetch"] as const;
export const DEFAULT_EXTRA_TOOLS = ["Read", "Grep", "Glob"];
export const MAX_EXTRA_AGENTS = 5;
export const MAX_SKILLS = 10;
export const MAX_DESCRIPTION = 300;
export const MAX_PROMPT = 4000;

const NAME_RE = /^[a-z0-9-]{1,40}$/;
const MODEL_RE = /^[A-Za-z0-9._-]{1,64}$/;
const KEYS = new Set(["description", "prompt", "tools", "model"]);

/**
 * Validate the extra agents of one run. `existingRoles` = names of the built-in roles (no clashes allowed).
 * Returns a clean copy (only description/prompt/tools/model). Throws with a Vietnamese message.
 */
export function validateExtraAgents(raw: unknown, existingRoles: string[]): Record<string, ExtraAgentDef> {
  const out: Record<string, ExtraAgentDef> = {};
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("agents phải là một đối tượng {tên: định nghĩa}.");
  const entries = Object.entries(raw as Record<string, unknown>);
  if (entries.length > MAX_EXTRA_AGENTS) throw new Error(`Tối đa ${MAX_EXTRA_AGENTS} agent thêm cho mỗi run.`);
  for (const [name, def] of entries) {
    if (!NAME_RE.test(name)) throw new Error(`Tên agent "${name}" không hợp lệ (chỉ a-z, 0-9, dấu gạch ngang; tối đa 40 ký tự).`);
    if (existingRoles.includes(name)) throw new Error(`Tên agent "${name}" trùng với vai có sẵn.`);
    if (typeof def !== "object" || def === null || Array.isArray(def)) throw new Error(`Định nghĩa agent "${name}" không hợp lệ.`);
    const d = def as Record<string, unknown>;
    for (const k of Object.keys(d)) if (!KEYS.has(k)) throw new Error(`Agent "${name}" có khóa không được hỗ trợ: ${k}.`);
    const description = typeof d["description"] === "string" ? d["description"].trim() : "";
    const prompt = typeof d["prompt"] === "string" ? d["prompt"].trim() : "";
    if (!description || description.length > MAX_DESCRIPTION) throw new Error(`Mô tả agent "${name}" phải có 1-${MAX_DESCRIPTION} ký tự.`);
    if (!prompt || prompt.length > MAX_PROMPT) throw new Error(`Prompt agent "${name}" phải có 1-${MAX_PROMPT} ký tự.`);
    const clean: ExtraAgentDef = { description, prompt };
    if (d["tools"] !== undefined) {
      if (!Array.isArray(d["tools"]) || d["tools"].some((t) => typeof t !== "string")) throw new Error(`Công cụ của agent "${name}" phải là mảng chuỗi.`);
      const tools = [...new Set((d["tools"] as string[]).map((t) => t.trim()))];
      for (const t of tools) {
        if (!(SAFE_AGENT_TOOLS as readonly string[]).includes(t)) throw new Error(`Công cụ "${t}" của agent "${name}" không nằm trong danh sách an toàn (${SAFE_AGENT_TOOLS.join(", ")}); không cho Bash hay "*".`);
      }
      clean.tools = tools.length ? tools : DEFAULT_EXTRA_TOOLS;
    } else clean.tools = DEFAULT_EXTRA_TOOLS;
    if (d["model"] !== undefined) {
      if (typeof d["model"] !== "string" || !MODEL_RE.test(d["model"])) throw new Error(`Model của agent "${name}" không hợp lệ.`);
      clean.model = d["model"];
    }
    out[name] = clean;
  }
  return out;
}

/** Validate skill names (`Skill(<name>)` goes into --allowedTools). Throws with a Vietnamese message. */
export function validateSkills(raw: unknown): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw) || raw.some((s) => typeof s !== "string")) throw new Error("skills phải là mảng chuỗi.");
  const list = [...new Set((raw as string[]).map((s) => s.trim()).filter(Boolean))];
  if (list.length > MAX_SKILLS) throw new Error(`Tối đa ${MAX_SKILLS} skill cho mỗi run.`);
  for (const s of list) if (!SKILL_NAME_RE.test(s)) throw new Error(`Tên skill "${s}" không hợp lệ (chỉ chữ, số, : _ -).`);
  return list;
}

/** Parse the text of a CLI `--agent-file` (JSON object name → definition). Throws with a Vietnamese message. */
export function parseAgentFileText(text: string): Record<string, unknown> {
  let j: unknown;
  try {
    j = JSON.parse(text.replace(/^﻿/, ""));
  } catch (e) {
    throw new Error(`File agent không phải JSON hợp lệ: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (typeof j !== "object" || j === null || Array.isArray(j)) throw new Error("File agent phải là một đối tượng JSON {tên: {description, prompt, tools?, model?}}.");
  return j as Record<string, unknown>;
}

/** Read and parse `--agent-file` (UTF-8). Throws with a Vietnamese message when missing or malformed. */
export function readAgentFile(file: string): Record<string, unknown> {
  let text: string;
  try {
    text = fs.readFileSync(file, "utf8");
  } catch {
    throw new Error(`Không đọc được file agent: ${file}`);
  }
  return parseAgentFileText(text);
}

/** Text for the coordinator's `{{extraAgents}}` placeholder; empty when there are none. */
export function describeExtraAgents(agents: Record<string, ExtraAgentDef>): string {
  const names = Object.keys(agents);
  if (!names.length) return "";
  return `Additional agents chosen by the user for this run (you may delegate to them with the Agent tool, one call at a time): ${names.map((n) => `${n} (${agents[n]!.description})`).join("; ")}.`;
}
