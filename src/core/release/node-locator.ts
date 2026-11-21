import fs from "node:fs";
import path from "node:path";

export const NODE_MISSING_MSG = "Không tìm thấy Node.js có kèm npm trên máy (cần để chạy test và đóng gói); hãy cài Node.js hoặc đặt TNF_NODE_DIR trỏ tới thư mục chứa node.exe.";

export interface NodeToolchain {
  /** node.exe that runs npm. */
  node: string;
  /** npm-cli.js that belongs to that node. */
  npmCli: string;
}

function npmCliNextTo(nodeExe: string): string[] {
  const dir = path.dirname(nodeExe);
  return [path.join(dir, "node_modules", "npm", "bin", "npm-cli.js"), path.join(dir, "..", "lib", "node_modules", "npm", "bin", "npm-cli.js")];
}

/**
 * node.exe plus npm-cli.js for the release steps (test, package). The installed controller ships its own node.exe WITHOUT npm
 * (and runs from a folder without the repo's tooling), so `process.execPath` is only used when npm sits next to it; otherwise
 * the system Node is searched: TNF_NODE_DIR, PATH, the usual install folders. Returns null when none has npm. `exists` is injectable.
 */
export function findNodeToolchain(
  env: NodeJS.ProcessEnv = process.env,
  execPath: string = process.execPath,
  exists: (p: string) => boolean = fs.existsSync,
): NodeToolchain | null {
  const tryNode = (nodeExe: string): NodeToolchain | null => {
    if (!exists(nodeExe)) return null;
    for (const cli of npmCliNextTo(nodeExe)) if (exists(cli)) return { node: nodeExe, npmCli: cli };
    return null;
  };

  const fromEnv = env["npm_execpath"];
  if (fromEnv && /npm-cli\.js$/i.test(fromEnv) && exists(fromEnv)) return { node: execPath, npmCli: fromEnv };

  const own = tryNode(execPath);
  if (own) return own;

  const w = path.win32;
  const dirs: string[] = [];
  if (env["TNF_NODE_DIR"]) dirs.push(env["TNF_NODE_DIR"]);
  const pathKey = Object.keys(env).find((k) => k.toLowerCase() === "path");
  for (const d of (pathKey ? env[pathKey] ?? "" : "").split(";")) {
    const t = d.trim().replace(/^"|"$/g, "");
    if (t) dirs.push(t);
  }
  for (const root of [env["ProgramFiles"], env["ProgramFiles(x86)"]]) if (root) dirs.push(w.join(root, "nodejs"));
  if (env["LOCALAPPDATA"]) dirs.push(w.join(env["LOCALAPPDATA"], "Programs", "nodejs"));

  for (const d of dirs) {
    const found = tryNode(w.join(d, "node.exe"));
    if (found) return found;
  }
  return null;
}
