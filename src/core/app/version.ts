import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

/** Read the controller version from <repoRoot>/package.json. Throws a clear error on any problem. */
export function readControllerVersion(repoRoot: string): string {
  const file = path.join(repoRoot, "package.json");
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`Không đọc được ${file}: ${(e as Error).message}`);
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch (e) {
    throw new Error(`package.json không phải JSON hợp lệ (${file}): ${(e as Error).message}`);
  }
  const version = typeof data === "object" && data !== null ? (data as Record<string, unknown>)["version"] : undefined;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error(`package.json thiếu trường version (${file})`);
  }
  return version;
}

/** Extract "x.y.z" from `claude --version` output such as "2.1.301 (Claude Code)". */
export function parseClaudeVersion(output: string): string | null {
  const m = /\d+\.\d+\.\d+/.exec(output);
  return m ? m[0] : null;
}

/** Run `claude --version` without a shell, with the (already sanitized) env. Returns null on any failure. */
export function readClaudeVersion(claudePath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): string | null {
  try {
    const res = spawnSync(claudePath, [...argsPrefix, "--version"], { env, encoding: "utf8", windowsHide: true, timeout: 10_000 });
    if (res.error || res.status !== 0) return null;
    return parseClaudeVersion(res.stdout ?? "");
  } catch {
    return null;
  }
}
