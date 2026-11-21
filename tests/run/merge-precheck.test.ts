import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { previewMerge, runGit, parseGitVersion, isRunBranchName, resolveRef } from "../../src/core/git/git.js";

vi.mock("node:child_process", async (importActual) => {
  const actual = await importActual<typeof import("node:child_process")>();
  return {
    ...actual,
    spawnSync: vi.fn((...a: Parameters<typeof actual.spawnSync>) => actual.spawnSync(...a)),
  };
});

const calls = () => vi.mocked(spawnSync).mock.calls.map((c) => (c[1] as string[]).join(" "));

const ENV = {
  ...process.env,
  GIT_AUTHOR_NAME: "t",
  GIT_AUTHOR_EMAIL: "t@example.com",
  GIT_COMMITTER_NAME: "t",
  GIT_COMMITTER_EMAIL: "t@example.com",
};
const g = (cwd: string, args: string[]) => {
  const r = runGit(cwd, args, ENV);
  if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  return r.stdout;
};
const commitFile = (repo: string, file: string, content: string, msg: string) => {
  fs.writeFileSync(path.join(repo, file), content, "utf8");
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-q", "-m", msg]);
};

const tmpDirs: string[] = [];
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-merge-precheck-"));
  tmpDirs.push(dir);
  g(dir, ["init", "-q", "-b", "main"]);
  commitFile(dir, "a.txt", "one\ntwo\nthree\n", "init a");
  commitFile(dir, "b.txt", "bee\n", "init b");
  return dir;
}
function snapshot(repo: string) {
  return {
    head: g(repo, ["rev-parse", "HEAD"]),
    index: g(repo, ["ls-files", "--stage"]),
    status: g(repo, ["status", "--porcelain"]),
  };
}

beforeEach(() => {
  vi.mocked(spawnSync).mockClear();
});

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    fs.rmSync(d, { recursive: true, force: true, maxRetries: 3 });
  }
});

describe("merge precheck: clean and conflict", () => {
  it("clean when the branch edits a different file than main", { timeout: 60000 }, () => {
    const repo = makeRepo();
    g(repo, ["checkout", "-q", "-b", "tnf/a1"]);
    commitFile(repo, "b.txt", "bee changed\n", "branch edits b");
    g(repo, ["checkout", "-q", "main"]);
    commitFile(repo, "a.txt", "one\ntwo\nthree\nfour\n", "main edits a");
    const before = snapshot(repo);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/a1" });
    expect(r.status).toBe("clean");
    expect(r.files).toEqual([]);
    expect(snapshot(repo)).toEqual(before);
  });

  it("conflict after a1 was merged into main and a2 edits the same line", { timeout: 60000 }, () => {
    const repo = makeRepo();
    g(repo, ["branch", "tnf/a1"]);
    g(repo, ["branch", "tnf/a2"]);
    g(repo, ["checkout", "-q", "tnf/a1"]);
    commitFile(repo, "a.txt", "one\nTWO from a1\nthree\n", "a1 edit");
    g(repo, ["checkout", "-q", "tnf/a2"]);
    commitFile(repo, "a.txt", "one\nTWO from a2\nthree\n", "a2 edit");
    g(repo, ["checkout", "-q", "main"]);
    g(repo, ["merge", "-q", "--no-ff", "-m", "merge a1", "tnf/a1"]);
    const before = snapshot(repo);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/a2" });
    expect(r.status).toBe("conflict");
    expect(r.files).toEqual(["a.txt"]);
    expect(snapshot(repo)).toEqual(before);
    expect(before.status).toBe("");
  });
});

describe("merge precheck: unknown cases", () => {
  it.each(["main", "tnf/../x", "-tnf/x", "--upload-pack=x"])(
    "bad branch name %j gives unknown without calling git",
    { timeout: 60000 },
    (branch) => {
      const repo = makeRepo();
      const before = snapshot(repo);
      expect(isRunBranchName(branch)).toBe(false);
      vi.mocked(spawnSync).mockClear();
      const r = previewMerge({ repoPath: repo, base: "main", branch });
      expect(vi.mocked(spawnSync)).toHaveBeenCalledTimes(0);
      expect(r.status).toBe("unknown");
      expect(r.files).toEqual([]);
      expect(snapshot(repo)).toEqual(before);
    },
  );

  it("isRunBranchName accepts tnf/a1", () => {
    expect(isRunBranchName("tnf/a1")).toBe(true);
  });

  it("missing branch gives unknown", { timeout: 60000 }, () => {
    const repo = makeRepo();
    const before = snapshot(repo);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/missing" });
    expect(r.status).toBe("unknown");
    expect(snapshot(repo)).toEqual(before);
  });

  it("old git (2.37) and null version give unknown and never run merge-tree", { timeout: 60000 }, () => {
    const repo = makeRepo();
    g(repo, ["branch", "tnf/a1"]);
    const before = snapshot(repo);
    for (const ov of [{ major: 2, minor: 37 }, null]) {
      vi.mocked(spawnSync).mockClear();
      const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/a1" }, ov);
      expect(r.status).toBe("unknown");
      expect(r.files).toEqual([]);
      expect(calls().some((c) => c.includes("merge-tree"))).toBe(false);
    }
    expect(snapshot(repo)).toEqual(before);
  });

  it("boundary version 2.38 is not unknown because of the version", { timeout: 60000 }, () => {
    const repo = makeRepo();
    g(repo, ["checkout", "-q", "-b", "tnf/a1"]);
    commitFile(repo, "b.txt", "bee changed\n", "branch edits b");
    g(repo, ["checkout", "-q", "main"]);
    const before = snapshot(repo);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/a1" }, { major: 2, minor: 38 });
    expect(r.status).toBe("clean");
    expect(snapshot(repo)).toEqual(before);
  });

  it("parseGitVersion handles windows suffix, plain and junk", () => {
    expect(parseGitVersion("git version 2.37.1.windows.1")).toEqual({ major: 2, minor: 37 });
    expect(parseGitVersion("git version 2.38.0")).toEqual({ major: 2, minor: 38 });
    expect(parseGitVersion("abc")).toBeNull();
    expect(parseGitVersion("")).toBeNull();
  });
});

describe("resolveRef", () => {
  it("resolveRef returns the 40 hex sha of main", () => {
    const repo = makeRepo();
    const sha = resolveRef(repo, "main");
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    expect(sha).toBe(g(repo, ["rev-parse", "main"]).trim());
  });

  it("resolveRef returns null for a missing ref", () => {
    const repo = makeRepo();
    expect(resolveRef(repo, "no-such-branch")).toBeNull();
  });

  it("resolveRef returns null for a ref starting with a dash", () => {
    const repo = makeRepo();
    expect(resolveRef(repo, "--all")).toBeNull();
  });
});
