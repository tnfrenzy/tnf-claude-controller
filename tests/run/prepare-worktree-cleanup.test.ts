import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { AGENT_GIT_ENV, createWorktreeAsync, mergeDependencyBranches, removeWorktree, runGit } from "../../src/core/git/git.js";

function g(cwd: string, args: string[]) {
  const r = runGit(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
}

describe("worktree cleanup after failed dependency merge", () => {
  it("leaves no worktree directory, tnf branch or extra worktree entry", async () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pwc-"));
    try {
      const repo = path.join(tmp, "repo");
      fs.mkdirSync(repo);
      g(repo, ["init", "-b", "main"]);
      fs.writeFileSync(path.join(repo, "a.txt"), "base\n");
      g(repo, ["add", "-A"]);
      g(repo, ["commit", "-m", "base"]);
      g(repo, ["checkout", "-b", "dep-a"]);
      fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
      g(repo, ["commit", "-am", "a"]);
      g(repo, ["checkout", "main"]);
      g(repo, ["checkout", "-b", "dep-c"]);
      fs.writeFileSync(path.join(repo, "a.txt"), "c\n");
      g(repo, ["commit", "-am", "c"]);
      g(repo, ["checkout", "main"]);

      const wt = path.join(tmp, "wt");
      await createWorktreeAsync({ repoPath: repo, baseBranch: "dep-a", worktreePath: wt, branch: "tnf/z" });
      let failed = false;
      try {
        mergeDependencyBranches(wt, ["dep-c"]);
      } catch {
        failed = true;
        removeWorktree({ repoPath: repo, worktreePath: wt, branch: "tnf/z" });
      }
      expect(failed).toBe(true);
      expect(fs.existsSync(wt)).toBe(false);
      expect(g(repo, ["branch", "--list", "tnf/*"]).trim()).toBe("");
      expect(g(repo, ["worktree", "list", "--porcelain"]).split("worktree ").filter(Boolean).length).toBe(1);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
