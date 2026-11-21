import fs from "node:fs/promises";
import path from "node:path";
import crypto from "node:crypto";
import { ATTACH_LIMITS, attachmentRel } from "./attachments.js";
import { validateInputsSchema, validateAnswers, type InputsSchema } from "./inputs.js";
import {
  SkillError, LIMITS, DEFAULT_STATE, validateSlug, validateRelPath, validatePackageInput, validateMetaInput,
  resolveInside, isZippable, type SkillMeta
} from "./package.js";

export interface SkillFiles {
  [rel: string]: string;
}
export interface SkillRecord {
  meta: SkillMeta;
  files: SkillFiles;
}
export type SkillListItem = SkillMeta | { slug: string; broken: true; error: string };

export interface SkillStoreOptions {
  renameImpl?: (from: string, to: string) => Promise<void>;
  retryDelayMs?: number;
}

const META_KEYS = ["slug", "title", "goal", "state", "bestScore", "bestRound", "createdAt", "updatedAt", "costUsdEstimate", "version", "config", "approvedAt", "paused", "lastError"] as const;
const PATCH_FORBIDDEN = new Set(["slug", "version", "createdAt", "updatedAt"]);
const LAST_ERROR_MAX = 500;
const ANSWERS_FILE = "answers.json";
const ANSWERS_DIR = "answers-files";
const TRIALS_DIR = "trials";
const TRIAL_NAME = /^sample-[1-9][0-9]*\.md$/;

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function corrupt(file: string, detail?: string): SkillError {
  return new SkillError(`Gói skill bị hỏng: không đọc được ${file}${detail ? ` (${detail})` : ""}.`, 400, "skill_corrupt");
}

/** Keep only known keys; unknown keys are dropped (spec 2.3). */
function sanitizeMeta(raw: unknown, slug: string): SkillMeta {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw corrupt("meta.json");
  const src = raw as Record<string, unknown>;
  const m: Record<string, unknown> = {};
  for (const k of META_KEYS) if (src[k] !== undefined) m[k] = src[k];
  const okStr = (v: unknown): v is string => typeof v === "string";
  if (m["slug"] !== slug || !okStr(m["title"]) || !okStr(m["goal"]) || !okStr(m["createdAt"]) || !okStr(m["updatedAt"])) throw corrupt("meta.json");
  if (!Number.isInteger(m["version"]) || (m["version"] as number) < 1) throw corrupt("meta.json", "version");
  if (m["state"] === undefined) m["state"] = DEFAULT_STATE;
  if (!okStr(m["state"])) throw corrupt("meta.json", "state");
  m["bestScore"] = typeof m["bestScore"] === "number" ? Math.min(100, Math.max(0, m["bestScore"])) : 0;
  m["bestRound"] = Number.isInteger(m["bestRound"]) ? m["bestRound"] : 0;
  m["costUsdEstimate"] = typeof m["costUsdEstimate"] === "number" && m["costUsdEstimate"] >= 0 ? m["costUsdEstimate"] : 0;
  if (m["config"] !== undefined && (typeof m["config"] !== "object" || m["config"] === null || Array.isArray(m["config"]))) delete m["config"];
  if (m["approvedAt"] !== undefined && !okStr(m["approvedAt"])) delete m["approvedAt"];
  if (m["paused"] !== undefined && typeof m["paused"] !== "boolean") delete m["paused"];
  if (m["lastError"] !== undefined) {
    if (!okStr(m["lastError"])) delete m["lastError"];
    else m["lastError"] = m["lastError"].slice(0, LAST_ERROR_MAX);
  }
  return m as unknown as SkillMeta;
}

export interface AttachmentInfo {
  pair: string;
  side: "input" | "expected";
  name: string;
  size: number;
}

export function createSkillStore(dataDir: string, opts: SkillStoreOptions = {}) {
  const root = path.resolve(dataDir, "skills");
  const rename = opts.renameImpl ?? ((a: string, b: string) => fs.rename(a, b));
  const retryDelay = opts.retryDelayMs ?? 30;

  async function ensureRoot() {
    await fs.mkdir(root, { recursive: true });
  }

  function packDir(slug: string): string {
    validateSlug(slug);
    return resolveInside(root, slug);
  }

  async function lstatOrNull(p: string) {
    try {
      return await fs.lstat(p);
    } catch {
      return null;
    }
  }

  /** Throws 404 when missing, 400 when the pack dir is a symlink or resolves outside root. */
  async function requirePack(slug: string): Promise<string> {
    const dir = packDir(slug);
    const st = await lstatOrNull(dir);
    if (!st) throw new SkillError("Không tìm thấy skill.", 404, "skill_not_found");
    if (st.isSymbolicLink() || !st.isDirectory()) throw new SkillError("Gói skill không hợp lệ (symlink hoặc không phải thư mục).", 400, "skill_symlink");
    const realRoot = await fs.realpath(root);
    const realDir = await fs.realpath(dir);
    if (!realDir.startsWith(realRoot + path.sep)) throw new SkillError("Gói skill nằm ngoài thư mục cho phép.", 400, "skill_bad_path");
    return dir;
  }

  async function writeAtomic(file: string, content: string) {
    await fs.mkdir(path.dirname(file), { recursive: true });
    const st = await lstatOrNull(file);
    if (st?.isSymbolicLink()) throw new SkillError("Từ chối ghi vào symlink trong gói skill.", 400, "skill_symlink");
    const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
    try {
      await fs.writeFile(tmp, content, "utf8");
      let lastErr: unknown;
      for (let i = 0; i < 3; i++) {
        try {
          await rename(tmp, file);
          return;
        } catch (e: any) {
          lastErr = e;
          if (e?.code !== "EPERM" && e?.code !== "EBUSY") break;
          await sleep(retryDelay);
        }
      }
      throw lastErr;
    } catch (e) {
      await fs.rm(tmp, { force: true }).catch(() => undefined);
      throw e;
    }
  }

  /** Walk examples/<pair>/<side>/ dirs; symlinks and non-matching names are skipped. */
  async function listAttachmentsIn(dir: string): Promise<AttachmentInfo[]> {
    const out: AttachmentInfo[] = [];
    const exDir = path.join(dir, "examples");
    let pairs: import("node:fs").Dirent[];
    try {
      pairs = await fs.readdir(exDir, { withFileTypes: true });
    } catch {
      return out;
    }
    for (const p of pairs) {
      if (p.isSymbolicLink() || !p.isDirectory() || !/^(train|holdout)-[1-9][0-9]*$/.test(p.name)) continue;
      for (const side of ["input", "expected"] as const) {
        let ents: import("node:fs").Dirent[];
        try {
          ents = await fs.readdir(path.join(exDir, p.name, side), { withFileTypes: true });
        } catch {
          continue;
        }
        for (const e of ents) {
          if (e.isSymbolicLink() || !e.isFile() || e.name.endsWith(".tmp")) continue;
          try {
            attachmentRel(p.name, side, e.name);
          } catch {
            continue;
          }
          const st = await fs.stat(path.join(exDir, p.name, side, e.name));
          out.push({ pair: p.name, side, name: e.name, size: st.size });
        }
      }
    }
    return out.sort((a, b) => (a.pair + a.side + a.name).localeCompare(b.pair + b.side + b.name));
  }

  /** Read current content files (excluding meta.json and versions/). Rejects symlinks. */
  async function readFilesIn(dir: string, skipMeta = true): Promise<SkillFiles> {
    const out: SkillFiles = {};
    async function walk(sub: string) {
      const abs = sub ? path.join(dir, sub) : dir;
      for (const ent of await fs.readdir(abs, { withFileTypes: true })) {
        const rel = sub ? `${sub}/${ent.name}` : ent.name;
        if (ent.isSymbolicLink()) throw new SkillError(`Từ chối đọc symlink trong gói skill: ${rel}.`, 400, "skill_symlink");
        if (!sub && (ent.name === ANSWERS_FILE || ent.name === ANSWERS_DIR || ent.name === TRIALS_DIR)) continue; // user answers are not part of the package
        if (ent.isDirectory()) {
          if (!sub && ent.name === "versions") continue;
          await walk(rel);
        } else if (ent.isFile()) {
          if (ent.name.endsWith(".tmp")) continue;
          if (skipMeta && rel === "meta.json") continue;
          try {
            validateRelPath(rel);
          } catch {
            continue;
          }
          out[rel] = await fs.readFile(path.join(dir, rel), "utf8");
        }
      }
    }
    await walk("");
    return out;
  }

  async function readMeta(dir: string, slug: string): Promise<SkillMeta> {
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, "meta.json"), "utf8");
    } catch {
      throw corrupt("meta.json");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw corrupt("meta.json", "JSON hỏng");
    }
    return sanitizeMeta(raw, slug);
  }

  async function checkInputs(dir: string) {
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, "inputs.json"), "utf8");
    } catch (e: any) {
      if (e?.code === "ENOENT") return;
      throw corrupt("inputs.json");
    }
    try {
      JSON.parse(text);
    } catch {
      throw corrupt("inputs.json", "JSON hỏng");
    }
  }

  async function readSchema(dir: string): Promise<InputsSchema> {
    let text: string;
    try {
      text = await fs.readFile(path.join(dir, "inputs.json"), "utf8");
    } catch (e: any) {
      if (e?.code === "ENOENT") throw new SkillError("Skill này chưa có inputs.json nên chưa có biểu mẫu.", 400, "inputs_missing");
      throw corrupt("inputs.json");
    }
    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      throw corrupt("inputs.json", "JSON hỏng");
    }
    const r = validateInputsSchema(raw);
    if (!r.ok) throw new SkillError("inputs.json không phải lược đồ biểu mẫu mới (version 2): " + r.errors.join(" "), 409, "inputs_legacy");
    return r.schema;
  }

  function writeMeta(dir: string, meta: SkillMeta) {
    return writeAtomic(path.join(dir, "meta.json"), JSON.stringify(sanitizeMeta(meta, meta.slug), null, 2));
  }

  /** Make the pack's content exactly `files` (meta.json and versions/ untouched). */
  async function replaceContent(dir: string, files: SkillFiles) {
    const existing = await readFilesIn(dir);
    for (const [rel, content] of Object.entries(files)) await writeAtomic(resolveInside(dir, rel), content);
    for (const rel of Object.keys(existing)) {
      if (!(rel in files)) await fs.rm(resolveInside(dir, rel), { force: true });
    }
  }

  async function snapshot(dir: string, version: number) {
    const vdir = resolveInside(dir, `versions/${version}`);
    await fs.rm(vdir, { recursive: true, force: true });
    const files = await readFilesIn(dir, false);
    await fs.mkdir(vdir, { recursive: true });
    for (const [rel, content] of Object.entries(files)) await writeAtomic(resolveInside(vdir, rel), content);
    await prune(dir);
  }

  async function versionNumbers(dir: string): Promise<number[]> {
    try {
      const ents = await fs.readdir(path.join(dir, "versions"), { withFileTypes: true });
      return ents.filter((e) => e.isDirectory() && /^[0-9]+$/.test(e.name)).map((e) => Number(e.name)).sort((a, b) => a - b);
    } catch {
      return [];
    }
  }

  async function prune(dir: string) {
    const nums = await versionNumbers(dir);
    while (nums.length > LIMITS.maxVersions) {
      const n = nums.shift()!;
      await fs.rm(path.join(dir, "versions", String(n)), { recursive: true, force: true });
    }
  }

  function cleanFiles(files: SkillFiles): SkillFiles {
    if (!files || typeof files !== "object" || Array.isArray(files)) throw new SkillError("`files` phải là một đối tượng đường dẫn -> nội dung.", 400, "skill_bad_schema");
    const copy: SkillFiles = { ...files };
    delete copy["meta.json"]; // store-owned
    validatePackageInput(copy);
    return copy;
  }

  return {
    root,

    async list(): Promise<SkillListItem[]> {
      await ensureRoot();
      const out: SkillListItem[] = [];
      for (const ent of await fs.readdir(root, { withFileTypes: true })) {
        if (!ent.isDirectory() || !/^[a-z0-9-]{1,40}$/.test(ent.name)) continue;
        try {
          const dir = await requirePack(ent.name);
          const meta = await readMeta(dir, ent.name);
          await checkInputs(dir);
          out.push(meta);
        } catch (e) {
          out.push({ slug: ent.name, broken: true, error: e instanceof SkillError ? e.message : "Không đọc được gói skill." });
        }
      }
      return out.sort((a, b) => a.slug.localeCompare(b.slug));
    },

    async create(input: { slug: string; title: string; goal: string; files: SkillFiles }): Promise<SkillRecord> {
      const slug = validateSlug(input.slug);
      validateMetaInput(input);
      const files = cleanFiles(input.files ?? {});
      if (files["SKILL.md"] === undefined) throw new SkillError("Gói skill phải có SKILL.md.", 400, "skill_bad_schema");
      await ensureRoot();
      const dir = packDir(slug);
      if (await lstatOrNull(dir)) throw new SkillError("Skill này đã tồn tại.", 409, "skill_exists");
      const now = new Date().toISOString();
      const meta: SkillMeta = {
        slug, title: input.title, goal: input.goal, state: DEFAULT_STATE, bestScore: 0, bestRound: 0,
        createdAt: now, updatedAt: now, costUsdEstimate: 0, version: 1
      };
      try {
        await fs.mkdir(dir);
        await replaceContent(dir, files);
        await writeMeta(dir, meta);
      } catch (e) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw e;
      }
      return { meta, files };
    },

    async get(slug: string): Promise<SkillRecord> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const meta = await readMeta(dir, slug);
      await checkInputs(dir);
      return { meta, files: await readFilesIn(dir) };
    },

    async update(slug: string, input: { title?: string; goal?: string; files?: SkillFiles }): Promise<SkillRecord> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const meta = await readMeta(dir, slug);
      validateMetaInput(input, false);
      const files = input.files !== undefined ? cleanFiles(input.files) : undefined;
      if (files && files["SKILL.md"] === undefined) throw new SkillError("Gói skill phải có SKILL.md.", 400, "skill_bad_schema");
      await snapshot(dir, meta.version);
      if (files) await replaceContent(dir, files);
      const next: SkillMeta = {
        ...meta,
        title: input.title ?? meta.title,
        goal: input.goal ?? meta.goal,
        version: meta.version + 1,
        updatedAt: new Date().toISOString()
      };
      await writeMeta(dir, next);
      return { meta: next, files: await readFilesIn(dir) };
    },

    /** Merge known meta keys without bumping version or snapshotting. */
    async updateMeta(slug: string, patch: Partial<SkillMeta> | Record<string, unknown>): Promise<SkillMeta> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const meta = await readMeta(dir, slug);
      const merged: Record<string, unknown> = { ...meta };
      for (const [k, v] of Object.entries(patch ?? {})) {
        if (PATCH_FORBIDDEN.has(k) || !(META_KEYS as readonly string[]).includes(k)) continue;
        if (v === undefined || v === null) delete merged[k];
        else merged[k] = v;
      }
      merged["updatedAt"] = new Date().toISOString();
      const next = sanitizeMeta(merged, slug);
      await writeMeta(dir, next);
      return next;
    },

    async readRounds(slug: string): Promise<{ version: number; rounds: unknown[]; [k: string]: unknown }> {
      await ensureRoot();
      const dir = await requirePack(slug);
      let text: string;
      try {
        text = await fs.readFile(path.join(dir, "rounds.json"), "utf8");
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === "ENOENT") return { version: 1, rounds: [] };
        throw corrupt("rounds.json");
      }
      try {
        const data = JSON.parse(text) as Record<string, unknown>;
        if (!data || typeof data !== "object" || Array.isArray(data) || !Array.isArray(data["rounds"])) throw new Error("shape");
        return data as { version: number; rounds: unknown[]; [k: string]: unknown };
      } catch {
        throw corrupt("rounds.json", "JSON hỏng");
      }
    },

    async writeRounds(slug: string, data: { version: number; rounds: unknown[]; [k: string]: unknown }): Promise<void> {
      await ensureRoot();
      const dir = await requirePack(slug);
      await writeAtomic(path.join(dir, "rounds.json"), JSON.stringify(data, null, 2));
    },

    async readSession(slug: string): Promise<Record<string, unknown> | null> {
      await ensureRoot();
      const dir = await requirePack(slug);
      let text: string;
      try {
        text = await fs.readFile(path.join(dir, "session.json"), "utf8");
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === "ENOENT") return null;
        throw corrupt("session.json");
      }
      try {
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || Array.isArray(data)) throw new Error("shape");
        return data;
      } catch {
        throw corrupt("session.json", "JSON hỏng");
      }
    },

    async writeSession(slug: string, data: object): Promise<void> {
      await ensureRoot();
      const dir = await requirePack(slug);
      await writeAtomic(path.join(dir, "session.json"), JSON.stringify(data, null, 2));
    },

    async remove(slug: string): Promise<void> {
      await ensureRoot();
      const dir = await requirePack(slug);
      await fs.rm(dir, { recursive: true, force: true });
    },

    async listVersions(slug: string): Promise<number[]> {
      await ensureRoot();
      const dir = await requirePack(slug);
      return versionNumbers(dir);
    },

    async restoreVersion(slug: string, n: number): Promise<SkillRecord> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const meta = await readMeta(dir, slug);
      if (!Number.isInteger(n) || !(await versionNumbers(dir)).includes(n)) throw new SkillError("Không tìm thấy phiên bản này.", 404, "skill_version_not_found");
      const vdir = resolveInside(dir, `versions/${n}`);
      const old = await readFilesIn(vdir);
      validatePackageInput(old);
      await snapshot(dir, meta.version);
      await replaceContent(dir, old);
      const next: SkillMeta = { ...meta, version: meta.version + 1, updatedAt: new Date().toISOString() };
      await writeMeta(dir, next);
      return { meta: next, files: await readFilesIn(dir) };
    },

    /** The v2 inputs schema of the pack. 400 when inputs.json is missing, 409 when it is the legacy format. */
    async readInputsSchema(slug: string): Promise<InputsSchema> {
      await ensureRoot();
      return readSchema(await requirePack(slug));
    },

    /** Example attachments (outside SkillFiles; readFilesIn skips them because validateRelPath rejects their paths). */
    async listAttachments(slug: string): Promise<AttachmentInfo[]> {
      await ensureRoot();
      return listAttachmentsIn(await requirePack(slug));
    },

    async readAttachment(slug: string, pair: string, side: string, name: string): Promise<Buffer> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const file = resolveInside(dir, attachmentRel(pair, side, name));
      const st = await lstatOrNull(file);
      if (!st || !st.isFile() || st.isSymbolicLink()) throw new SkillError("Không tìm thấy tệp đính kèm.", 404, "attach_not_found");
      return fs.readFile(file);
    },

    /** Validate everything first, then write; on a write failure the files written by this call are removed. */
    async attachExamples(slug: string, items: { pair: string; side: string; name: string; data: Buffer }[]): Promise<void> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const existing = await listAttachmentsIn(dir);
      const sizes = new Map<string, number>(existing.map((a) => [attachmentRel(a.pair, a.side, a.name), a.size]));
      for (const it of items) {
        const rel = attachmentRel(it.pair, it.side, it.name);
        if (it.data.length > ATTACH_LIMITS.fileBytes) {
          throw new SkillError(`Tệp "${it.name}" quá lớn (tối đa ${ATTACH_LIMITS.fileBytes / 1024 / 1024} MB mỗi tệp).`, 400, "attach_too_big");
        }
        sizes.set(rel, it.data.length);
      }
      let total = 0;
      const perSide = new Map<string, number>();
      for (const [rel, size] of sizes) {
        total += size;
        const key = rel.split("/").slice(0, 3).join("/");
        perSide.set(key, (perSide.get(key) ?? 0) + 1);
      }
      if (total > ATTACH_LIMITS.totalBytes) {
        throw new SkillError(`Tổng dung lượng tệp đính kèm của skill vượt ${ATTACH_LIMITS.totalBytes / 1024 / 1024} MB.`, 400, "attach_total_too_big");
      }
      for (const [key, n] of perSide) {
        if (n > ATTACH_LIMITS.filesPerSide) throw new SkillError(`Mỗi phía của một cặp mẫu tối đa ${ATTACH_LIMITS.filesPerSide} tệp (${key}).`, 400, "attach_too_many");
      }
      const written: string[] = [];
      try {
        for (const it of items) {
          const file = resolveInside(dir, attachmentRel(it.pair, it.side, it.name));
          await fs.mkdir(path.dirname(file), { recursive: true });
          const st = await lstatOrNull(file);
          if (st?.isSymbolicLink()) throw new SkillError("Từ chối ghi vào symlink trong gói skill.", 400, "skill_symlink");
          const tmp = `${file}.${crypto.randomBytes(6).toString("hex")}.tmp`;
          try {
            await fs.writeFile(tmp, it.data);
            await rename(tmp, file);
          } catch (e) {
            await fs.rm(tmp, { force: true }).catch(() => undefined);
            throw e;
          }
          written.push(file);
        }
      } catch (e) {
        for (const f of written) await fs.rm(f, { force: true }).catch(() => undefined);
        throw e;
      }
    },

    /** Saved answers (`{}` when none). Does not touch meta/version. */
    async readAnswers(slug: string): Promise<Record<string, unknown>> {
      await ensureRoot();
      const dir = await requirePack(slug);
      let text: string;
      try {
        text = await fs.readFile(path.join(dir, ANSWERS_FILE), "utf8");
      } catch (e: unknown) {
        if ((e as { code?: string })?.code === "ENOENT") return {};
        throw corrupt(ANSWERS_FILE);
      }
      try {
        const data = JSON.parse(text);
        if (!data || typeof data !== "object" || Array.isArray(data) || typeof data.answers !== "object" || !data.answers) throw new Error("shape");
        return data.answers;
      } catch {
        throw corrupt(ANSWERS_FILE, "JSON hỏng");
      }
    },

    /**
     * Validate and save answers to answers.json (atomic, no version bump). `stagedInboxDir` is `<stageDir>/inbox`
     * (files uploaded via the inbox staging API); file fields list file names, which must be staged or already saved.
     * Staged files move into answers-files/, unreferenced old ones are deleted, the staging dir is removed.
     */
    async writeAnswers(slug: string, answers: Record<string, unknown>, stageDir?: string): Promise<void> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const schema = await readSchema(dir);
      const stagedDir = stageDir ? path.join(stageDir, "inbox") : null;
      const staged = new Set<string>();
      if (stagedDir) {
        try {
          for (const e of await fs.readdir(stagedDir, { withFileTypes: true })) if (e.isFile()) staged.add(e.name);
        } catch {
          /* no staged files */
        }
      }
      const filesDir = path.join(dir, ANSWERS_DIR);
      const saved = new Set<string>();
      try {
        for (const e of await fs.readdir(filesDir, { withFileTypes: true })) if (e.isFile()) saved.add(e.name);
      } catch {
        /* none yet */
      }
      const res = validateAnswers(schema, answers);
      const errors: Record<string, string> = { ...res.errors };
      const keep = new Set<string>();
      for (const f of schema.fields) {
        const v = answers[f.id];
        if (f.kind !== "file" || !Array.isArray(v) || errors[f.id]) continue;
        const missing = v.filter((n: string) => !staged.has(n) && !saved.has(n));
        if (missing.length) errors[f.id] = `Tệp chưa được tải lên: ${missing.join(", ")}.`;
        else for (const n of v) keep.add(n as string);
      }
      if (Object.keys(errors).length) {
        const err = new SkillError("Câu trả lời chưa hợp lệ.", 400, "answers_invalid");
        err.fields = errors;
        throw err;
      }
      if (keep.size) await fs.mkdir(filesDir, { recursive: true });
      for (const n of keep) {
        if (staged.has(n)) {
          await fs.rm(path.join(filesDir, n), { force: true });
          await fs.copyFile(path.join(stagedDir!, n), path.join(filesDir, n));
        }
      }
      for (const n of saved) if (!keep.has(n)) await fs.rm(path.join(filesDir, n), { force: true });
      if (!keep.size) await fs.rm(filesDir, { recursive: true, force: true });
      await writeAtomic(path.join(dir, ANSWERS_FILE), JSON.stringify({ version: 1, savedAt: new Date().toISOString(), answers }, null, 2));
      if (stageDir) await fs.rm(stageDir, { recursive: true, force: true });
    },

    /** Trial output of one round (outside SkillFiles): trials/round-<n>/sample-<idx+1>.md. */
    async writeTrialOutput(slug: string, n: number, idx: number, markdown: string): Promise<string> {
      await ensureRoot();
      const dir = await requirePack(slug);
      if (!Number.isInteger(n) || n < 1 || !Number.isInteger(idx) || idx < 0) throw new SkillError("Số vòng hoặc số mẫu không hợp lệ.", 400, "bad_file");
      const name = `sample-${idx + 1}.md`;
      await writeAtomic(path.join(dir, TRIALS_DIR, `round-${n}`, name), markdown);
      return name;
    },

    /** Remove stale sample-*.md of one round (only matching regular files in that round dir). */
    async clearTrialOutputs(slug: string, n: number): Promise<void> {
      for (const f of await this.listTrialFiles(slug, n)) {
        const dir = await requirePack(slug);
        await fs.rm(path.join(dir, TRIALS_DIR, `round-${n}`, f.name), { force: true });
      }
    },

    async listTrialFiles(slug: string, n: number): Promise<{ name: string; size: number }[]> {
      await ensureRoot();
      const dir = await requirePack(slug);
      if (!Number.isInteger(n) || n < 1) throw new SkillError("Số vòng không hợp lệ.", 400, "bad_file");
      let ents: import("node:fs").Dirent[];
      try {
        ents = await fs.readdir(path.join(dir, TRIALS_DIR, `round-${n}`), { withFileTypes: true });
      } catch {
        return [];
      }
      const out: { name: string; size: number }[] = [];
      for (const e of ents) {
        if (e.isSymbolicLink() || !e.isFile() || !TRIAL_NAME.test(e.name)) continue;
        out.push({ name: e.name, size: (await fs.stat(path.join(dir, TRIALS_DIR, `round-${n}`, e.name))).size });
      }
      return out.sort((a, b) => a.name.localeCompare(b.name, "en", { numeric: true }));
    },

    async readTrialFile(slug: string, n: number, name: string): Promise<string> {
      await ensureRoot();
      const dir = await requirePack(slug);
      if (!Number.isInteger(n) || n < 1 || !TRIAL_NAME.test(name)) throw new SkillError("Tên tệp không hợp lệ.", 400, "bad_file");
      const file = path.join(dir, TRIALS_DIR, `round-${n}`, name);
      const st = await lstatOrNull(file);
      if (!st || !st.isFile() || st.isSymbolicLink()) throw new SkillError("Không tìm thấy tệp đầu ra.", 404, "not_found");
      return fs.readFile(file, "utf8");
    },

    async readZipEntries(slug: string): Promise<{ name: string; data: Buffer }[]> {
      await ensureRoot();
      const dir = await requirePack(slug);
      const files = await readFilesIn(dir);
      return Object.entries(files).filter(([rel]) => isZippable(rel)).map(([name, text]) => ({ name, data: Buffer.from(text, "utf8") }));
    }
  };
}

export type SkillStore = ReturnType<typeof createSkillStore>;
