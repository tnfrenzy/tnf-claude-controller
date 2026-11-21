// UI/UX Pro Max skill (vendored under config/skills/ui-ux-pro-max): pure helpers that decide when a coding run gets
// the instruction block, and append it to the implementer prompt. No I/O besides an injectable existence check.
import fs from "node:fs";
import path from "node:path";
import { fold } from "./role-catalog.js";

export const UX_SKILL_NAME = "ui-ux-pro-max";
export const MAX_UX_BLOCK_BYTES = 4096;

const WORD_KEYWORDS = /\b(ui|ux|css)\b/;
const SUBSTRING_KEYWORDS = ["giao dien", "man hinh", "layout", "landing", "dashboard", "component"];

export function wantsUxSkill(prompt: string | undefined | null, explicitSkills: readonly string[] | undefined | null, kind: string): boolean {
  if (kind !== "coding") return false;
  if ((explicitSkills ?? []).includes(UX_SKILL_NAME)) return true;
  const text = fold(prompt ?? "");
  if (!text.trim()) return false;
  return WORD_KEYWORDS.test(text) || SUBSTRING_KEYWORDS.some((k) => text.includes(k));
}

export function stripUxSkill(skills: readonly string[] | undefined | null): string[] {
  return (skills ?? []).filter((s) => s !== UX_SKILL_NAME);
}

export function buildUxSkillBlock(o: { skillDir: string; notesDir: string }): string {
  const script = path.join(o.skillDir, "scripts", "search.py");
  return [
    "## UI/UX design intelligence (ui-ux-pro-max)",
    "Use this ONLY for new UI/UX work or a significant visual redesign; skip it for small fixes.",
    "Generate a design system by running (Bash):",
    `python -X utf8 -I "${script}" "<query: product type, style, keywords>" --design-system --persist -p "<Project>" --output-dir "${o.notesDir}"`,
    `If \`python\` does not run, use: py -3 -X utf8 -I "${script}" "<query>" --design-system --persist -p "<Project>" --output-dir "${o.notesDir}"`,
    "Always pass BOTH --persist and --output-dir. Never write design files into the current directory or the worktree, and never commit them.",
    `The result is saved at ${path.join(o.notesDir, "design-system", "<slug>", "MASTER.md")}; read it, then apply it to the UI code following the target repo's own conventions.`,
    "Fallback: if writing there is blocked, run the same command WITHOUT --persist and read the design system from stdout.",
  ].join("\n");
}

export function appendUxBlock<T extends Record<string, Record<string, unknown>>>(roles: T, block: string): T {
  const impl = roles["implementer"];
  if (!impl || typeof impl["prompt"] !== "string") return roles;
  return { ...roles, implementer: { ...impl, prompt: `${impl["prompt"]}\n\n${block}` } };
}

export interface ApplyUxSkillInput {
  roles: Record<string, Record<string, unknown>>;
  prompt: string;
  skills: readonly string[] | undefined;
  kind: string;
  repoRoot: string;
  runDir: string;
  exists?: (p: string) => boolean;
}

export interface ApplyUxSkillResult {
  roles: Record<string, Record<string, unknown>>;
  skills: string[];
  applied: boolean;
  skillDir?: string;
  notesDir?: string;
}

export function applyUxSkill(i: ApplyUxSkillInput): ApplyUxSkillResult {
  const skills = stripUxSkill(i.skills);
  if (!wantsUxSkill(i.prompt, i.skills, i.kind)) return { roles: i.roles, skills, applied: false };
  const exists = i.exists ?? fs.existsSync;
  const skillDir = path.join(i.repoRoot, "config", "skills", UX_SKILL_NAME);
  if (!exists(path.join(skillDir, "scripts", "search.py"))) return { roles: i.roles, skills, applied: false };
  const notesDir = path.join(i.runDir, "notes");
  const roles = appendUxBlock(i.roles, buildUxSkillBlock({ skillDir, notesDir }));
  return { roles, skills, applied: true, skillDir, notesDir };
}
