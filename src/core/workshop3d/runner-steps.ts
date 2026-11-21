// src/core/workshop3d/runner-steps.ts — the controller-run steps of the session runner (building, rendering, optimizing,
// and the Blender high-quality phase: hqrender, hqreview, hqmaterials).
// They share the runner's commit/fail/runRole through a small kit, so the commit rule stays in one place (runner.ts).
import fs from "node:fs";
import path from "node:path";
import type { Parsed } from "../skill-workshop/round-steps.js";
import { BLENDER_GLB, BLENDER_MISSING_MSG, clearHq, HQ_DIR, hqRenderFiles, readHqExposure, type HqOptions, type HqResult } from "./blender.js";
import { fitViewsFromDelta, FIT_MAX_PASSES, planExposureBoosts } from "./exposure-fit.js";
import type { BuildResult } from "./build.js";
import { COLOR_DELTA, readColorText, REFERENCE_PALETTE } from "./palette.js";
import type { W3DPromptCtx } from "./prompts.js";
import { parseMaterials, parseOptimize, parseRenderPlan, parseVerdict, type RenderPlan, type W3DMaterial, type W3DPlan } from "./role-output.js";
import type { W3DRunnerDeps } from "./runner.js";
import { addNote, atStep, crossCheckMaterials, withCost, type CtxInput } from "./runner-helpers.js";
import { afterBuild, afterFinalReview, afterHqRender, afterStepOk, reviewTotal, shouldUseBestFinal } from "./state.js";
import { slashes } from "./step-adapter.js";
import type { W3DStore } from "./store.js";
import type { W3DScores, W3DSnapshot, W3DState, Workshop3DRole } from "./types.js";

/** Session files written by the runner (relative to the session dir). */
export const W3D_FILES = {
  answers: "intake-answers.json", art: "art.json", spec: "spec.json", model: "model.py", materials: "materials.json",
  renderPlan: "render-plan.json", renders: "renders.json", review: "review.json", optimize: "optimize.json", report: "REPORT.md",
  buildOk: "outputs/.build-ok", buildStats: "outputs/build.json", rebuild: "rebuild.json",
} as const;
const F = W3D_FILES;

export type CtxOf = (extra: Partial<CtxInput>) => Omit<W3DPromptCtx, "round">;
export const errText = (e: unknown): string => (e instanceof Error ? e.message : String(e));

/** Success transition plus an optional note line. */
export const okWith = (fn: (s: W3DSnapshot, cost: number) => W3DSnapshot, cost: number, note?: string | null) => (s: W3DSnapshot): W3DSnapshot => {
  const n = fn(s, cost);
  return note ? { ...n, note: addNote(n.note, note) } : n;
};

export interface StepKit {
  deps: W3DRunnerDeps;
  store: W3DStore;
  abs(slug: string, rel: string): string;
  has(slug: string, rel: string): boolean;
  remove(slug: string, rel: string): void;
  readJson<T>(slug: string, rel: string): T | null;
  writeJson(slug: string, rel: string, v: unknown): void;
  commit(slug: string, state: W3DState, cost: number, fn: (s: W3DSnapshot) => W3DSnapshot, write?: () => void): boolean;
  fail(slug: string, state: W3DState, cost: number, message: string): void;
  runRole<T>(slug: string, s: W3DSnapshot, role: Workshop3DRole, ctx: Omit<W3DPromptCtx, "round">, parse: (text: string) => Parsed<T>): Promise<{ value: T; cost: number } | null>;
}

/** Appended to an environment failure: the user fixes the machine, then resume() builds again. */
export const INFRA_HINT = "Đây là lỗi môi trường của máy (Python, thư viện CAD, tệp bị khoá), không phải lỗi mô hình. Hãy sửa theo hướng dẫn trên rồi bấm Tiếp tục để dựng lại.";
const infraError = (r: { error?: string }): string => `Lỗi môi trường khi dựng: ${r.error ?? "không rõ"}\n${INFRA_HINT}`;

/** outputs/build.json for the ar-optimizer and presenter prompts; written after every assemble so it never goes stale. */
export function writeBuildStats(k: StepKit, slug: string, r: BuildResult): void {
  const prev = k.readJson<{ bboxMm?: unknown }>(slug, F.buildStats);
  k.writeJson(slug, F.buildStats, {
    bboxMm: r.bboxMm ?? prev?.bboxMm ?? null,
    triangles: r.triangles ?? null,
    glbBytes: r.glbBytes ?? null,
    usdzBytes: r.usdzBytes ?? null,
    mobileGlbBytes: r.mobileGlbBytes ?? null,
    parts: r.parts ?? null,
    texturePx: r.texturePx ?? null,
    textures: r.textures ?? null,
    warnings: r.warnings,
  });
}

export async function buildingStep(k: StepKit, slug: string, s: W3DSnapshot, plan: W3DPlan | undefined): Promise<void> {
  const { deps, store } = k;
  if (!plan) return k.fail(slug, s.state, 0, "Thiếu hoặc hỏng spec.json (bảng chi tiết).");
  const marker = k.readJson<{ params?: Record<string, string | number> }>(slug, F.rebuild);
  let note: string | null = null;
  if (marker?.params && Object.keys(marker.params).length > 0) {
    const pr = await deps.patchParams(k.abs(slug, F.model), marker.params);
    if (!pr.ok) {
      const error = `Không sửa được tham số trong model.py: ${pr.error ?? "lỗi không rõ"}`;
      k.commit(slug, s.state, 0, (x) => ({ ...x, state: "failed", resumeState: "building", error }), () => k.remove(slug, F.rebuild));
      return;
    }
    // model.py now carries the new values: only now does brief.params follow, and only for the keys really changed.
    const changed = Object.fromEntries(pr.changed.filter((key) => Object.prototype.hasOwnProperty.call(marker.params, key)).map((key) => [key, marker.params![key]!]));
    const cur = store.get(slug);
    if (cur && Object.keys(changed).length > 0) store.saveBrief(slug, { ...cur.brief, params: { ...cur.brief.params, ...changed } });
    if (pr.ignored.length > 0) note = `Tham số không có trong PARAMS của model.py nên bỏ qua: ${pr.ignored.join(", ")}.`;
    // Patched once: a resume after an environment failure must not patch (or merge) again.
    k.writeJson(slug, F.rebuild, { params: {} });
  }
  if (!atStep(store.get(slug)?.snapshot, "building")) return;
  k.remove(slug, F.buildOk);
  // The model changes: high-quality images, model-blender.glb and the best final copy belong to the old one.
  clearHq(store.dir(slug));
  fs.rmSync(path.join(store.dir(slug), "renders", "view"), { recursive: true, force: true }); // leftovers of the retired baked view
  let r: BuildResult;
  try {
    // Rebuild with new parameters: the old plan's bounding box no longer applies.
    r = await deps.build(slug, plan, marker ? { skipBboxCheck: true } : {});
  } catch (e) {
    r = { ok: false, stage: "script", error: errText(e), warnings: [], files: [] };
  }
  if (!r.ok && r.infra) {
    // Not the model's fault: no build retry is used and cad-modeler is not asked; the rebuild marker stays for resume().
    const error = infraError(r);
    k.commit(slug, "building", 0, (x) => ({ ...x, state: "failed", resumeState: "building", error, note: addNote(x.note, note) }));
    return;
  }
  if (!r.ok && r.error) {
    try {
      deps.lesson?.(`Dựng lỗi (${r.stage ?? "build"}): ${r.error.replace(/\s+/g, " ").slice(0, 240)}`);
    } catch {
      // a lessons-file problem never changes the session
    }
  }
  // Rebuild: materials are already chosen, go straight to rendering.
  const skipMaterials = !!marker && r.ok && k.has(slug, F.materials);
  k.commit(slug, "building", 0, (x) => {
    const n = afterBuild(x, { ok: r.ok, ...(r.error !== undefined ? { error: r.error } : {}) });
    return { ...(skipMaterials ? { ...n, state: "rendering" as const } : n), note: addNote(n.note, note) };
  }, () => {
    if (r.ok) {
      writeBuildStats(k, slug, r);
      store.writeFile(slug, F.buildOk, new Date(deps.now()).toISOString());
      // After a rebuild the measured outer box is the new reference of spec.json.
      const bb = r.bboxMm;
      if (marker && bb && bb.every((v) => Number.isFinite(v) && v >= 1)) {
        k.writeJson(slug, F.spec, { ...plan, bbox_mm: bb.map((v) => Math.round(v * 10) / 10) });
      }
    }
    if (marker) k.remove(slug, F.rebuild);
  });
}

export async function renderingStep(k: StepKit, slug: string, s: W3DSnapshot, ctx: CtxOf): Promise<void> {
  const { deps, store } = k;
  let rp = k.readJson<RenderPlan>(slug, F.renderPlan);
  let cost = 0;
  if (!rp) {
    const out = await k.runRole(slug, s, "render-director", ctx({}), parseRenderPlan);
    if (!out) return;
    cost = out.cost;
    if (!atStep(store.get(slug)?.snapshot, "rendering")) return void k.commit(slug, "rendering", cost, (x) => x);
    k.writeJson(slug, F.renderPlan, out.value);
    rp = out.value;
  }
  if (k.has(slug, F.materials)) {
    // The build GLB may predate materials.json (first round, or a material fix round): assemble again before rendering.
    let a: BuildResult;
    try {
      a = await deps.assemble(slug, {});
    } catch (e) {
      a = { ok: false, stage: "assemble", error: errText(e), warnings: [], files: [] };
    }
    if (!a.ok && a.infra) {
      const error = infraError(a);
      return void k.commit(slug, "rendering", cost, (x) => ({ ...withCost(x, cost), state: "failed", resumeState: "rendering", error }));
    }
    if (!a.ok) return k.fail(slug, "rendering", cost, `Ghép GLB với vật liệu lỗi: ${a.error ?? "không rõ"}`);
    writeBuildStats(k, slug, a);
  }
  if (!atStep(store.get(slug)?.snapshot, "rendering")) return void k.commit(slug, "rendering", cost, (x) => x);
  let loopNote: string | null = null;
  if (s.hqMode === "loop" && deps.hq?.available()) {
    // Strong machine: Blender renders every round (lower settings); three.js only when Blender gives nothing.
    const still = (): boolean => store.get(slug)?.snapshot.state === "rendering";
    let h: HqResult | null = null;
    try {
      h = await deps.hq.render(slug, { profile: "loop", plan: rp, shouldContinue: still });
    } catch (e) {
      loopNote = `Render Blender trong vòng lỗi: ${errText(e).slice(0, 200)}; dùng three.js.`;
    }
    if (h?.aborted) return void k.commit(slug, "rendering", cost, (x) => x);
    if (h?.ok) {
      const files = h.files;
      return void k.commit(slug, "rendering", cost, okWith(afterStepOk, cost, hqNote(h)), () => k.writeJson(slug, F.renders, files));
    }
    if (h) loopNote = `Render Blender trong vòng không ra ảnh (${h.skipped ?? h.warnings[0] ?? "không rõ"}); dùng three.js.`;
  }
  let r: { ok: boolean; files: string[]; error?: string };
  try {
    r = await deps.render(slug, rp);
  } catch (e) {
    r = { ok: false, files: [], error: errText(e) };
  }
  if (!r.ok) return k.fail(slug, "rendering", cost, `Dựng ảnh lỗi: ${r.error ?? "không rõ"}`);
  k.commit(slug, "rendering", cost, okWith(afterStepOk, cost, loopNote), () => k.writeJson(slug, F.renders, r.files));
}

export async function optimizingStep(k: StepKit, slug: string, s: W3DSnapshot, ctx: CtxOf): Promise<void> {
  const out = await k.runRole(slug, s, "ar-optimizer", ctx({}), parseOptimize);
  if (!out) return;
  if (!atStep(k.store.get(slug)?.snapshot, "optimizing")) return void k.commit(slug, "optimizing", out.cost, (x) => x);
  let note: string | null = null;
  try {
    const a = await k.deps.assemble(slug, { maxTriangles: out.value.max_triangles, texturePx: out.value.texture_px });
    const mobileWarn = a.warnings.filter((w) => /di động|model-mobile/.test(w));
    if (!a.ok) note = `Không tạo được bản di động (model-mobile.glb): ${a.error ?? "không rõ"}`;
    else {
      writeBuildStats(k, slug, a);
      if (mobileWarn.length > 0) note = mobileWarn.join(" ");
    }
  } catch (e) {
    note = `Không tạo được bản di động (model-mobile.glb): ${errText(e)}`;
  }
  k.commit(slug, "optimizing", out.cost, okWith(afterStepOk, out.cost, note), () => k.writeJson(slug, F.optimize, out.value));
}

// ---------------------------------------------------------------- Blender high-quality phase (two-phase review)

/** What the runner needs from the Blender step (index.ts wires blender.ts; tests inject fakes). */
export interface W3DHqDeps {
  /** Blender found now (it may have been removed since the session started). */
  available(): boolean;
  render(slug: string, opts: HqOptions): Promise<HqResult>;
  /** outputs/model-blender.glb; skipped when disabled in the config. */
  exportGlb(slug: string, opts: { shouldContinue?: () => boolean }): Promise<{ ok: boolean; skipped?: boolean; aborted?: boolean; warning?: string }>;
  /** renders/pano/pano.jpg: 360-degree view from inside the cabin for the presentation page (panorama.ts); absent = skipped. */
  panorama?(slug: string, opts: { shouldContinue?: () => boolean }): Promise<{ ok: boolean; skipped?: string; aborted?: boolean; reused?: boolean; seconds?: number; error?: string }>;
}

export const W3D_FINAL_REVIEW = "review-final.json";
export const BEST_FINAL_DIR = "best-final";
const BEST_FINAL_FILES = [F.materials, "outputs/model.glb", BLENDER_GLB] as const;

const mtime = (f: string): number => {
  try {
    return fs.statSync(f).mtimeMs;
  } catch {
    return 0;
  }
};

/** One short note line for the result of a Blender render (count, time, first warnings). */
export function hqNote(r: HqResult, extra: string[] = []): string | null {
  const warn = [...(r.skipped ? [r.skipped] : []), ...r.warnings, ...extra];
  const head = r.files.length > 0
    ? `Render chất lượng cao (Blender): ${r.files.length} ảnh (${r.rendered.length} mới, ${r.reused.length} dùng lại) trong ${Math.round(r.seconds / 6) / 10} phút.`
    : null;
  const lines = [head, ...warn.slice(0, 3)].filter((x): x is string => !!x);
  return lines.length ? lines.join(" ") : null;
}

/** Re-assemble outputs/model.glb when materials.json is newer (after a targeted material fix). */
async function assembleIfMaterialsNewer(k: StepKit, slug: string): Promise<{ error: string; infra: boolean } | null> {
  if (!k.has(slug, F.materials) || mtime(k.abs(slug, F.materials)) <= mtime(k.abs(slug, "outputs/model.glb"))) return null;
  let a: BuildResult;
  try {
    a = await k.deps.assemble(slug, {});
  } catch (e) {
    a = { ok: false, stage: "assemble", error: errText(e), warnings: [], files: [] };
  }
  if (!a.ok) return { error: a.error ?? "không rõ", infra: !!a.infra };
  writeBuildStats(k, slug, a);
  return null;
}

export async function hqRenderStep(k: StepKit, slug: string, s: W3DSnapshot): Promise<void> {
  const hq = k.deps.hq;
  if (!hq || !hq.available()) {
    return void k.commit(slug, "hqrender", 0, (x) => afterHqRender(x, { images: 0, note: BLENDER_MISSING_MSG }));
  }
  const asm = await assembleIfMaterialsNewer(k, slug);
  if (asm?.infra) return void k.commit(slug, "hqrender", 0, (x) => ({ ...x, state: "failed", resumeState: "hqrender", error: infraError(asm) }));
  if (asm) return k.fail(slug, "hqrender", 0, `Ghép GLB với vật liệu lỗi: ${asm.error}`);
  const still = (): boolean => k.store.get(slug)?.snapshot.state === "hqrender";
  let r: HqResult;
  try {
    r = await hq.render(slug, { profile: "final", plan: k.readJson<RenderPlan>(slug, F.renderPlan), redo: s.hqRedo ?? null, shouldContinue: still });
  } catch (e) {
    r = { ok: false, files: [], rendered: [], reused: [], failed: [], blank: [], warnings: [`Render chất lượng cao lỗi: ${errText(e).slice(0, 300)}`], seconds: 0 };
  }
  if (r.aborted) return; // paused or stopped: finished images are checkpoints, the loop re-reads the state
  const extra: string[] = [];
  if (r.ok) {
    const fit = await fitExposureToReference(k, slug, hq, still);
    if (fit.aborted) return;
    if (fit.note) extra.push(fit.note);
    if (fit.result) r = mergeHq(r, fit.result);
  }
  if (r.ok) {
    try {
      const g = await hq.exportGlb(slug, { shouldContinue: still });
      if (g.aborted) return;
      if (g.warning) extra.push(g.warning);
    } catch (e) {
      extra.push(`Không xuất được model-blender.glb: ${errText(e).slice(0, 200)}`);
    }
  }
  k.commit(slug, "hqrender", 0, (x) => afterHqRender(x, { images: r.files.length, note: hqNote(r, extra) }));
}

function mergeHq(a: HqResult, b: HqResult): HqResult {
  return { ...a, files: b.files.length ? b.files : a.files, rendered: [...new Set([...a.rendered, ...b.rendered])], warnings: [...a.warnings, ...b.warnings], seconds: Math.round((a.seconds + b.seconds) * 10) / 10 };
}

/**
 * Brightness fit against the reference photos: measures the Blender images (color-delta), and renders again only the views
 * whose whole-image dL* is far off, with the exposure changed by exposure-fit.ts (capped; at most FIT_MAX_PASSES passes).
 * No reference palette = nothing happens. Never fails the step.
 */
async function fitExposureToReference(k: StepKit, slug: string, hq: NonNullable<StepKit["deps"]["hq"]>, still: () => boolean): Promise<{ aborted?: boolean; note?: string; result?: HqResult }> {
  if (!k.deps.color || !k.has(slug, REFERENCE_PALETTE)) return {};
  const dir = k.store.dir(slug);
  const trail: string[] = [];
  let result: HqResult | undefined;
  for (let pass = 0; pass < FIT_MAX_PASSES; pass++) {
    const files = hqRenderFiles(dir).map((f) => slashes(path.join(dir, f)));
    if (files.length === 0) break;
    await colorDeltaFor(k, slug, files, "hq");
    let delta: unknown = null;
    try {
      delta = JSON.parse(fs.readFileSync(path.join(dir, COLOR_DELTA), "utf8"));
    } catch {
      break;
    }
    const views = fitViewsFromDelta(delta);
    if (pass === 0) trail.push(...views.map((v) => `${v.view} ${v.dL > 0 ? "+" : ""}${v.dL}`));
    const boosts = planExposureBoosts(views, readHqExposure(dir));
    if (Object.keys(boosts).length === 0) break;
    let r: HqResult;
    try {
      r = await hq.render(slug, { profile: "final", plan: k.readJson<RenderPlan>(slug, F.renderPlan), exposureBoost: boosts, shouldContinue: still });
    } catch {
      break;
    }
    if (r.aborted) return { aborted: true };
    result = result ? mergeHq(result, r) : r;
    trail.push(`bù sáng lần ${pass + 1}: ${Object.entries(boosts).map(([n, b]) => `${n} ${b > 0 ? "+" : ""}${b}`).join(", ")} stop`);
  }
  if (result) await colorDeltaFor(k, slug, hqRenderFiles(dir).map((f) => slashes(path.join(dir, f))), "hq");
  return { ...(result ? { result } : {}), ...(trail.length > 1 ? { note: `Bù sáng theo ảnh mẫu (dL* trước: ${trail.join("; ")}).` } : {}) };
}

function copyInto(k: StepKit, slug: string, from: string, to: string): void {
  for (const rel of BEST_FINAL_FILES) {
    if (!k.has(slug, `${from}${rel}`)) continue;
    fs.mkdirSync(path.dirname(k.abs(slug, `${to}${rel}`)), { recursive: true });
    fs.copyFileSync(k.abs(slug, `${from}${rel}`), k.abs(slug, `${to}${rel}`));
  }
  if (k.has(slug, `${from}${HQ_DIR}`)) {
    fs.rmSync(k.abs(slug, `${to}${HQ_DIR}`), { recursive: true, force: true });
    fs.cpSync(k.abs(slug, `${from}${HQ_DIR}`), k.abs(slug, `${to}${HQ_DIR}`), { recursive: true });
  }
}

export async function hqReviewStep(k: StepKit, slug: string, s: W3DSnapshot, ctx: CtxOf): Promise<void> {
  const dir = k.store.dir(slug);
  const files = hqRenderFiles(dir).map((r) => slashes(path.join(dir, r)));
  if (files.length === 0) {
    return void k.commit(slug, "hqreview", 0, (x) => ({ ...x, state: "optimizing", issues: [], note: addNote(x.note, "Không còn ảnh chất lượng cao: bỏ qua bước duyệt lần cuối.") }));
  }
  const colorDelta = await colorDeltaFor(k, slug, files, "hq");
  const out = await k.runRole(slug, s, "visual-reviewer", ctx({ renders: files, reviewMode: "final", colorDelta }), parseVerdict);
  if (!out) return;
  const v = out.value;
  let decided: W3DSnapshot | null = null;
  k.commit(slug, "hqreview", out.cost, (x) => (decided = afterFinalReview(x, v, out.cost)), () => {
    const round = s.hqFixRounds ?? 0;
    k.writeJson(slug, W3D_FINAL_REVIEW, { ...v, finalRound: round });
    const phase1 = k.readJson<Record<string, unknown>>(slug, F.review);
    if (phase1) k.writeJson(slug, F.review, { ...phase1, final: { ...v, finalRound: round } });
    const d = decided as W3DSnapshot | null;
    try {
      if (d && d.bestFinalRound === round && v.scores && d.bestFinalScore === reviewTotal(v.scores)) copyInto(k, slug, "", `${BEST_FINAL_DIR}/`);
      if (d && !v.ok && d.state === "optimizing" && shouldUseBestFinal(d) && k.has(slug, BEST_FINAL_DIR)) copyInto(k, slug, `${BEST_FINAL_DIR}/`, "");
    } catch {
      /* the best copy is best effort: the current version stays */
    }
  });
}

/** reference-palette.json (computed when missing or stale) as prompt text for material-artist; null without references. */
export async function paletteFor(k: StepKit, slug: string, references: readonly string[] | undefined): Promise<string | null> {
  const color = k.deps.color;
  if (!color || !references?.length) return null;
  try {
    const w = await color.palette(slug, [...references]);
    if (w) k.deps.log?.(`workshop3d ${slug}: ${w}`);
  } catch (e) {
    k.deps.log?.(`workshop3d ${slug}: đo màu ảnh mẫu lỗi: ${errText(e)}`);
  }
  return readColorText(k.store.dir(slug), REFERENCE_PALETTE);
}

/** color-delta.json of these renders as prompt text for visual-reviewer; null without a reference palette. */
export async function colorDeltaFor(k: StepKit, slug: string, renders: string[], mode: "fast" | "hq"): Promise<string | null> {
  const color = k.deps.color;
  if (!color || renders.length === 0 || !k.has(slug, REFERENCE_PALETTE)) return null;
  try {
    const w = await color.delta(slug, renders, mode);
    if (w) k.deps.log?.(`workshop3d ${slug}: ${w}`);
  } catch (e) {
    k.deps.log?.(`workshop3d ${slug}: đo độ lệch màu lỗi: ${errText(e)}`);
  }
  return readColorText(k.store.dir(slug), COLOR_DELTA);
}

const PART_FILE_RE =/^([a-z0-9][a-z0-9_]{0,63})\.stl$/i;

/** Part ids the CAD script wrote (outputs/parts/*.stl) that the plan does not list, sorted; [] before the first build. */
export function modelPartsOutsidePlan(sessionDir: string, plan: W3DPlan | undefined): string[] {
  let names: string[];
  try {
    names = fs.readdirSync(path.join(sessionDir, "outputs", "parts"));
  } catch {
    return [];
  }
  const known = new Set((plan?.parts ?? []).map((p) => p.id));
  return names.map((n) => PART_FILE_RE.exec(n)?.[1]).filter((id): id is string => !!id && !known.has(id)).sort();
}

export async function hqMaterialsStep(k: StepKit, slug: string, s: W3DSnapshot, ctx: CtxOf, plan: W3DPlan | undefined): Promise<void> {
  if (!plan) return k.fail(slug, s.state, 0, "Thiếu hoặc hỏng spec.json (bảng chi tiết).");
  const modelParts = modelPartsOutsidePlan(k.store.dir(slug), plan);
  const parse = (text: string): Parsed<{ materials: Record<string, W3DMaterial>; note?: string }> => {
    const p = parseMaterials(text);
    return p.ok ? crossCheckMaterials(plan, p.value.materials, modelParts) : p;
  };
  const palette = await paletteFor(k, slug, ctx({}).references);
  const out = await k.runRole(slug, s, "material-artist", ctx({ issues: s.issues, modelParts, palette }), parse);
  if (out) k.commit(slug, "hqmaterials", out.cost, okWith(afterStepOk, out.cost, out.value.note), () => k.writeJson(slug, F.materials, { materials: out.value.materials }));
}

/** Renders for render-presenter: the high-quality set when there is one, else the three.js renders. */
export function presenterRenders(k: StepKit, slug: string): string[] {
  const dir = k.store.dir(slug);
  const hq = hqRenderFiles(dir);
  const rels = hq.length > 0 ? hq : (k.readJson<string[]>(slug, F.renders) ?? []);
  return rels.map((r) => slashes(path.join(dir, r)));
}

const scoreText = (sc: W3DScores | null | undefined): string =>
  sc ? `đẹp ${sc.beauty}, chi tiết ${sc.detail}, tỉ lệ ${sc.proportion}${typeof sc.likeness === "number" ? `, giống ảnh mẫu ${sc.likeness}` : ""} (tổng ${reviewTotal(sc)})` : "chưa có";

/** Deterministic end of REPORT.md: both review phases, the Blender images and what is left unfixed. */
export function reviewSection(s: W3DSnapshot, phase1: { scores?: W3DScores } | null, hqFiles: string[], glb: boolean): string {
  const lines = ["", "## Điểm duyệt", ""];
  if (s.hqMode === "final") {
    lines.push(`- Pha 1 (hình học, ảnh render nhanh): ${scoreText(phase1?.scores)}`);
    lines.push(`- Pha 2 (duyệt lần cuối trên ảnh Blender): ${scoreText(s.finalScores)}${s.hqFixRounds ? `, sau ${s.hqFixRounds} lượt sửa` : ""}`);
  } else {
    lines.push(`- Duyệt ảnh: ${scoreText(phase1?.scores)}`);
  }
  if (hqFiles.length > 0) lines.push(`- Ảnh chất lượng cao (Blender Cycles): ${hqFiles.map((f) => f.split("/").pop()).join(", ")}`);
  if (glb) lines.push("- Bàn xem 3D dùng outputs/model-blender.glb (vật liệu đá thật, đã qua gltf-validator).");
  const backlog = s.backlog ?? [];
  if (backlog.length > 0) {
    lines.push("", "### Lỗi còn tồn đọng (chưa sửa)", "");
    for (const i of backlog.slice(0, 30)) lines.push(`- [${i.target}] ${i.text}`);
  }
  return `${lines.join("\n")}\n`;
}
