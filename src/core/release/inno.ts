import fs from "node:fs";
import path from "node:path";

export const INNO_MISSING_MSG = "Không tìm thấy Inno Setup 6 (đặt TNF_ISCC hoặc cài Inno Setup)";

/** Locate ISCC.exe: TNF_ISCC, %LOCALAPPDATA%\Programs, ProgramFiles(x86), ProgramFiles. `exists` is injectable. */
export function findIscc(env: NodeJS.ProcessEnv = process.env, exists: (p: string) => boolean = fs.existsSync): string | null {
  const candidates = [
    env["TNF_ISCC"],
    env["LOCALAPPDATA"] && path.join(env["LOCALAPPDATA"], "Programs", "Inno Setup 6", "ISCC.exe"),
    env["ProgramFiles(x86)"] && path.join(env["ProgramFiles(x86)"], "Inno Setup 6", "ISCC.exe"),
    env["ProgramFiles"] && path.join(env["ProgramFiles"], "Inno Setup 6", "ISCC.exe"),
  ];
  for (const c of candidates) if (c && exists(c)) return c;
  return null;
}
