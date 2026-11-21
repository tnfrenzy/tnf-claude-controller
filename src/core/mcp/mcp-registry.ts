import fs from "node:fs";
import path from "node:path";

export type McpKind = "stdio" | "http" | "cli";

export interface McpServer {
  id: string;
  name: string;
  kind: McpKind;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
  url?: string;
  headers?: Record<string, string>;
  enabled: boolean;
  preset?: string;
  writeTools?: string[];
  processTools?: string[];
  blockedTools?: string[];
}

export const MCP_ID_RE = /^[a-z0-9][a-z0-9_-]{0,39}$/;

export const MCP_PRESETS: Array<Omit<McpServer, "enabled">> = [
  {
    id: "desktop-commander", name: "Desktop Commander", kind: "stdio", preset: "desktop-commander",
    // Windows-specific: `npx` is npx.cmd there, so Claude Code needs `cmd /c` to start it.
    command: "cmd", args: ["/c", "npx", "-y", "@wonderwhy-er/desktop-commander@latest"],
    writeTools: ["write_file", "edit_block", "create_directory", "move_file", "write_pdf"],
    processTools: ["start_process", "interact_with_process", "read_process_output", "force_terminate", "kill_process", "list_processes", "list_sessions"],
    blockedTools: ["set_config_value"],
  },
];

const strList = (v: unknown): string[] | undefined => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : undefined);
const strMap = (v: unknown): Record<string, string> | undefined => {
  if (typeof v !== "object" || v === null) return undefined;
  const out: Record<string, string> = {};
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (typeof x === "string") out[k] = x;
  return out;
};

/** Validate one registry entry (kind "cli" entries are never stored). Throws a Vietnamese message. */
export function validateMcpServer(raw: unknown): McpServer {
  if (typeof raw !== "object" || raw === null) throw new Error("Dữ liệu máy chủ MCP không hợp lệ.");
  const r = raw as Record<string, unknown>;
  const id = typeof r["id"] === "string" ? r["id"] : "";
  if (!MCP_ID_RE.test(id)) throw new Error("id máy chủ MCP chỉ gồm chữ thường, số, gạch ngang/dưới (tối đa 40 ký tự).");
  const name = typeof r["name"] === "string" ? r["name"].trim() : "";
  if (!name) throw new Error("Thiếu tên máy chủ MCP.");
  const kind = r["kind"];
  if (kind !== "stdio" && kind !== "http") throw new Error("Chỉ lưu được kiểu stdio hoặc http (connector claude.ai/plugin do Claude quản lý).");
  const out: McpServer = { id, name, kind, enabled: r["enabled"] !== false };
  if (kind === "stdio") {
    const command = typeof r["command"] === "string" ? r["command"].trim() : "";
    if (!command) throw new Error("Máy chủ stdio cần lệnh khởi động.");
    out.command = command;
    const args = strList(r["args"]);
    if (args) out.args = args;
    const env = strMap(r["env"]);
    if (env && Object.keys(env).length) out.env = env;
  } else {
    const url = typeof r["url"] === "string" ? r["url"].trim() : "";
    if (!/^https?:\/\/\S+$/.test(url)) throw new Error("URL máy chủ MCP phải bắt đầu bằng http:// hoặc https://.");
    out.url = url;
    const headers = strMap(r["headers"]);
    if (headers && Object.keys(headers).length) out.headers = headers;
  }
  if (typeof r["preset"] === "string") out.preset = r["preset"];
  for (const k of ["writeTools", "processTools", "blockedTools"] as const) {
    const l = strList(r[k]);
    if (l) out[k] = l;
  }
  return out;
}

function file(dataDir: string): string {
  return path.join(dataDir, "mcp-servers.json");
}

export function loadMcpServers(dataDir: string): McpServer[] {
  try {
    const raw = JSON.parse(fs.readFileSync(file(dataDir), "utf8")) as unknown;
    if (!Array.isArray(raw)) return [];
    const out: McpServer[] = [];
    const seen = new Set<string>();
    for (const x of raw) {
      try {
        const s = validateMcpServer(x);
        if (seen.has(s.id)) continue; // keep the first of duplicate ids
        seen.add(s.id);
        out.push(s);
      } catch { /* skip a hand-broken entry */ }
    }
    return out;
  } catch {
    return [];
  }
}

export function saveMcpServers(dataDir: string, list: McpServer[]): void {
  fs.mkdirSync(dataDir, { recursive: true });
  const tmp = `${file(dataDir)}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(list, null, 2), "utf8");
  fs.renameSync(tmp, file(dataDir)); // atomic replace in the same directory
}

export type CliMcpStatus = "connected" | "needs_auth" | "failed" | "not_configured";
export interface CliMcpItem { name: string; target: string; status: CliMcpStatus; detail?: string }

const TAIL_RE = / - (?:\S+ )?(Connected|Needs authentication|Failed to connect.*|Not configured)$/;

/** Parse `claude mcp list` (lines `<name>: <target> - <glyph> <status>`); noise lines are skipped. */
export function parseMcpList(stdout: string): CliMcpItem[] {
  const items: CliMcpItem[] = [];
  for (const raw of stdout.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const m = TAIL_RE.exec(line);
    const sep = line.indexOf(": ");
    if (!m || sep <= 0) continue;
    const tail = m[1]!;
    const status: CliMcpStatus = tail === "Connected" ? "connected" : tail === "Needs authentication" ? "needs_auth" : tail === "Not configured" ? "not_configured" : "failed";
    const item: CliMcpItem = { name: line.slice(0, sep), target: line.slice(sep + 2, m.index).trim(), status };
    if (status === "failed") item.detail = tail.replace(/^Failed to connect\s*[—-]?\s*/, "");
    items.push(item);
  }
  return items;
}

/** CLI-managed servers as registry rows (used by planMcp to deny the ones that are not granted). */
export function cliItemsToServers(items: CliMcpItem[]): McpServer[] {
  return items.map((i) => ({ id: i.name, name: i.name, kind: "cli" as const, enabled: i.status !== "not_configured" }));
}
