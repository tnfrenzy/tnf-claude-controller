import fs from "node:fs";
import path from "node:path";

export const BASH_MISSING_MSG = "Không tìm thấy bash của Git for Windows (cài Git for Windows hoặc đặt TNF_GIT_BASH)";

/** Locate Git for Windows bash.exe. `exists` is injectable. */
export function findGitBash(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const candidates = [
    env["TNF_GIT_BASH"],
    env["ProgramFiles"] && path.join(env["ProgramFiles"], "Git", "bin", "bash.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Git", "bin", "bash.exe"),
    env["LOCALAPPDATA"] && path.join(env["LOCALAPPDATA"], "Programs", "Git", "bin", "bash.exe"),
  ];
  for (const c of candidates) if (c && exists(c)) return c;
  return null;
}

/** Minimal environment for a project script: nothing inherited except a small system PATH, HOME, LANG, plus the key path variable. */
export function minimalScriptEnv(o: { keyEnvName: string; keyPath: string; bashPath: string; env?: NodeJS.ProcessEnv }): NodeJS.ProcessEnv {
  const src = o.env ?? process.env;
  const gitRoot = path.dirname(path.dirname(o.bashPath));
  const sysRoot = src["SystemRoot"] ?? src["SYSTEMROOT"] ?? "C:\\Windows";
  const parts = [path.join(gitRoot, "usr", "bin"), path.join(gitRoot, "bin"), path.join(gitRoot, "mingw64", "bin"), path.join(sysRoot, "System32")];
  const out: NodeJS.ProcessEnv = {
    PATH: parts.join(path.delimiter),
    HOME: src["USERPROFILE"] ?? src["HOME"] ?? "",
    LANG: "C.UTF-8",
    SystemRoot: sysRoot,
    GIT_TERMINAL_PROMPT: "0",
  };
  out[o.keyEnvName] = o.keyPath;
  return out;
}
