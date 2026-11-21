/**
 * Poly Haven CC0 assets for the Blender high-quality render: a small fixed list (config/polyhaven-assets.json), fetched
 * ONLY by an explicit user command (`tnf w3d fetch-assets --yes`), never while the app runs.
 *
 * Folder contract (read by tools/workshop3d/blender/w3d_bscene.py polyhaven_assets()):
 *   <dataDir>/library/polyhaven/<id>/meta.json  {id, type: "texture"|"hdri", use, name, license, source, res, files: {diff|nor|rough|hdr: <file name>}, crop?, size_m?}
 *   <dataDir>/library/polyhaven/<id>/<file>     the downloaded images (md5 checked against the API)
 * A meta.json is written only after every file of the asset is in place, so a half-done download is never used.
 */
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../app/config.js";

export interface PolyHavenAssetSpec {
  id: string;
  type: "texture" | "hdri";
  use: string;
  res: string;
  name: string;
  /** our key (diff, nor, rough, hdr) -> Poly Haven map name (Diffuse, nor_gl, Rough, hdr). */
  maps: Record<string, string>;
  crop?: [number, number, number, number];
  size_m?: number;
}
export interface PolyHavenList { source: string; api: string; license: string; assets: PolyHavenAssetSpec[] }
export interface PlannedFile { key: string; url: string; md5: string; size: number; name: string; present: boolean }
export interface PlannedAsset { spec: PolyHavenAssetSpec; files: PlannedFile[]; error?: string }
export interface FetchPlan { assets: PlannedAsset[]; downloadBytes: number }

const ID_RE = /^[a-z0-9_]{1,64}$/;
/** Only Poly Haven's download host: URLs come from the API (data we do not control). */
const DL_RE = /^https:\/\/dl\.polyhaven\.org\/file\/ph-assets\/[A-Za-z0-9_./-]+$/;
const FILE_RE = /^[a-z0-9_.-]{1,120}$/i;
export const MAX_ASSET_BYTES = 80 * 1024 * 1024;

export function polyhavenDir(dataDir: string): string {
  return path.join(dataDir, "library", "polyhaven");
}

export function loadPolyHavenList(repoRoot: string = REPO_ROOT): PolyHavenList {
  const raw = JSON.parse(fs.readFileSync(path.join(repoRoot, "config", "polyhaven-assets.json"), "utf8")) as PolyHavenList;
  const assets = (raw.assets ?? []).filter((a) => ID_RE.test(a.id) && (a.type === "texture" || a.type === "hdri") && a.maps && typeof a.maps === "object");
  return { source: raw.source, api: raw.api, license: raw.license, assets };
}

const md5 = (file: string): string | null => {
  try {
    return crypto.createHash("md5").update(fs.readFileSync(file)).digest("hex");
  } catch {
    return null;
  }
};

/** Pick one file entry of the /files/<id> answer: textures jpg (else png), HDRI .hdr. */
export function pickFile(files: unknown, spec: PolyHavenAssetSpec, mapName: string): { url: string; md5: string; size: number } | null {
  const f = files as Record<string, Record<string, Record<string, { url?: unknown; md5?: unknown; size?: unknown }>>>;
  const byRes = spec.type === "hdri" ? f?.["hdri"]?.[spec.res] : f?.[mapName]?.[spec.res];
  const e = spec.type === "hdri" ? byRes?.["hdr"] : (byRes?.["jpg"] ?? byRes?.["png"]);
  if (!e || typeof e.url !== "string" || !DL_RE.test(e.url) || typeof e.md5 !== "string" || typeof e.size !== "number") return null;
  if (e.size <= 0 || e.size > MAX_ASSET_BYTES) return null;
  return { url: e.url, md5: e.md5, size: e.size };
}

/** Ask the API for the file list of every asset (small JSON requests) and mark what is already on disk. */
export async function planFetch(list: PolyHavenList, dir: string, getJson: (url: string) => Promise<unknown>): Promise<FetchPlan> {
  const assets: PlannedAsset[] = [];
  let downloadBytes = 0;
  for (const spec of list.assets) {
    try {
      const files = await getJson(`${list.api}/files/${spec.id}`);
      const out: PlannedFile[] = [];
      for (const [key, mapName] of Object.entries(spec.maps)) {
        const p = pickFile(files, spec, mapName);
        if (!p) throw new Error(`thiếu tệp ${mapName} ${spec.res}`);
        const name = decodeURIComponent(p.url.split("/").pop() ?? "");
        if (!FILE_RE.test(name)) throw new Error(`tên tệp lạ: ${name.slice(0, 60)}`);
        const present = md5(path.join(dir, spec.id, name)) === p.md5;
        if (!present) downloadBytes += p.size;
        out.push({ key, ...p, name, present });
      }
      assets.push({ spec, files: out });
    } catch (e) {
      assets.push({ spec, files: [], error: e instanceof Error ? e.message : String(e) });
    }
  }
  return { assets, downloadBytes };
}

/** Download the missing files (md5 checked), then write meta.json of each complete asset. Returns Vietnamese errors. */
export async function runFetch(plan: FetchPlan, list: PolyHavenList, dir: string, getBytes: (url: string) => Promise<Uint8Array>, log: (l: string) => void = () => undefined): Promise<string[]> {
  const errors: string[] = [];
  for (const a of plan.assets) {
    if (a.error) {
      errors.push(`${a.spec.id}: ${a.error}`);
      continue;
    }
    const adir = path.join(dir, a.spec.id);
    fs.mkdirSync(adir, { recursive: true });
    let ok = true;
    for (const f of a.files) {
      if (f.present) continue;
      try {
        log(`Đang tải ${a.spec.id}/${f.name} (${(f.size / 1024 / 1024).toFixed(1)} MB)…`);
        const bytes = await getBytes(f.url);
        const got = crypto.createHash("md5").update(bytes).digest("hex");
        if (got !== f.md5) throw new Error("md5 không khớp");
        const tmp = path.join(adir, `.${f.name}.part`);
        fs.writeFileSync(tmp, bytes);
        fs.renameSync(tmp, path.join(adir, f.name));
      } catch (e) {
        ok = false;
        errors.push(`${a.spec.id}/${f.name}: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
    if (!ok) continue;
    const meta = {
      id: a.spec.id, type: a.spec.type, use: a.spec.use, name: a.spec.name, res: a.spec.res, license: list.license,
      source: `${list.source}/a/${a.spec.id}`, files: Object.fromEntries(a.files.map((f) => [f.key, f.name])),
      ...(a.spec.crop ? { crop: a.spec.crop } : {}), ...(a.spec.size_m ? { size_m: a.spec.size_m } : {}),
      fetched: new Date().toISOString(),
    };
    fs.writeFileSync(path.join(adir, "meta.json"), JSON.stringify(meta, null, 2), "utf8");
  }
  return errors;
}

const UA = "tnf-cli (3D workshop asset fetch)";
export const httpGetJson = async (url: string): Promise<unknown> => {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(30_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return r.json();
};
export const httpGetBytes = async (url: string): Promise<Uint8Array> => {
  const r = await fetch(url, { headers: { "user-agent": UA }, signal: AbortSignal.timeout(600_000) });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  return new Uint8Array(await r.arrayBuffer());
};
