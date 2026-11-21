import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Find the Claude Code executable so we can spawn it WITHOUT a shell.
 * On Windows `where claude` typically returns the npm shim `claude.cmd`, which cannot be
 * spawned without a shell; the shim points to node_modules/@anthropic-ai/claude-code/bin/claude.exe.
 */
export function locateClaude(explicit?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const fromEnv = env["TNF_CLAUDE_PATH"];
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (fromEnv) candidates.push(fromEnv);

  for (const c of candidates) {
    const resolved = resolveShim(c);
    if (resolved) return resolved;
  }

  const finder = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(finder, ["claude"], { encoding: "utf8", windowsHide: true, env });
  if (res.status === 0) {
    for (const line of res.stdout.split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      const resolved = resolveShim(line);
      if (resolved) return resolved;
    }
  }
  throw new Error(
    "Không tìm thấy Claude Code CLI. Hãy đặt `claudePath` trong config/controller.json hoặc biến môi trường TNF_CLAUDE_PATH.",
  );
}

function resolveShim(p: string): string | null {
  if (!fs.existsSync(p)) return null;
  const ext = path.extname(p).toLowerCase();
  if (process.platform === "win32" && (ext === ".cmd" || ext === ".ps1" || ext === "")) {
    const dir = path.dirname(p);
    const exe = path.join(dir, "node_modules", "@anthropic-ai", "claude-code", "bin", "claude.exe");
    if (fs.existsSync(exe)) return exe;
    const exe2 = path.join(dir, "claude.exe");
    if (fs.existsSync(exe2)) return exe2;
    if (ext === "") return null;
    return null;
  }
  return p;
}
