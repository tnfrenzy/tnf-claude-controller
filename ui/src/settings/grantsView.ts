import type { CliMcpView, GrantsView } from "../api";

export const GROUP_FIELDS: Array<{ key: keyof GrantsView & string; labelKey: string }> = [
  { key: "fileWrite", labelKey: "grants_file_write" },
  { key: "web", labelKey: "grants_web" },
  { key: "cmdNode", labelKey: "grants_cmd_node" },
  { key: "cmdPython", labelKey: "grants_cmd_python" },
  { key: "cmdNative", labelKey: "grants_cmd_native" },
  { key: "cmdBasic", labelKey: "grants_cmd_basic" },
  { key: "cmdInstall", labelKey: "grants_cmd_install" },
  { key: "gitRestore", labelKey: "grants_git_restore" },
];

export function setMcpAccess(g: GrantsView, id: string, access: "off" | "read" | "full"): GrantsView {
  const mcp = { ...g.mcp };
  if (access === "off") delete mcp[id];
  else mcp[id] = access;
  return { ...g, mcp };
}

/** Trim and strip trailing slashes/backslashes (keeps a bare drive root like "D:\\" intact). */
export function normalizeDirPath(p: string): string {
  const t = p.trim().replace(/[\\/]+$/, "");
  return /^[A-Za-z]:$/.test(t) ? t + "\\" : t;
}

export function addDir(g: GrantsView, path: string, write = false): GrantsView {
  const p = normalizeDirPath(path);
  if (!p || g.extraDirs.some((d) => normalizeDirPath(d.path).toLowerCase() === p.toLowerCase())) return g;
  return { ...g, extraDirs: [...g.extraDirs, { path: p, write }] };
}

export function removeDir(g: GrantsView, path: string): GrantsView {
  return { ...g, extraDirs: g.extraDirs.filter((d) => d.path !== path) };
}

export function isLocalHost(h: string): boolean {
  return h === "localhost" || h === "127.0.0.1" || h === "[::1]" || h === "::1";
}

/** claude.ai connectors the CLI knows about (plugin servers are not loaded by coding runs); access is off/full only. */
export function connectorRows(cli: CliMcpView[]): Array<{ id: string; label: string; canRead: boolean }> {
  return cli
    .filter((c) => c.status !== "not_configured" && c.name.startsWith("claude.ai "))
    .map((c) => ({ id: c.name, label: c.name, canRead: false }));
}

/** Folder-group name accepted by POST /api/outputs/save (^[a-z0-9][a-z0-9_-]{0,60}$); falls back to "skill". */
export function outputGroup(slug: string): string {
  const s = slug.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^[^a-z0-9]+/, "").replace(/-+$/, "").slice(0, 61);
  return s || "skill";
}
