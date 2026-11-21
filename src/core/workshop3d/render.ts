/**
 * Render PNG views of outputs/model.glb with ONE headless Edge/Chrome run + three.js (tools/workshop3d/render/).
 *
 * Flow: a local static server on 127.0.0.1 (random port) serves the page, three, the model and /views.json (the views to
 * draw). The page loads the model once, frames each camera with camera.js (bbox rules: target = centre of the box or of a
 * part, exterior cameras outside the outer box, interior cameras clamped into the free interior box, cutaway near plane),
 * draws it, re-frames and redraws a blank result (at most 2 retries) and POSTs every final frame to /shot?cam=<name>,
 * then a manifest to /finished. The controller checks every PNG again (png.ts: flat / one-colour image = blank), drops
 * blank frames (they never reach renders.json or the reviewer) and records everything in render-info.json.
 * For a hollow model the page adds the interior groups the plan misses (overview, ceiling, floor, back/left/right wall,
 * COP close-up) as `auto_*` views.
 *
 * Camera contract: `distance` is metres from the target (model centre unless `target` names a part). Default cameras
 * (empty plan.cameras) are framed to fit the whole model (fit=1).
 *
 * Asset layout (same in dev and packaged build; see scripts/package.ts): <app root>/tools/workshop3d/render/index.html
 * and <app root>/node_modules/three. <app root> is three levels above this file (src/core/workshop3d or dist/core/workshop3d).
 * Every run cleans up its server, browser and temp profile on success, error and timeout.
 */
import { spawn } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { locateBrowser } from "../app/browser-locator.js";
import { isBlank, pngStats, type PixelStats } from "./png.js";
import type { W3DCamera, RenderPlan } from "./role-output.js";
import type { W3DStore } from "./store.js";

/** One view the page draws (sent as /views.json). */
export interface RenderViewSpec { name: string; az: number; el: number; dist: number; fit: boolean; target?: string }
export interface RenderSpec { environment: RenderPlan["environment"]; exposure: number; auto: boolean; views: RenderViewSpec[] }
/** Manifest entry posted by the page for every frame it drew. */
export interface RenderManifestEntry {
  name: string;
  group?: string;
  label?: string;
  mode?: string;
  auto?: boolean;
  attempts?: number;
  blank?: boolean;
}
export interface RenderServer {
  port: number;
  /** PNG bodies posted by the page, by camera name. */
  shots: Map<string, Buffer>;
  /** Resolves with the page's manifest (or null on a bad body) once the page posts /finished. */
  finished: Promise<RenderManifestEntry[] | null>;
  close(): Promise<void>;
}
export interface RenderDeps {
  /** Browser executable; `null` = not found; undefined = auto-locate. */
  browser?: string | null;
  /** Runs the browser; must stop it (whole tree) when `signal` aborts (the page is finished) or at the timeout. */
  run?: (exe: string, args: string[], timeoutMs: number, signal?: AbortSignal) => Promise<{ code: number | null }>;
  serve?: (modelPath: string, spec: RenderSpec) => Promise<RenderServer>;
  /** Folder holding the `three` package (default: repo node_modules/three). */
  threeRoot?: string;
  timeoutMs?: number;
  /** Add the missing interior groups of a hollow model (default true). */
  autoInterior?: boolean;
}
export interface RenderViewInfo { name: string; file: string | null; group?: string; label?: string; mode?: string; auto: boolean; attempts: number; blank: boolean; std?: number; dominant?: number }
export interface RenderResult {
  ok: boolean;
  files: string[];
  error?: string;
  /** Views whose final frame was still blank (dropped from files). */
  blank?: string[];
  views?: RenderViewInfo[];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP_ROOT = path.resolve(HERE, "../../..");
const SHOT_MAX_BYTES = 30 * 1024 * 1024;
const NAME_RE = /^[a-z0-9_-]{1,44}$/;
export const RENDER_INFO_FILE = "render-info.json";

/** Page and three package, both relative to the app root (repo root in dev, build/app when packaged). */
export function resolveRenderAssets(appRoot: string = APP_ROOT): { page: string; threeRoot: string } {
  return {
    page: path.resolve(appRoot, "tools", "workshop3d", "render", "index.html"),
    threeRoot: path.resolve(appRoot, "node_modules", "three"),
  };
}

/** Time the browser gets for the whole run: 40 s + 3 s per MB of model + 20 s per view, capped at 15 min. */
export function renderTimeoutMs(glbBytes: number, views: number): number {
  return Math.min(900_000, 40_000 + Math.round((3000 * Math.max(0, glbBytes)) / (1024 * 1024)) + 20_000 * Math.max(1, views));
}

export const DEFAULT_CAMERAS: W3DCamera[] = [
  { name: "front", azimuth: 0, elevation: 10, distance: 1 },
  { name: "right", azimuth: 90, elevation: 10, distance: 1 },
  { name: "back", azimuth: 180, elevation: 10, distance: 1 },
  { name: "iso", azimuth: 35, elevation: 25, distance: 1 },
];

export function sanitizeCameraName(name: string): string {
  const s = name.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "").slice(0, 40);
  return s || "cam";
}

/** Views for the page: sanitized unique names (never starting with the reserved `auto_`), clamped distances. */
export function buildRenderSpec(plan: RenderPlan, autoInterior = true): RenderSpec {
  const useDefaults = plan.cameras.length === 0;
  const cams = useDefaults ? DEFAULT_CAMERAS : plan.cameras;
  const used = new Set<string>();
  const views = cams.map((c) => {
    let base = sanitizeCameraName(c.name);
    if (base.startsWith("auto_")) base = `cam_${base}`.slice(0, 40);
    let name = base;
    for (let i = 2; used.has(name); i++) name = `${base}_${i}`.slice(0, 44);
    used.add(name);
    const v: RenderViewSpec = { name, az: c.azimuth, el: c.elevation, dist: useDefaults ? c.distance : Math.min(100, Math.max(0.1, c.distance)), fit: useDefaults };
    if (c.target) v.target = c.target;
    return v;
  });
  return { environment: plan.environment, exposure: plan.exposure, auto: autoInterior, views };
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript",
  ".mjs": "text/javascript",
  ".glb": "model/gltf-binary",
};

function readBody(req: http.IncomingMessage, max: number): Promise<Buffer | null> {
  return new Promise((resolve) => {
    const parts: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > max) {
        req.destroy();
        resolve(null);
      } else parts.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(parts)));
    req.on("error", () => resolve(null));
  });
}

/**
 * Serves GET "/", "/camera.js", "/model.glb", "/views.json", "/three/*"; accepts POST "/shot?cam=" (PNG) and
 * "/finished" (manifest JSON). Bound to 127.0.0.1.
 */
export function startRenderServer(
  modelPath: string,
  spec: RenderSpec | Record<string, unknown>,
  threeRoot?: string,
  /** Another page of tools/workshop3d/render (view-compare.html) and extra models served at /m/<key>.glb. */
  extra?: { page?: string; models?: Record<string, string> },
): Promise<RenderServer> {
  const assets = resolveRenderAssets();
  const page = extra?.page ?? assets.page;
  const root = path.resolve(threeRoot ?? assets.threeRoot);
  const shots = new Map<string, Buffer>();
  let finish: (m: RenderManifestEntry[] | null) => void = () => undefined;
  const finished = new Promise<RenderManifestEntry[] | null>((r) => { finish = r; });
  const specJson = JSON.stringify(spec);
  const server = http.createServer((req, res) => {
    let file: string | null = null;
    let url: URL;
    try {
      url = new URL(req.url ?? "/", "http://x");
    } catch {
      res.statusCode = 400;
      res.end();
      return;
    }
    const u = decodeURIComponent(url.pathname);
    if (req.method === "POST") {
      const cam = url.searchParams.get("cam") ?? "";
      if (u === "/shot" && NAME_RE.test(cam)) {
        void readBody(req, SHOT_MAX_BYTES).then((b) => {
          if (b && b.length > 0) shots.set(cam, b);
          res.statusCode = b ? 204 : 413;
          res.end();
        });
        return;
      }
      if (u === "/finished") {
        void readBody(req, 512 * 1024).then((b) => {
          let m: RenderManifestEntry[] | null = null;
          try {
            const j = JSON.parse(b?.toString("utf8") ?? "null") as unknown;
            if (Array.isArray(j)) m = j.filter((e): e is RenderManifestEntry => !!e && typeof e === "object" && typeof (e as { name?: unknown }).name === "string");
          } catch {
            m = null;
          }
          res.statusCode = 204;
          res.end();
          finish(m);
        });
        return;
      }
      res.statusCode = 404;
      res.end();
      return;
    }
    if (u === "/views.json") {
      res.setHeader("content-type", "application/json");
      res.end(specJson);
      return;
    }
    if (u === "/") file = page;
    else if (u === "/camera.js") file = path.join(path.dirname(assets.page), "camera.js");
    else if (u === "/model.glb") file = modelPath;
    else if (u.startsWith("/m/") && u.endsWith(".glb") && extra?.models && Object.prototype.hasOwnProperty.call(extra.models, u.slice(3, -4))) file = extra.models[u.slice(3, -4)] ?? null;
    else if (u.startsWith("/three/")) {
      const f = path.resolve(root, u.slice("/three/".length));
      if (f.startsWith(root + path.sep)) file = f;
    }
    if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) {
      res.statusCode = 404;
      res.end();
      return;
    }
    res.setHeader("content-type", MIME[path.extname(file).toLowerCase()] ?? "application/octet-stream");
    fs.createReadStream(file).on("error", () => res.destroy()).pipe(res);
  });
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      resolve({
        port: (server.address() as AddressInfo).port,
        shots,
        finished,
        close: () => new Promise<void>((r) => {
          finish(null);
          server.close(() => r());
          server.closeAllConnections();
        }),
      });
    });
  });
}

function killTree(pid: number | undefined, kill: () => void): void {
  if (!pid) return;
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true }).on("error", () => undefined);
  } else kill();
}

/** Spawns without a shell; kills the whole process tree on timeout or when `signal` aborts (then resolves code 0). */
export function runProcess(exe: string, args: string[], timeoutMs: number, signal?: AbortSignal): Promise<{ code: number | null }> {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { stdio: "ignore", windowsHide: true });
    let done = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (code: number | null): void => {
      if (done) return;
      done = true;
      if (timer) clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      resolve({ code });
    };
    const onAbort = (): void => {
      killTree(child.pid, () => child.kill("SIGKILL"));
      finish(0);
    };
    if (signal?.aborted) return onAbort();
    signal?.addEventListener("abort", onAbort);
    timer = setTimeout(() => {
      killTree(child.pid, () => child.kill("SIGKILL"));
      finish(null);
    }, timeoutMs);
    child.on("error", () => finish(null));
    child.on("exit", (code) => finish(code));
  });
}

/** Remove the PNGs of earlier rounds: renders/ holds only the current round. */
function clearRenders(dir: string): void {
  try {
    for (const f of fs.readdirSync(dir)) {
      if (/\.png$/i.test(f)) fs.rmSync(path.join(dir, f), { force: true });
    }
  } catch {
    /* a locked old file must not stop the new round */
  }
}

export async function renderViews(store: W3DStore, slug: string, plan: RenderPlan, deps: RenderDeps = {}): Promise<RenderResult> {
  const browser = deps.browser === undefined ? (locateBrowser()?.path ?? null) : deps.browser;
  if (!browser) return { ok: false, files: [], error: "Không tìm thấy Edge hoặc Chrome để dựng ảnh." };
  const root = store.dir(slug);
  const model = path.join(root, "outputs", "model.glb");
  if (!fs.existsSync(model)) return { ok: false, files: [], error: "Chưa có outputs/model.glb để dựng ảnh." };

  const run = deps.run ?? runProcess;
  const spec = buildRenderSpec(plan, deps.autoInterior ?? true);
  let glbBytes = 0;
  try {
    glbBytes = fs.statSync(model).size;
  } catch {
    /* keep 0 */
  }
  const timeoutMs = deps.timeoutMs ?? renderTimeoutMs(glbBytes, spec.views.length + (spec.auto ? 7 : 0));
  const rendersDir = path.join(root, "renders");
  fs.mkdirSync(rendersDir, { recursive: true });
  clearRenders(rendersDir);

  let server: RenderServer | null = null;
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-render-profile-"));
  const files: string[] = [];
  const blank: string[] = [];
  const failed: string[] = [];
  const views: RenderViewInfo[] = [];
  try {
    server = await (deps.serve ?? ((m: string, s: RenderSpec) => startRenderServer(m, s, deps.threeRoot)))(model, spec);
    const ac = new AbortController();
    let manifest: RenderManifestEntry[] | null = null;
    void server.finished.then((m) => {
      manifest = m;
      ac.abort();
    });
    const args = [
      "--headless=new", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--hide-scrollbars",
      "--no-first-run", "--no-default-browser-check", "--disable-extensions", "--mute-audio",
      "--window-size=1280,960", `--user-data-dir=${profile}`, `http://127.0.0.1:${server.port}/`,
    ];
    try {
      await run(browser, args, timeoutMs, ac.signal);
    } catch {
      /* missing frames are reported below */
    }
    const shots = server.shots;
    const byName = new Map<string, RenderManifestEntry>();
    for (const e of (manifest as RenderManifestEntry[] | null) ?? []) if (NAME_RE.test(e.name)) byName.set(e.name, e);
    const order = [...spec.views.map((v) => v.name), ...[...byName.keys()].filter((n) => n.startsWith("auto_"))];
    for (const name of [...new Set(order)]) {
      const e = byName.get(name);
      const shot = shots.get(name);
      const auto = name.startsWith("auto_");
      const info: RenderViewInfo = { name, file: null, auto, attempts: e?.attempts ?? 1, blank: false };
      if (e?.group) info.group = String(e.group).slice(0, 40);
      if (e?.label) info.label = String(e.label).slice(0, 120);
      if (e?.mode) info.mode = String(e.mode).slice(0, 20);
      if (!shot) {
        if (!auto) failed.push(name);
        views.push(info);
        continue;
      }
      const st: PixelStats | null = pngStats(shot);
      if (st) {
        info.std = Math.round(st.std * 10) / 10;
        info.dominant = Math.round(st.dominant * 1000) / 1000;
      }
      if ((st ? isBlank(st) : false) || e?.blank === true) {
        info.blank = true;
        blank.push(name);
        views.push(info);
        continue;
      }
      const rel = `renders/${name}.png`;
      fs.writeFileSync(path.join(root, rel), shot);
      info.file = rel;
      files.push(rel);
      views.push(info);
    }
  } catch (e) {
    return { ok: false, files, error: `Không dựng được ảnh: ${(e as Error).message.slice(0, 200)}` };
  } finally {
    if (server) await server.close().catch(() => undefined);
    try {
      fs.rmSync(profile, { recursive: true, force: true });
    } catch {
      /* a locked profile folder must not turn a result into an exception */
    }
  }
  try {
    fs.writeFileSync(path.join(root, RENDER_INFO_FILE), JSON.stringify({ views, blank, failed }, null, 2), "utf8");
  } catch {
    /* info is best effort */
  }
  const result: RenderResult = { ok: true, files, views, ...(blank.length ? { blank } : {}) };
  if (failed.length > 0) return { ...result, ok: false, error: `Dựng ảnh lỗi ở góc: ${failed.join(", ")}.` };
  if (files.length === 0) return { ...result, ok: false, error: `Mọi góc đều ra ảnh trống (${blank.join(", ")}): kiểm tra mô hình và camera.` };
  return result;
}
