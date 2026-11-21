// src/core/workshop3d/script-check.ts
import path from "node:path";
import { CAD_PYTHON_MISSING_MSG, defaultCadRunner, findCadPython, type CadRunner } from "../design3d/cad-tools.js";
import { REPO_ROOT } from "../app/config.js";

export const W3D_TOOLS_DIR = path.join(REPO_ROOT, "tools", "workshop3d");
export const CHECK_TIMEOUT_MS = 20_000;

export interface CheckDeps {
  python?: string | null;
  run?: CadRunner;
  toolsDir?: string;
}
export interface CheckResult {
  ok: boolean;
  errors: string[];
  /** The check itself could not run (no python, spawn error, timeout, unreadable output): the environment, not the script. */
  infra?: true;
}

export async function checkScript(scriptPath: string, d: CheckDeps = {}): Promise<CheckResult> {
  const python = d.python !== undefined ? d.python : findCadPython();
  if (!python) return { ok: false, errors: [CAD_PYTHON_MISSING_MSG], infra: true };
  const run = d.run ?? defaultCadRunner;
  let r;
  try {
    r = await run(python, [path.join(d.toolsDir ?? W3D_TOOLS_DIR, "check_script.py"), scriptPath], CHECK_TIMEOUT_MS);
  } catch (e) {
    return { ok: false, errors: [`Không chạy được bước kiểm script: ${e instanceof Error ? e.message : String(e)}`], infra: true };
  }
  if (r.timedOut) return { ok: false, errors: ["Kiểm script quá thời gian."], infra: true };
  try {
    const j = JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as { ok?: unknown; errors?: unknown };
    const errors = Array.isArray(j.errors) ? j.errors.filter((e): e is string => typeof e === "string") : [];
    return { ok: j.ok === true && errors.length === 0, errors };
  } catch {
    return { ok: false, errors: [`Không đọc được kết quả kiểm script: ${r.stderr.slice(0, 300) || r.stdout.slice(0, 300)}`], infra: true };
  }
}
