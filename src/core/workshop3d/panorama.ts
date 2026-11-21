import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import type { W3DBlenderConfig } from "../app/config.js";
import { BLENDER_TOOLS_DIR, parseBlenderResult, runBlenderProcess, type HqDeps } from "./blender.js";
import type { W3DStore } from "./store.js";

/**
 * 360-degree panorama from the middle of the cabin (equirectangular, Blender Cycles), shown by the presentation page
 * with Pannellum. One image, checkpointed by a key of model.glb + materials.json: a finished panorama of the same model is
 * never rendered again, and a pause kills the running Blender without leaving a half image.
 */

export const PANO_DIR = "renders/pano";
export const PANO_FILE = `${PANO_DIR}/pano.jpg`;
const PANO_MANIFEST = `${PANO_DIR}/pano.json`;
export const PANO_WIDTH = 3072;
export const PANO_HEIGHT = 1536;
const PANO_MAX_SAMPLES = 48;
const PANO_MIN_TIMEOUT_SEC = 2400;

export interface PanoResult {
  ok: boolean;
  skipped?: string;
  aborted?: boolean;
  reused?: boolean;
  seconds?: number;
  error?: string;
}

function fileKey(files: string[]): string {
  const h = crypto.createHash("sha1");
  for (const f of files) {
    try {
      h.update(fs.readFileSync(f));
    } catch {
      h.update("missing");
    }
  }
  h.update(`${PANO_WIDTH}x${PANO_HEIGHT}`);
  return h.digest("hex").slice(0, 16);
}

export function panoReady(sessionDir: string): boolean {
  return fs.existsSync(path.join(sessionDir, PANO_FILE));
}

export async function renderPanorama(store: W3DStore, slug: string, cfg: W3DBlenderConfig, deps: HqDeps, opts: { shouldContinue?: () => boolean } = {}): Promise<PanoResult> {
  const dir = store.dir(slug);
  if (!deps.blender) return { ok: false, skipped: "Chưa có Blender: bỏ qua ảnh 360°." };
  const glb = path.join(dir, "outputs", "model.glb");
  if (!fs.existsSync(glb)) return { ok: false, skipped: "Chưa có outputs/model.glb." };
  const mats = path.join(dir, "materials.json");
  const key = fileKey([glb, mats]);
  const manifestFile = path.join(dir, PANO_MANIFEST);
  try {
    const m = JSON.parse(fs.readFileSync(manifestFile, "utf8")) as { key?: string };
    if (m.key === key && panoReady(dir)) return { ok: true, reused: true };
  } catch {
    // no valid checkpoint: render
  }
  const panoDir = path.join(dir, PANO_DIR);
  fs.mkdirSync(path.join(panoDir, ".jobs"), { recursive: true });
  const tmp = path.join(panoDir, ".pano.tmp.jpg");
  fs.rmSync(tmp, { force: true });
  const job = {
    glb, materials: fs.existsSync(mats) ? mats : null, libraryDir: deps.libraryDir ?? null, polyhavenDir: deps.polyhavenDir ?? null, out: tmp,
    width: PANO_WIDTH, height: PANO_HEIGHT, samples: Math.min(cfg.samples, PANO_MAX_SAMPLES), device: cfg.device, exposure: cfg.exposure, attempt: 0,
    format: "jpg", view: { name: "pano", preset: "pano" },
  };
  const jobFile = path.join(panoDir, ".jobs", "pano.json");
  fs.writeFileSync(jobFile, JSON.stringify(job, null, 2));
  const stop = (): boolean => !!opts.shouldContinue && !opts.shouldContinue();
  const run = deps.run ?? runBlenderProcess;
  const t0 = (deps.now ?? Date.now)();
  const r = await run(deps.blender, ["-b", "--factory-startup", "-noaudio", "-P", path.join(deps.scriptsDir ?? BLENDER_TOOLS_DIR, "render_view.py"), "--", jobFile], {
    timeoutMs: Math.max(cfg.perImageTimeoutSec, PANO_MIN_TIMEOUT_SEC) * 1000, shouldStop: stop, ...(deps.pollMs ? { pollMs: deps.pollMs } : {}),
  });
  if (r.aborted) {
    fs.rmSync(tmp, { force: true });
    return { ok: false, aborted: true };
  }
  const info = parseBlenderResult(r.stdout);
  if (r.timedOut || !info || info["ok"] !== true || r.code !== 0 || !fs.existsSync(tmp)) {
    fs.rmSync(tmp, { force: true });
    const why = r.timedOut ? "quá thời gian" : typeof info?.["error"] === "string" ? (info["error"] as string) : `mã thoát ${r.code}`;
    return { ok: false, error: `Không render được ảnh 360°: ${why}` };
  }
  fs.renameSync(tmp, path.join(dir, PANO_FILE));
  const seconds = Math.round(((deps.now ?? Date.now)() - t0) / 100) / 10;
  fs.writeFileSync(manifestFile, JSON.stringify({ key, seconds, at: new Date((deps.now ?? Date.now)()).toISOString() }, null, 2));
  return { ok: true, seconds };
}
