import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, createWorktree, runGit } from "../../src/core/git/git.js";
import type { RunRecord } from "../../src/core/run/run-store.js";
import { buildCleanupPlan, parseOlderThan } from "../../src/core/git/cleanup-plan.js";
import { executeCleanup, planCleanup } from "../../src/core/git/worktree-cleanup.js";
import { canRead } from "../helpers/junction.js";

let root: string;
let repo: string;
let worktreesDir: string;

const DAY = 86_400_000;
const NOW = Date.UTC(2026, 10, 3);

/** Throwaway target repo with one commit on main (copied from tests/git.test.ts, where it is not exported). */
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

function mkWorktree(id: string): { wt: string; branch: string } {
  const wt = path.join(worktreesDir, "proj", id);
  const branch = `tnf/proj/${id}`;
  createWorktree({ repoPath: repo, baseBranch: "main", worktreePath: wt, branch });
  return { wt, branch };
}

function run(id: string, wt: string | null, branch: string | null, over: Partial<RunRecord> = {}): RunRecord {
  return { id, status: "done", project: "proj", kind: "coding", worktree_path: wt, branch, updated_at: NOW - 30 * DAY, created_at: NOW - 31 * DAY, ...over } as RunRecord;
}

const getRepoPath = (name: string) => (name === "proj" ? { repoPath: repo, baseBranch: "main" } : null);

function plan(runs: RunRecord[], active: string[] = []) {
  return planCleanup({ runs, olderThanDays: 7, now: NOW, activeRunIds: active, worktreesDir, getRepoPath });
}

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-wtc-"));
  repo = makeRepo();
  worktreesDir = path.join(root, "worktrees");
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("planCleanup", () => {
  it("skips a running run as active", async () => {
    const { wt, branch } = mkWorktree("r1");
    const p = await plan([run("r1", wt, branch, { status: "running" })]);
    expect(p.candidates).toEqual([]);
    expect(p.skipped).toEqual([{ runId: "r1", reason: "active", severity: "info" }]);
  });

  it("skips a run whose id is in activeRunIds", async () => {
    const { wt, branch } = mkWorktree("r1b");
    const p = await plan([run("r1b", wt, branch)], ["r1b"]);
    expect(p.candidates).toEqual([]);
    expect(p.skipped[0]!.reason).toBe("active");
  });

  it("only warns about uncommitted changes", async () => {
    const { wt, branch } = mkWorktree("r2");
    fs.writeFileSync(path.join(wt, "new.txt"), "x\n");
    const p = await plan([run("r2", wt, branch)]);
    expect(p.candidates).toEqual([]);
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0]).toMatchObject({ runId: "r2", reason: "uncommitted", severity: "warn" });
  });

  it("lists a merged, clean worktree with a size estimate", async () => {
    const { wt, branch } = mkWorktree("r3");
    const p = await plan([run("r3", wt, branch)]);
    expect(p.skipped).toEqual([]);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]).toMatchObject({ runIds: ["r3"], worktreePath: wt, branch, repoPath: repo, baseBranch: "main" });
    expect(p.candidates[0]!.estimatedBytes).toBeGreaterThan(0);
    expect(p.totalBytes).toBe(p.candidates[0]!.estimatedBytes);
  });

  it("does not warn about a real node_modules folder in the worktree", async () => {
    const { wt, branch } = mkWorktree("r4");
    fs.mkdirSync(path.join(wt, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(wt, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
    const p = await plan([run("r4", wt, branch)]);
    expect(p.skipped).toEqual([]);
    expect(p.candidates).toHaveLength(1);
  });

  it("skips a run newer than the threshold", async () => {
    const { wt, branch } = mkWorktree("r5");
    const p = await plan([run("r5", wt, branch, { updated_at: NOW - 2 * DAY })]);
    expect(p.candidates).toEqual([]);
    expect(p.skipped[0]).toMatchObject({ runId: "r5", reason: "too_recent" });
  });

  it("skips a shared worktree when one of its runs is not eligible", async () => {
    const { wt, branch } = mkWorktree("r6");
    const p = await plan([run("r6", wt, branch), run("r6-follow", wt, branch, { status: "running" })]);
    expect(p.candidates).toEqual([]);
    expect(p.skipped.map((s) => [s.runId, s.reason]).sort()).toEqual([
      ["r6", "shared_worktree"],
      ["r6-follow", "active"],
    ]);
  });

  it("warns about a branch with commits not merged into base", async () => {
    const { wt, branch } = mkWorktree("r7");
    fs.writeFileSync(path.join(wt, "feat.txt"), "f\n");
    const env = { ...process.env, ...AGENT_GIT_ENV };
    expect(runGit(wt, ["add", "-A"], env).code).toBe(0);
    expect(runGit(wt, ["commit", "-m", "feat: x"], env).code).toBe(0);
    const p = await plan([run("r7", wt, branch)]);
    expect(p.candidates).toEqual([]);
    expect(p.skipped[0]).toMatchObject({ runId: "r7", reason: "unmerged", severity: "warn" });
  });

  it("skips runs without worktree or branch and never calls isBranchMerged with null", async () => {
    let calls = 0;
    const p = await planCleanup({
      runs: [run("a", null, null), run("b", path.join(worktreesDir, "proj", "b"), null)],
      olderThanDays: 7,
      now: NOW,
      worktreesDir,
      getRepoPath,
      deps: {
        isBranchMerged: () => {
          calls++;
          return true;
        },
      },
    });
    expect(p.candidates).toEqual([]);
    expect(p.skipped.map((s) => [s.runId, s.reason])).toEqual([
      ["a", "no_worktree"],
      ["b", "no_branch"],
    ]);
    expect(calls).toBe(0);
  });

  it("treats a failing git status as unknown, not as clean, and does not throw", async () => {
    const { wt, branch } = mkWorktree("r8");
    const p = await planCleanup({
      runs: [run("r8", wt, branch)],
      olderThanDays: 7,
      now: NOW,
      worktreesDir,
      getRepoPath,
      deps: { worktreeStatus: () => ({ ok: false, dirty: false, detail: "boom" }) },
    });
    expect(p.candidates).toEqual([]);
    expect(p.skipped[0]).toMatchObject({ runId: "r8", reason: "status_unknown", severity: "warn" });
  });

  it("catches a throwing dependency per run", async () => {
    const a = mkWorktree("r9");
    const b = mkWorktree("r10");
    let n = 0;
    const p = await planCleanup({
      runs: [run("r9", a.wt, a.branch), run("r10", b.wt, b.branch)],
      olderThanDays: 7,
      now: NOW,
      worktreesDir,
      getRepoPath,
      deps: {
        isBranchMerged: () => {
          if (n++ === 0) throw new Error("kaboom");
          return true;
        },
      },
    });
    expect(p.skipped).toHaveLength(1);
    expect(p.skipped[0]).toMatchObject({ reason: "error", severity: "warn", detail: "kaboom" });
    expect(p.candidates).toHaveLength(1);
  });

  it("skips worktrees outside the worktrees dir and runs of unknown projects", async () => {
    const { wt, branch } = mkWorktree("r11");
    const p1 = await planCleanup({ runs: [run("r11", wt, branch)], olderThanDays: 7, now: NOW, worktreesDir: path.join(root, "elsewhere"), getRepoPath });
    expect(p1.skipped[0]!.reason).toBe("outside_worktrees_dir");
    const p2 = await plan([run("r11", wt, branch, { project: "ghost" })]);
    expect(p2.skipped[0]!.reason).toBe("no_project");
  });
});

const branchExists = (b: string) => runGit(repo, ["branch", "--list", b]).stdout.trim().length > 0;

function exec(p: Awaited<ReturnType<typeof plan>>, over: { dryRun?: boolean; activeRunIds?: string[] } = {}) {
  return executeCleanup({ plan: p, workspaceDir: path.join(root, "ws"), olderThanDays: 7, now: NOW, ...over });
}

describe("executeCleanup", () => {
  it("dryRun deletes nothing but reports what would go", async () => {
    const { wt, branch } = mkWorktree("e1");
    const p = await plan([run("e1", wt, branch)]);
    const r = await exec(p, { dryRun: true });
    expect(r.results).toMatchObject([{ runId: "e1", status: "dry-run" }]);
    expect(fs.existsSync(wt)).toBe(true);
    expect(branchExists(branch)).toBe(true);
  });

  it("removes the worktree and keeps the tnf branch", async () => {
    const { wt, branch } = mkWorktree("e2");
    const p = await plan([run("e2", wt, branch)]);
    const r = await exec(p);
    expect(r.results).toMatchObject([{ runId: "e2", status: "removed" }]);
    expect(fs.existsSync(wt)).toBe(false);
    expect(branchExists(branch)).toBe(true);
  });

  it("a failing run does not stop the next one and nothing throws", async () => {
    const a = mkWorktree("e3");
    const b = mkWorktree("e4");
    const p = await plan([run("e3", a.wt, a.branch), run("e4", b.wt, b.branch)]);
    p.candidates[0]!.repoPath = path.join(root, "no-such-repo");
    const r = await exec(p);
    expect(r.results.map((x) => [x.runId, x.status])).toEqual([
      ["e3", "failed"],
      ["e4", "removed"],
    ]);
    expect(r.results[0]!.error).toBeTruthy();
    expect(fs.existsSync(b.wt)).toBe(false);
  });

  it("removes old inbox-staging dirs and keeps recent and active ones", async () => {
    const dir = path.join(root, "ws", "inbox-staging");
    for (const n of ["old", "new", "busy"]) {
      fs.mkdirSync(path.join(dir, n), { recursive: true });
      fs.writeFileSync(path.join(dir, n, "f.txt"), "x");
    }
    const old = new Date(NOW - 30 * DAY);
    fs.utimesSync(path.join(dir, "old"), old, old);
    fs.utimesSync(path.join(dir, "busy"), old, old);
    fs.utimesSync(path.join(dir, "new"), new Date(NOW - DAY), new Date(NOW - DAY));
    const dry = await exec({ candidates: [], skipped: [], totalBytes: 0 }, { dryRun: true, activeRunIds: ["busy"] });
    expect(dry.inboxRemoved).toEqual([path.join(dir, "old")]);
    expect(fs.existsSync(path.join(dir, "old"))).toBe(true);
    const r = await exec({ candidates: [], skipped: [], totalBytes: 0 }, { activeRunIds: ["busy"] });
    expect(r.inboxRemoved).toEqual([path.join(dir, "old")]);
    expect(fs.existsSync(path.join(dir, "old"))).toBe(false);
    expect(fs.existsSync(path.join(dir, "new"))).toBe(true);
    expect(fs.existsSync(path.join(dir, "busy"))).toBe(true);
  });

  it("skips a run that became active after the plan was made", async () => {
    const { wt, branch } = mkWorktree("e5");
    const p = await plan([run("e5", wt, branch)]);
    const r = await exec(p, { activeRunIds: ["e5"] });
    expect(r.results).toMatchObject([{ runId: "e5", status: "skipped", detail: "active_now" }]);
    expect(fs.existsSync(wt)).toBe(true);
  });

  // Skipped on sandboxes where junctions are unreadable (UNKNOWN -4094 / EPERM); that is an environment limit, not a bug.
  it.skipIf(!canRead)("unlinks the node_modules junction without touching the source node_modules (skipped when junctions are unreadable)", async () => {
    const { wt, branch } = mkWorktree("j1");
    const srcNm = path.join(repo, "node_modules");
    fs.mkdirSync(path.join(srcNm, "pkg"), { recursive: true });
    fs.writeFileSync(path.join(srcNm, "pkg", "index.js"), "module.exports = 1;\n");
    const bigSize = 300_000;
    fs.writeFileSync(path.join(srcNm, "pkg", "big.bin"), Buffer.alloc(bigSize, 1));
    const link = path.join(wt, "node_modules");
    fs.symlinkSync(srcNm, link, "junction");
    expect(fs.lstatSync(link).isSymbolicLink()).toBe(true);

    const p = await plan([run("j1", wt, branch)]);
    expect(p.skipped).toEqual([]);
    expect(p.candidates).toHaveLength(1);
    expect(p.candidates[0]!.estimatedBytes).toBeLessThan(bigSize);

    const r = await exec(p);
    expect(r.results).toMatchObject([{ runId: "j1", status: "removed" }]);
    expect(fs.existsSync(wt)).toBe(false);
    expect(branchExists(branch)).toBe(true);
    expect(fs.readFileSync(path.join(srcNm, "pkg", "index.js"), "utf8")).toBe("module.exports = 1;\n");
    expect(fs.statSync(path.join(srcNm, "pkg", "big.bin")).size).toBe(bigSize);
  });

  it("skips a worktree that got uncommitted files after the plan was made", async () => {
    const { wt, branch } = mkWorktree("e6");
    const p = await plan([run("e6", wt, branch)]);
    fs.writeFileSync(path.join(wt, "late.txt"), "x\n");
    const r = await exec(p);
    expect(r.results).toMatchObject([{ runId: "e6", status: "skipped", detail: "uncommitted_now" }]);
    expect(fs.existsSync(wt)).toBe(true);
  });
});

describe("parseOlderThan", () => {
  it("defaults to 14 and accepts only positive integer strings", () => {
    expect(parseOlderThan(undefined)).toBe(14);
    for (const bad of ["0", "abc", "-1", "1.5"]) expect(parseOlderThan(bad)).toBeNull();
    expect(parseOlderThan("7")).toBe(7);
  });
});

describe("buildCleanupPlan", () => {
  it("marks running runs active and returns execute options", async () => {
    const runs = [run("b1", null, null, { status: "running" })];
    const store = { listRuns: () => runs, getProject: () => undefined } as never;
    const config = { workspaceDir: path.join(root, "ws"), worktreesDir };
    const r = await buildCleanupPlan({ config, store, days: 9, now: NOW });
    expect(r.activeRunIds).toEqual(["b1"]);
    expect(r.plan.skipped).toMatchObject([{ runId: "b1", reason: "active" }]);
    expect(r.executeOpts).toMatchObject({ workspaceDir: config.workspaceDir, olderThanDays: 9, now: NOW });
  });
});
