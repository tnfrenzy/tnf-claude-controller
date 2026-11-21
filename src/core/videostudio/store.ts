// src/core/videostudio/store.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { VsError, emptyPlan, safeVsRel, validatePlan } from "./plan.js";
import type { VsAspect, VsAsset, VsListItem, VsPlan, VsProject } from "./plan-types.js";

export interface VsStoreLimits {
  maxFileBytes?: number;
  maxAssets?: number;
}

export interface VsStore {
  create(input: { title: string; brief: string; styleId: string; aspect: VsAspect }): VsProject;
  get(slug: string): VsProject;
  list(): VsListItem[];
  update(slug: string, patch: Partial<Omit<VsProject, "slug" | "createdAt">>): VsProject;
  getPlan(slug: string): VsPlan;
  savePlan(slug: string, plan: unknown): VsPlan;
  addAsset(slug: string, name: string, data: Buffer, opts?: { generated?: boolean }): VsAsset;
  listAssets(slug: string): VsAsset[];
  setAssetDuration(slug: string, rel: string, duration: number): void;
  dir(slug: string): string;
  filePath(slug: string, rel: string): string;
  remove(slug: string): void;
}

const KIND_BY_EXT: Record<string, VsAsset["kind"]> = {
  mp4: "video",
  mov: "video",
  webm: "video",
  mkv: "video",
  png: "image",
  jpg: "image",
  jpeg: "image",
  webp: "image",
  mp3: "audio",
  wav: "audio",
  m4a: "audio",
  ogg: "audio",
};
const RESERVED_RE = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const MAX_NAME = 80;

const SLUG_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;
const ASPECTS: readonly string[] = ["16:9", "9:16", "1:1"];

function writeAtomic(file: string, content: string): void {
  const tmp = `${file}.${crypto.randomBytes(4).toString("hex")}.tmp`;
  try {
    fs.writeFileSync(tmp, content, "utf8");
    fs.renameSync(tmp, file);
  } catch (e) {
    try {
      fs.rmSync(tmp, { force: true });
    } catch {
      /* ignore */
    }
    throw e;
  }
}

function makeSlug(d: Date): string {
  const iso = d.toISOString(); // YYYY-MM-DDTHH:MM:SS.mmmZ
  const date = iso.slice(0, 10).replace(/-/g, "");
  const time = iso.slice(11, 19).replace(/:/g, "");
  return `${date}-${time}-${crypto.randomBytes(3).toString("hex")}`;
}

// limits is accepted now and used by asset handling in a later task.
export function createVsStore(
  dataDir: string,
  now: () => Date = () => new Date(),
  limits: VsStoreLimits = {},
): VsStore {
  const root = path.join(dataDir, "videostudio");
  const maxFileBytes = limits.maxFileBytes ?? 300 * 1024 * 1024;
  const maxAssets = limits.maxAssets ?? 100;

  function checkSlug(slug: string): void {
    if (typeof slug !== "string" || !SLUG_RE.test(slug)) {
      throw new VsError("Mã dự án không hợp lệ.", 400);
    }
  }

  function dirOf(slug: string): string {
    checkSlug(slug);
    return path.join(root, slug);
  }

  function readProject(dir: string): VsProject | null {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dir, "project.json"), "utf8")) as unknown;
      if (!raw || typeof raw !== "object") return null;
      const p = raw as VsProject;
      if (typeof p.slug !== "string" || !SLUG_RE.test(p.slug)) return null;
      if (typeof p.title !== "string" || typeof p.updatedAt !== "string") return null;
      return p;
    } catch {
      return null;
    }
  }

  function get(slug: string): VsProject {
    const p = readProject(dirOf(slug));
    if (!p) throw new VsError("Không tìm thấy dự án.", 404);
    return p;
  }

  function readLedger(slug: string): VsAsset[] {
    try {
      const raw = JSON.parse(fs.readFileSync(path.join(dirOf(slug), "assets.json"), "utf8")) as unknown;
      if (!Array.isArray(raw)) return [];
      return raw.filter(
        (a): a is VsAsset => !!a && typeof a === "object" && typeof (a as VsAsset).rel === "string",
      );
    } catch {
      return [];
    }
  }

  function sanitizeName(name: string): { stem: string; ext: string } {
    const norm = String(name ?? "").replace(/\\/g, "/");
    const parts = norm.split("/");
    if (parts.some((p) => p === "..")) throw new VsError("Tên tệp không hợp lệ.", 400);
    const base = parts[parts.length - 1] ?? "";
    const dot = base.lastIndexOf(".");
    const ext = dot >= 0 ? base.slice(dot + 1).toLowerCase() : "";
    if (!(ext in KIND_BY_EXT)) throw new VsError("Định dạng tệp không được hỗ trợ.", 400);
    let stem = (dot >= 0 ? base.slice(0, dot) : base).replace(/[^A-Za-z0-9._-]/g, "_");
    stem = stem.replace(/^\.+|\.+$/g, "");
    if (stem === "") stem = "asset";
    if (RESERVED_RE.test(stem)) stem = `_${stem}`;
    return { stem, ext };
  }

  function fit(stem: string, suffix: string, ext: string): string {
    const room = Math.max(1, MAX_NAME - ext.length - 1 - suffix.length);
    return `${stem.slice(0, room)}${suffix}.${ext}`;
  }

  return {
    create(input) {
      const title = String(input?.title ?? "").trim();
      const brief = String(input?.brief ?? "");
      if (title.length < 1 || title.length > 80) {
        throw new VsError("Tiêu đề phải từ 1 đến 80 ký tự.", 400);
      }
      if (brief.length > 4000) throw new VsError("Mô tả tối đa 4000 ký tự.", 400);
      if (!ASPECTS.includes(input.aspect)) throw new VsError("Tỉ lệ khung hình không hợp lệ.", 400);
      if (typeof input.styleId !== "string" || input.styleId.trim() === "") {
        throw new VsError("Phong cách không hợp lệ.", 400);
      }
      fs.mkdirSync(root, { recursive: true });
      let slug = "";
      let dir = "";
      for (let i = 0; ; i++) {
        slug = makeSlug(now());
        dir = path.join(root, slug);
        try {
          fs.mkdirSync(dir);
          break;
        } catch (e) {
          if ((e as NodeJS.ErrnoException).code === "EEXIST" && i < 20) continue;
          throw e;
        }
      }
      const ts = now().toISOString();
      const project: VsProject = {
        slug,
        title,
        brief,
        styleId: input.styleId,
        aspect: input.aspect,
        state: "draft",
        error: null,
        costUsd: 0,
        lastRender: null,
        lastPreview: null,
        createdAt: ts,
        updatedAt: ts,
      };
      writeAtomic(path.join(dir, "plan.json"), JSON.stringify(emptyPlan(input.styleId, input.aspect), null, 2));
      writeAtomic(path.join(dir, "project.json"), JSON.stringify(project, null, 2));
      return project;
    },

    get,

    list() {
      let names: string[];
      try {
        names = fs.readdirSync(root);
      } catch {
        return [];
      }
      const items: VsListItem[] = [];
      for (const name of names) {
        if (!SLUG_RE.test(name)) continue;
        const p = readProject(path.join(root, name));
        if (!p || p.slug !== name) continue;
        items.push({ slug: p.slug, title: p.title, state: p.state, aspect: p.aspect, updatedAt: p.updatedAt });
      }
      items.sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : a.updatedAt > b.updatedAt ? -1 : b.slug.localeCompare(a.slug)));
      return items;
    },

    update(slug, patch) {
      const cur = get(slug);
      const next: VsProject = {
        ...cur,
        ...patch,
        slug: cur.slug,
        createdAt: cur.createdAt,
        updatedAt: now().toISOString(),
      };
      writeAtomic(path.join(dirOf(slug), "project.json"), JSON.stringify(next, null, 2));
      return next;
    },

    getPlan(slug) {
      const dir = dirOf(slug);
      get(slug);
      try {
        return JSON.parse(fs.readFileSync(path.join(dir, "plan.json"), "utf8")) as VsPlan;
      } catch {
        throw new VsError("Không tìm thấy kế hoạch.", 404);
      }
    },

    savePlan(slug, plan) {
      const dir = dirOf(slug);
      get(slug);
      const v = validatePlan(plan);
      if (!v.ok) throw new VsError(v.errors.join("; "), 400);
      writeAtomic(path.join(dir, "plan.json"), JSON.stringify(v.plan, null, 2));
      const cur = get(slug);
      writeAtomic(
        path.join(dir, "project.json"),
        JSON.stringify({ ...cur, updatedAt: now().toISOString() }, null, 2),
      );
      return v.plan;
    },

    addAsset(slug, name, data, opts) {
      const dir = dirOf(slug);
      get(slug);
      const { stem, ext } = sanitizeName(name);
      if (data.length > maxFileBytes) throw new VsError("Tệp quá lớn.", 413);
      const ledger = readLedger(slug);
      if (ledger.length >= maxAssets) throw new VsError(`Mỗi dự án tối đa ${maxAssets} tệp.`, 400);
      const assetsDir = path.join(dir, "assets");
      fs.mkdirSync(assetsDir, { recursive: true });
      const taken = new Set<string>(fs.readdirSync(assetsDir).map((n) => n.toLowerCase()));
      for (const a of ledger) taken.add(a.rel.slice(a.rel.lastIndexOf("/") + 1).toLowerCase());
      let finalName = fit(stem, "", ext);
      for (let i = 2; taken.has(finalName.toLowerCase()); i++) finalName = fit(stem, `-${i}`, ext);
      const target = path.join(assetsDir, finalName);
      const tmp = `${target}.${crypto.randomBytes(4).toString("hex")}.tmp`;
      try {
        fs.writeFileSync(tmp, data);
        fs.renameSync(tmp, target);
      } catch (e) {
        fs.rmSync(tmp, { force: true });
        throw e;
      }
      const rel = `assets/${finalName}`;
      const asset: VsAsset = {
        rel,
        path: rel,
        kind: KIND_BY_EXT[ext] as VsAsset["kind"],
        size: data.length,
        duration: null,
        generated: opts?.generated ?? false,
      };
      writeAtomic(path.join(dir, "assets.json"), JSON.stringify([...ledger, asset], null, 2));
      return asset;
    },

    listAssets(slug) {
      const dir = dirOf(slug);
      get(slug);
      return readLedger(slug).filter((a) => {
        try {
          return fs.statSync(path.join(dir, safeVsRel(a.rel))).isFile();
        } catch {
          return false;
        }
      });
    },

    setAssetDuration(slug, rel, duration) {
      const dir = dirOf(slug);
      get(slug);
      const ledger = readLedger(slug);
      const idx = ledger.findIndex((a) => a.rel === rel);
      if (idx < 0) throw new VsError("Không tìm thấy tệp trong dự án.", 404);
      ledger[idx] = { ...(ledger[idx] as VsAsset), duration };
      writeAtomic(path.join(dir, "assets.json"), JSON.stringify(ledger, null, 2));
    },

    dir(slug) {
      return dirOf(slug);
    },

    filePath(slug, rel) {
      const dir = path.resolve(dirOf(slug));
      const abs = path.resolve(dir, safeVsRel(rel));
      if (!path.isAbsolute(abs) || !abs.startsWith(dir + path.sep)) {
        throw new VsError("Đường dẫn tệp không hợp lệ.", 400);
      }
      return abs;
    },

    remove(slug) {
      const dir = dirOf(slug);
      if (!fs.existsSync(dir)) throw new VsError("Không tìm thấy dự án.", 404);
      fs.rmSync(dir, { recursive: true, force: true });
    },
  };
}
