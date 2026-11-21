// src/core/workshop3d/index.ts — wires the 3D workshop engine (store, role steps, build, render, runner) for the server and the CLI.
import fs from "node:fs";
import path from "node:path";
import { locateBrowser } from "../app/browser-locator.js";
import { CAD_PYTHON_MISSING_MSG, defaultCadRunner, findCadPython } from "../design3d/cad-tools.js";
import { loadKit, type Design3dKit } from "../design3d/design3d-kit.js";
import { parseW3DBlender, type ControllerConfig } from "../app/config.js";
import type { RunManager } from "../run/run-manager.js";
import { exportBlenderGlb, findBlender, hqRenderFiles, readHqProgress, renderHq, type HqDeps, type HqProgress } from "./blender.js";
import { runAssemble, runBuild, type BuildDeps, type BuildOptions, type BuildResult } from "./build.js";
import { createColorDeps, type W3DColorDeps } from "./palette.js";
import { patchParams, type PatchResult } from "./patch-params.js";
import { renderViews } from "./render.js";
import type { RenderPlan, W3DPlan } from "./role-output.js";
import { createW3DRunner, type W3DRunner } from "./runner.js";
import { W3D_FILES, type W3DHqDeps } from "./runner-steps.js";
import { isRunning, W3DError } from "./state.js";
import type { W3DLoopLimits } from "./state.js";
import { createW3DRunStep, WORKSHOP3D_PROJECT, type W3DStepManager } from "./step-adapter.js";
import { pickW3DModel } from "./model-settings.js";
import { loadAppSettings } from "../app/app-settings.js";
import { appendLesson, readLessons } from "../ideas/lessons.js";
import { renderPanorama } from "./panorama.js";
import { deliveryDir, syncDelivery } from "./delivery.js";
import { buildPresentation, type PresentationResult } from "./presentation.js";
import { createW3DStore, safeRel, type W3DListItem, type W3DStore } from "./store.js";
import type { W3DBrief, W3DHqMode, W3DSnapshot } from "./types.js";

export const MAX_W3D_FILE_BYTES = 50 * 1024 * 1024;
const QUOTA_FULL_PCT = 98;

const FILE_TYPES: Record<string, string> = {
  glb: "model/gltf-binary",
  gltf: "model/gltf+json",
  usdz: "model/vnd.usdz+zip",
  step: "application/octet-stream",
  stp: "application/octet-stream",
  stl: "application/octet-stream",
  png: "image/png",
  md: "text/markdown; charset=utf-8",
  json: "application/json; charset=utf-8",
};

export interface W3DDetail {
  brief: W3DBrief;
  snapshot: W3DSnapshot;
  files: string[];
  /** High-quality images (renders/hq/, view order) first, then the three.js renders. */
  renders: string[];
  report: string | null;
  /** Blender progress ("Đang render chất lượng cao: ảnh i/N"), null before the first Blender render. */
  hq?: HqProgress | null;
  /** Bytes of the session folder (delete confirmation), refreshed at most every 30 s. */
  diskBytes?: number;
  /** Where the files are (the session folder is under the app's data dir; outputs/ holds the deliverables). */
  paths?: W3DPaths;
}

/** A file request that must be answered with an HTTP error (status + Vietnamese message). */
export class W3DFileError extends Error {
  constructor(message: string, readonly status: 400 | 404 | 413) {
    super(message);
  }
}

export interface W3DPaths {
  session: string;
  outputs: string;
  /** `<outputs>/trinh-bay` once built, else null. */
  presentation: string | null;
  /** Mirror of the deliverables in the Settings output folder (where the user looks for the files). */
  delivery: string | null;
}

export interface W3DFileInfo {
  abs: string;
  size: number;
  contentType: string;
  /** Viewers (png, glb) embed the file; everything else may be downloaded. */
  inline: boolean;
}

/** What the HTTP server needs from the engine (tests inject a fake with the same shape). */
export interface Workshop3DEngine {
  store: W3DStore;
  runner: W3DRunner;
  /** Kills running role runs (stop). */
  cancelActive(): void;
  /** Clears the sticky cancel flag of the step adapter (start/resume). */
  resetCancel(): void;
  listForApi(): W3DListItem[];
  detail(slug: string): W3DDetail | null;
  /** Validated file under outputs/ or renders/; throws W3DFileError. */
  filePath(slug: string, rel: string): W3DFileInfo;
  /** The design3d kit (null when it fails to load). */
  kit(): Design3dKit | null;
  /** Checked before a new session is created: a Vietnamese message when the CAD python is missing, else null. */
  preflight(): string | null;
  /** Delete the session folder for good (W3DError while it runs, bakes or renders). Returns the bytes freed. */
  remove(slug: string): { bytes: number };
  /** (Re)builds the offline presentation page `outputs/trinh-bay/index.html` from the session's files. */
  buildPresentation?(slug: string): PresentationResult;
  /** Copies the deliverables to the Settings output folder; returns that folder and how many files were copied. */
  deliver?(slug: string): { dir: string; copied: number };
  /** Absolute folders of a session (shown in the app and opened in Explorer). */
  paths?(slug: string): W3DPaths | null;
}

/** The engine, or null plus the reason when it cannot be built: a broken 3D workshop must never stop the app. */
export function tryCreateWorkshop3D(create: () => Workshop3DEngine, log: (msg: string) => void = (m) => console.warn(m)): { engine: Workshop3DEngine | null; error: string | null } {
  try {
    return { engine: create(), error: null };
  } catch (e) {
    const error = e instanceof Error ? e.message : String(e);
    log(`Xưởng dựng 3D không khởi tạo được (các chức năng khác vẫn chạy): ${error}`);
    return { engine: null, error };
  }
}

/** 503 message of every /api/workshop3d route while the engine is unavailable. */
export function workshop3dUnavailableMessage(error: string | null): string {
  return `Xưởng dựng 3D chưa sẵn sàng: ${(error ?? "không rõ lý do").slice(0, 300)}. Kiểm tra tệp config/roles-design3d.json rồi khởi động lại app.`;
}

function pathsOf(root: string, delivery: string | null): W3DPaths {
  const pres = path.join(root, "outputs", "trinh-bay");
  return { session: root, outputs: path.join(root, "outputs"), presentation: fs.existsSync(path.join(pres, "index.html")) ? pres : null, delivery: delivery && fs.existsSync(delivery) ? delivery : null };
}

function listRecursive(root: string, sub: string, depth = 3): string[] {
  const out: string[] = [];
  const walk = (rel: string, d: number): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(path.join(root, rel), { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
      const r = `${rel}/${e.name}`;
      if (e.isDirectory()) {
        if (d > 0) walk(r, d - 1);
      } else if (e.isFile()) out.push(r);
    }
  };
  walk(sub, depth);
  return out;
}

/** Adds the read-side helpers (list, detail, safe file lookup) to a store + runner pair. */
export function makeWorkshop3DEngine(parts: {
  store: W3DStore;
  runner: W3DRunner;
  cancelActive?: () => void;
  resetCancel?: () => void;
  kit?: () => Design3dKit | null;
  preflight?: () => string | null;
  /** Settings output folder (app-settings outputDir, else <workspace>/outputs). */
  outputDir?: () => string;
}): Workshop3DEngine {
  const { store, runner } = parts;
  const deliveryOf = (slug: string): string | null => {
    if (!parts.outputDir) return null;
    try {
      return deliveryDir(parts.outputDir(), slug, store.get(slug)?.brief.title ?? "");
    } catch {
      return null;
    }
  };
  // Folder size for the delete confirmation: walked at most every 30 s per session (detail is polled every 3 s).
  const diskCache = new Map<string, { at: number; bytes: number }>();
  const cachedBytes = (slug: string): number => {
    const c = diskCache.get(slug);
    if (c && Date.now() - c.at < 30_000) return c.bytes;
    const bytes = store.diskBytes(slug);
    diskCache.set(slug, { at: Date.now(), bytes });
    return bytes;
  };
  // A progress file left "running" by a crash must not block deleting forever.
  const staleProgress = (updatedAt: string | undefined): boolean => !updatedAt || Date.now() - Date.parse(updatedAt) > 2 * 3600_000;
  return {
    store,
    runner,
    cancelActive: () => parts.cancelActive?.(),
    resetCancel: () => parts.resetCancel?.(),
    listForApi: () => store.list(),
    kit: () => parts.kit?.() ?? null,
    preflight: () => parts.preflight?.() ?? null,
    detail(slug) {
      const rec = store.get(slug);
      if (!rec) return null;
      const root = store.dir(slug);
      return {
        brief: rec.brief,
        snapshot: rec.snapshot,
        files: listRecursive(root, "outputs"),
        renders: [...hqRenderFiles(root), ...listRecursive(root, "renders", 0), ...(fs.existsSync(path.join(root, "renders", "pano", "pano.jpg")) ? ["renders/pano/pano.jpg"] : [])],
        report: store.readFile(slug, W3D_FILES.report),
        hq: readHqProgress(root),
        diskBytes: cachedBytes(slug),
        paths: pathsOf(root, deliveryOf(slug)),
      };
    },
    paths(slug: string) {
      if (!store.exists(slug)) return null;
      return pathsOf(store.dir(slug), deliveryOf(slug));
    },
    deliver(slug: string) {
      if (!store.exists(slug)) throw new W3DError("Không tìm thấy phiên dựng 3D.");
      const dest = deliveryOf(slug);
      if (!dest) throw new W3DError("Chưa biết thư mục kết quả.");
      return { dir: dest, copied: syncDelivery(store.dir(slug), dest) };
    },
    buildPresentation(slug: string) {
      if (!store.exists(slug)) throw new W3DError("Không tìm thấy phiên dựng 3D.");
      return buildPresentation(store.dir(slug));
    },
    remove(slug: string) {
      const rec = store.get(slug);
      if (!rec) throw new W3DError("Không tìm thấy phiên dựng 3D.");
      if (isRunning(rec.snapshot.state)) throw new W3DError("Phiên đang chạy: bấm Dừng (hoặc Tạm dừng) rồi mới xóa được bản dựng.");
      const hq = readHqProgress(store.dir(slug));
      if (hq?.running && !staleProgress(hq.updatedAt)) throw new W3DError("Blender đang render phiên này: chờ xong (hoặc dừng phiên) rồi mới xóa.");
      const bytes = store.diskBytes(slug);
      store.remove(slug);
      diskCache.delete(slug);
      return { bytes };
    },
    filePath(slug, rel) {
      if (!store.exists(slug)) throw new W3DFileError("Không tìm thấy phiên dựng 3D.", 404);
      let safe: string;
      try {
        safe = safeRel(rel);
      } catch {
        throw new W3DFileError("Đường dẫn tệp không hợp lệ.", 400);
      }
      const [top] = safe.split("/");
      if (top !== "outputs" && top !== "renders") throw new W3DFileError("Chỉ đọc được tệp trong outputs/ hoặc renders/.", 400);
      const ext = path.extname(safe).slice(1).toLowerCase();
      const contentType = FILE_TYPES[ext];
      if (!contentType) throw new W3DFileError("Loại tệp này không được phép tải.", 400);
      const root = store.dir(slug);
      const abs = path.join(root, safe);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        throw new W3DFileError("Không tìm thấy tệp.", 404);
      }
      if (!st.isFile() || st.isSymbolicLink()) throw new W3DFileError("Không tìm thấy tệp.", 404);
      // A junction or symlinked folder inside the session must not lead out of it.
      try {
        const real = fs.realpathSync(abs);
        const realRoot = fs.realpathSync(root);
        if (real !== realRoot && !real.startsWith(realRoot + path.sep)) throw new W3DFileError("Đường dẫn tệp không hợp lệ.", 400);
      } catch (e) {
        if (e instanceof W3DFileError) throw e;
        throw new W3DFileError("Không tìm thấy tệp.", 404);
      }
      if (st.size > MAX_W3D_FILE_BYTES) throw new W3DFileError("Tệp quá lớn (tối đa 50 MB).", 413);
      return { abs, size: st.size, contentType, inline: ext === "png" || ext === "glb" };
    },
  };
}

/** Earliest future reset (epoch ms) among subscription windows that are (nearly) used up; null when none. */
export function quotaResetFrom(
  last: { five_hour_pct: number | null; seven_day_pct: number | null; five_hour_resets_at: number | null; seven_day_resets_at: number | null } | null,
  now: number,
): number | null {
  if (!last) return null;
  // pct is plain percent 0..100 (stream-parser, quota-baseline); resets_at is seconds or ms (same rule as resetsMs in quota-baseline.ts).
  const full = (pct: number | null): boolean => typeof pct === "number" && Number.isFinite(pct) && pct >= QUOTA_FULL_PCT;
  const ms = (v: number | null): number | null => (typeof v === "number" && Number.isFinite(v) ? (v < 1e11 ? v * 1000 : v) : null);
  const times: number[] = [];
  if (full(last.five_hour_pct)) times.push(ms(last.five_hour_resets_at) ?? NaN);
  if (full(last.seven_day_pct)) times.push(ms(last.seven_day_resets_at) ?? NaN);
  const future = times.filter((t) => Number.isFinite(t) && t > now);
  return future.length > 0 ? Math.min(...future) : null;
}

/** Loop limits of new sessions from controller.json `workshop3d` (missing keys use the state.ts defaults). */
export function w3dLimitsFrom(config: Pick<ControllerConfig, "workshop3d">): W3DLoopLimits {
  const c = config.workshop3d ?? {};
  const out: W3DLoopLimits = {};
  if (c.maxFixRounds !== undefined) out.maxFixRounds = c.maxFixRounds;
  if (c.maxNoImproveRounds !== undefined) out.maxNoImprove = c.maxNoImproveRounds;
  if (c.maxAutoResumes !== undefined) out.maxAutoResumes = c.maxAutoResumes;
  if (c.blender !== undefined) out.maxHqFixRounds = parseW3DBlender(c.blender).finalFixRounds;
  return out;
}

/**
 * Blender high-quality step of the engine (blender.ts) with the app's folders: the user's stone library
 * (<dataDir>/library/materials) and the Poly Haven assets of `tnf w3d fetch-assets` (<dataDir>/library/polyhaven).
 * `blender` overrides the lookup (tests); undefined = findBlender at every call (installing Blender needs no restart).
 */
export function createHqDeps(opts: { config: Pick<ControllerConfig, "workshop3d" | "tools">; dataDir: string; store: W3DStore; blender?: string | null; run?: HqDeps["run"]; validateGlb?: HqDeps["validateGlb"] }): { hq: W3DHqDeps; mode: () => W3DHqMode } {
  const cfg = parseW3DBlender(opts.config.workshop3d?.blender);
  const exe = (): string | null => (opts.blender !== undefined ? opts.blender : findBlender(process.env, [cfg.path, opts.config.tools?.blender ?? null]));
  const deps = (): HqDeps => ({
    blender: exe(),
    libraryDir: path.join(opts.dataDir, "library", "materials"),
    polyhavenDir: path.join(opts.dataDir, "library", "polyhaven"),
    ...(opts.run ? { run: opts.run } : {}),
    ...(opts.validateGlb ? { validateGlb: opts.validateGlb } : {}),
  });
  return {
    hq: {
      available: () => cfg.enabled && exe() !== null,
      render: (slug, o) => renderHq(opts.store, slug, cfg, deps(), o),
      exportGlb: (slug, o) => exportBlenderGlb(opts.store, slug, cfg, deps(), o),
      panorama: (slug, o) => renderPanorama(opts.store, slug, cfg, deps(), o),
    },
    mode: () => (!cfg.enabled || exe() === null ? "off" : cfg.inLoop ? "loop" : "final"),
  };
}

/** Replaceable parts of the engine (tests); every field defaults to the production behaviour. */
export interface Workshop3DDeps {
  /** CAD python for build, assemble and the PARAMS patch (null = not installed); default findCadPython. */
  python?: string | null;
  validateGlb?: BuildDeps["validateGlb"];
  render?: (slug: string, plan: RenderPlan) => Promise<{ ok: boolean; files: string[]; error?: string }>;
  patchParams?: (scriptPath: string, params: Record<string, string | number>) => Promise<PatchResult>;
  /** Whole build / assemble steps, for tests that must not run CAD at all. */
  build?: (slug: string, plan: W3DPlan, opts?: BuildOptions) => Promise<BuildResult>;
  assemble?: (slug: string, opts: BuildOptions) => Promise<BuildResult>;
  quotaResetAt?: () => number | null;
  /** blender.exe for the high-quality step (null = not installed); default findBlender. */
  blender?: string | null;
  blenderRun?: HqDeps["run"];
  /** Colour measurement (reference palette, render colour delta); null = off. Default: the CAD python, off under vitest
   * or with a fake build/render unless given. */
  color?: W3DColorDeps | null;
}

export interface CreateWorkshop3DOptions {
  manager: RunManager;
  dataDir: string;
  config: ControllerConfig;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  log?: (msg: string) => void;
  deps?: Workshop3DDeps;
}

export function createWorkshop3D(opts: CreateWorkshop3DOptions): Workshop3DEngine {
  const { manager, dataDir, config } = opts;
  const deps = opts.deps ?? {};
  const now = opts.now ?? (() => Date.now());
  const sleep = opts.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const store = createW3DStore(dataDir);

  // The role runs belong to a repo-less project; created here so it exists before the first step.
  if (!manager.store.getProject(WORKSHOP3D_PROJECT)) {
    manager.store.upsertProject({ name: WORKSHOP3D_PROJECT, repo_path: null, base_branch: null, allowed_commands: [] });
  }

  // Settings > Điều chỉnh "Model cho xưởng dựng 3D": read at every role call, so a change applies to the next call.
  const adapter = createW3DRunStep(manager as unknown as W3DStepManager, undefined, {
    modelFor: (_role, fileModel) => pickW3DModel(fileModel, loadAppSettings(dataDir).workshop3d?.models, config.models.map((m) => m.id)),
    resumeModeler: () => config.workshop3d?.resumeModeler === true,
  });
  const configuredPython = config.tools?.cad?.python ?? null;
  const python = (): string | null => (deps.python !== undefined ? deps.python : findCadPython(process.env, configuredPython));
  const buildDeps = (): BuildDeps => ({ python: python(), run: defaultCadRunner, ...(deps.validateGlb ? { validateGlb: deps.validateGlb } : {}) });
  // A test (fake render/build, or vitest) never starts the real Blender unless it passes deps.blender.
  const blender = deps.blender !== undefined ? deps.blender : deps.render || deps.build || process.env["VITEST"] ? null : undefined;
  const hq = createHqDeps({ config, dataDir, store, ...(blender !== undefined ? { blender } : {}), ...(deps.blenderRun ? { run: deps.blenderRun } : {}), ...(deps.validateGlb ? { validateGlb: deps.validateGlb } : {}) });
  const color = deps.color !== undefined ? deps.color : deps.render || deps.build || process.env["VITEST"] ? null : createColorDeps({ store, python });
  const runner = createW3DRunner({
    store,
    hq: hq.hq,
    ...(color ? { color } : {}),
    lessons: () => readLessons(dataDir, "workshop3d"),
    lesson: (text) => void appendLesson(dataDir, "workshop3d", text),
    deliver: (slug) => {
      syncDelivery(store.dir(slug), deliveryDir(manager.outputDir(), slug, store.get(slug)?.brief.title ?? ""));
    },
    hqMode: hq.mode,
    runStep: adapter.runStep,
    build: deps.build ?? ((slug, plan, o) => runBuild(store, slug, plan, buildDeps(), o)),
    assemble: deps.assemble ?? ((slug, o) => runAssemble(store, slug, buildDeps(), o)),
    render: deps.render ?? ((slug, plan) => renderViews(store, slug, plan, { browser: locateBrowser()?.path ?? null })),
    patchParams: deps.patchParams ?? ((scriptPath, params) => patchParams(scriptPath, params, { python: python() })),
    now,
    sleep,
    quotaResetAt: deps.quotaResetAt ?? (() => quotaResetFrom(manager.lastRateLimit, now())),
    cancelActive: adapter.cancelActive,
    resetCancel: adapter.resetCancel,
    ...(opts.log ? { log: opts.log } : {}),
    limits: w3dLimitsFrom(config),
  });
  return makeWorkshop3DEngine({
    store,
    runner,
    cancelActive: adapter.cancelActive,
    resetCancel: adapter.resetCancel,
    // TNF_CAD_PYTHON, tools.cad.python, then the usual venvs (deps.python in tests).
    preflight: () => (python() ? null : CAD_PYTHON_MISSING_MSG),
    outputDir: () => manager.outputDir(),
    kit: () => {
      try {
        return loadKit(config.repoRoot);
      } catch {
        return null;
      }
    },
  });
}
