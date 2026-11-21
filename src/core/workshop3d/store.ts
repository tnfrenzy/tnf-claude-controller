// src/core/workshop3d/store.ts
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { initialSnapshot } from "./state.js";
import { isW3DState, type W3DBrief, type W3DSnapshot } from "./types.js";

export interface W3DRecord { slug: string; brief: W3DBrief; snapshot: W3DSnapshot; createdAt: string }
export interface W3DListItem { slug: string; title: string; state: string; costUsd: number; updatedAt: number }

const SLUG_RE = /^\d{8}-\d{6}-[0-9a-f]{6}$/;

/** Relative path inside a session: no absolute path, no drive letter, no `..`. Returns it with `/` separators. */
export function safeRel(rel: string): string {
  const n = rel.replace(/\\/g, "/");
  if (n === "" || n.startsWith("/") || /^[A-Za-z]:/.test(n) || n.split("/").some((p) => p === ".." || p === "")) {
    throw new Error(`Đường dẫn không hợp lệ: ${rel.slice(0, 80)}`);
  }
  return n;
}

/** Creation time encoded in the slug (UTC, see `stamp` in create): file birthtimes change on copy/restore. "" when invalid. */
export function slugTime(slug: string): string {
  const m = /^(\d{4})(\d{2})(\d{2})-(\d{2})(\d{2})(\d{2})-/.exec(slug);
  if (!m) return "";
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}.000Z`);
  return Number.isNaN(d.getTime()) ? "" : d.toISOString();
}

export function createW3DStore(dataDir: string, now: () => Date = () => new Date()) {
  const root = path.join(dataDir, "workshop3d");
  const dir = (slug: string): string => {
    if (!SLUG_RE.test(slug)) throw new Error("Mã phiên không hợp lệ.");
    return path.join(root, slug);
  };
  const writeJson = (file: string, v: unknown): void => {
    const tmp = `${file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(v, null, 2), "utf8");
    fs.renameSync(tmp, file);
  };
  const readJson = <T>(file: string): T | null => {
    try {
      return JSON.parse(fs.readFileSync(file, "utf8")) as T;
    } catch {
      return null;
    }
  };
  const stamp = (d: Date): string => d.toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);

  return {
    dir,
    exists(slug: string): boolean {
      try {
        return fs.existsSync(dir(slug));
      } catch {
        return false;
      }
    },
    create(brief: W3DBrief, snapshot: W3DSnapshot = initialSnapshot()): string {
      const slug = `${stamp(now())}-${crypto.randomBytes(3).toString("hex")}`;
      fs.mkdirSync(path.join(dir(slug), "rounds"), { recursive: true });
      writeJson(path.join(dir(slug), "brief.json"), brief);
      writeJson(path.join(dir(slug), "state.json"), snapshot);
      return slug;
    },
    get(slug: string): W3DRecord | null {
      let d: string;
      try {
        d = dir(slug);
      } catch {
        return null;
      }
      const brief = readJson<W3DBrief>(path.join(d, "brief.json"));
      const snapshot = readJson<W3DSnapshot>(path.join(d, "state.json"));
      // A hand-edited or corrupt state.json must not reach the runner: require an object with a known state.
      if (!brief || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) || !isW3DState(snapshot.state)) return null;
      return { slug, brief, snapshot, createdAt: slugTime(slug) };
    },
    list(): W3DListItem[] {
      let names: string[] = [];
      try {
        names = fs.readdirSync(root).filter((n) => SLUG_RE.test(n));
      } catch {
        return [];
      }
      const items: W3DListItem[] = [];
      for (const slug of names.sort().reverse()) {
        const rec = this.get(slug);
        if (!rec) continue;
        let updatedAt = 0;
        try {
          updatedAt = fs.statSync(path.join(dir(slug), "state.json")).mtimeMs;
        } catch {
          /* 0 */
        }
        items.push({ slug, title: rec.brief.title, state: rec.snapshot.state, costUsd: rec.snapshot.costUsd, updatedAt });
      }
      return items;
    },
    saveSnapshot(slug: string, s: W3DSnapshot): void {
      writeJson(path.join(dir(slug), "state.json"), s);
    },
    saveBrief(slug: string, b: W3DBrief): void {
      writeJson(path.join(dir(slug), "brief.json"), b);
    },
    writeFile(slug: string, rel: string, content: string | Buffer): void {
      const f = path.join(dir(slug), safeRel(rel));
      fs.mkdirSync(path.dirname(f), { recursive: true });
      fs.writeFileSync(f, content);
    },
    readFile(slug: string, rel: string): string | null {
      try {
        return fs.readFileSync(path.join(dir(slug), safeRel(rel)), "utf8");
      } catch {
        return null;
      }
    },
    appendRound(slug: string, n: number, role: string, text: string): void {
      this.writeFile(slug, `rounds/${Math.max(0, Math.floor(n))}/${role}.txt`, text);
    },
    /** Bytes on disk of the session folder (links are not followed). */
    diskBytes(slug: string): number {
      let total = 0;
      const walk = (d: string): void => {
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const f = path.join(d, e.name);
          if (e.isDirectory()) walk(f);
          else if (e.isFile()) {
            try {
              total += fs.statSync(f).size;
            } catch {
              /* vanished */
            }
          }
        }
      };
      walk(dir(slug));
      return total;
    },
    /**
     * Delete the WHOLE session folder <dataDir>/workshop3d/<slug>, nothing else: the slug must match the engine pattern
     * and the real path (junctions resolved) must be a direct child of the real workshop3d folder. Returns false when
     * there is no such session.
     */
    remove(slug: string): boolean {
      const d = dir(slug);
      if (!fs.existsSync(d)) return false;
      const realRoot = fs.realpathSync(root);
      const real = fs.realpathSync(d);
      if (path.dirname(real) !== realRoot || path.basename(real) !== slug || fs.lstatSync(d).isSymbolicLink()) {
        throw new Error("Thư mục phiên không nằm trong thư mục dữ liệu xưởng 3D: không xóa.");
      }
      fs.rmSync(real, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 });
      return true;
    },
    listFiles(slug: string, sub: string): string[] {
      const base = path.join(dir(slug), safeRel(sub));
      try {
        return fs.readdirSync(base).sort().map((n) => `${safeRel(sub)}/${n}`);
      } catch {
        return [];
      }
    },
  };
}
export type W3DStore = ReturnType<typeof createW3DStore>;
