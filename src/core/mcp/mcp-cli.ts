import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { grantsAddDirs, type Grants, type McpPlan } from "../run/grants.js";
import { parseMcpList, type CliMcpItem } from "./mcp-registry.js";

const snapFile = (dataDir: string): string => path.join(dataDir, "mcp-cli.json");

export function readCliSnapshot(dataDir: string): { at: number; items: CliMcpItem[] } | null {
  try {
    const v = JSON.parse(fs.readFileSync(snapFile(dataDir), "utf8")) as { at?: number; items?: CliMcpItem[] };
    return typeof v.at === "number" && Array.isArray(v.items) ? { at: v.at, items: v.items } : null;
  } catch {
    return null;
  }
}

export function writeCliSnapshot(dataDir: string, items: CliMcpItem[]): { at: number; items: CliMcpItem[] } {
  const snap = { at: Date.now(), items };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(snapFile(dataDir), JSON.stringify(snap, null, 2), "utf8");
  return snap;
}

/** `claude mcp list` (slow: it health-checks every server). Env must already be stripped of API keys by the caller. */
export function runClaudeMcpList(claudePath: string, env: NodeJS.ProcessEnv, timeoutMs = 90_000, prefixArgs: string[] = []): Promise<CliMcpItem[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(claudePath, [...prefixArgs, "mcp", "list"], { shell: false, windowsHide: true, env, stdio: ["ignore", "pipe", "pipe"] });
    let out = "";
    let errTail = "";
    const timer = setTimeout(() => {
      child.kill();
      reject(new Error("`claude mcp list` quá thời gian chờ."));
    }, timeoutMs);
    child.stdout.on("data", (c: Buffer) => {
      out += c.toString("utf8");
    });
    child.stderr.on("data", (c: Buffer) => {
      errTail = (errTail + c.toString("utf8")).slice(-4000); // drain so a chatty child never blocks on a full pipe
    });
    child.on("error", (e) => {
      clearTimeout(timer);
      reject(new Error(`Không chạy được claude: ${e.message}`));
    });
    child.on("close", () => {
      clearTimeout(timer);
      if (!out.trim() && errTail.trim()) return reject(new Error(`claude mcp list lỗi:${errTail.trim().slice(-300)}`));
      resolve(parseMcpList(out));
    });
  });
}

/**
 * Extra CLI args for one coding run. Without `--strict-mcp-config` the CLI loads every claude.ai account connector
 * (spike 2026-11-09), so strict is emitted whenever no CLI connector is granted, even with no `--mcp-config` file.
 * `--mcp-config` is variadic, so it is always followed by another flag. Writes `<configDir>/mcp.json` only when a
 * registry server is granted. `configDir` must be OUTSIDE the run directory (it holds plaintext env/headers, and the run
 * directory is served as artifacts and copied to the output folder); the caller passes the data-dir run folder.
 */
export function mcpRunArgs(plan: McpPlan, grants: Grants, configDir: string): { extraArgs: string[]; disallowed: string[]; allowed: string[] } {
  const extraArgs: string[] = [];
  if (plan.config) {
    fs.mkdirSync(configDir, { recursive: true });
    const f = path.join(configDir, "mcp.json");
    fs.writeFileSync(f, JSON.stringify(plan.config, null, 2), "utf8");
    extraArgs.push("--mcp-config", f);
  }
  if (plan.strict) extraArgs.push("--strict-mcp-config");
  for (const d of grantsAddDirs(grants)) extraArgs.push("--add-dir", d);
  return { extraArgs, disallowed: plan.disallowed, allowed: plan.allowed };
}
