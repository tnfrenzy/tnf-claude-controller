// src/core/workshop3d/patch-params.ts — rewrite the PARAMS literal of model.py (tools/workshop3d/patch_params.py).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { CAD_PYTHON_MISSING_MSG, defaultCadRunner, findCadPython, type CadRunner } from "../design3d/cad-tools.js";
import { W3D_TOOLS_DIR } from "./script-check.js";

export const PATCH_TIMEOUT_MS = 20_000;

export interface PatchDeps {
  python?: string | null;
  run?: CadRunner;
  toolsDir?: string;
}
export interface PatchResult {
  ok: boolean;
  changed: string[];
  ignored: string[];
  error?: string;
}

const strs = (v: unknown): string[] => (Array.isArray(v) ? v.filter((s): s is string => typeof s === "string") : []);

export async function patchParams(scriptPath: string, params: Record<string, string | number>, d: PatchDeps = {}): Promise<PatchResult> {
  const fail = (error: string): PatchResult => ({ ok: false, changed: [], ignored: [], error });
  for (const [k, v] of Object.entries(params)) {
    if (typeof v === "number" && !Number.isFinite(v)) return fail(`Tham số ${k.slice(0, 60)} phải là số hữu hạn.`);
  }
  const python = d.python !== undefined ? d.python : findCadPython();
  if (!python) return fail(CAD_PYTHON_MISSING_MSG);
  const run = d.run ?? defaultCadRunner;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-params-"));
  try {
    const file = path.join(tmp, "params.json");
    fs.writeFileSync(file, JSON.stringify(params), "utf8");
    let r;
    try {
      r = await run(python, [path.join(d.toolsDir ?? W3D_TOOLS_DIR, "patch_params.py"), scriptPath, file], PATCH_TIMEOUT_MS);
    } catch (e) {
      return fail(`Không chạy được bước sửa tham số: ${e instanceof Error ? e.message : String(e)}`);
    }
    if (r.timedOut) return fail("Sửa tham số quá thời gian.");
    let j: Record<string, unknown>;
    try {
      j = JSON.parse(r.stdout.trim().split("\n").pop() ?? "") as Record<string, unknown>;
    } catch {
      return fail(`Không đọc được kết quả sửa tham số: ${(r.stderr || r.stdout).slice(0, 300)}`);
    }
    if (j["ok"] !== true) return fail(typeof j["error"] === "string" ? j["error"] : "Sửa tham số lỗi.");
    return { ok: true, changed: strs(j["changed"]), ignored: strs(j["ignored"]) };
  } finally {
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
