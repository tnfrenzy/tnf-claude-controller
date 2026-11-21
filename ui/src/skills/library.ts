// Pure helpers for the library UI (no React): kept here so they can be unit-tested with vitest.
import type { AgentMdPreview, AgentMdWarning, CatalogRole, ExtraAgentInput, LibraryItem, LibraryRole } from "../types";

/** Max size (bytes) of a Markdown file accepted for library import. */
export const MAX_IMPORT_MD_BYTES = 131072;

/** True for names ending in .md or .markdown (case-insensitive) with a non-empty stem; a bare ".md" is false. */
export function isAgentMdFileName(name: string): boolean {
  return /[^/\\]\.(md|markdown)$/i.test(name);
}

export function importWarningKey(w: AgentMdWarning): string {
  return "lib_import_warn_" + w;
}

export function importBlockedKey(b: NonNullable<AgentMdPreview["blocked"]>): string {
  return "lib_import_blocked_" + (b === "license_not_permissive" ? "license" : b);
}

/** Same cap as the server (src/core/run/extras.ts MAX_EXTRA_AGENTS): rows + library roles + roles pulled in by items. */
export const MAX_RUN_AGENTS = 5;

export interface ExtraRow {
  name: string;
  description: string;
  prompt: string;
  tools: string[];
}

/** Rows the user left empty are ignored, like the server-side form logic always did. */
export function nonEmptyRows(rows: ExtraRow[]): ExtraRow[] {
  return rows.filter((r) => r.name.trim() || r.description.trim() || r.prompt.trim());
}

/** How a ticked item lands in a run: roles it feeds, roles it drags in, and roles that do not exist in this run kind. */
export interface ItemEffect {
  /** built-in roles of this run kind that get the text appended */
  applied: string[];
  /** custom library roles pulled into the run because the item names them */
  pulled: string[];
  /** built-in roles that exist only in the other run kind (the server skips them) */
  skipped: string[];
  /** true when the item names no role: the text goes to the coordinator only */
  coordinatorOnly: boolean;
}

export function itemEffect(item: LibraryItem, kindRoles: string[], builtinRoles: string[]): ItemEffect {
  const out: ItemEffect = { applied: [], pulled: [], skipped: [], coordinatorOnly: item.roleIds.length === 0 };
  for (const r of item.roleIds) {
    if (kindRoles.includes(r)) out.applied.push(r);
    else if (builtinRoles.includes(r)) out.skipped.push(r);
    else out.pulled.push(r);
  }
  return out;
}

export interface RunAgentPlan {
  /** the `agents` field for POST /api/runs (library roles first, then hand-written rows) */
  agents: Record<string, ExtraAgentInput>;
  /** distinct custom roles the run will contain: ticked roles, rows, and roles pulled in by ticked items */
  names: string[];
  /** Vietnamese-free error code; the page maps it to a message */
  error: null | "limit" | "clash";
  clash?: string;
}

function toAgent(r: LibraryRole): ExtraAgentInput {
  const a: ExtraAgentInput = { description: r.description, prompt: r.prompt };
  if (r.tools) a.tools = r.tools;
  if (r.model) a.model = r.model;
  return a;
}

/**
 * Build the `agents` body field and count the custom roles the run would contain.
 * A library role named by a ticked item is added by the server itself, so it is counted here but not sent.
 */
export function planRunAgents(args: {
  libraryRoles: LibraryRole[];
  tickedRoleIds: string[];
  rows: ExtraRow[];
  tickedItems: LibraryItem[];
  kindRoles: string[];
  builtinRoles: string[];
}): RunAgentPlan {
  const agents: Record<string, ExtraAgentInput> = {};
  const names = new Set<string>();
  for (const id of args.tickedRoleIds) {
    const role = args.libraryRoles.find((r) => r.id === id);
    if (!role) continue;
    agents[id] = toAgent(role);
    names.add(id);
  }
  for (const r of nonEmptyRows(args.rows)) {
    const name = r.name.trim();
    if (name in agents || args.kindRoles.includes(name)) return { agents, names: [...names], error: "clash", clash: name };
    agents[name] = { description: r.description, prompt: r.prompt, tools: r.tools };
    names.add(name);
  }
  for (const item of args.tickedItems) for (const p of itemEffect(item, args.kindRoles, args.builtinRoles).pulled) names.add(p);
  return { agents, names: [...names], error: names.size > MAX_RUN_AGENTS ? "limit" : null };
}

/** Role choices for an item editor: built-in roles first, then library roles. */
export function roleChoices(builtinRoles: string[], libraryRoles: LibraryRole[]): { id: string; builtin: boolean }[] {
  const seen = new Set<string>();
  const out: { id: string; builtin: boolean }[] = [];
  const all = [...builtinRoles.map((id) => ({ id, builtin: true })), ...libraryRoles.map((r) => ({ id: r.id, builtin: false }))];
  for (const c of all) {
    if (seen.has(c.id)) continue;
    seen.add(c.id);
    out.push(c);
  }
  return out;
}

/** Catalog card state: already in the library or can be added. */
export function catalogState(role: Pick<CatalogRole, "id">, inLibrary: string[]): "in_library" | "addable" {
  return inLibrary.includes(role.id) ? "in_library" : "addable";
}

/** Human-readable size of an item's text, e.g. "1.5 KB". */
export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  return `${(n / 1024).toFixed(1)} KB`;
}

// `{{{{` is an escape for a literal `{{`; `{{name}}` is a slot.
const SLOT_RE = () => /\{\{\{\{|\{\{([\p{L}\p{N}_]+)\}\}/gu;

/** Unique slot names in order of first appearance. */
export function extractSlots(content: string): string[] {
  const out: string[] = [];
  for (const m of content.matchAll(SLOT_RE())) {
    const name = m[1];
    if (name && !out.includes(name)) out.push(name);
  }
  return out;
}

/** Replace every `{{name}}` with its value (replacer function: `$&` and `$'` stay literal). Missing values stay as written. */
export function fillTemplate(content: string, values: Record<string, string>): string {
  return content.replace(SLOT_RE(), (whole, name: string | undefined) => {
    if (name === undefined) return "{{";
    return Object.prototype.hasOwnProperty.call(values, name) ? (values[name] as string) : whole;
  });
}

/** Slots whose value is empty or whitespace only. */
export function missingSlots(content: string, values: Record<string, string>): string[] {
  return extractSlots(content).filter((n) => !(values[n] ?? "").trim());
}

/** Label for a slot input: underscores become spaces. */
export function slotLabel(name: string): string {
  return name.replace(/_/g, " ");
}

/** UTF-8 byte length without Buffer (browser). */
export function utf8Bytes(s: string): number {
  return new TextEncoder().encode(s).length;
}
