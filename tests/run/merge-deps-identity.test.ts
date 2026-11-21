import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_GIT_ENV, createWorktreeAsync, mergeDependencyBranches, runGit } from "../../src/core/git/git.js";

const SAVED = { ...process.env };
let tmp: string;
let repo: string;

function g(cwd: string, args: string[]) {
  const r = runGit(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

function commitFile(cwd: string, file: string, text: string, msg: string) {
  fs.writeFileSync(path.join(cwd, file), text);
  g(cwd, ["add", "-A"]);
  g(cwd, ["commit", "-m", msg]);
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mdi-"));
  const empty = path.join(tmp, "empty.gitconfig");
  fs.writeFileSync(empty, "");
  process.env.HOME = tmp;
  process.env.USERPROFILE = tmp;
  process.env.GIT_CONFIG_GLOBAL = empty;
  process.env.GIT_CONFIG_NOSYSTEM = "1";
  delete process.env.GIT_AUTHOR_NAME;
  delete process.env.GIT_COMMITTER_NAME;
  delete process.env.GIT_AUTHOR_EMAIL;
  delete process.env.GIT_COMMITTER_EMAIL;
  repo = path.join(tmp, "repo");
  fs.mkdirSync(repo);
  g(repo, ["init", "-b", "main"]);
  commitFile(repo, "base.txt", "base\n", "base");
  g(repo, ["checkout", "-b", "dep-a"]);
  commitFile(repo, "a.txt", "a\n", "a");
  g(repo, ["checkout", "main"]);
  g(repo, ["checkout", "-b", "dep-b"]);
  commitFile(repo, "b.txt", "b\n", "b");
  g(repo, ["checkout", "main"]);
  g(repo, ["checkout", "-b", "dep-c"]);
  commitFile(repo, "a.txt", "conflict\n", "c");
  g(repo, ["checkout", "main"]);
});

afterEach(() => {
  for (const k of Object.keys(process.env)) if (!(k in SAVED)) delete process.env[k];
  Object.assign(process.env, SAVED);
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("mergeDependencyBranches", () => {
  it("merges diverged branches without a global git identity, author TNF Agent", async () => {
    const wt = path.join(tmp, "wt");
    await createWorktreeAsync({ repoPath: repo, baseBranch: "dep-a", worktreePath: wt, branch: "tnf/x" });
    mergeDependencyBranches(wt, ["dep-b"]);
    const log = g(wt, ["log", "-1", "--format=%an|%cn|%p"]).trim();
    expect(log.startsWith("TNF Agent|TNF Agent|")).toBe(true);
    expect(log.split("|")[2].split(" ").length).toBe(2);
  });

  it("throws on conflict and leaves no merge in progress", async () => {
    const wt = path.join(tmp, "wt2");
    await createWorktreeAsync({ repoPath: repo, baseBranch: "dep-a", worktreePath: wt, branch: "tnf/y" });
    expect(() => mergeDependencyBranches(wt, ["dep-c"])).toThrow("Không gộp được nhánh phụ thuộc");
    const gitDir = g(wt, ["rev-parse", "--git-dir"]).trim();
    const abs = path.isAbsolute(gitDir) ? gitDir : path.join(wt, gitDir);
    expect(fs.existsSync(path.join(abs, "MERGE_HEAD"))).toBe(false);
  });
});
