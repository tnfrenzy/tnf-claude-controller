import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/**
 * Locate the OpenAI Codex CLI executable (`codex.exe` / `codex.cmd` -> resolved binary on Windows, `codex` on POSIX).
 */
export function locateCodex(explicit?: string | null, env: NodeJS.ProcessEnv = process.env): string {
  const candidates: string[] = [];
  if (explicit) candidates.push(explicit);
  if (env["TNF_CODEX_PATH"]) candidates.push(env["TNF_CODEX_PATH"]);

  for (const c of candidates) {
    if (c && fs.existsSync(c)) return c;
  }

  const finder = process.platform === "win32" ? "where" : "which";
  const res = spawnSync(finder, ["codex"], { encoding: "utf8", windowsHide: true, env });
  if (res.status === 0) {
    for (const line of (res.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (!fs.existsSync(line)) continue;
      if (process.platform === "win32" && path.extname(line).toLowerCase() === ".exe") return line;
      if (process.platform !== "win32") return line;
    }
    for (const line of (res.stdout ?? "").split(/\r?\n/).map((l) => l.trim()).filter(Boolean)) {
      if (fs.existsSync(line)) return line;
    }
  }

  throw new Error(
    "Không tìm thấy OpenAI Codex CLI (codex). Hãy cài `@openai/codex` hoặc đặt `codexPath` trong config/controller.json / biến môi trường TNF_CODEX_PATH.",
  );
}
