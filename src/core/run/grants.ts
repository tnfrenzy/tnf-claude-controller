/** Per-environment permission ticks (spec 2026-11-09 §3). Pure functions, no I/O. */
import type { McpServer } from "../mcp/mcp-registry.js";
import { slashes } from "../app/util.js";

export type McpAccess = "off" | "read" | "full";
export interface ExtraDir { path: string; write: boolean }
export interface Grants {
  fileWrite: boolean; web: boolean;
  cmdNode: boolean; cmdPython: boolean; cmdNative: boolean; cmdBasic: boolean; cmdInstall: boolean; gitRestore: boolean;
  /** Let MCP "process" tools (Desktop Commander start_process…) run arbitrary commands. Bypasses deny rules: off by default. */
  anyProcess: boolean;
  /** controller checks this before launching a dev server/app for Xem trước; no CLI rules. */
  preview: boolean;
  extraDirs: ExtraDir[];
  mcp: Record<string, McpAccess>;
}

export const BOOL_KEYS = ["fileWrite", "web", "cmdNode", "cmdPython", "cmdNative", "cmdBasic", "cmdInstall", "gitRestore", "anyProcess", "preview"] as const;

export const DEFAULT_GRANTS: Grants = {
  fileWrite: true, web: true, cmdNode: true, cmdPython: true, cmdNative: true, cmdBasic: true, cmdInstall: true, gitRestore: true,
  anyProcess: false, preview: false, extraDirs: [], mcp: {},
};

const b = (...names: string[]) => names.map((n) => `Bash(${n})`);

/** Rules of each group; their union with ALWAYS_RULES equals CODING_ENV_TOOLS (test-enforced). */
export const GROUP_RULES: Record<"web" | "cmdNode" | "cmdPython" | "cmdNative" | "cmdBasic" | "cmdInstall" | "gitRestore", string[]> = {
  web: ["WebSearch", "WebFetch"],
  cmdNode: b("npm *", "npx *", "pnpm *", "yarn *", "tsc*", "vitest*", "eslint*", "prettier*"),
  cmdPython: b("python *", "python3 *", "py *", "pytest*", "pip list*", "pip show*", "uv *"),
  cmdInstall: b("pip install*"),
  cmdNative: b("dotnet *", "cargo *", "go *", "make*"),
  cmdBasic: b("ls*", "dir*", "cat *", "type *", "head *", "tail *", "wc *", "find *", "grep *", "rg *", "echo *", "pwd*", "where *", "which *", "mkdir *", "cp *", "mv *", "touch *", "sort*", "diff *",
    "Get-ChildItem*", "Get-Content*", "Select-String*", "Test-Path*", "Get-Location*", "findstr *"),
  gitRestore: b("git stash*", "git restore*", "git reset*", "git checkout HEAD*"),
};
export const ALWAYS_RULES: string[] = [
  "TodoWrite",
  ...b("git mv*", "git blame*", "git tag*", "git describe*", "git --version*", "git version*", "claude auth status*",
    "powershell -NoProfile -File scripts/start.ps1*", "powershell -NoProfile -ExecutionPolicy Bypass -File scripts/start.ps1*", "powershell -NoProfile -File scripts/stop.ps1*",
    "git config --get*", "git config --list*", "git cherry-pick*"),
];

/** null when valid, else a Vietnamese reason. */
export function validateExtraDir(p: string): string | null {
  const s = p.trim();
  if (!/^[A-Za-z]:[\\/]/.test(s) && !s.startsWith("/")) return `Thư mục phải là đường dẫn tuyệt đối: "${p}"`;
  if (s.split(/[\\/]/).includes("..")) return `Đường dẫn không được chứa "..": "${p}"`;
  if (s.split(/[\\/]/).includes(".")) return `Đường dẫn không được chứa đoạn ".": "${p}"`;
  const meta = /[*?[\](){}]/.exec(s);
  if (meta) return `Đường dẫn không được chứa ký tự "${meta[0]}": "${p}"`;
  if (/^[A-Za-z]:[\\/]*$/.test(s) || s === "/")return `Không cấp cả ổ đĩa gốc: "${p}"`;
  return null;
}

const ACCESS = new Set(["off", "read", "full"]);

export function sanitizeGrants(raw: unknown): Grants {
  const r = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
  const out: Grants = { ...DEFAULT_GRANTS, extraDirs: [], mcp: {} };
  for (const k of BOOL_KEYS) if (typeof r[k] === "boolean") out[k] = r[k] as boolean;
  if (Array.isArray(r["extraDirs"])) {
    for (const d of r["extraDirs"] as unknown[]) {
      if (typeof d !== "object" || d === null) continue;
      const p = (d as Record<string, unknown>)["path"];
      if (typeof p !== "string" || validateExtraDir(p) !== null) continue;
      out.extraDirs.push({ path: p.trim(), write: (d as Record<string, unknown>)["write"] === true });
    }
  }
  if (typeof r["mcp"] === "object" && r["mcp"] !== null) {
    for (const [k, v] of Object.entries(r["mcp"] as Record<string, unknown>)) {
      if (k.length <= 100 && typeof v === "string" && ACCESS.has(v) && v !== "off") out.mcp[k] = v as McpAccess;
    }
  }
  return out;
}

/** Project grants (if any) win over the app-wide default profile, which wins over the built-in default. */
export function resolveGrants(project: unknown, appDefault: unknown): Grants {
  const hasProject = typeof project === "object" && project !== null && Object.keys(project).length > 0;
  return sanitizeGrants(hasProject ? project : appDefault);
}

/** Everything except Edit/Write/NotebookEdit in the worktree (those depend on `fileWrite`, handled in buildCodingAllowedTools). */
export function grantsToAllowedTools(g: Grants): string[] {
  const out = [...ALWAYS_RULES];
  for (const [k, rules] of Object.entries(GROUP_RULES)) if (g[k as keyof typeof GROUP_RULES]) out.push(...rules);
  for (const d of g.extraDirs) {
    const s = slashes(d.path);
    out.push(`Read(${s}/**)`, `Glob(${s}/**)`, `Grep(${s}/**)`);
    if (d.write) out.push(`Edit(${s}/**)`, `Write(${s}/**)`);
  }
  return out;
}

/**
 * Deny rules for what is NOT ticked. Coding runs use bypassPermissions, where the allowlist restricts nothing and
 * only `--disallowedTools` does. Default grants produce an empty list.
 */
export function grantsToDisallowedTools(g: Grants, worktreePath: string): string[] {
  const out: string[] = [];
  const push = (t: string) => {
    if (!out.includes(t)) out.push(t);
  };
  for (const [k, rules] of Object.entries(GROUP_RULES)) if (!g[k as keyof typeof GROUP_RULES]) for (const r of rules) push(r);
  if (!g.fileWrite) {
    const wt = slashes(worktreePath);
    push(`Edit(${wt}/**)`);
    push(`Write(${wt}/**)`);
    push(`NotebookEdit(${wt}/**)`);
  }
  for (const d of g.extraDirs) {
    if (d.write) continue;
    const s = slashes(d.path);
    push(`Edit(${s}/**)`);
    push(`Write(${s}/**)`);
  }
  return out;
}

export function grantsAddDirs(g: Grants): string[] {
  return g.extraDirs.map((d) => d.path);
}

/** Claude Code names MCP tools `mcp__<server with non [A-Za-z0-9_-] replaced by _>__<tool>`. */
export function mcpPrefix(name: string): string {
  return `mcp__${name.replace(/[^A-Za-z0-9_-]/g, "_")}`;
}

export interface McpPlan { config: { mcpServers: Record<string, unknown> } | null; allowed: string[]; disallowed: string[]; strict: boolean }

function configEntry(s: McpServer): Record<string, unknown> {
  if (s.kind === "http") return { type: "http", url: s.url, ...(s.headers && Object.keys(s.headers).length ? { headers: s.headers } : {}) };
  return { command: s.command, ...(s.args?.length ? { args: s.args } : {}), ...(s.env && Object.keys(s.env).length ? { env: s.env } : {}) };
}

/**
 * Turn the MCP ticks into `--mcp-config` content and allow/deny rules. Under bypassPermissions only the deny rules
 * actually restrict, so "read" and "no process" are expressed as `--disallowedTools` on the server's known tools.
 * `kind:"cli"` servers (plugin / claude.ai connectors) are managed by the CLI: not written to mcp.json, and every
 * non-granted one is denied as a whole so it cannot be used by accident when strict mode is off.
 */
export function planMcp(g: Grants, servers: McpServer[]): McpPlan {
  const cfg: Record<string, unknown> = {};
  const allowed: string[] = [];
  const disallowed: string[] = [];
  let hasCli = false;
  for (const s of servers) {
    const access = g.mcp[s.id] ?? "off";
    const prefix = mcpPrefix(s.id);
    if (!s.enabled || access === "off") {
      if (s.kind === "cli") disallowed.push(prefix);
      continue;
    }
    if (s.kind === "cli") hasCli = true;
    else cfg[s.id] = configEntry(s);
    allowed.push(prefix);
    for (const t of s.blockedTools ?? []) disallowed.push(`${prefix}__${t}`);
    if (!g.anyProcess || access === "read") for (const t of s.processTools ?? []) disallowed.push(`${prefix}__${t}`);
    if (access === "read") for (const t of s.writeTools ?? []) disallowed.push(`${prefix}__${t}`);
  }
  const granted = allowed.length > 0;
  return { config: Object.keys(cfg).length ? { mcpServers: cfg } : null, allowed, disallowed: granted ? disallowed : [], strict: !hasCli };
}
