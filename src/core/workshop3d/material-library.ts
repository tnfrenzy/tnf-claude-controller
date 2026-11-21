// src/core/workshop3d/material-library.ts — "Tạo hàng loạt": batch library of low-detail products made from photos.
// Floor stone / materials use the code-only fast path (tools/workshop3d/make_material.py, no AI, quota cost 0).
// Other categories (handrail, false ceiling, button, panel frame, control cabinet) are listed but not built yet: they
// will become one standard 3D workshop session per photo (entry kind "part", `session` = that session's slug).
import fs from "node:fs";
import path from "node:path";
import { CAD_PYTHON_MISSING_MSG, defaultCadRunner, type CadRunner } from "../design3d/cad-tools.js";
import { W3D_TOOLS_DIR } from "./script-check.js";

/** Contract with the visual-quality agent: `<dataDir>/library/materials/<id>/` (albedo, normal, roughness, meta, slab, preview). */
export const MATERIAL_FILES = ["albedo.png", "normal.png", "roughness.png", "preview.png", "slab.glb"] as const;
export type MaterialFile = (typeof MATERIAL_FILES)[number];
export const MAX_BATCH_UPLOAD = 12;
export const MAX_BATCH_DIR = 24;
export const MAX_IMAGE_BYTES = 10 * 1024 * 1024;
export const MAKE_TIMEOUT_MS = 240_000;
const UPLOAD_TTL_MS = 24 * 3600_000;
const BATCH_KEEP = 20;

export type EntryKind = "material" | "part";
export interface SizeMm { w: number; d: number; h: number }
export interface BatchCategory {
  id: string;
  kind: EntryKind;
  /** Built now (true) or listed as "sắp có". */
  ready: boolean;
  defaultSize: SizeMm;
}
export const BATCH_CATEGORIES: readonly BatchCategory[] = [
  { id: "stone", kind: "material", ready: true, defaultSize: { w: 600, d: 600, h: 20 } },
  { id: "handrail", kind: "part", ready: false, defaultSize: { w: 1000, d: 60, h: 80 } },
  { id: "ceiling", kind: "part", ready: false, defaultSize: { w: 1400, d: 1300, h: 60 } },
  { id: "button", kind: "part", ready: false, defaultSize: { w: 40, d: 20, h: 40 } },
  { id: "panel-frame", kind: "part", ready: false, defaultSize: { w: 300, d: 30, h: 1200 } },
  { id: "control-cabinet", kind: "part", ready: false, defaultSize: { w: 600, d: 300, h: 1600 } },
];

/** One library entry, as the API returns it (meta.json on disk keeps the contract fields, `kind` there is "stone"). */
export interface LibraryEntry {
  id: string;
  name: string;
  category: string;
  kind: EntryKind;
  /** meta.json `kind` (the material kind of the contract, e.g. "stone"). */
  materialKind: string;
  size_mm: SizeMm;
  source: string;
  session: string | null;
  tile_cm: number;
  /** "tile" = seamless texture repeated every tile_cm; "fit" = whole floor design laid once over the slab. */
  mapping: "tile" | "fit";
  created: string;
  files: MaterialFile[];
}

export type ItemState = "queued" | "running" | "done" | "failed";
export interface BatchItem {
  index: number;
  source: string;
  name: string;
  state: ItemState;
  id?: string;
  error?: string;
  /** Numbers printed by make_material.py (seam ratios, mapping, bbox...). */
  stats?: Record<string, unknown>;
  ms?: number;
}
export interface BatchStatus {
  id: string;
  category: string;
  size_mm: SizeMm;
  tile_cm: number;
  origin: "upload" | "dir";
  created: string;
  done: boolean;
  /** Code-only path: always 0 (no Claude call). */
  costUsd: 0;
  items: BatchItem[];
}

export class MaterialError extends Error {
  constructor(message: string, readonly status: 400 | 403 | 404 | 409 | 413 | 503 = 400) {
    super(message);
  }
}

export interface MaterialLibraryOptions {
  dataDir: string;
  /** CAD python (null = not installed); called per job. */
  python: () => string | null;
  run?: CadRunner;
  toolsDir?: string;
  timeoutMs?: number;
  now?: () => number;
  log?: (msg: string) => void;
}

export interface BatchInputItem {
  /** Original file name (shown, and the default entry name = its stem). */
  fileName: string;
  /** Absolute path of the image to read (a staged upload or a file of the imported folder). */
  path: string;
  name?: string;
}
export interface BatchOptions {
  category?: string;
  size_mm?: unknown;
  tile_cm?: unknown;
  mapping?: unknown;
}

export interface MaterialLibrary {
  root: string;
  list(): LibraryEntry[];
  get(id: string): LibraryEntry | null;
  remove(id: string): void;
  update(id: string, patch: { name?: unknown; tile_cm?: unknown }): Promise<LibraryEntry>;
  filePath(id: string, file: string): { abs: string; size: number; contentType: string };
  /** Saves an uploaded image (checked: size, magic bytes) and returns its upload id. */
  stageUpload(fileName: string, data: Buffer): { upload: string; fileName: string };
  startUploadBatch(items: { upload: unknown; name?: unknown }[], opts: BatchOptions): BatchStatus;
  startDirBatch(dir: string, opts: BatchOptions): BatchStatus;
  batch(id: string): BatchStatus | null;
  batches(): BatchStatus[];
  /** Resolves when the queue is empty (tests). */
  idle(): Promise<void>;
}

const MAGIC: { ext: string; test: (b: Buffer) => boolean }[] = [
  { ext: "png", test: (b) => b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) },
  { ext: "jpg", test: (b) => b.length >= 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff },
  { ext: "webp", test: (b) => b.length >= 12 && b.toString("latin1", 0, 4) === "RIFF" && b.toString("latin1", 8, 12) === "WEBP" },
];

/** Image type from the first bytes (png / jpg / webp), or null. The file extension is never trusted. */
export function sniffImage(head: Buffer): "png" | "jpg" | "webp" | null {
  return (MAGIC.find((m) => m.test(head))?.ext as "png" | "jpg" | "webp" | undefined) ?? null;
}

const IMAGE_EXT = /\.(png|jpe?g|webp)$/i;

/** ASCII slug for an id: Vietnamese letters lose their marks (đ -> d), anything else becomes "-". */
export function slugify(s: string): string {
  const base = s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[đĐ]/g, "d").toLowerCase();
  return base.replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}

/** Library id: a-z, 0-9, "-" and "_", 1-64 chars, never "." / ".." / a path. */
export function isSafeId(id: string): boolean {
  return /^[a-z0-9][a-z0-9_-]{0,63}$/.test(id);
}

/** Display name: trimmed, control characters removed, 1-80 chars. */
export function cleanName(v: unknown): string {
  if (typeof v !== "string") throw new MaterialError("Tên phải là chuỗi.");
  // eslint-disable-next-line no-control-regex
  const s = v.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (!s) throw new MaterialError("Tên đang trống.");
  if (s.length > 80) throw new MaterialError("Tên dài quá 80 ký tự.");
  return s;
}

export function parseTileCm(v: unknown, fallback = 60): number {
  if (v === undefined || v === null || v === "") return fallback;
  const n = typeof v === "string" ? Number(v) : v;
  if (typeof n !== "number" || !Number.isFinite(n) || n < 5 || n > 500) throw new MaterialError("Kích thước ô vân (tile_cm) phải từ 5 đến 500 cm.");
  return Math.round(n * 10) / 10;
}

export function parseSize(v: unknown, fallback: SizeMm): SizeMm {
  if (v === undefined || v === null) return { ...fallback };
  if (typeof v !== "object" || Array.isArray(v)) throw new MaterialError("size_mm phải là {w, d, h} (mm).");
  const o = v as Record<string, unknown>;
  const num = (k: "w" | "d" | "h", lo: number, hi: number, label: string): number => {
    const raw = o[k] === undefined ? fallback[k] : o[k];
    const n = typeof raw === "string" ? Number(raw) : raw;
    if (typeof n !== "number" || !Number.isFinite(n) || n < lo || n > hi) throw new MaterialError(`${label} phải từ ${lo} đến ${hi} mm.`);
    return Math.round(n * 10) / 10;
  };
  return { w: num("w", 10, 5000, "Rộng"), d: num("d", 10, 5000, "Sâu"), h: num("h", 1, 500, "Cao/Dày") };
}

function category(id: unknown): BatchCategory {
  const c = BATCH_CATEGORIES.find((x) => x.id === (id ?? "stone"));
  if (!c) throw new MaterialError("Loại không hợp lệ.");
  if (!c.ready) throw new MaterialError("Loại này sắp có: hiện chỉ tạo hàng loạt được đá sàn / vật liệu.", 409);
  return c;
}

function lastJson(stdout: string): Record<string, unknown> | null {
  const line = stdout.trim().split(/\r?\n/).pop() ?? "";
  try {
    const j = JSON.parse(line) as unknown;
    return j && typeof j === "object" ? (j as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

function readHead(file: string, n = 16): Buffer {
  const fd = fs.openSync(file, "r");
  try {
    const b = Buffer.alloc(n);
    const got = fs.readSync(fd, b, 0, n, 0);
    return b.subarray(0, got);
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * A folder path typed by a person may be NFC while the disk name is NFD (or the other way round): Windows does not
 * normalise. Resolve segment by segment, comparing NFC forms. Returns the real path or null.
 */
export function resolveDirLoose(input: string): string | null {
  const abs = path.resolve(input);
  if (fs.existsSync(abs)) return abs;
  const parsed = path.parse(abs);
  let cur = parsed.root;
  const parts = abs.slice(parsed.root.length).split(/[\\/]+/).filter(Boolean);
  for (const part of parts) {
    const direct = path.join(cur, part);
    if (fs.existsSync(direct)) {
      cur = direct;
      continue;
    }
    let entries: string[];
    try {
      entries = fs.readdirSync(cur);
    } catch {
      return null;
    }
    const want = part.normalize("NFC").toLowerCase();
    const hit = entries.find((e) => e.normalize("NFC").toLowerCase() === want);
    if (!hit) return null;
    cur = path.join(cur, hit);
  }
  return cur;
}

const CONTENT: Record<MaterialFile, string> = {
  "albedo.png": "image/png",
  "normal.png": "image/png",
  "roughness.png": "image/png",
  "preview.png": "image/png",
  "slab.glb": "model/gltf-binary",
};

export function createMaterialLibrary(opts: MaterialLibraryOptions): MaterialLibrary {
  const root = path.join(opts.dataDir, "library", "materials");
  const uploads = path.join(opts.dataDir, "library", "material-uploads");
  const run = opts.run ?? defaultCadRunner;
  const script = path.join(opts.toolsDir ?? W3D_TOOLS_DIR, "make_material.py");
  const timeoutMs = opts.timeoutMs ?? MAKE_TIMEOUT_MS;
  const now = opts.now ?? (() => Date.now());
  const log = opts.log ?? (() => undefined);
  const batches = new Map<string, BatchStatus>();
  const jobs: { batch: BatchStatus; item: BatchItem; input: BatchInputItem; cleanup?: string }[] = [];
  let working: Promise<void> | null = null;
  // ids reserved by queued / running jobs (their folder may not exist yet)
  const reserved = new Set<string>();

  const dirOf = (id: string): string => {
    if (!isSafeId(id)) throw new MaterialError("Mã vật liệu không hợp lệ.", 400);
    return path.join(root, id);
  };

  function readEntry(id: string): LibraryEntry | null {
    const dir = path.join(root, id);
    if (!isSafeId(id) || fs.existsSync(path.join(dir, ".building"))) return null;
    let meta: Record<string, unknown>;
    try {
      meta = JSON.parse(fs.readFileSync(path.join(dir, "meta.json"), "utf8")) as Record<string, unknown>;
    } catch {
      return null;
    }
    const s = (meta["size_mm"] ?? {}) as Partial<SizeMm>;
    const n = (v: unknown, f: number): number => (typeof v === "number" && Number.isFinite(v) ? v : f);
    const cat = typeof meta["category"] === "string" ? meta["category"] : "stone";
    return {
      id,
      name: typeof meta["name"] === "string" ? meta["name"] : id,
      category: cat,
      kind: meta["entry"] === "part" ? "part" : "material",
      materialKind: typeof meta["kind"] === "string" ? meta["kind"] : "stone",
      size_mm: { w: n(s.w, 600), d: n(s.d, 600), h: n(s.h, 20) },
      source: typeof meta["source"] === "string" ? meta["source"] : "",
      session: typeof meta["session"] === "string" ? meta["session"] : null,
      tile_cm: n(meta["tile_cm"], 60),
      mapping: meta["mapping"] === "fit" ? "fit" : "tile",
      created: typeof meta["created"] === "string" ? meta["created"] : "",
      files: MATERIAL_FILES.filter((f) => fs.existsSync(path.join(dir, f))),
    };
  }

  function list(): LibraryEntry[] {
    let names: string[] = [];
    try {
      names = fs.readdirSync(root);
    } catch {
      return [];
    }
    return names
      .map(readEntry)
      .filter((e): e is LibraryEntry => e !== null)
      .sort((a, b) => b.created.localeCompare(a.created) || a.name.localeCompare(b.name));
  }

  function newId(name: string): string {
    const base = slugify(name) || "vat-lieu";
    for (let i = 1; ; i++) {
      const id = i === 1 ? base : `${base}-${i}`;
      if (!reserved.has(id) && !fs.existsSync(path.join(root, id))) return id;
    }
  }

  function writeMeta(id: string, patch: Record<string, unknown>): void {
    const file = path.join(dirOf(id), "meta.json");
    const meta = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify({ ...meta, ...patch }, null, 2), "utf8");
    fs.renameSync(tmp, file);
  }

  async function runPython(args: string[]): Promise<{ ok: true; json: Record<string, unknown> } | { ok: false; error: string }> {
    const python = opts.python();
    if (!python) return { ok: false, error: CAD_PYTHON_MISSING_MSG };
    let r;
    try {
      r = await run(python, [script, ...args], timeoutMs);
    } catch (e) {
      return { ok: false, error: `Không chạy được Python: ${e instanceof Error ? e.message : String(e)}` };
    }
    if (r.timedOut) return { ok: false, error: `Xử lý ảnh quá thời gian (${Math.round(timeoutMs / 1000)} giây) và đã bị dừng.` };
    const j = lastJson(r.stdout);
    if (r.code !== 0 || !j || j["ok"] !== true) {
      const why = typeof j?.["error"] === "string" ? j["error"] : (r.stderr || r.stdout).trim().slice(-400) || `mã thoát ${r.code}`;
      return { ok: false, error: /No module named|ModuleNotFoundError/.test(why) ? `Môi trường Python thiếu thư viện (pip install numpy pillow trimesh trong venv CAD): ${why}` : why };
    }
    return { ok: true, json: j };
  }

  async function processJob(job: (typeof jobs)[number]): Promise<void> {
    const { batch, item, input } = job;
    const id = item.id!;
    item.state = "running";
    const started = now();
    const dir = path.join(root, id);
    try {
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(path.join(dir, ".building"), "");
      const s = batch.size_mm;
      const r = await runPython([
        input.path, dir,
        "--tile-cm", String(batch.tile_cm),
        "--slab-mm", String(s.w), String(s.d), String(s.h),
        "--name", item.name,
        "--source", input.fileName,
        ...(mappingOf(batch) ? ["--mapping", mappingOf(batch)!] : []),
      ]);
      if (!r.ok) throw new Error(r.error);
      const missing = MATERIAL_FILES.filter((f) => !fs.existsSync(path.join(dir, f)));
      if (missing.length > 0 || !fs.existsSync(path.join(dir, "meta.json"))) throw new Error(`Thiếu tệp kết quả: ${[...missing, "meta.json"].join(", ")}`);
      writeMeta(id, { category: batch.category, entry: "material", session: null });
      fs.rmSync(path.join(dir, ".building"), { force: true });
      const { ok: _ok, ...stats } = r.json;
      item.stats = stats;
      item.state = "done";
    } catch (e) {
      item.state = "failed";
      item.error = e instanceof Error ? e.message : String(e);
      fs.rmSync(dir, { recursive: true, force: true });
      delete item.id;
    } finally {
      reserved.delete(id);
      item.ms = now() - started;
      if (job.cleanup) fs.rmSync(job.cleanup, { force: true });
      batch.done = batch.items.every((x) => x.state === "done" || x.state === "failed");
      if (batch.done) log(`Lô ${batch.id}: ${batch.items.filter((x) => x.state === "done").length}/${batch.items.length} ảnh xong.`);
    }
  }

  const batchMapping = new Map<string, string>();
  const mappingOf = (b: BatchStatus): string | undefined => batchMapping.get(b.id);

  function pump(): void {
    if (working) return;
    working = (async () => {
      while (jobs.length > 0) {
        const job = jobs.shift()!;
        await processJob(job);
      }
    })().finally(() => {
      working = null;
    });
  }

  function makeBatch(inputs: BatchInputItem[], o: BatchOptions, origin: BatchStatus["origin"], cleanup: boolean): BatchStatus {
    const cat = category(o.category);
    const size = parseSize(o.size_mm, cat.defaultSize);
    const tile = parseTileCm(o.tile_cm);
    const mapping = o.mapping === undefined || o.mapping === null || o.mapping === "" ? "auto" : o.mapping;
    if (mapping !== "auto" && mapping !== "tile" && mapping !== "fit") throw new MaterialError('mapping phải là "auto", "tile" hoặc "fit".');
    const id = `b-${now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
    const batch: BatchStatus = { id, category: cat.id, size_mm: size, tile_cm: tile, origin, created: new Date(now()).toISOString(), done: false, costUsd: 0, items: [] };
    if (mapping !== "auto") batchMapping.set(id, mapping);
    fs.mkdirSync(root, { recursive: true });
    inputs.forEach((input, index) => {
      const name = input.name ?? input.fileName.replace(/\.[^.]+$/, "");
      const itemId = newId(name);
      reserved.add(itemId);
      const item: BatchItem = { index, source: input.fileName, name, state: "queued", id: itemId };
      batch.items.push(item);
      jobs.push({ batch, item, input, ...(cleanup ? { cleanup: input.path } : {}) });
    });
    batches.set(id, batch);
    // keep the last BATCH_KEEP batches in memory
    const old = [...batches.keys()].slice(0, Math.max(0, batches.size - BATCH_KEEP));
    for (const k of old) if (batches.get(k)?.done) batches.delete(k);
    pump();
    return batch;
  }

  function sweepUploads(): void {
    let names: string[] = [];
    try {
      names = fs.readdirSync(uploads);
    } catch {
      return;
    }
    const busy = new Set(jobs.map((j) => j.input.path));
    for (const n of names) {
      const f = path.join(uploads, n);
      try {
        if (!busy.has(f) && now() - fs.statSync(f).mtimeMs > UPLOAD_TTL_MS) fs.rmSync(f, { force: true });
      } catch {
        /* ignore */
      }
    }
  }

  return {
    root,
    list,
    get: (id) => (isSafeId(id) ? readEntry(id) : null),
    remove(id) {
      const dir = dirOf(id);
      if (reserved.has(id)) throw new MaterialError("Vật liệu này đang được dựng, hãy chờ xong.", 409);
      if (!fs.existsSync(path.join(dir, "meta.json"))) throw new MaterialError("Không tìm thấy vật liệu.", 404);
      fs.rmSync(dir, { recursive: true, force: true });
    },
    async update(id, patch) {
      const cur = isSafeId(id) ? readEntry(id) : null;
      if (!cur) throw new MaterialError("Không tìm thấy vật liệu.", 404);
      if (reserved.has(id)) throw new MaterialError("Vật liệu này đang được dựng, hãy chờ xong.", 409);
      if (patch.name !== undefined) writeMeta(id, { name: cleanName(patch.name) });
      if (patch.tile_cm !== undefined) {
        const tile = parseTileCm(patch.tile_cm);
        if (tile !== cur.tile_cm) {
          reserved.add(id);
          try {
            const r = await runPython(["--slab-only", dirOf(id), "--tile-cm", String(tile)]);
            if (!r.ok) throw new MaterialError(`Không dựng lại được tấm mẫu: ${r.error}`, 400);
          } finally {
            reserved.delete(id);
          }
        }
      }
      return readEntry(id)!;
    },
    filePath(id, file) {
      if (!(MATERIAL_FILES as readonly string[]).includes(file)) throw new MaterialError("Chỉ tải được albedo/normal/roughness/preview hoặc slab.glb.", 400);
      const dir = dirOf(id);
      if (!readEntry(id)) throw new MaterialError("Không tìm thấy vật liệu.", 404);
      const abs = path.join(dir, file);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(abs);
      } catch {
        throw new MaterialError("Không tìm thấy tệp.", 404);
      }
      if (!st.isFile()) throw new MaterialError("Không tìm thấy tệp.", 404);
      return { abs, size: st.size, contentType: CONTENT[file as MaterialFile] };
    },
    stageUpload(fileName, data) {
      const name = path.basename(fileName || "").trim();
      if (!name || name.length > 120 || !IMAGE_EXT.test(name)) throw new MaterialError("Chỉ nhận ảnh .png, .jpg, .jpeg hoặc .webp.");
      if (data.length === 0) throw new MaterialError(`Ảnh ${name} rỗng.`);
      if (data.length > MAX_IMAGE_BYTES) throw new MaterialError(`Ảnh ${name} quá lớn (tối đa 10 MB).`, 413);
      const type = sniffImage(data.subarray(0, 16));
      if (!type) throw new MaterialError(`Tệp ${name} không phải ảnh PNG, JPG hoặc WEBP.`);
      sweepUploads();
      fs.mkdirSync(uploads, { recursive: true });
      const upload = `u-${now().toString(36)}-${Math.random().toString(36).slice(2, 10)}.${type}`;
      fs.writeFileSync(path.join(uploads, upload), data);
      fs.writeFileSync(path.join(uploads, `${upload}.name`), name, "utf8");
      return { upload, fileName: name };
    },
    startUploadBatch(items, o) {
      if (!Array.isArray(items) || items.length === 0) throw new MaterialError("Chưa có ảnh nào trong lô.");
      if (items.length > MAX_BATCH_UPLOAD) throw new MaterialError(`Tối đa ${MAX_BATCH_UPLOAD} ảnh mỗi lô tải lên.`);
      const inputs: BatchInputItem[] = items.map((it) => {
        const up = typeof it?.upload === "string" ? it.upload : "";
        if (!/^u-[a-z0-9]+-[a-z0-9]+\.(png|jpg|webp)$/.test(up)) throw new MaterialError("Mã ảnh tải lên không hợp lệ.");
        const p = path.join(uploads, up);
        if (!fs.existsSync(p)) throw new MaterialError("Ảnh tải lên đã hết hạn hoặc không tồn tại; hãy tải lại.", 404);
        let fileName = up;
        try {
          fileName = fs.readFileSync(`${p}.name`, "utf8");
        } catch {
          /* keep the upload id */
        }
        fs.rmSync(`${p}.name`, { force: true });
        return { fileName, path: p, ...(it.name !== undefined && it.name !== "" ? { name: cleanName(it.name) } : {}) };
      });
      return makeBatch(inputs, o, "upload", true);
    },
    startDirBatch(dirInput, o) {
      if (typeof dirInput !== "string" || !dirInput.trim()) throw new MaterialError("Hãy nhập đường dẫn thư mục.");
      if (!path.isAbsolute(dirInput.trim())) throw new MaterialError("Đường dẫn thư mục phải là đường dẫn đầy đủ (ví dụ D:\\Anh\\Da San).");
      const dir = resolveDirLoose(dirInput.trim());
      if (!dir) throw new MaterialError("Không thấy thư mục này trên máy chạy app.", 404);
      const st = fs.lstatSync(dir);
      if (!st.isDirectory()) throw new MaterialError("Đường dẫn không phải thư mục.");
      const inputs: BatchInputItem[] = [];
      const skipped: string[] = [];
      for (const e of fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
        // one level only, regular files only: no recursion, no symlinks / junctions
        if (!e.isFile() || e.isSymbolicLink() || !IMAGE_EXT.test(e.name)) continue;
        const p = path.join(dir, e.name);
        const s = fs.lstatSync(p);
        if (!s.isFile() || s.size === 0 || s.size > MAX_IMAGE_BYTES || !sniffImage(readHead(p))) {
          skipped.push(e.name);
          continue;
        }
        inputs.push({ fileName: e.name.normalize("NFC"), path: p });
      }
      if (inputs.length === 0) throw new MaterialError(`Thư mục không có ảnh PNG/JPG/WEBP hợp lệ (≤ 10 MB)${skipped.length ? `; bỏ qua: ${skipped.slice(0, 5).join(", ")}` : ""}.`);
      if (inputs.length > MAX_BATCH_DIR) throw new MaterialError(`Thư mục có ${inputs.length} ảnh, tối đa ${MAX_BATCH_DIR} ảnh mỗi lô.`);
      return makeBatch(inputs, o, "dir", false);
    },
    batch: (id) => batches.get(id) ?? null,
    batches: () => [...batches.values()].reverse(),
    async idle() {
      while (working) await working;
    },
  };
}

/** For the material-artist role (to be wired by its owner): what the library offers, `{id, name, kind}` only. */
export function listMaterialsForPrompt(lib: Pick<MaterialLibrary, "list">): { id: string; name: string; kind: string }[] {
  return lib.list().filter((e) => e.kind === "material").map((e) => ({ id: e.id, name: e.name, kind: e.materialKind }));
}
