import { spawn } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import { runGit } from "./git.js";

/**
 * How a coding worktree gets the target repo's installed `node_modules` (agents may not run `npm install`).
 * - copy (default): a real copy inside the worktree. A junction/symlink to the repo is NOT readable from the agent's
 *   sandboxed Bash/Node (readdir/stat/realpath fail with UNKNOWN -4094 while the plain path works), so tests such as
 *   `vitest` cannot be resolved through it (run 20261026-090255-437781).
 * - junction: the old behaviour (link to the repo's folder); also the automatic fallback when the folder is over the
 *   size cap or copying fails.
 * - none: do nothing.
 */
export type NodeModulesMode = "copy" | "junction" | "none";

export interface NodeModulesConfig {
  mode: NodeModulesMode;
  /** Largest `node_modules` (bytes) that is copied; bigger ones fall back to a junction. */
  maxBytes: number;
}

const MB = 1024 * 1024;
export const DEFAULT_NODE_MODULES: NodeModulesConfig = { mode: "copy", maxBytes: 600 * MB };
export const NODE_MODULES_MAX_MB_CEILING = 20_000;

export interface NodeModulesResult {
  action: "copied" | "linked" | "skipped";
  /** Why it was skipped, or why a link was used instead of a copy. */
  reason?: string;
  bytes?: number;
  files?: number;
  ms: number;
}

export interface DirSize {
  bytes: number;
  files: number;
  exceeded: boolean;
}

/** Sum file sizes under `dir` without following links; stops as soon as `capBytes` is passed. */
export function measureDir(dir: string, capBytes: number): DirSize {
  let bytes = 0;
  let files = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      files++;
      if (e.isFile()) {
        try {
          bytes += fs.statSync(full).size;
        } catch {
          /* vanished: ignore */
        }
        if (bytes > capBytes) return { bytes, files, exceeded: true };
      }
    }
  }
  return { bytes, files, exceeded: false };
}

/** measureDir that hands the event loop back every few hundred entries (the sync walk of a big node_modules froze the server). */
export async function measureDirAsync(dir: string, capBytes: number): Promise<DirSize> {
  let bytes = 0;
  let files = 0;
  let n = 0;
  const stack = [dir];
  while (stack.length) {
    const cur = stack.pop()!;
    let entries: fs.Dirent[];
    try {
      entries = await fs.promises.readdir(cur, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const e of entries) {
      const full = path.join(cur, e.name);
      if (e.isDirectory()) {
        stack.push(full);
        continue;
      }
      files++;
      if (e.isFile()) {
        try {
          bytes += (await fs.promises.stat(full)).size;
        } catch {
          /* vanished: ignore */
        }
        if (bytes > capBytes) return { bytes, files, exceeded: true };
      }
      if (++n % 400 === 0) await new Promise<void>((r) => setImmediate(r));
    }
  }
  return { bytes, files, exceeded: false };
}

export interface ProvisionDeps {
  /** Replaces the real copy (tests). */
  copyDir?: (src: string, dst: string) => Promise<void>;
  /** Folder (same volume as the worktrees) holding one cached copy per repo; enables the hard-link fast path. */
  cacheRoot?: string;
}

/** Windows: robocopy with 32 threads (~3x faster than cpSync on 4.8k small files, measured 33 s vs 92 s). Exit codes 0-7 are success. */
function robocopyDir(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn("robocopy", [src, dst, "/E", "/MT:32", "/R:0", "/W:0", "/NFL", "/NDL", "/NJH", "/NJS", "/NP"], { stdio: ["ignore", "ignore", "ignore"], windowsHide: true, shell: false });
    child.on("error", reject);
    child.on("close", (code) => (code !== null && code < 8 ? resolve() : reject(new Error(`robocopy thoát với mã ${code}`))));
  });
}

/** Cache key: repo path plus the lock file and node_modules folder timestamps, so an `npm install` invalidates it. */
function cacheKey(repoPath: string, src: string): string {
  const parts = [repoPath];
  for (const f of [path.join(repoPath, "package-lock.json"), path.join(src, ".package-lock.json"), src]) {
    try {
      const st = fs.statSync(f);
      parts.push(`${st.size}:${Math.floor(st.mtimeMs)}`);
    } catch {
      parts.push("-");
    }
  }
  return crypto.createHash("sha1").update(parts.join("|")).digest("hex").slice(0, 16);
}

/** Recreate `src` under `dst` with hard links for files (no data copied). Throws on any failure (e.g. different volume). */
function hardlinkTree(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dst, e.name);
    if (e.isDirectory()) hardlinkTree(s, d);
    else if (e.isSymbolicLink()) fs.symlinkSync(fs.readlinkSync(s), d);
    else fs.linkSync(s, d);
  }
}

/** Runs inside the child process: synchronous cpSync is ~4x faster than fs.promises.cp on Windows (measured 18 s vs 75 s for 3.3k files). */
const CHILD_COPY = "require('node:fs').cpSync(process.argv[1], process.argv[2], { recursive: true, force: false, errorOnExist: false, dereference: false, verbatimSymlinks: true })";

/**
 * Copy in a child node process (no shell, paths as arguments): the fast synchronous copy never blocks the controller's
 * event loop, so the server and WebSocket stay responsive during the 10-20 s it takes.
 */
function defaultCopyDir(src: string, dst: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, ["-e", CHILD_COPY, src, dst], { stdio: ["ignore", "ignore", "pipe"], windowsHide: true, shell: false });
    let err = "";
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => (err = (err + d).slice(-2000)));
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(err.trim().split(/\r?\n/).filter(Boolean).pop() ?? `tiến trình copy thoát với mã ${code}`));
    });
  });
}

/**
 * Give the worktree its `node_modules`. Never throws: any problem is reported in the result. Only acts when the repo
 * has a `node_modules` directory and git ignores that name, so nothing shows up in the agent's diff. The copy is async
 * so the server stays responsive while it runs.
 */
export async function provisionNodeModules(repoPath: string, worktreePath: string, cfg: NodeModulesConfig, deps: ProvisionDeps = {}): Promise<NodeModulesResult> {
  const t0 = Date.now();
  const done = (r: Omit<NodeModulesResult, "ms">): NodeModulesResult => ({ ...r, ms: Date.now() - t0 });
  if (cfg.mode === "none") return done({ action: "skipped", reason: "cấu hình nodeModules.mode = none" });

  const src = path.join(repoPath, "node_modules");
  const dst = path.join(worktreePath, "node_modules");
  try {
    if (!fs.existsSync(src) || !fs.statSync(src).isDirectory()) return done({ action: "skipped", reason: "repo đích không có thư mục node_modules" });
  } catch {
    return done({ action: "skipped", reason: "không đọc được node_modules của repo đích" });
  }
  try {
    fs.lstatSync(dst);
    return done({ action: "skipped", reason: "worktree đã có node_modules" });
  } catch {
    /* not there yet */
  }
  if (runGit(worktreePath, ["check-ignore", "-q", "node_modules/"]).code !== 0) {
    return done({ action: "skipped", reason: "git không bỏ qua node_modules (thiếu .gitignore), bản sao sẽ lẫn vào diff" });
  }

  const link = (reason?: string): NodeModulesResult => {
    try {
      fs.symlinkSync(src, dst, process.platform === "win32" ? "junction" : "dir");
    } catch (e) {
      return done({ action: "skipped", reason: `không tạo được liên kết node_modules: ${e instanceof Error ? e.message : String(e)}` });
    }
    return done({ action: "linked", ...(reason ? { reason } : {}) });
  };

  if (cfg.mode === "junction") return link();

  const size = await measureDirAsync(src, cfg.maxBytes);
  if (size.exceeded) return link(`node_modules vượt trần ${Math.round(cfg.maxBytes / MB)} MB nên dùng junction (agent có thể không đọc được qua junction)`);
  const copier = deps.copyDir ?? (process.platform === "win32" ? robocopyDir : defaultCopyDir);
  try {
    if (deps.cacheRoot && !deps.copyDir) {
      const cache = path.join(deps.cacheRoot, cacheKey(repoPath, src));
      const ready = path.join(cache, ".tnf-ready");
      if (!fs.existsSync(ready)) {
        // A new key means the repo's dependencies changed: drop older caches so the disk does not fill up.
        for (const old of fs.existsSync(deps.cacheRoot) ? fs.readdirSync(deps.cacheRoot) : []) fs.rmSync(path.join(deps.cacheRoot, old), { recursive: true, force: true });
        await copier(src, path.join(cache, "node_modules"));
        fs.writeFileSync(ready, String(Date.now()), "utf8");
      }
      try {
        hardlinkTree(path.join(cache, "node_modules"), dst);
        return done({ action: "copied", bytes: size.bytes, files: size.files, reason: "hardlink từ bộ đệm" });
      } catch {
        fs.rmSync(dst, { recursive: true, force: true });
      }
    }
    await copier(src, dst);
  } catch (e) {
    fs.rmSync(dst, { recursive: true, force: true });
    return link(`copy lỗi (${e instanceof Error ? e.message : String(e)}) nên dùng junction`);
  }
  return done({ action: "copied", bytes: size.bytes, files: size.files });
}

/** One Vietnamese line for the run's `node-modules.txt`. */
export function describeNodeModules(r: NodeModulesResult): string {
  const secs = (r.ms / 1000).toFixed(1);
  if (r.action === "copied") return `node_modules: đã copy vào worktree (${((r.bytes ?? 0) / MB).toFixed(1)} MB, ${r.files} file, ${secs} s${r.reason ? `, ${r.reason}` : ""}).\n`;
  if (r.action === "linked") return `node_modules: dùng junction tới repo đích${r.reason ? ` (${r.reason})` : ""}.\n`;
  return `node_modules: không cấp${r.reason ? ` (${r.reason})` : ""}.\n`;
}
