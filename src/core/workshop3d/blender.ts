/**
 * High-quality images of a workshop session with Blender Cycles (docs/DESIGN-3D.md "Render chất lượng cao bằng Blender").
 *
 * - findBlender(): TNF_BLENDER, configured paths (workshop3d.blender.path, tools.blender), then D:\tnf-cad-tools\blender\*\blender.exe.
 *   No Blender = the step is skipped (the session keeps its three.js images), never an error.
 * - renderHq(): ONE Blender process per view (tools/workshop3d/blender/render_view.py), spawned without a shell, killed
 *   with its whole tree at the per-image timeout or when the session leaves the step (pause / stop). Every finished image
 *   is a checkpoint in renders/hq/hq.json: a resume (restart, crash, power cut) renders only what is missing. A blank image
 *   (same rule as png.ts) is rendered once more with a wider camera, then dropped. Progress for the UI: renders/hq/progress.json.
 * - exportBlenderGlb(): outputs/model-blender.glb (real stone textures baked), kept only with 0 gltf-validator errors.
 */
import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { killTree } from "../design3d/cad-tools.js";
import { REPO_ROOT, type W3DBlenderConfig } from "../app/config.js";
import { defaultValidate, type BuildDeps } from "./build.js";
import { isBlank, pngStats } from "./png.js";
import { RENDER_INFO_FILE, sanitizeCameraName } from "./render.js";
import type { RenderPlan } from "./role-output.js";
import type { W3DStore } from "./store.js";

export const BLENDER_TOOLS_DIR = path.join(REPO_ROOT, "tools", "workshop3d", "blender");
export const BLENDER_DEFAULT_ROOT = "D:\\tnf-cad-tools\\blender";
export const HQ_DIR = "renders/hq";
export const HQ_MANIFEST = `${HQ_DIR}/hq.json`;
export const HQ_PROGRESS = `${HQ_DIR}/progress.json`;
export const HQ_EXPOSURE = `${HQ_DIR}/exposure.json`;
export const BLENDER_GLB = "outputs/model-blender.glb";
/** Default high-quality set: overview, towards the door, ceiling, left / right wall, COP close-up. */
export const HQ_DEFAULT_PRESETS = ["overview", "door", "ceiling", "wall_left", "wall_right", "cop"] as const;
export const HQ_PRESETS = [...HQ_DEFAULT_PRESETS, "floor", "wall_back"] as const;
const MAX_VIEWS = 8;
const GLB_TIMEOUT_MS = 1_200_000;
const NAME_RE = /^[a-z0-9_-]{1,44}$/;

export const BLENDER_MISSING_MSG =
  "Không tìm thấy Blender nên bỏ qua render chất lượng cao (giữ ảnh three.js). Cài Blender bản portable (giấy phép GPL, tải từ blender.org) " +
  "vào D:\\tnf-cad-tools\\blender\\<phiên bản>\\blender.exe, hoặc đặt đường dẫn vào workshop3d.blender.path / tools.blender trong controller.json hoặc biến TNF_BLENDER.";

/** First blender.exe that exists: TNF_BLENDER, configured paths, then D:\tnf-cad-tools\blender\*\blender.exe (newest folder name first). */
export function findBlender(
  env: NodeJS.ProcessEnv = process.env,
  configured: (string | null | undefined)[] = [],
  exists: (p: string) => boolean = fs.existsSync,
  listDir: (dir: string) => string[] = (d) => {
    try {
      return fs.readdirSync(d);
    } catch {
      return [];
    }
  },
): string | null {
  const w = path.win32;
  const scanned = listDir(BLENDER_DEFAULT_ROOT)
    .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    .map((d) => w.join(BLENDER_DEFAULT_ROOT, d, "blender.exe"));
  const candidates = [env["TNF_BLENDER"], ...configured, w.join(BLENDER_DEFAULT_ROOT, "blender.exe"), ...scanned];
  for (const c of candidates) if (c && exists(c)) return c;
  return null;
}

export interface HqView {
  name: string;
  preset?: string;
  orbit?: { az: number; el: number; dist: number; target?: string };
}

/** render-info.json of the three.js step: a hollow model got interior views (auto_* or mode interior / cutaway). */
export function looksHollow(info: { views?: { name?: string; mode?: string; auto?: boolean }[] } | null): boolean | null {
  const v = info?.views;
  if (!Array.isArray(v) || v.length === 0) return null;
  return v.some((x) => x?.auto === true || x?.mode === "interior" || x?.mode === "cutaway" || String(x?.name ?? "").startsWith("auto_"));
}

/**
 * Views of the high-quality set. Configured names win (preset names or plan:<camera>). Otherwise a hollow model (or one
 * of unknown shape) gets the default interior presets; a solid model uses the render-director's cameras when it has any.
 */
export function selectHqViews(plan: RenderPlan | null, configured: string[], hollow: boolean | null): HqView[] {
  const cams = plan?.cameras ?? [];
  const fromCamera = (c: RenderPlan["cameras"][number]): HqView => ({
    name: `plan_${sanitizeCameraName(c.name)}`.slice(0, 44),
    orbit: { az: c.azimuth, el: c.elevation, dist: c.distance, ...(c.target ? { target: c.target } : {}) },
  });
  let views: HqView[];
  if (configured.length > 0) {
    views = configured.flatMap((v): HqView[] => {
      if (v.startsWith("plan:")) {
        const c = cams.find((x) => sanitizeCameraName(x.name) === sanitizeCameraName(v.slice(5)));
        return c ? [fromCamera(c)] : [];
      }
      return (HQ_PRESETS as readonly string[]).includes(v) ? [{ name: v, preset: v }] : [];
    });
  } else if (hollow === false && cams.length > 0) {
    views = cams.map(fromCamera);
  } else {
    views = HQ_DEFAULT_PRESETS.map((p) => ({ name: p, preset: p }));
  }
  const seen = new Set<string>();
  return views.filter((v) => NAME_RE.test(v.name) && !seen.has(v.name) && seen.add(v.name)).slice(0, MAX_VIEWS);
}

export interface BlenderRunResult { code: number | null; stdout: string; stderr: string; timedOut: boolean; aborted: boolean }
/** Runs Blender; must kill the whole tree at the timeout or when `shouldStop()` turns true (polled). */
export type BlenderRun = (exe: string, args: string[], opts: { timeoutMs: number; shouldStop?: () => boolean; pollMs?: number }) => Promise<BlenderRunResult>;

const tail = (s: string, n: number): string => (s.length > n ? s.slice(s.length - n) : s);

/**
 * One Blender process of the app at a time (low-memory machines): every runBlenderProcess call waits for the previous one.
 * The timeout of a call starts when its own process starts.
 */
let blenderChain: Promise<unknown> = Promise.resolve();
let blenderWaiting = 0;
export function withBlenderLock<T>(fn: () => Promise<T>): Promise<T> {
  blenderWaiting++;
  const next = blenderChain.then(() => {
    blenderWaiting--;
    return fn();
  });
  blenderChain = next.catch(() => undefined);
  return next;
}
/** Blender jobs queued behind the running one (for the "đang chờ Blender" status). */
export const blenderQueueLength = (): number => blenderWaiting;

/** spawn without a shell; stdout/stderr tails kept; tree killed on timeout or stop. Serialised by withBlenderLock. */
export const runBlenderProcess: BlenderRun = (exe, args, opts) => withBlenderLock(() => spawnBlender(exe, args, opts));

const spawnBlender: BlenderRun = (exe, args, opts) =>
  new Promise((resolve) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let done = false;
    let timedOut = false;
    let aborted = false;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      clearInterval(poll);
      resolve({ code, stdout, stderr, timedOut, aborted });
    };
    const kill = (): void => {
      killTree(child);
      // a grandchild holding the pipes must not keep us waiting forever
      setTimeout(() => finish(null), 10_000).unref();
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
    }, opts.timeoutMs);
    const poll = setInterval(() => {
      if (!aborted && opts.shouldStop?.()) {
        aborted = true;
        kill();
      }
    }, opts.pollMs ?? 3000);
    child.stdout.on("data", (d: Buffer) => (stdout = tail(stdout + d.toString("utf8"), 40_000)));
    child.stderr.on("data", (d: Buffer) => (stderr = tail(stderr + d.toString("utf8"), 20_000)));
    child.on("error", (e) => {
      stderr += String(e);
      finish(null);
    });
    child.on("close", (code) => finish(code));
  });

/** The `W3D_RESULT {json}` line printed by the Blender scripts. */
export function parseBlenderResult(stdout: string): Record<string, unknown> | null {
  const lines = stdout.split(/\r?\n/).filter((l) => l.startsWith("W3D_RESULT "));
  const last = lines.pop();
  if (!last) return null;
  try {
    const j = JSON.parse(last.slice("W3D_RESULT ".length)) as unknown;
    return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export interface HqDeps {
  /** blender.exe, or null when not installed. */
  blender: string | null;
  run?: BlenderRun;
  scriptsDir?: string;
  /** <dataDir>/library/materials (user's stone library) and <dataDir>/library/polyhaven (fetch-assets). */
  libraryDir?: string | null;
  polyhavenDir?: string | null;
  validateGlb?: BuildDeps["validateGlb"];
  now?: () => number;
  pollMs?: number;
}
export interface HqOptions {
  /** final = full settings; loop = the lower in-loop settings, every view rendered again. */
  profile: "final" | "loop";
  plan?: RenderPlan | null;
  /** Views to render again (targeted fix after the final review); null/undefined = only missing ones. */
  redo?: string[] | null;
  /** Exposure boost (stops over cfg.exposure) per view from the reference-colour fit; those views are rendered again. Saved in renders/hq/exposure.json so later renders keep it. */
  exposureBoost?: Record<string, number> | null;
  /** False once the session left the step (pause, stop): the running Blender is killed and nothing more starts. */
  shouldContinue?: () => boolean;
}
export interface HqViewEntry { key: string; file: string; seconds: number; device?: string; mode?: string; attempts: number; std?: number; at: string }
export interface HqManifest { version: 1; views: Record<string, HqViewEntry>; order: string[]; glb?: { key: string; ok: boolean; warning?: string } }
export interface HqProgress { running: boolean; profile: string; total: number; done: number; current: string | null; index: number; startedAt: string; updatedAt: string; lastSeconds: number | null; failed: string[] }
export interface HqResult {
  /** At least one image exists. */
  ok: boolean;
  aborted?: boolean;
  /** Why nothing was attempted (no Blender, no GLB). */
  skipped?: string;
  files: string[];
  rendered: string[];
  reused: string[];
  failed: { name: string; error: string }[];
  blank: string[];
  warnings: string[];
  seconds: number;
}

const readJson = <T>(file: string): T | null => {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as T;
  } catch {
    return null;
  }
};
const writeJson = (file: string, v: unknown): void => {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(v, null, 2), "utf8");
  fs.renameSync(tmp, file);
};

export function readHqManifest(sessionDir: string): HqManifest | null {
  const m = readJson<HqManifest>(path.join(sessionDir, HQ_MANIFEST));
  return m && m.version === 1 && m.views && typeof m.views === "object" ? { ...m, order: Array.isArray(m.order) ? m.order : Object.keys(m.views) } : null;
}
/** Saved exposure boost per view (stops over cfg.exposure); {} when none. */
export function readHqExposure(sessionDir: string): Record<string, number> {
  const j = readJson<{ boost?: Record<string, unknown> }>(path.join(sessionDir, HQ_EXPOSURE));
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(j?.boost ?? {})) if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  return out;
}
export function readHqProgress(sessionDir: string): HqProgress | null {
  return readJson<HqProgress>(path.join(sessionDir, HQ_PROGRESS));
}
/** High-quality images that exist, in view order (relative to the session dir). */
export function hqRenderFiles(sessionDir: string): string[] {
  const m = readHqManifest(sessionDir);
  if (!m) return [];
  return m.order.map((n) => m.views[n]?.file).filter((f): f is string => !!f && fs.existsSync(path.join(sessionDir, f)));
}

/**
 * Views of this set to render again. Names outside the set (a guessed "floor" when the set has no floor view) are
 * dropped; when none is left the first two views go again, never the whole set.
 */
export function redoViews(views: readonly HqView[], redo: readonly string[]): string[] {
  if (redo.length === 0) return [];
  const names = new Set(views.map((v) => v.name));
  const known = [...new Set(redo.filter((n) => names.has(n)))];
  return known.length > 0 ? known : views.slice(0, 2).map((v) => v.name);
}

/** Per-view checkpoint key: settings + view definition (a change renders that view again). */
export function viewKey(cfg: W3DBlenderConfig, profile: HqOptions["profile"], v: HqView, boost = 0): string {
  const s = profile === "loop" ? cfg.loop : { width: cfg.width, height: cfg.height, samples: cfg.samples };
  return crypto.createHash("sha1").update(JSON.stringify({ s, d: cfg.device, e: cfg.exposure, profile, v: { p: v.preset ?? null, o: v.orbit ?? null }, ...(boost ? { b: boost } : {}) })).digest("hex").slice(0, 16);
}

const short = (s: string, n = 300): string => (s.length > n ? `${s.slice(0, n)}…` : s);

export async function renderHq(store: W3DStore, slug: string, cfg: W3DBlenderConfig, deps: HqDeps, opts: HqOptions): Promise<HqResult> {
  const t0 = (deps.now ?? Date.now)();
  const res: HqResult = { ok: false, files: [], rendered: [], reused: [], failed: [], blank: [], warnings: [], seconds: 0 };
  const dir = store.dir(slug);
  if (!deps.blender) return { ...res, skipped: BLENDER_MISSING_MSG };
  const glb = path.join(dir, "outputs", "model.glb");
  if (!fs.existsSync(glb)) return { ...res, skipped: "Chưa có outputs/model.glb để render chất lượng cao." };
  const run = deps.run ?? runBlenderProcess;
  const scripts = deps.scriptsDir ?? BLENDER_TOOLS_DIR;
  const hollow = looksHollow(readJson(path.join(dir, RENDER_INFO_FILE)));
  const views = selectHqViews(opts.plan ?? null, cfg.views, hollow);
  const hqDir = path.join(dir, HQ_DIR);
  fs.mkdirSync(path.join(hqDir, ".jobs"), { recursive: true });
  const manifest: HqManifest = readHqManifest(dir) ?? { version: 1, views: {}, order: [] };
  manifest.order = views.map((v) => v.name);
  const boosts = opts.profile === "loop" ? {} : { ...readHqExposure(dir), ...(opts.exposureBoost ?? {}) };
  if (opts.exposureBoost && Object.keys(opts.exposureBoost).length > 0) writeJson(path.join(dir, HQ_EXPOSURE), { boost: boosts });
  const refit = Object.keys(opts.exposureBoost ?? {}).filter((n) => views.some((v) => v.name === n));
  const redo = new Set(opts.profile === "loop" ? views.map((v) => v.name) : [...redoViews(views, opts.redo ?? []), ...refit]);
  for (const name of redo) {
    delete manifest.views[name];
    fs.rmSync(path.join(hqDir, `${name}.png`), { force: true });
  }
  const settings = opts.profile === "loop" ? cfg.loop : { width: cfg.width, height: cfg.height, samples: cfg.samples };
  const keyOf = (v: HqView): string => viewKey(cfg, opts.profile, v, boosts[v.name] ?? 0);
  const valid = (v: HqView): boolean => {
    const e = manifest.views[v.name];
    return !!e && e.key === keyOf(v) && fs.existsSync(path.join(dir, e.file));
  };
  const progress: HqProgress = {
    running: true, profile: opts.profile, total: views.length, done: views.filter(valid).length, current: null, index: 0,
    startedAt: new Date(t0).toISOString(), updatedAt: new Date(t0).toISOString(), lastSeconds: null, failed: [],
  };
  const saveProgress = (): void => {
    progress.updatedAt = new Date((deps.now ?? Date.now)()).toISOString();
    try {
      writeJson(path.join(dir, HQ_PROGRESS), progress);
    } catch {
      /* progress is best effort */
    }
  };
  writeJson(path.join(dir, HQ_MANIFEST), manifest);
  saveProgress();
  const stop = (): boolean => !!opts.shouldContinue && !opts.shouldContinue();
  try {
    for (const [i, v] of views.entries()) {
      if (valid(v)) {
        res.reused.push(v.name);
        continue;
      }
      if (stop()) return { ...res, aborted: true };
      progress.current = v.name;
      progress.index = i + 1;
      saveProgress();
      const tmp = path.join(hqDir, `.${v.name}.tmp.png`);
      let finalStd: number | undefined;
      let info: Record<string, unknown> | null = null;
      let err: string | null = null;
      let attempts = 0;
      let blank = false;
      for (let attempt = 0; attempt < 2; attempt++) {
        attempts = attempt + 1;
        fs.rmSync(tmp, { force: true });
        const job = {
          glb, materials: fs.existsSync(path.join(dir, "materials.json")) ? path.join(dir, "materials.json") : null,
          libraryDir: deps.libraryDir ?? null, polyhavenDir: deps.polyhavenDir ?? null, out: tmp,
          width: settings.width, height: settings.height, samples: settings.samples, device: cfg.device, exposure: cfg.exposure + (boosts[v.name] ?? 0), attempt,
          view: { name: v.name, ...(v.preset ? { preset: v.preset } : {}), ...(v.orbit ? { orbit: v.orbit } : {}) },
        };
        const jobFile = path.join(hqDir, ".jobs", `${v.name}.json`);
        writeJson(jobFile, job);
        const r = await run(deps.blender, ["-b", "--factory-startup", "-noaudio", "-P", path.join(scripts, "render_view.py"), "--", jobFile], {
          timeoutMs: cfg.perImageTimeoutSec * 1000, shouldStop: stop, ...(deps.pollMs ? { pollMs: deps.pollMs } : {}),
        });
        if (r.aborted) {
          fs.rmSync(tmp, { force: true });
          return { ...res, aborted: true };
        }
        info = parseBlenderResult(r.stdout);
        if (r.timedOut) {
          err = `quá ${cfg.perImageTimeoutSec} giây`;
          break;
        }
        if (!info || info["ok"] !== true || r.code !== 0 || !fs.existsSync(tmp)) {
          const why = typeof info?.["error"] === "string" ? (info["error"] as string) : short(tail(r.stderr || r.stdout, 600).trim() || `mã thoát ${r.code}`);
          err = info?.["skip"] === true ? `bỏ qua: ${why}` : why;
          break;
        }
        for (const w of Array.isArray(info["warnings"]) ? info["warnings"] : []) if (typeof w === "string" && !res.warnings.includes(w)) res.warnings.push(w);
        const st = pngStats(fs.readFileSync(tmp));
        finalStd = st ? Math.round(st.std * 10) / 10 : undefined;
        blank = st ? isBlank(st) : false;
        if (!blank) break;
      }
      if (err || blank || !info) {
        fs.rmSync(tmp, { force: true });
        if (blank) res.blank.push(v.name);
        else res.failed.push({ name: v.name, error: err ?? "không rõ" });
        progress.failed.push(v.name);
        saveProgress();
        continue;
      }
      const rel = `${HQ_DIR}/${v.name}.png`;
      fs.renameSync(tmp, path.join(dir, rel));
      const seconds = typeof info["seconds"] === "number" ? (info["seconds"] as number) : 0;
      manifest.views[v.name] = {
        key: keyOf(v), file: rel, seconds, attempts, at: new Date((deps.now ?? Date.now)()).toISOString(),
        ...(typeof info["device"] === "string" ? { device: info["device"] as string } : {}),
        ...(typeof info["mode"] === "string" ? { mode: info["mode"] as string } : {}),
        ...(finalStd !== undefined ? { std: finalStd } : {}),
      };
      writeJson(path.join(dir, HQ_MANIFEST), manifest); // checkpoint: this image is never rendered again on resume
      res.rendered.push(v.name);
      progress.done = views.filter(valid).length;
      progress.lastSeconds = seconds;
      saveProgress();
    }
  } finally {
    progress.running = false;
    progress.current = null;
    saveProgress();
  }
  res.files = views.filter(valid).map((v) => manifest.views[v.name]!.file);
  res.ok = res.files.length > 0;
  res.seconds = Math.round(((deps.now ?? Date.now)() - t0) / 100) / 10;
  if (res.failed.length) res.warnings.push(`Render chất lượng cao lỗi ở góc: ${res.failed.map((f) => `${f.name} (${short(f.error, 160)})`).join("; ")}.`);
  if (res.blank.length) res.warnings.push(`Ảnh chất lượng cao trống sau 2 lần thử, đã bỏ: ${res.blank.join(", ")}.`);
  return res;
}

const fileKey = (files: string[]): string => {
  const h = crypto.createHash("sha1");
  for (const f of files) {
    try {
      h.update(fs.readFileSync(f));
    } catch {
      h.update("missing");
    }
  }
  return h.digest("hex").slice(0, 16);
};

/** outputs/model-blender.glb from the current model.glb + materials.json; kept only when gltf-validator reports 0 errors. */
export async function exportBlenderGlb(store: W3DStore, slug: string, cfg: W3DBlenderConfig, deps: HqDeps, opts: { shouldContinue?: () => boolean } = {}): Promise<{ ok: boolean; skipped?: boolean; aborted?: boolean; warning?: string }> {
  const dir = store.dir(slug);
  const target = path.join(dir, BLENDER_GLB);
  if (!deps.blender || !cfg.exportGlb) return { ok: false, skipped: true };
  const glb = path.join(dir, "outputs", "model.glb");
  const mats = path.join(dir, "materials.json");
  if (!fs.existsSync(glb)) return { ok: false, skipped: true };
  const key = fileKey([glb, mats]);
  const manifest = readHqManifest(dir) ?? { version: 1 as const, views: {}, order: [] };
  if (manifest.glb?.key === key && (manifest.glb.ok ? fs.existsSync(target) : true)) {
    return manifest.glb.ok ? { ok: true } : { ok: false, ...(manifest.glb.warning ? { warning: manifest.glb.warning } : {}) };
  }
  const tmp = path.join(dir, "outputs", ".model-blender.tmp.glb");
  fs.rmSync(tmp, { force: true });
  fs.mkdirSync(path.join(dir, HQ_DIR, ".jobs"), { recursive: true });
  const jobFile = path.join(dir, HQ_DIR, ".jobs", "export.json");
  writeJson(jobFile, { glb, materials: fs.existsSync(mats) ? mats : null, libraryDir: deps.libraryDir ?? null, polyhavenDir: deps.polyhavenDir ?? null, out: tmp, device: cfg.device });
  const r = await (deps.run ?? runBlenderProcess)(deps.blender, ["-b", "--factory-startup", "-noaudio", "-P", path.join(deps.scriptsDir ?? BLENDER_TOOLS_DIR, "export_glb.py"), "--", jobFile], {
    timeoutMs: GLB_TIMEOUT_MS, ...(opts.shouldContinue ? { shouldStop: () => !opts.shouldContinue!() } : {}), ...(deps.pollMs ? { pollMs: deps.pollMs } : {}),
  });
  if (r.aborted) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, aborted: true };
  }
  const info = parseBlenderResult(r.stdout);
  let warning: string | null = null;
  if (r.timedOut) warning = `Xuất model-blender.glb quá ${GLB_TIMEOUT_MS / 1000} giây.`;
  else if (!info || info["ok"] !== true || !fs.existsSync(tmp)) warning = `Không xuất được model-blender.glb: ${typeof info?.["error"] === "string" ? info["error"] : short(tail(r.stderr || r.stdout, 400).trim())}`;
  else {
    try {
      const v = await (deps.validateGlb ?? defaultValidate)(new Uint8Array(fs.readFileSync(tmp)));
      if (v.errors > 0) warning = `model-blender.glb không qua gltf-validator (${v.errors} lỗi: ${v.messages.slice(0, 2).join("; ")}), giữ GLB cũ cho bàn xem.`;
    } catch (e) {
      warning = `Không kiểm được model-blender.glb: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  if (warning) fs.rmSync(tmp, { force: true });
  else {
    fs.rmSync(target, { force: true });
    fs.renameSync(tmp, target);
  }
  const m2 = readHqManifest(dir) ?? manifest;
  m2.glb = { key, ok: !warning, ...(warning ? { warning } : {}) };
  writeJson(path.join(dir, HQ_MANIFEST), m2);
  return warning ? { ok: false, warning } : { ok: true };
}

/** Remove every high-quality output (the model changed: building step). */
export function clearHq(sessionDir: string): void {
  for (const rel of [HQ_DIR, BLENDER_GLB, "best-final"]) {
    try {
      fs.rmSync(path.join(sessionDir, rel), { recursive: true, force: true });
    } catch {
      /* a locked file must not stop the build */
    }
  }
}
