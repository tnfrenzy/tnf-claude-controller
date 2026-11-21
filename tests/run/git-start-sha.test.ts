import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createWorktree, isCommitOnBranch, isFullCommitSha, runGit } from "../../src/core/git/git.js";

let root: string;
let repo: string;
let shas: string[]; // main commits: [init, second, third]

function g(cwd: string, args: string[]): string {
  const res = runGit(cwd, args);
  if (res.code !== 0) throw new Error(res.stderr);
  return res.stdout.trim();
}

function commitFile(cwd: string, name: string): string {
  fs.writeFileSync(path.join(cwd, name), name + "\n");
  g(cwd, ["add", "-A"]);
  g(cwd, ["commit", "-m", "add " + name]);
  return g(cwd, ["rev-parse", "HEAD"]);
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-gitsha-"));
  repo = path.join(root, "repo");
  fs.mkdirSync(repo, { recursive: true });
  g(repo, ["init", "-b", "main"]);
  g(repo, ["config", "core.autocrlf", "false"]);
  g(repo, ["config", "user.name", "Test User"]);
  g(repo, ["config", "user.email", "test@example.com"]);
  shas = [commitFile(repo, "a.txt"), commitFile(repo, "b.txt"), commitFile(repo, "c.txt")];
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

const wt = (name: string) => path.join(root, "wt", name);
const branchExists = (b: string) => runGit(repo, ["rev-parse", "--verify", "--quiet", "refs/heads/" + b]).code === 0;

describe("isFullCommitSha", () => {
  it("accepts only 40 lowercase hex characters", () => {
    expect(isFullCommitSha("a".repeat(40))).toBe(true);
    expect(isFullCommitSha(shas[1]!)).toBe(true);
    expect(isFullCommitSha("a".repeat(39))).toBe(false);
    expect(isFullCommitSha("a".repeat(41))).toBe(false);
    expect(isFullCommitSha("A".repeat(40))).toBe(false);
    expect(isFullCommitSha("g".repeat(40))).toBe(false);
    expect(isFullCommitSha("HEAD~1")).toBe(false);
    expect(isFullCommitSha("main")).toBe(false);
    expect(isFullCommitSha("")).toBe(false);
  });
});

describe("createWorktree startSha", () => {
  it("creates the branch at a mid-branch sha", () => {
    const p = wt("mid");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: p, branch: "tnf/proj/mid", startSha: shas[1] });
    expect(g(p, ["rev-parse", "HEAD"])).toBe(shas[1]);
    expect(branchExists("tnf/proj/mid")).toBe(true);
  });

  it("without startSha starts at the head of the base branch", () => {
    const p = wt("base");
    const base = createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: p, branch: "tnf/proj/base" });
    expect(base).toBe(shas[2]);
    expect(g(p, ["rev-parse", "HEAD"])).toBe(shas[2]);
  });

  it("rejects arbitrary refs and short shas before creating anything", () => {
    for (const [i, bad] of ["main", "HEAD~1", shas[1]!.slice(0, 7), shas[1]!.toUpperCase()].entries()) {
      const p = wt("bad" + i);
      const branch = "tnf/proj/bad" + i;
      expect(() => createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: p, branch, startSha: bad })).toThrow(/startSha/);
      expect(branchExists(branch)).toBe(false);
      expect(fs.existsSync(p)).toBe(false);
    }
    expect(fs.existsSync(path.join(root, "wt"))).toBe(false);
  });

  it("fails on an existing branch name and leaves the old branch untouched", () => {
    g(repo, ["branch", "tnf/proj/dup", shas[0]!]);
    expect(() =>
      createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt("dup"), branch: "tnf/proj/dup", startSha: shas[1] }),
    ).toThrow();
    expect(g(repo, ["rev-parse", "refs/heads/tnf/proj/dup"])).toBe(shas[0]);
  });
});

describe("isCommitOnBranch", () => {
  it("true for a sha on the run branch, false otherwise", () => {
    const p = wt("run");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: p, branch: "tnf/proj/run", startSha: shas[1] });
    const own = commitFile(p, "run.txt");
    expect(isCommitOnBranch(repo, shas[1]!, "tnf/proj/run")).toBe(true);
    expect(isCommitOnBranch(repo, own, "tnf/proj/run")).toBe(true);
    // shas[2] lives only on main, not on the run branch
    expect(isCommitOnBranch(repo, shas[2]!, "tnf/proj/run")).toBe(false);
  });

  it("false for malformed shas and for non-run branch names", () => {
    g(repo, ["branch", "tnf/proj/other", shas[2]!]);
    expect(isCommitOnBranch(repo, "HEAD~1", "tnf/proj/other")).toBe(false);
    expect(isCommitOnBranch(repo, "main", "tnf/proj/other")).toBe(false);
    expect(isCommitOnBranch(repo, shas[0]!.slice(0, 7), "tnf/proj/other")).toBe(false);
    expect(isCommitOnBranch(repo, shas[0]!, "main")).toBe(false);
    expect(isCommitOnBranch(repo, shas[0]!, "tnf/../main")).toBe(false);
    expect(isCommitOnBranch(repo, shas[0]!, "tnf/proj/other")).toBe(true);
  });
});
