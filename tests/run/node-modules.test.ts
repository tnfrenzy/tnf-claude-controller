import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, createWorktree, removeWorktree, runGit } from "../../src/core/git/git.js";
import { canRead } from "../helpers/junction.js";
import { DEFAULT_NODE_MODULES, measureDir, provisionNodeModules, type NodeModulesConfig } from "../../src/core/git/node-modules.js";

let root: string;
let repo: string;
let n = 0;

const g = (cwd: string, args: string[]) => {
  const res = runGit(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
  if (res.code !== 0) throw new Error(res.stderr);
  return res.stdout;
};

/** Target repo whose `node_modules` is git-ignored and holds a few real files (a Node project). */
function makeNodeRepo(ignored = true): string {
  const r = path.join(root, "repo");
  fs.mkdirSync(r, { recursive: true });
  g(r, ["init", "-b", "main"]);
  g(r, ["config", "core.autocrlf", "false"]);
  fs.writeFileSync(path.join(r, "README.md"), "# t\n");
  if (ignored) fs.writeFileSync(path.join(r, ".gitignore"), "node_modules/\n");
  g(r, ["add", "-A"]);
  g(r, ["commit", "-m", "init"]);
  fs.mkdirSync(path.join(r, "node_modules", "dep", "lib"), { recursive: true });
  fs.writeFileSync(path.join(r, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
  fs.writeFileSync(path.join(r, "node_modules", "dep", "lib", "util.js"), "x".repeat(2000));
  return r;
}

function newWorktree(): string {
  const wt = path.join(root, "worktrees", `run-${++n}`);
  createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch: `tnf/run-${n}` });
  return wt;
}

const cfg = (over: Partial<NodeModulesConfig> = {}): NodeModulesConfig => ({ ...DEFAULT_NODE_MODULES, ...over });

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-nm-"));
  repo = makeNodeRepo();
});
afterEach(() => fs.rmSync(root, { recursive: true, force: true }));

describe("measureDir", () => {
  it("sums file sizes and counts files", () => {
    const m = measureDir(path.join(repo, "node_modules"), 1_000_000);
    expect(m).toEqual({ bytes: 2000 + "module.exports = 1;\n".length, files: 2, exceeded: false });
  });
  it("stops early and reports exceeded once the cap is passed", () => {
    expect(measureDir(path.join(repo, "node_modules"), 1000).exceeded).toBe(true);
  });
});

describe("provisionNodeModules – copy (default)", () => {
  it("createWorktree itself no longer touches node_modules", () => {
    const wt = newWorktree();
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);
  });

  it("copies real files (not a link), keeps git clean, and removeWorktree leaves the original intact", async () => {
    const wt = newWorktree();
    const r = await provisionNodeModules(repo, wt, cfg());
    expect(r.action).toBe("copied");
    expect(r.files).toBe(2);
    const dst = path.join(wt, "node_modules");
    expect(fs.lstatSync(dst).isSymbolicLink()).toBe(false);
    expect(fs.lstatSync(dst).isDirectory()).toBe(true);
    expect(fs.readFileSync(path.join(dst, "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(fs.readFileSync(path.join(dst, "dep", "lib", "util.js"), "utf8")).toHaveLength(2000);
    expect(runGit(wt, ["status", "--porcelain"]).stdout).toBe("");
    // editing the copy must not touch the original
    fs.writeFileSync(path.join(dst, "dep", "index.js"), "changed");
    expect(fs.readFileSync(path.join(repo, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");

    const removed = removeWorktree({ repoPath: repo, worktreePath: wt, branch: `tnf/run-${n}` });
    expect(removed.worktree_removed).toBe(true);
    expect(fs.existsSync(wt)).toBe(false);
    expect(fs.readFileSync(path.join(repo, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
  });

  it("is a no-op when the worktree already has node_modules", async () => {
    const wt = newWorktree();
    fs.mkdirSync(path.join(wt, "node_modules"));
    const r = await provisionNodeModules(repo, wt, cfg());
    expect(r.action).toBe("skipped");
    expect(fs.readdirSync(path.join(wt, "node_modules"))).toEqual([]);
  });
});

describe("provisionNodeModules – size cap and fallback", () => {
  // skipped in sandboxes that cannot read through junctions (UNKNOWN -4094)
  it.skipIf(!canRead)("falls back to a junction/symlink when the folder is over the cap, and says why", async () => {
    const wt = newWorktree();
    const r = await provisionNodeModules(repo, wt, cfg({ maxBytes: 1000 }));
    expect(r.action).toBe("linked");
    expect(r.reason).toMatch(/trần/);
    expect(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(wt, "node_modules", "dep", "index.js"), "utf8")).toContain("module.exports");
    // the link is removed, never the original
    removeWorktree({ repoPath: repo, worktreePath: wt, branch: `tnf/run-${n}` });
    expect(fs.existsSync(wt)).toBe(false);
    expect(fs.existsSync(path.join(repo, "node_modules", "dep", "index.js"))).toBe(true);
  });

  it("falls back to a link and cleans the partial copy when copying fails", async () => {
    const wt = newWorktree();
    const failing = async (_src: string, dst: string) => {
      fs.mkdirSync(path.join(dst, "half"), { recursive: true });
      throw new Error("disk full");
    };
    const r = await provisionNodeModules(repo, wt, cfg(), { copyDir: failing });
    expect(r.action).toBe("linked");
    expect(r.reason).toMatch(/disk full/);
    expect(fs.lstatSync(path.join(wt, "node_modules")).isSymbolicLink()).toBe(true);
    expect(fs.existsSync(path.join(wt, "node_modules", "half"))).toBe(false);
  });

  it("mode junction always links, mode none does nothing", async () => {
    const a = newWorktree();
    expect((await provisionNodeModules(repo, a, cfg({ mode: "junction" }))).action).toBe("linked");
    expect(fs.lstatSync(path.join(a, "node_modules")).isSymbolicLink()).toBe(true);
    const b = newWorktree();
    expect((await provisionNodeModules(repo, b, cfg({ mode: "none" }))).action).toBe("skipped");
    expect(fs.existsSync(path.join(b, "node_modules"))).toBe(false);
  });
});

describe("provisionNodeModules – when not to touch anything", () => {
  it("skips when the repo has no node_modules", async () => {
    fs.rmSync(path.join(repo, "node_modules"), { recursive: true, force: true });
    const wt = newWorktree();
    const r = await provisionNodeModules(repo, wt, cfg());
    expect(r.action).toBe("skipped");
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);
  });

  it("skips when git does not ignore node_modules (the copy would show up in the agent's diff)", async () => {
    fs.rmSync(root, { recursive: true, force: true });
    fs.mkdirSync(root, { recursive: true });
    repo = makeNodeRepo(false);
    const wt = newWorktree();
    const r = await provisionNodeModules(repo, wt, cfg());
    expect(r.action).toBe("skipped");
    expect(r.reason).toMatch(/gitignore|bỏ qua/i);
    expect(fs.existsSync(path.join(wt, "node_modules"))).toBe(false);
  });
});
