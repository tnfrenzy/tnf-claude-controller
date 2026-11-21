import fs from "node:fs";
import path from "node:path";
import { commitInRemote, currentBranch, isBranchMerged, isRepoClean, isTracked } from "../git/git.js";
import { BASH_MISSING_MSG } from "./bash-locator.js";

export const SCRIPT_TARGET_RE = /^[A-Za-z0-9._-]+@[A-Za-z0-9.-]+$/;

/** Format checks for a project-script step (throws Vietnamese errors). */
export function checkScriptFormat(o: { scriptPath: string; target: string }): void {
  const p = o.scriptPath;
  if (!p || path.isAbsolute(p) || /^[A-Za-z]:/.test(p) || p.startsWith("/") || p.startsWith("\\")) throw new Error("Đường dẫn script phải là đường dẫn tương đối trong repo.");
  if (p.split(/[\\/]/).includes("..")) throw new Error('Đường dẫn script không được chứa "..".');
  if (!p.endsWith(".sh")) throw new Error("Script phải có đuôi .sh.");
  if (!SCRIPT_TARGET_RE.test(o.target)) throw new Error("Target phải có dạng user@host.");
}

export interface ScriptReadyInput {
  repo: string;
  /** Base branch of the project's own repo (not a run worktree). */
  base: string;
  remote: string;
  scriptPath: string;
  target: string;
  keyPath: string;
  bashPath: string | null;
  exists?: (p: string) => boolean;
}

/** Preconditions for project-script; each failure has its own Vietnamese message. */
export function checkScriptReady(o: ScriptReadyInput): void {
  const exists = o.exists ?? fs.existsSync;
  checkScriptFormat(o);
  const cur = currentBranch(o.repo);
  if (cur !== o.base) throw new Error(`Repo đang ở nhánh "${cur}", không phải nhánh base "${o.base}"; không chạy script.`);
  if (!isRepoClean(o.repo)) throw new Error("Repo còn thay đổi chưa commit; không chạy script.");
  if (!commitInRemote(o.repo, o.remote, o.base)) throw new Error(`Commit hiện tại chưa có trong remote "${o.remote}"; hãy đẩy lên trước khi chạy script.`);
  if (!isTracked(o.repo, o.scriptPath)) throw new Error("Script chưa được git theo dõi; hãy commit script vào repo.");
  if (!o.keyPath || !exists(path.resolve(o.repo, o.keyPath))) throw new Error("File khóa SSH không tồn tại.");
  if (!o.bashPath) throw new Error(BASH_MISSING_MSG);
}

/** Repo must be on the base branch and clean. Throws Vietnamese errors (shared by publishRun and the release pipeline). */
export function checkRepoReady(repo: string, base: string): void {
  const cur = currentBranch(repo);
  if (cur !== base) throw new Error(`Repo đích đang ở nhánh "${cur}", không phải nhánh base "${base}"; không thể phát hành.`);
  if (!isRepoClean(repo)) throw new Error("Repo đích còn thay đổi chưa commit; hãy commit hoặc cất chúng trước khi phát hành.");
}

export function checkBranchMerged(repo: string, branch: string, base: string): void {
  if (!isBranchMerged(repo, branch, base)) throw new Error("Nhánh chưa được commit vào main. Hãy commit vào main trước khi phát hành.");
}

/** Without `branch` (no runId) only the base branch and clean state are checked. */
export function checkReleasePreconditions(o: { repo: string; base: string; branch?: string | null }): void {
  checkRepoReady(o.repo, o.base);
  if (o.branch) checkBranchMerged(o.repo, o.branch, o.base);
}
