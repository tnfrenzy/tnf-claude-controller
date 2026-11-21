import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, collectPostRun, commitAllInWorktree, createWorktree, removeWorktree, runGit, validateRepo } from "../../src/core/git/git.js";

let root: string;
let repo: string;

/** Throwaway target repo with one commit on main. */
function makeRepo(): string {
  const r = path.join(root, "repo");
  fs.mkdirSync(r, { recursive: true });
  const g = (args: string[]) => {
    const res = runGit(r, args);
    if (res.code !== 0) throw new Error(res.stderr);
    return res.stdout;
  };
  g(["init", "-b", "main"]);
  g(["config", "core.autocrlf", "false"]);
  g(["config", "user.name", "Test User"]);
  g(["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(r, "README.md"), "# t\n");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  return r;
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-git-"));
  repo = makeRepo();
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("git helper", () => {
  it("AGENT_GIT_ENV names TNF Agent and disables terminal prompts", () => {
    expect(AGENT_GIT_ENV["GIT_AUTHOR_NAME"]).toBe("TNF Agent");
    expect(AGENT_GIT_ENV["GIT_COMMITTER_EMAIL"]).toBe("agent@example.com");
    expect(AGENT_GIT_ENV["GIT_TERMINAL_PROMPT"]).toBe("0");
  });

  it("validateRepo accepts a clean repo with the base branch and reports head/branches", () => {
    const v = validateRepo(repo, "main");
    expect(v.ok).toBe(true);
    expect(v.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(v.dirty).toBe(false);
    expect(v.branches).toContain("main");
    expect(v.error).toBeNull();
  });
  it("validateRepo flags dirty trees but still ok; rejects missing branch, relative path, non-repo", () => {
    fs.writeFileSync(path.join(repo, "x.txt"), "x");
    expect(validateRepo(repo, "main")).toMatchObject({ ok: true, dirty: true });
    expect(validateRepo(repo, "nope")).toMatchObject({ ok: false });
    expect(validateRepo(repo, "nope").error).toMatch(/nhánh/i);
    expect(validateRepo("relative/path", "main").error).toMatch(/tuyệt đối/);
    expect(validateRepo(root, "main").ok).toBe(false);
    const sub = path.join(repo, "sub");
    fs.mkdirSync(sub);
    expect(validateRepo(sub, "main").error).toMatch(/gốc/);
  });

  it("createWorktree branches from base, excludes notes/, and collectPostRun gathers evidence", () => {
    const wt = path.join(root, "worktrees", "run-1");
    const base = createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: "tnf/run-1" });
    expect(base).toBe(validateRepo(repo, "main").head_sha);
    expect(runGit(wt, ["branch", "--show-current"]).stdout.trim()).toBe("tnf/run-1");
    const excludeFile = path.resolve(wt, runGit(wt, ["rev-parse", "--git-path", "info"]).stdout.trim(), "exclude");
    expect(fs.readFileSync(excludeFile, "utf8")).toContain("notes/");

    const repoStatusBefore = runGit(repo, ["status", "--porcelain"]).stdout;
    const repoHeadBefore = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();

    // Agent-like commit with the controller-provided identity, plus one uncommitted file and an ignored notes/ dir.
    fs.mkdirSync(path.join(wt, "src"));
    fs.writeFileSync(path.join(wt, "src", "sub.js"), "export const sub = (a, b) => a - b;\n");
    const env = { ...process.env, ...AGENT_GIT_ENV };
    expect(runGit(wt, ["add", "-A"], env).code).toBe(0);
    expect(runGit(wt, ["commit", "-m", "feat(math): add sub"], env).code).toBe(0);
    fs.writeFileSync(path.join(wt, "README.md"), "# t\nchanged\n");
    fs.mkdirSync(path.join(wt, "notes"));
    fs.writeFileSync(path.join(wt, "notes", "plan.md"), "plan");

    const out = path.join(root, "run-dir");
    const r = collectPostRun({ worktreePath: wt, baseSha: base, repoPath: repo, repoStatusBefore, repoHeadBefore, outDir: out });
    expect(r.commits).toHaveLength(1);
    expect(r.commits[0]!.subject).toBe("feat(math): add sub");
    expect(r.commits[0]!.hash).toMatch(/^[0-9a-f]{7,40}$/);
    expect(r.changed_files).toBe(1);
    expect(r.has_uncommitted).toBe(true);
    expect(r.status).toContain("README.md");
    expect(r.status).not.toContain("notes/");
    expect(r.repo_root_changed).toBe(false);
    expect(runGit(wt, ["log", "-1", "--format=%an <%ae>"]).stdout.trim()).toBe("TNF Agent <agent@example.com>");
    expect(fs.readFileSync(path.join(out, "diff.patch"), "utf8")).toContain("src/sub.js");
    expect(fs.readFileSync(path.join(out, "diff-stat.txt"), "utf8")).toMatch(/1 file changed/);
    expect(fs.readFileSync(path.join(out, "uncommitted.patch"), "utf8")).toContain("changed");
    expect(fs.readFileSync(path.join(out, "repo-check.txt"), "utf8")).toMatch(/^OK/);
    expect(fs.existsSync(path.join(out, "git-log.txt"))).toBe(true);
    // original repo untouched
    expect(runGit(repo, ["status", "--porcelain"]).stdout).toBe("");
    expect(runGit(repo, ["rev-parse", "HEAD"]).stdout.trim()).toBe(repoHeadBefore);
  });

  it("collectPostRun reports a changed original repo and no uncommitted.patch when clean", () => {
    const wt = path.join(root, "worktrees", "run-2");
    const base = createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: "tnf/run-2" });
    const before = runGit(repo, ["status", "--porcelain"]).stdout;
    const head = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();
    fs.writeFileSync(path.join(repo, "oops.txt"), "x"); // something touched the original repo
    const out = path.join(root, "run-dir-2");
    const r = collectPostRun({ worktreePath: wt, baseSha: base, repoPath: repo, repoStatusBefore: before, repoHeadBefore: head, outDir: out });
    expect(r.repo_root_changed).toBe(true);
    expect(r.commits).toEqual([]);
    expect(r.has_uncommitted).toBe(false);
    expect(fs.existsSync(path.join(out, "uncommitted.patch"))).toBe(false);
    expect(fs.readFileSync(path.join(out, "repo-check.txt"), "utf8")).toMatch(/^CHANGED/);
  });

  it("createWorktree throws a Vietnamese error when the branch already exists", () => {
    const wt = path.join(root, "worktrees", "run-3");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: "tnf/run-3" });
    expect(() => createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt + "b", branch: "tnf/run-3" })).toThrow(/git worktree add/);
  });

  it("createWorktree leaves node_modules to provisionNodeModules (tests/node-modules.test.ts); removeWorktree keeps the original", () => {
    fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["commit", "-m", "chore: ignore node_modules"], { ...process.env, ...AGENT_GIT_ENV });
    fs.mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1;\n");

    const wt = path.join(root, "worktrees", "run-4");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: "tnf/run-4" });
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);
    const r = removeWorktree({ repoPath: repo, worktreePath: wt, branch: "tnf/run-4" });
    expect(r.worktree_removed).toBe(true);
    expect(fs.existsSync(wt)).toBe(false);
    expect(fs.existsSync(path.join(repo, "node_modules", "dep", "index.js"))).toBe(true);
  });

  it("commitAllInWorktree tolerates a copied, git-ignored node_modules (git 2.55 exits 1 on ':!node_modules' there)", () => {
    fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["commit", "-m", "chore: ignore node_modules"], { ...process.env, ...AGENT_GIT_ENV });
    const wt = path.join(root, "worktrees", "run-6");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: "tnf/run-6" });
    fs.mkdirSync(path.join(wt, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(wt, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
    // nothing to stage: must not throw and must not commit
    const head = runGit(wt, ["rev-parse", "HEAD"]).stdout.trim();
    const none = commitAllInWorktree(wt, "chore(tnf): finalize run-6");
    expect(none).toEqual({ committed: false, commit: head });
    // leftovers get committed, node_modules stays out of the tree
    fs.writeFileSync(path.join(wt, "left.txt"), "x\n");
    const some = commitAllInWorktree(wt, "chore(tnf): finalize run-6");
    expect(some.committed).toBe(true);
    expect(runGit(wt, ["ls-files"]).stdout).toContain("left.txt");
    expect(runGit(wt, ["ls-files"]).stdout).not.toContain("node_modules");
    // repo without .gitignore: the exclude pathspec keeps node_modules out
    const wt2 = path.join(root, "worktrees", "run-7");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt2, branch: "tnf/run-7" });
    fs.rmSync(path.join(wt2, ".gitignore"));
    fs.mkdirSync(path.join(wt2, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(wt2, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
    fs.writeFileSync(path.join(wt2, "left.txt"), "x\n");
    expect(commitAllInWorktree(wt2, "chore(tnf): finalize run-7").committed).toBe(true);
    expect(runGit(wt2, ["ls-files"]).stdout).not.toContain("node_modules/dep");
  });

  it("removeWorktree keeps the branch with deleteBranch:false and deletes it by default", () => {
    const keep = path.join(root, "worktrees", "run-8");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: keep, branch: "tnf/run-8" });
    const r1 = removeWorktree({ repoPath: repo, worktreePath: keep, branch: "tnf/run-8", deleteBranch: false });
    expect(r1.worktree_removed).toBe(true);
    expect(r1.branch_deleted).toBe(false);
    expect(fs.existsSync(keep)).toBe(false);
    expect(runGit(repo, ["branch", "--list", "tnf/run-8"]).stdout).toContain("tnf/run-8");

    const del = path.join(root, "worktrees", "run-9");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: del, branch: "tnf/run-9" });
    const r2 = removeWorktree({ repoPath: repo, worktreePath: del, branch: "tnf/run-9" });
    expect(r2.branch_deleted).toBe(true);
    expect(runGit(repo, ["branch", "--list", "tnf/run-9"]).stdout.trim()).toBe("");
  });

  it("createWorktree does not create node_modules when the repo has none", () => {
    const wt = path.join(root, "worktrees", "run-5");
    createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: "tnf/run-5" });
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);
  });
});
