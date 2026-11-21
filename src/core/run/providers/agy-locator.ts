import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Locate the Antigravity CLI executable (`agy.exe` on Windows, `agy` on POSIX) so we can spawn it WITHOUT a shell.
 */
export function locateAgy(explicit?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (env["TNF_AGY_PATH"]) candidates.push(env["TNF_AGY_PATH"]);
  if (process.platform === "win32" && env["LOCALAPPDATA"]) {
    candidates.push(path.join(env["LOCALAPPDATA"], "agy", "bin", "agy.exe"));
  }

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  const finder = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(finder, ["agy"], { encoding: "utf8", windowsHide: true, env });
  if (res.status === 0) {
    for (const line of (res.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (fs.existsSync(line)) return line;
    }
  }

  throw new Error(
    "Không tìm thấy Antigravity CLI (agy). Hãy cài đặt Antigravity CLI hoặc đặt `agyPath` trong config/controller.json / biến môi trường TNF_AGY_PATH.",
  );
}
