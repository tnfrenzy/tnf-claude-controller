// src/core/workshop3d/build.ts — controller-run build: check script, run it, measure, GLB, USDZ, validate.
import fs from "node:fs";
import path from "node:path";
import { CAD_PYTHON_MISSING_MSG, CAD_TOOLS_DIR, defaultCadRunner, type CadRunner, type CadRunResult } from "../design3d/cad-tools.js";
import type { W3DPlan } from "./role-output.js";
import { checkScript, W3D_TOOLS_DIR } from "./script-check.js";
import type { W3DStore } from "./store.js";

export interface BuildDeps {
  python: string | null;
  run?: CadRunner;
  validateGlb?: (bytes: Uint8Array) => Promise<{ errors: number; warnings: number; messages: string[] }>;
  scriptTimeoutMs?: number;
}
export interface BuildOptions {
  maxTriangles?: number;
  texturePx?: number;
  /** Rebuild with new parameters: the old plan's bounding box no longer applies; measure only. */
  skipBboxCheck?: boolean;
}
export interface BuildResult {
  ok: boolean;
  stage: "check" | "script" | "measure" | "assemble" | "usdz" | "validate" | "done";
  error?: string;
  /**
   * The failure is the environment (no python, missing package, spawn error, tool timeout, locked folder), not the
   * model: the runner fails the session for the user to fix instead of sending it back to the modeler.
   */
  infra?: true;
  bboxMm?: [number, number, number];
  triangles?: number;
  glbBytes?: number;
  usdzBytes?: number;
  mobileGlbBytes?: number;
  /** Part count of the assembled GLB. */
  parts?: number;
  /** Texture size (px) of the main GLB and the number of distinct textures. */
  texturePx?: number;
  textures?: number;
  warnings: string[];
  files: string[];
}

/** Model script: includes the 20-70 s cold cadquery import, fillets and one STL export per part (up to ~200). */
export const SCRIPT_TIMEOUT_MS = 600_000;
/** step_info.py: cadquery import plus reading a large STEP. */
export const STEP_INFO_TIMEOUT_MS = 300_000;
/** assemble_glb.py and export_usdz.py. */
export const ASSEMBLE_TIMEOUT_MS = 180_000;
const LOG_MAX = 4000;
const RM_TRIES = 6;

export const defaultValidate: NonNullable<BuildDeps["validateGlb"]> = async (bytes) => {
  const v = await import("gltf-validator");
  const r = await v.validateBytes(bytes);
  return { errors: r.issues.numErrors, warnings: r.issues.numWarnings, messages: r.issues.messages.slice(0, 5).map((m: { message: string }) => m.message) };
};

const tail = (s: string, n = LOG_MAX): string => (s.length > n ? s.slice(s.length - n) : s);
/** A Python package of the CAD venv is missing or broken (pip install), as opposed to an error in the model script. */
export const isImportError = (s: string): boolean => /ModuleNotFoundError|ImportError|No module named|DLL load failed/.test(s);

function lastJson(stdout: string): Record<string, unknown> | null {
  const line = stdout.trim().split("\n").pop() ?? "";
  try {
    const j = JSON.parse(line) as unknown;
    return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function writeLog(sessionDir: string, text: string, append = false): void {
  try {
    const file = path.join(sessionDir, "build.log");
    const prev = append && fs.existsSync(file) ? fs.readFileSync(file, "utf8") + "\n" : "";
    fs.writeFileSync(file, tail(prev + text), "utf8");
  } catch {
    /* log is best effort */
  }
}

const sortedDesc = (t: number[]): number[] => [...t].sort((a, b) => b - a);

const nonEmpty = (dir: string, rel: string): boolean => {
  try {
    return fs.statSync(path.join(dir, rel)).size > 0;
  } catch {
    return false;
  }
};
const existing = (dir: string, rels: string[]): string[] => [...new Set(rels)].filter((r) => nonEmpty(dir, r));
const sizeOf = (f: string): number | undefined => {
  try {
    return fs.statSync(f).size;
  } catch {
    return undefined;
  }
};

async function safeRun(run: CadRunner, python: string, args: string[], timeoutMs: number): Promise<CadRunResult | { error: string }> {
  try {
    return await run(python, args, timeoutMs);
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}

/** rmSync that retries a busy folder (EBUSY/EPERM: a python that was killed a moment ago still holds a file). */
async function removeRetry(p: string, opts: fs.RmOptions): Promise<string | null> {
  for (let i = 0; ; i++) {
    try {
      fs.rmSync(p, opts);
      return null;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if ((code !== "EBUSY" && code !== "EPERM" && code !== "ENOTEMPTY") || i >= RM_TRIES - 1) return e instanceof Error ? e.message : String(e);
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
  }
}

const fmt = (t: number[]): string => t.map((v) => Math.round(v * 10) / 10).join(" x ");
const list = (ids: string[], max = 30): string => (ids.length > max ? `${ids.slice(0, max).join(", ")}, … (${ids.length} id)` : ids.join(", "));

export async function runBuild(store: W3DStore, slug: string, plan: W3DPlan, deps: BuildDeps, opts: BuildOptions = {}): Promise<BuildResult> {
  const dir = store.dir(slug);
  const python = deps.python;
  // files = only what THIS run produced; early failures (before anything is cleared or written) list nothing.
  let produced: string[] = [];
  const infra = { infra: true } as const;
  const failEarly = (stage: BuildResult["stage"], error: string, extra: Partial<BuildResult> = {}): BuildResult => ({ ok: false, stage, error, warnings: [], files: [], ...extra });
  const fail = (stage: BuildResult["stage"], error: string, extra: Partial<BuildResult> = {}): BuildResult => {
    writeLog(dir, error);
    return { ok: false, stage, error, warnings: [], files: existing(dir, [...produced, "build.log"]), ...extra };
  };
  if (!python) return failEarly("script", CAD_PYTHON_MISSING_MSG, infra);
  const run = deps.run ?? defaultCadRunner;
  const script = path.join(dir, "model.py");
  if (!fs.existsSync(script)) return failEarly("check", "Chưa có model.py trong phiên.");

  const chk = await checkScript(script, { python, run, toolsDir: W3D_TOOLS_DIR });
  if (!chk.ok) {
    return chk.infra
      ? failEarly("check", `Không chạy được bước kiểm script: ${chk.errors.join("\n")}`, infra)
      : failEarly("check", `Script không qua kiểm tra an toàn:\n${chk.errors.join("\n")}`);
  }

  const out = path.join(dir, "outputs");
  const busy = await removeRetry(path.join(out, "parts"), { recursive: true, force: true });
  if (busy) {
    return failEarly("script", `Không xoá được thư mục outputs/parts của lần dựng trước (có thể một tiến trình Python cũ còn giữ tệp): ${busy}. Hãy đóng tiến trình python.exe đó (hoặc khởi động lại máy) rồi bấm Tiếp tục.`, infra);
  }
  for (const f of ["model.step", "model.glb", "model-mobile.glb", "model.usdz"]) {
    const e = await removeRetry(path.join(out, f), { force: true });
    if (e) return failEarly("script", `Không xoá được outputs/${f} của lần dựng trước: ${e}. Hãy đóng chương trình đang mở tệp đó rồi bấm Tiếp tục.`, infra);
  }
  fs.mkdirSync(path.join(out, "parts"), { recursive: true });
  const timeout = deps.scriptTimeoutMs ?? SCRIPT_TIMEOUT_MS;
  const r = await safeRun(run, python, [script, out], timeout);
  if ("error" in r) return fail("script", `Không chạy được Python của công cụ CAD: ${r.error}`, infra);
  if (r.timedOut) return fail("script", `Script chạy quá thời gian (${Math.round(timeout / 1000)} giây): hãy đơn giản hóa mô hình (bớt bo cạnh, bớt chi tiết nhỏ).\n${tail(r.stderr, 1500)}`);
  const log = `${r.stdout}\n${r.stderr}`;
  if (r.code !== 0) {
    if (isImportError(r.stderr)) return fail("script", `Môi trường Python của công cụ CAD thiếu thư viện (pip install trong venv CAD):\n${tail(r.stderr, 1500)}`, infra);
    return fail("script", `Script lỗi (mã ${r.code}).\n${tail(r.stderr || r.stdout, 2500)}`);
  }
  const stepPath = path.join(out, "model.step");
  const stls = fs.readdirSync(path.join(out, "parts")).filter((f) => f.toLowerCase().endsWith(".stl"));
  if (!fs.existsSync(stepPath) || stls.length === 0) {
    return fail("script", `Script chạy xong nhưng thiếu ${!fs.existsSync(stepPath) ? "outputs/model.step" : "outputs/parts/*.stl"}; cần ghi model.step và mỗi bộ phận một file STL (tên file = id bộ phận).`);
  }
  writeLog(dir, log);
  produced = ["outputs/model.step", ...stls.sort().map((f) => `outputs/parts/${f}`)];
  const written = new Set(stls.map((f) => f.slice(0, -4)));
  const planned = new Set(plan.parts.map((p) => p.id));
  const missing = plan.parts.map((p) => p.id).filter((id) => !written.has(id));
  if (missing.length > 0) {
    return fail("script", `Thiếu STL của bộ phận trong bảng chi tiết: ${list(missing)}. Mỗi id phải có đúng một tệp outputs/parts/<id>.stl.`);
  }
  const extra = [...written].filter((id) => !planned.has(id)).sort();
  const buildWarnings = extra.length > 0 ? [`Có STL không thuộc bảng chi tiết (vẫn được ghép): ${list(extra)}.`] : [];

  const info = await safeRun(run, python, [path.join(CAD_TOOLS_DIR, "step_info.py"), stepPath], STEP_INFO_TIMEOUT_MS);
  if ("error" in info) return fail("measure", `Không chạy được bước đo STEP: ${info.error}`, infra);
  if (info.timedOut) return fail("measure", `Đo kích thước STEP quá thời gian (${STEP_INFO_TIMEOUT_MS / 1000} giây).`, infra);
  if (info.code !== 0) {
    const why = tail(info.stderr || info.stdout, 600);
    return isImportError(why) ? fail("measure", `Môi trường Python của công cụ CAD thiếu thư viện để đo STEP: ${why}`, infra) : fail("measure", `Không đo được kích thước STEP: ${why}`);
  }
  const bb = lastJson(info.stdout)?.["boundingBox"] as { x?: number; y?: number; z?: number } | undefined;
  if (!bb || typeof bb.x !== "number" || typeof bb.y !== "number" || typeof bb.z !== "number") return fail("measure", "Không đọc được boundingBox từ STEP.");
  const measured: [number, number, number] = [bb.x, bb.y, bb.z];
  if (!opts.skipBboxCheck) {
    const m = sortedDesc(measured);
    const e = sortedDesc(plan.bbox_mm);
    // The STEP box includes frames, sills and protrusions and over-estimates curved faces: allow 1 % of the largest size.
    const tol = Math.max(plan.tolerance_mm, 0.01 * Math.max(...plan.bbox_mm));
    if (m.some((v, i) => Math.abs(v - e[i]!) > tol)) {
      return fail("measure", `Kích thước mô hình lệch kế hoạch: đo được ${fmt(m)} mm (sắp giảm dần), mong đợi ${fmt(e)} mm, dung sai ${Math.round(tol * 10) / 10} mm.`, { bboxMm: measured });
    }
  }

  const res = await runAssemble(store, slug, deps, opts);
  return { ...res, warnings: [...buildWarnings, ...res.warnings], files: existing(dir, [...produced, ...res.files, "build.log"]), bboxMm: measured };
}

export async function runAssemble(store: W3DStore, slug: string, deps: BuildDeps, opts: BuildOptions = {}): Promise<BuildResult> {
  const dir = store.dir(slug);
  const tmpDir = path.join(dir, "tmp");
  const state = { started: false };
  try {
    const r = await assembleInner(dir, tmpDir, deps, opts, state);
    if (!state.started) return r;
    const note = r.ok ? `assemble ok: ${r.triangles ?? "?"} tri, glb ${r.glbBytes ?? 0} B, usdz ${r.usdzBytes ?? 0} B${r.warnings.length ? "; " + r.warnings.join(" | ") : ""}` : `assemble lỗi (${r.stage}): ${r.error ?? ""}`;
    writeLog(dir, note, true);
    return { ...r, files: existing(dir, [...r.files, "build.log"]) };
  } finally {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}

async function assembleInner(dir: string, tmpDir: string, deps: BuildDeps, opts: BuildOptions, state: { started: boolean }): Promise<BuildResult> {
  const python = deps.python;
  const warnings: string[] = [];
  const made: string[] = [];
  const fail = (stage: BuildResult["stage"], error: string, infra = false): BuildResult => ({ ok: false, stage, error, ...(infra ? { infra: true as const } : {}), warnings, files: existing(dir, made) });
  if (!python) return fail("assemble", CAD_PYTHON_MISSING_MSG, true);
  const run = deps.run ?? defaultCadRunner;
  const out = path.join(dir, "outputs");
  const partsDir = path.join(out, "parts");
  if (!fs.existsSync(partsDir) || !fs.readdirSync(partsDir).some((f) => f.toLowerCase().endsWith(".stl"))) {
    return fail("assemble", "Chưa có outputs/parts/*.stl để ghép.");
  }
  let mats = path.join(dir, "materials.json");
  if (!fs.existsSync(mats)) {
    warnings.push("Thiếu materials.json: dùng vật liệu xám mặc định.");
    mats = path.join(tmpDir, "empty-materials.json");
    fs.mkdirSync(tmpDir, { recursive: true });
    fs.writeFileSync(mats, JSON.stringify({ materials: {} }), "utf8");
  }
  const glb = path.join(out, "model.glb");
  const mobile = path.join(out, "model-mobile.glb");
  const usdz = path.join(out, "model.usdz");
  for (const f of [glb, mobile, usdz]) fs.rmSync(f, { force: true });
  state.started = true;
  const asm = path.join(W3D_TOOLS_DIR, "assemble_glb.py");

  const a = await safeRun(run, python, [asm, partsDir, mats, glb], ASSEMBLE_TIMEOUT_MS);
  if ("error" in a) return fail("assemble", `Không chạy được bước ghép GLB: ${a.error}`, true);
  const aj = lastJson(a.stdout);
  if (a.timedOut) return fail("assemble", `Bước ghép GLB quá thời gian (${ASSEMBLE_TIMEOUT_MS / 1000} giây).`, true);
  if (a.code !== 0 || !aj || aj["ok"] !== true) {
    const why = typeof aj?.["error"] === "string" ? aj["error"] : tail(a.stderr || a.stdout, 600);
    return isImportError(why) || isImportError(a.stderr)
      ? fail("assemble", `Môi trường Python của công cụ CAD thiếu thư viện để ghép GLB (pip install trimesh pillow): ${why}`, true)
      : fail("assemble", `Ghép GLB lỗi: ${why}`);
  }
  for (const w of Array.isArray(aj["warnings"]) ? aj["warnings"] : []) if (typeof w === "string") warnings.push(w);
  if (!fs.existsSync(glb) || fs.statSync(glb).size === 0) return fail("assemble", "Bước ghép báo xong nhưng không tạo ra outputs/model.glb (hoặc file rỗng).");
  made.push("outputs/model.glb");
  const n = (k: string): number | undefined => (typeof aj[k] === "number" && Number.isFinite(aj[k]) ? (aj[k] as number) : undefined);
  const triangles = n("triangles");
  const stats: Partial<BuildResult> = {};
  if (n("parts") !== undefined) stats.parts = n("parts")!;
  if (n("texture_px") !== undefined) stats.texturePx = n("texture_px")!;
  if (n("textures") !== undefined) stats.textures = n("textures")!;

  if (opts.maxTriangles || opts.texturePx) {
    const args = [asm, partsDir, mats, mobile];
    if (opts.maxTriangles) args.push("--max-triangles", String(opts.maxTriangles));
    if (opts.texturePx) args.push("--texture-px", String(opts.texturePx));
    const mb = await safeRun(run, python, args, ASSEMBLE_TIMEOUT_MS);
    const mj = "error" in mb ? null : lastJson(mb.stdout);
    if ("error" in mb || mb.timedOut || mb.code !== 0 || !mj || mj["ok"] !== true) {
      fs.rmSync(mobile, { force: true });
      warnings.push(`Không dựng được bản di động (model-mobile.glb): ${"error" in mb ? mb.error : mb.timedOut ? "quá thời gian" : typeof mj?.["error"] === "string" ? mj["error"] : tail(mb.stderr, 300)}`);
    } else {
      made.push("outputs/model-mobile.glb");
      const sz = sizeOf(mobile);
      if (sz !== undefined) stats.mobileGlbBytes = sz;
      for (const w of Array.isArray(mj["warnings"]) ? mj["warnings"] : []) if (typeof w === "string") warnings.push(w);
      if (mj["decimation"] === "unavailable" && !warnings.some((w) => w.includes("tam giác"))) {
        warnings.push("Không giảm được tam giác cho bản di động (thiếu gói fast-simplification), giữ nguyên lưới.");
      }
    }
  }

  const u = await safeRun(run, python, [path.join(W3D_TOOLS_DIR, "export_usdz.py"), partsDir, mats, usdz], ASSEMBLE_TIMEOUT_MS);
  const uj = "error" in u ? null : lastJson(u.stdout);
  if ("error" in u || u.timedOut || u.code !== 0 || !uj || uj["ok"] !== true) {
    fs.rmSync(usdz, { force: true });
    warnings.push(`Không xuất được USDZ (bản AR iOS): ${"error" in u ? u.error : u.timedOut ? "quá thời gian" : typeof uj?.["error"] === "string" ? uj["error"] : tail(u.stderr, 300)}`);
  }

  made.push("outputs/model.usdz");
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(fs.readFileSync(glb));
  } catch {
    return fail("assemble", "Không thấy outputs/model.glb sau khi ghép.");
  }
  let v;
  try {
    v = await (deps.validateGlb ?? defaultValidate)(bytes);
  } catch (e) {
    return fail("validate", `Không chạy được bộ kiểm GLB (gltf-validator): ${e instanceof Error ? e.message : String(e)}`, true);
  }
  if (v.warnings > 0) warnings.push(`GLB có ${v.warnings} cảnh báo khi kiểm.`);
  if (v.errors > 0) return fail("validate", `GLB không hợp lệ (${v.errors} lỗi): ${v.messages.join("; ")}`);
  return {
    ok: true,
    stage: "done",
    ...(triangles !== undefined ? { triangles } : {}),
    glbBytes: bytes.length,
    ...(fs.existsSync(usdz) ? { usdzBytes: fs.statSync(usdz).size } : {}),
    ...stats,
    warnings,
    files: existing(dir, made),
  };
}
