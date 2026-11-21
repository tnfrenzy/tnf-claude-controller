/**
 * Git operations the controller runs itself (CONTEXT-SPEC-v1 §3.2, §9): always `spawnSync("git", [...])` without a
 * shell, explicit cwd, no credential helpers injected. The agent never gets these helpers; it only gets the env below.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

/** Identity the controller gives every agent process (never the user's own); no interactive credential prompts. */
export const AGENT_GIT_ENV: Record<string, string> = {
  GIT_AUTHOR_NAME: "TNF Agent",
  GIT_AUTHOR_EMAIL: "agent@example.com",
  GIT_COMMITTER_NAME: "TNF Agent",
  GIT_COMMITTER_EMAIL: "agent@example.com",
  GIT_TERMINAL_PROMPT: "0",
};

export interface GitResult {
  code: number;
  stdout: string;
  stderr: string;
}

export function runGit(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): GitResult {
  const r = spawnSync("git", args, { cwd, env, encoding: "utf8", windowsHide: true, shell: false, maxBuffer: 64 * 1024 * 1024 });
  if (r.error) return { code: -1, stdout: "", stderr: r.error.message };
  return { code: r.status ?? -1, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
}

/** Async twin of runGit: the event loop keeps serving requests while git works (a worktree checkout takes ~10 s on a big repo). */
export function runGitAsync(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): Promise<GitResult> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd, env, windowsHide: true, shell: false });
    let out = "";
    let err = "";
    child.stdout.setEncoding("utf8").on("data", (d: string) => { out += d; });
    child.stderr.setEncoding("utf8").on("data", (d: string) => { err += d; });
    child.on("error", (e) => resolve({ code: -1, stdout: "", stderr: e.message }));
    child.on("close", (code) => resolve({ code: code ?? -1, stdout: out, stderr: err }));
  });
}

/** Run git and throw (Vietnamese message) on non-zero exit. Returns trimmed stdout. */
export function git(cwd: string, args: string[], env?: NodeJS.ProcessEnv): string {
  const r = runGit(cwd, args, env);
  if (r.code !== 0) throw new Error(`Lệnh git thất bại (git ${args.join(" ")}) trong ${cwd}: ${r.stderr.trim() || r.stdout.trim() || `mã ${r.code}`}`);
  return r.stdout.trim();
}

export interface RepoValidation {
  ok: boolean;
  head_sha: string | null;
  dirty: boolean;
  branches: string[];
  error: string | null;
}

const fail = (error: string, extra: Partial<RepoValidation> = {}): RepoValidation => ({ ok: false, head_sha: null, dirty: false, branches: [], error, ...extra });

/** Check a target repo per SPEC §9: absolute ASCII path, real git toplevel, base branch exists. */
export function validateRepo(repoPath: string, baseBranch: string): RepoValidation {
  if (!path.isAbsolute(repoPath)) return fail("Đường dẫn repo phải là đường dẫn tuyệt đối.");
  if (!/^[\x20-\x7E]+$/.test(repoPath)) return fail("Đường dẫn repo chỉ được chứa ký tự ASCII (không dấu).");
  if (!fs.existsSync(repoPath) || !fs.statSync(repoPath).isDirectory()) return fail("Thư mục repo không tồn tại.");
  const top = runGit(repoPath, ["rev-parse", "--show-toplevel"]);
  if (top.code !== 0) return fail("Thư mục này không phải git repo.");
  const canonPath = (p: string): string => {
    const resolved = (() => {
      try { return fs.realpathSync.native(p); } catch { return path.resolve(p); }
    })();
    return process.platform === "win32" ? resolved.toLowerCase() : resolved;
  };
  if (canonPath(top.stdout.trim()) !== canonPath(repoPath)) return fail(`Đường dẫn phải là thư mục gốc của repo (${path.resolve(top.stdout.trim())}).`);
  const branches = runGit(repoPath, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"])
    .stdout.split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const head = runGit(repoPath, ["rev-parse", "--verify", "--quiet", `refs/heads/${baseBranch}`]);
  if (head.code !== 0) return fail(`Không có nhánh gốc "${baseBranch}" trong repo.`, { branches });
  const status = runGit(repoPath, ["status", "--porcelain"]);
  return { ok: true, head_sha: head.stdout.trim(), dirty: status.stdout.trim().length > 0, branches, error: null };
}

export interface CreateWorktreeOptions {
  repoPath: string;
  baseBranch: string;
  worktreePath: string;
  branch: string;
  /** Optional full 40-hex commit sha to start the new branch at instead of the head of baseBranch. */
  startSha?: string;
}

/**
 * `git worktree add -b <branch> <worktreePath> <baseBranch>` from the target repo; returns the base sha.
 * Adds `notes/` to the worktree's own info/exclude so agent notes never show up in `git status` (S5).
 */
/** ASCII, lowercase, filename- and ref-safe form of a project (environment) name; never empty. */
export function projectSlug(name: string): string {
  const slug = name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase().replace(/[^a-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 40);
  return slug || "default";
}

/** Where a run's output lives: <worktreesDir>/<project>/<run-id>, so one environment's runs never mix with another's. */
export function runWorktreePath(worktreesDir: string, project: string, runId: string): string {
  return path.join(worktreesDir, projectSlug(project), runId);
}

/** Agent branch of a run: tnf/<project>/<run-id> (the project part tells environments apart in `git branch`). */
export function runBranchName(project: string, runId: string): string {
  return `tnf/${projectSlug(project)}/${runId}`;
}

/** Parse "git version 2.43.0.windows.1" into major/minor; null when the text does not look like that. */
export function parseGitVersion(text: string): { major: number; minor: number } | null {
  const m = /git version (\d+)\.(\d+)/.exec(text ?? "");
  if (!m) return null;
  return { major: Number(m[1]), minor: Number(m[2]) };
}

/** Installed git version (via `git --version`), or null when it cannot be read. */
export function gitVersion(cwd: string): { major: number; minor: number } | null {
  const r = runGit(cwd, ["--version"]);
  if (r.code !== 0) return null;
  return parseGitVersion(r.stdout);
}

/**
 * True for a run branch name: `tnf/` followed by one or more segments of [A-Za-z0-9._-] separated by `/`.
 * Several segments are allowed on purpose: runBranchName creates `tnf/<slug>/<run-id>` (two `/`).
 * Segments are non-empty, do not start with `-`, do not end with `.` or `.lock`; the whole name has no `..`.
 */
export function isRunBranchName(name: string): boolean {
  if (typeof name !== "string" || !name.startsWith("tnf/") || name.includes("..")) return false;
  const segments = name.slice(4).split("/");
  return segments.every((s) => /^[A-Za-z0-9._-]+$/.test(s) && !s.startsWith("-") && !s.endsWith(".") && !s.endsWith(".lock"));
}

/** True for a usable base ref name: non-empty, no leading `-`, no whitespace, no `..`. */
export function isValidBaseRef(name: string): boolean {
  return typeof name === "string" && name.length > 0 && !name.startsWith("-") && !/\s/.test(name) && !name.includes("..");
}

/** Resolves `ref` to a commit sha, or null when the ref is invalid or does not exist. */
export function resolveRef(repoPath: string, ref: string): string | null {
  if (!isValidBaseRef(ref)) return null;
  const r = runGit(repoPath, ["rev-parse", "--verify", "--quiet", `${ref}^{commit}`]);
  if (r.code !== 0) return null;
  const sha = r.stdout.trim();
  return sha || null;
}

export interface MergePreview {
  status: "clean" | "conflict" | "unknown";
  files: string[];
  reason?: string;
  checked_at: number;
}

/**
 * Dry-run merge of `branch` into `base` with `git merge-tree --write-tree` (git 2.38+). Never touches the working
 * tree, index or refs, and never checks out. Anything that cannot be verified is "unknown", never "clean".
 * `gitVersionOverride` is for tests only: undefined reads the real version, null means "version unknown".
 */
export function previewMerge(
  o: { repoPath: string; base: string; branch: string },
  gitVersionOverride?: { major: number; minor: number } | null,
): MergePreview {
  const unknown = (reason: string): MergePreview => ({ status: "unknown", files: [], reason, checked_at: Date.now() });
  if (!isRunBranchName(o.branch)) return unknown(`Tên nhánh không hợp lệ: "${o.branch}"`);
  if (!isValidBaseRef(o.base)) return unknown(`Tên nhánh gốc không hợp lệ: "${o.base}"`);
  const v = gitVersionOverride === undefined ? gitVersion(o.repoPath) : gitVersionOverride;
  if (!v || !(v.major > 2 || (v.major === 2 && v.minor >= 38))) return unknown("không kiểm được: cần git 2.38+");
  // core.quotepath=false keeps non-ASCII file names readable (spaces are never quoted without it either).
  const r = runGit(o.repoPath, ["-c", "core.quotepath=false", "merge-tree", "--write-tree", "--name-only", "--no-messages", o.base, o.branch]);
  if (r.code === 0) return { status: "clean", files: [], checked_at: Date.now() };
  // Exit 1 is also used for bad refs (empty stdout, message on stderr): a real conflict starts with the tree OID.
  if (r.code === 1 && /^[0-9a-f]{40,64}\r?$/m.test(r.stdout.split("\n")[0] ?? "")) {
    const files = [...new Set(r.stdout.split(/\r?\n/).slice(1).filter((l) => l.length > 0))];
    return { status: "conflict", files, checked_at: Date.now() };
  }
  const err = r.stderr.trim().slice(0, 300);
  return unknown(err || `git merge-tree thoát với mã ${r.code}`);
}

/** True only for a full commit sha: exactly 40 lowercase hex characters. */
export function isFullCommitSha(s: unknown): boolean {
  return typeof s === "string" && /^[0-9a-f]{40}$/.test(s);
}

/** True when `sha` (full form) is an ancestor of, or equal to, the head of run branch `branch`. */
export function isCommitOnBranch(repoPath: string, sha: string, branch: string): boolean {
  if (!isFullCommitSha(sha) || !isRunBranchName(branch)) return false;
  const r = runGit(repoPath, ["merge-base", "--is-ancestor", sha, "refs/heads/" + branch]);
  return r.code === 0;
}

/** Same as createWorktree but the slow `git worktree add` runs without blocking the server's event loop. */
export async function createWorktreeAsync(o: CreateWorktreeOptions): Promise<string> {
  if (o.startSha !== undefined && !isFullCommitSha(o.startSha)) {
    throw new Error("startSha không hợp lệ: cần đúng 40 ký tự hex thường.");
  }
  fs.mkdirSync(path.dirname(o.worktreePath), { recursive: true });
  const args = ["worktree", "add", "-b", o.branch, o.worktreePath, o.startSha ?? o.baseBranch];
  const r = await runGitAsync(o.repoPath, args);
  if (r.code !== 0) throw new Error(`Lệnh git thất bại (git ${args.join(" ")}) trong ${o.repoPath}: ${r.stderr.trim() || r.stdout.trim() || `mã ${r.code}`}`);
  return finishWorktree(o);
}

export function createWorktree(o: CreateWorktreeOptions): string {
  if (o.startSha !== undefined && !isFullCommitSha(o.startSha)) {
    throw new Error("startSha không hợp lệ: cần đúng 40 ký tự hex thường.");
  }
  fs.mkdirSync(path.dirname(o.worktreePath), { recursive: true });
  git(o.repoPath, ["worktree", "add", "-b", o.branch, o.worktreePath, o.startSha ?? o.baseBranch]);
  return finishWorktree(o);
}

function finishWorktree(o: CreateWorktreeOptions): string {
  const base = git(o.worktreePath, ["rev-parse", "HEAD"]);
  const infoDir = path.resolve(o.worktreePath, git(o.worktreePath, ["rev-parse", "--git-path", "info"]));
  fs.mkdirSync(infoDir, { recursive: true });
  const excludeFile = path.join(infoDir, "exclude");
  const cur = fs.existsSync(excludeFile) ? fs.readFileSync(excludeFile, "utf8") : "";
  if (!/^notes\/$/m.test(cur)) fs.appendFileSync(excludeFile, (cur && !cur.endsWith("\n") ? "\n" : "") + "notes/\n");
  // node_modules is provisioned separately and asynchronously (node-modules.ts: copy, or a junction over the size cap).
  return base;
}

/** Remove a `node_modules` junction/symlink we created (never the real directory) before git deletes the worktree. A copied folder is plain files that `git worktree remove --force` deletes itself. */
export function unlinkNodeModules(worktreePath: string): void {
  const dst = path.join(worktreePath, "node_modules");
  let st: fs.Stats;
  try {
    st = fs.lstatSync(dst);
  } catch {
    return;
  }
  if (!st.isSymbolicLink()) return;
  // On Windows a junction is removed with rmdir (contents untouched); a POSIX dir symlink with unlink.
  if (process.platform === "win32") fs.rmdirSync(dst);
  else fs.unlinkSync(dst);
}

export interface CommitRecord {
  hash: string;
  subject: string;
}

export interface PostRunVcs {
  commits: CommitRecord[];
  changed_files: number;
  /** `git status --porcelain` of the worktree. */
  status: string;
  has_uncommitted: boolean;
  /** The original repo's status or HEAD differs from before the run (SPEC §4.4 post-check). */
  repo_root_changed: boolean;
}

export interface CollectPostRunOptions {
  worktreePath: string;
  baseSha: string;
  repoPath: string;
  repoStatusBefore: string;
  repoHeadBefore: string;
  /** Run directory; artifacts are written here (diff.patch, diff-stat.txt, git-status.txt, git-log.txt, uncommitted.patch, repo-check.txt). */
  outDir: string;
}

/** Controller-side evidence after the process exits (SPEC §3.2 step 4). Never throws; missing git output becomes empty files. */
export function collectPostRun(o: CollectPostRunOptions): PostRunVcs {
  fs.mkdirSync(o.outDir, { recursive: true });
  const w = (name: string, content: string) => fs.writeFileSync(path.join(o.outDir, name), content, "utf8");
  const range = `${o.baseSha}..HEAD`;
  const log = runGit(o.worktreePath, ["log", "--format=%H %s", range]).stdout;
  const commits: CommitRecord[] = log
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .map((l) => {
      const sp = l.indexOf(" ");
      return sp > 0 ? { hash: l.slice(0, sp), subject: l.slice(sp + 1) } : { hash: l, subject: "" };
    });
  w("git-log.txt", runGit(o.worktreePath, ["log", "--oneline", range]).stdout);
  const diffStat = runGit(o.worktreePath, ["diff", "--stat", range]).stdout;
  w("diff-stat.txt", diffStat);
  w("diff.patch", runGit(o.worktreePath, ["diff", range]).stdout);
  const changedFiles = runGit(o.worktreePath, ["diff", "--name-only", range])
    .stdout.split(/\r?\n/)
    .filter((s) => s.trim()).length;
  const status = runGit(o.worktreePath, ["status", "--porcelain"]).stdout;
  w("git-status.txt", status);
  const hasUncommitted = status.trim().length > 0;
  if (hasUncommitted) {
    // Tracked changes plus new files (intent-to-add makes untracked files show in `git diff`, then undo it).
    const untracked = status
      .split(/\r?\n/)
      .filter((l) => l.startsWith("??"))
      .map((l) => l.slice(3).trim())
      .filter(Boolean);
    if (untracked.length) runGit(o.worktreePath, ["add", "-N", "--", ...untracked]);
    w("uncommitted.patch", runGit(o.worktreePath, ["diff"]).stdout);
    if (untracked.length) runGit(o.worktreePath, ["reset", "-q", "--", ...untracked]);
  } else if (fs.existsSync(path.join(o.outDir, "uncommitted.patch"))) {
    fs.rmSync(path.join(o.outDir, "uncommitted.patch"));
  }
  const repoStatusAfter = runGit(o.repoPath, ["status", "--porcelain"]).stdout;
  const repoHeadAfter = runGit(o.repoPath, ["rev-parse", "HEAD"]).stdout.trim();
  const repoRootChanged = repoStatusAfter !== o.repoStatusBefore || repoHeadAfter !== o.repoHeadBefore;
  w(
    "repo-check.txt",
    [
      repoRootChanged ? "CHANGED — repo gốc đã thay đổi trong lúc run (kiểm tra lại!)" : "OK — repo gốc không đổi",
      `repo: ${o.repoPath}`,
      `HEAD trước: ${o.repoHeadBefore}`,
      `HEAD sau:   ${repoHeadAfter}`,
      `status trước: ${o.repoStatusBefore.trim() || "(sạch)"}`,
      `status sau:   ${repoStatusAfter.trim() || "(sạch)"}`,
    ].join("\n") + "\n",
  );
  return { commits, changed_files: changedFiles, status, has_uncommitted: hasUncommitted, repo_root_changed: repoRootChanged };
}

export interface RemoveWorktreeOptions {
  repoPath: string;
  worktreePath: string;
  branch: string;
  /** Default true. When false the `tnf/<run-id>` branch is kept (worktree cleanup). */
  deleteBranch?: boolean;
}

/**
 * Delete a run's worktree and its `tnf/<run-id>` branch from the target repo (UI "Dọn worktree", after a two-step
 * confirmation). `--force` so uncommitted leftovers do not block; the branch is deleted with `-D` because its commits
 * are already recorded in the run's artifacts (git-log.txt / diff.patch) and the user explicitly asked.
 */
export function removeWorktree(o: RemoveWorktreeOptions): { worktree_removed: boolean; branch_deleted: boolean; messages: string[] } {
  const messages: string[] = [];
  let worktreeRemoved = false;
  if (fs.existsSync(o.worktreePath)) {
    unlinkNodeModules(o.worktreePath);
    const r = runGit(o.repoPath, ["worktree", "remove", "--force", o.worktreePath]);
    if (r.code !== 0) throw new Error(`Không xóa được worktree: ${r.stderr.trim() || r.stdout.trim()}`);
    worktreeRemoved = true;
  } else {
    messages.push("Thư mục worktree không còn trên đĩa; chỉ dọn bản ghi git.");
  }
  runGit(o.repoPath, ["worktree", "prune"]);
  let branchDeleted = false;
  if (o.deleteBranch === false) {
    messages.push(`Giữ nguyên nhánh ${o.branch}.`);
  } else if (/^tnf\//.test(o.branch)) {
    const b = runGit(o.repoPath, ["branch", "-D", o.branch]);
    if (b.code === 0) branchDeleted = true;
    else messages.push(`Không xóa được nhánh ${o.branch}: ${b.stderr.trim() || b.stdout.trim()}`);
  } else {
    messages.push(`Giữ nguyên nhánh ${o.branch} (chỉ xóa nhánh tnf/...).`);
  }
  return { worktree_removed: worktreeRemoved, branch_deleted: branchDeleted, messages };
}

const COMMIT_ENV = (): NodeJS.ProcessEnv => ({ ...process.env, ...AGENT_GIT_ENV });

/** Merge dependency branches into a fresh worktree using the agent identity (no global git identity needed). */
export function mergeDependencyBranches(worktreePath: string, branches: string[]): void {
  for (const mb of branches) {
    if (!isValidBaseRef(mb)) throw new Error(`Tên nhánh phụ thuộc không hợp lệ: ${mb}`);
    const mr = runGit(worktreePath, ["merge", "--no-edit", mb], COMMIT_ENV());
    if (mr.code !== 0) {
      runGit(worktreePath, ["merge", "--abort"], COMMIT_ENV());
      throw new Error(`Không gộp được nhánh phụ thuộc ${mb} vào worktree mới: ${(mr.stderr || mr.stdout).trim().slice(0, 300)}`);
    }
  }
}

/**
 * Stage everything except `node_modules` (may be a real copy in the worktree) and commit if something is staged.
 * When git already ignores `node_modules`, a plain `add -A` skips it; the exclude pathspec `:!node_modules` is used
 * only otherwise, because git ≥ 2.55 exits 1 ("The following paths are ignored") when that pathspec touches an
 * ignored directory, even with nothing to stage (0.4.1 fix, seen on the "Commit vào main" button).
 */
export function commitAllInWorktree(worktreePath: string, message: string): { committed: boolean; commit: string | null } {
  const ignored = runGit(worktreePath, ["check-ignore", "-q", "node_modules"]).code === 0;
  git(worktreePath, ignored ? ["add", "-A", "--", "."] : ["add", "-A", "--", ".", ":!node_modules"], COMMIT_ENV());
  const q = runGit(worktreePath, ["diff", "--cached", "--quiet"]);
  if (q.code === 0) return { committed: false, commit: git(worktreePath, ["rev-parse", "HEAD"]) };
  git(worktreePath, ["commit", "-m", message], COMMIT_ENV());
  return { committed: true, commit: git(worktreePath, ["rev-parse", "HEAD"]) };
}

export function isRepoClean(repoPath: string): boolean {
  return git(repoPath, ["status", "--porcelain"]) === "";
}

export function currentBranch(repoPath: string): string {
  return git(repoPath, ["rev-parse", "--abbrev-ref", "HEAD"]);
}

/** True when `branch` is an ancestor of `base` (already merged). Missing branch or any git error -> false. */
export function isBranchMerged(repoPath: string, branch: string, base: string): boolean {
  return runGit(repoPath, ["merge-base", "--is-ancestor", branch, base]).code === 0;
}

/** True when `remote` is a configured remote of the repo (no network). Invalid names -> false. */
export function remoteExists(repoPath: string, remote: string): boolean {
  if (!remote || remote.startsWith("-") || /\s/.test(remote)) return false;
  const r = runGit(repoPath, ["remote"]);
  if (r.code !== 0) return false;
  return r.stdout.split(/\r?\n/).some((l) => l.trim() === remote);
}

/** True when `relPath` is tracked by git in the repo (`git ls-files --error-unmatch`). */
export function isTracked(repoPath: string, relPath: string): boolean {
  if (!relPath || relPath.startsWith("-")) return false;
  return runGit(repoPath, ["ls-files", "--error-unmatch", "--", relPath]).code === 0;
}

/**
 * True when HEAD is already contained in `<remote>/<branch>`: asks only the configured remote (`ls-remote`), then checks
 * that the remote tip is a descendant-or-equal of HEAD. Any failure (no remote, no branch, unknown object) -> false.
 */
export function commitInRemote(repoPath: string, remote: string, branch: string): boolean {
  if (!remoteExists(repoPath, remote)) return false;
  if (!branch || branch.startsWith("-")) return false;
  const ls = runGit(repoPath, ["ls-remote", remote, `refs/heads/${branch}`]);
  if (ls.code !== 0) return false;
  const tip = ls.stdout.trim().split(/\s+/)[0] ?? "";
  if (!/^[0-9a-f]{40,64}$/.test(tip)) return false;
  return runGit(repoPath, ["merge-base", "--is-ancestor", "HEAD", tip]).code === 0;
}

/** Stage the given files and commit with the agent identity; returns the new HEAD. */
export function commitFiles(repoPath: string, files: string[], message: string): string {
  git(repoPath, ["add", "--", ...files], COMMIT_ENV());
  git(repoPath, ["commit", "-m", message], COMMIT_ENV());
  return git(repoPath, ["rev-parse", "HEAD"]);
}

/** `git merge --no-ff` into the currently checked-out branch of repoPath; aborts on conflict. Never checks out or pushes. */
export function mergeBranchNoFf(o: { repoPath: string; base: string; branch: string; message: string }): { commit: string } {
  const r = runGit(o.repoPath, ["merge", "--no-ff", "-m", o.message, o.branch], COMMIT_ENV());
  if (r.code !== 0) {
    runGit(o.repoPath, ["merge", "--abort"]);
    throw new Error(`Gộp nhánh ${o.branch} vào ${o.base} bị xung đột hoặc thất bại; đã hủy gộp, repo giữ nguyên. Hãy gộp tay. Chi tiết: ${(r.stdout + r.stderr).trim().slice(0, 300)}`);
  }
  return { commit: git(o.repoPath, ["rev-parse", "HEAD"]) };
}

/** Phase 5.6: `git --version` through PATH (coding runs need git). Returns "x.y.z"; throws a Vietnamese message when missing. */
export function locateGit(env: NodeJS.ProcessEnv = process.env): string {
  const r = runGit(process.cwd(), ["--version"], env);
  const m = /\d+\.\d+(?:\.\d+)?/.exec(r.stdout);
  if (r.code !== 0 || !m) {
    throw new Error("Không tìm thấy `git` trong PATH. Run lập trình cần Git for Windows (https://git-scm.com/download/win); cài xong mở lại ứng dụng.");
  }
  return m[0];
}
