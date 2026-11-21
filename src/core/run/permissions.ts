/** Allowlist construction for coding runs (CONTEXT-SPEC-v1 §4.2). Pure functions, no I/O. */

import { grantsToAllowedTools, type Grants } from "./grants.js";
import { slashes } from "../app/util.js";

const RULE_RE = /^Bash\((.+)\)$/;

/**
 * Validate one `project.allowed_commands` entry. Returns null when valid, otherwise a Vietnamese reason.
 * The fixed part (before the first `*`) must not chain commands or expand variables, and must not be a blanket rule.
 */
export function validateAllowedCommand(rule: string): string | null {
  const m = RULE_RE.exec(rule.trim());
  if (!m) return `Mẫu phải có dạng Bash(<lệnh>*), ví dụ Bash(pytest*): "${rule}"`;
  const inner = m[1]!;
  const fixed = inner.split("*")[0]!.trim();
  if (!fixed) return `Không được cấp quyền Bash rộng ("${rule}"); phải có tiền tố lệnh cụ thể.`;
  for (const bad of ["&&", "||", ";", "|", "$", "`", ">", "<", "\n"]) {
    if (fixed.includes(bad)) return `Phần cố định của mẫu không được chứa "${bad}" (lệnh ghép/mở rộng biến): "${rule}"`;
  }
  if (/^git\s*$/.test(fixed) || /^(sh|bash|cmd|powershell|pwsh)\b/.test(fixed)) return `Không cấp "${rule}": quá rộng (git *, shell lồng).`;
  return null;
}

export const SKILL_NAME_RE = /^[A-Za-z0-9:_-]{1,80}$/;

/** `Skill(<name>)` allow rules for the skills a run asked for. Throws (Vietnamese) on a bad name. */
export function skillRules(skills: string[] | undefined): string[] {
  const out: string[] = [];
  for (const s of skills ?? []) {
    if (!SKILL_NAME_RE.test(s)) throw new Error(`Tên skill "${s}" không hợp lệ (chỉ chữ, số, : _ -).`);
    const rule = `Skill(${s})`;
    if (!out.includes(rule)) out.push(rule);
  }
  return out;
}

/** Research runs: base allowlist plus the run's Skill(...) rules (no Bash is ever added). */
export function buildResearchAllowedTools(base: string[], skills?: string[]): string[] {
  const out = [...base];
  for (const r of skillRules(skills)) if (!out.includes(r)) out.push(r);
  return out;
}

/**
 * Baseline every coding environment gets, on top of `defaults.coding.allowedTools` (so installs that keep an older
 * controller.json still receive it): web search/fetch, todo list, common read/build/test shell commands and safe git
 * extras. Dangerous commands stay blocked by deny-settings.json and `disallowedTools` (deny wins over allow).
 */
export const CODING_ENV_TOOLS: readonly string[] = [
  "WebSearch", "WebFetch", "TodoWrite",
  "Bash(npm *)", "Bash(npx *)", "Bash(pnpm *)", "Bash(yarn *)", "Bash(tsc*)", "Bash(vitest*)", "Bash(eslint*)", "Bash(prettier*)",
  "Bash(python *)", "Bash(python3 *)", "Bash(py *)", "Bash(pytest*)", "Bash(pip list*)", "Bash(pip show*)", "Bash(pip install*)", "Bash(uv *)",
  "Bash(dotnet *)", "Bash(cargo *)", "Bash(go *)", "Bash(make*)",
  "Bash(ls*)", "Bash(dir*)", "Bash(cat *)", "Bash(type *)", "Bash(head *)", "Bash(tail *)", "Bash(wc *)", "Bash(find *)", "Bash(grep *)", "Bash(rg *)",
  "Bash(echo *)", "Bash(pwd*)", "Bash(where *)", "Bash(which *)", "Bash(mkdir *)", "Bash(cp *)", "Bash(mv *)", "Bash(touch *)", "Bash(sort*)", "Bash(diff *)",
  "Bash(Get-ChildItem*)", "Bash(Get-Content*)", "Bash(Select-String*)", "Bash(Test-Path*)", "Bash(Get-Location*)", "Bash(findstr *)",
  "Bash(git stash*)", "Bash(git restore*)", "Bash(git mv*)", "Bash(git blame*)", "Bash(git tag*)", "Bash(git describe*)",
  "Bash(git reset*)", "Bash(git checkout HEAD*)", "Bash(git --version*)", "Bash(git version*)", "Bash(claude auth status*)",
  "Bash(powershell -NoProfile -File scripts/start.ps1*)", "Bash(powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1*)", "Bash(powershell -NoProfile -File scripts/stop.ps1*)",
  "Bash(git config --get*)", "Bash(git config --list*)", "Bash(git cherry-pick*)",
];

export interface BuildAllowedToolsOptions {
  /** Skills requested for this run, added as `Skill(<name>)`. */
  skills?: string[];
  /** Union of role tools from config (defaults.coding.allowedTools). */
  base: string[];
  /** `project.allowed_commands`, each a Bash(...) pattern. */
  projectCommands: string[];
  worktreePath: string;
  runDir: string;
  /** Per-environment ticks; absent = legacy behaviour (CODING_ENV_TOOLS, Edit/Write allowed). */
  grants?: Grants;
}

/** Tools the idea-splitter run must never have. */
export const SPLITTER_DISALLOWED_TOOLS = ["Bash", "Edit", "Write", "NotebookEdit", "Agent"] as const;

/** Throws (Vietnamese) if any tool in the list could write, run commands or spawn agents. */
export function assertReadOnlyTools(list: string[]): void {
  for (const t of list) {
    const name = t.trim().split("(")[0]!.trim();
    if ((SPLITTER_DISALLOWED_TOOLS as readonly string[]).includes(name)) {
      throw new Error(`Chế độ chỉ đọc không được cấp công cụ "${t}".`);
    }
  }
}

/** Allowlist of the read-only idea-splitter: Read/Grep/Glob on the repo, plus web tools only when enabled. */
export function buildSplitterAllowedTools(o: { repoPath: string; webSearch: boolean }): string[] {
  const repo = slashes(o.repoPath);
  const out = [`Read(${repo}/**)`, `Grep(${repo}/**)`, `Glob(${repo}/**)`];
  if (o.webSearch) out.push("WebSearch", "WebFetch");
  assertReadOnlyTools(out);
  return out;
}

/** Read-only web tools granted only to scout coding runs (session level). */
export function buildScoutWebTools(): string[] {
  const out = ["WebSearch", "WebFetch"];
  assertReadOnlyTools(out);
  return out;
}

/**
 * Scope Edit/Write to the worktree, allow Write into <run-dir>/notes, append validated project commands.
 * Paths use `/` (S6c verified the CLI matches them on Windows). Throws on an invalid project command.
 */
export function buildCodingAllowedTools(o: BuildAllowedToolsOptions): string[] {
  const wt = slashes(o.worktreePath);
  const notes = `${slashes(o.runDir)}/notes`;
  const out: string[] = [];
  const push = (t: string) => {
    if (!out.includes(t)) out.push(t);
  };
  const fileWrite = o.grants ? o.grants.fileWrite : true;
  for (const t of o.base) {
    if (t === "Edit") {
      if (fileWrite) push(`Edit(${wt}/**)`);
    } else if (t === "Write") {
      if (fileWrite) push(`Write(${wt}/**)`);
      push(`Write(${notes}/**)`);
    } else push(t);
  }
  if (fileWrite) push(`NotebookEdit(${wt}/**)`);
  for (const t of o.grants ? grantsToAllowedTools(o.grants) : CODING_ENV_TOOLS) push(t);
  for (const r of skillRules(o.skills)) push(r);
  for (const rule of o.projectCommands) {
    const err = validateAllowedCommand(rule);
    if (err) throw new Error(`project.allowed_commands không hợp lệ: ${err}`);
    push(rule.trim());
  }
  return out;
}
