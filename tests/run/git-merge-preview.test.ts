import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { parseGitVersion, gitVersion, isRunBranchName, isValidBaseRef, previewMerge, runGit } from "../../src/core/git/git.js";

describe("parseGitVersion", () => {
  it("parses real-world strings", () => {
    expect(parseGitVersion("git version 2.43.0.windows.1")).toEqual({ major: 2, minor: 43 });
    expect(parseGitVersion("git version 2.38.0")).toEqual({ major: 2, minor: 38 });
  });
  it("returns null for junk", () => {
    expect(parseGitVersion("hello")).toBeNull();
    expect(parseGitVersion("")).toBeNull();
  });
});

describe("gitVersion", () => {
  it("reads the installed git", () => {
    const v = gitVersion(os.tmpdir());
    expect(v).not.toBeNull();
    expect(v!.major).toBeGreaterThanOrEqual(2);
  });
  it("returns null when cwd does not exist", () => {
    expect(gitVersion(path.join(os.tmpdir(), "tnf-no-such-dir-" + Date.now(), "x"))).toBeNull();
  });
});

describe("isRunBranchName", () => {
  it.each(["tnf/abc", "tnf/proj/20261103-162939-b79ca6", "tnf/a.b_c-d"])("accepts %s", (n) => {
    expect(isRunBranchName(n)).toBe(true);
  });
  it.each(["main", "tnf/", "tnf//x", "tnf/-x", "tnf/a..b", "tnf/a b", "tnf/x.lock", "tnf/x.", "tnf/x/", "-tnf/x", "tnf/a;b", ""])(
    "rejects %j",
    (n) => {
      expect(isRunBranchName(n)).toBe(false);
    },
  );
});

describe("isValidBaseRef", () => {
  it("accepts normal refs", () => {
    expect(isValidBaseRef("main")).toBe(true);
    expect(isValidBaseRef("release/1.0")).toBe(true);
  });
  it.each(["", "-main", "a b", "a..b"])("rejects %j", (n) => {
    expect(isValidBaseRef(n)).toBe(false);
  });
});

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
function makeRepo(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mp-"));
  g(dir, ["init", "-q", "-b", "main"]);
  commitFile(dir, "README.md", "line one\n", "init");
  return dir;
}
/** Repo where main and tnf/proj/<name> both edit README.md (plus extra files edited on both sides). */
function makeConflictRepo(extra: string[] = []): string {
  const dir = makeRepo();
  for (const f of extra) commitFile(dir, f, "base\n", "add " + f);
  g(dir, ["branch", "tnf/proj/c1"]);
  commitFile(dir, "README.md", "main edit\n", "main edit");
  for (const f of extra) commitFile(dir, f, "main side\n", "main " + f);
  g(dir, ["checkout", "-q", "tnf/proj/c1"]);
  commitFile(dir, "README.md", "branch edit\n", "branch edit");
  for (const f of extra) commitFile(dir, f, "branch side\n", "branch " + f);
  g(dir, ["checkout", "-q", "main"]);
  return dir;
}
function snapshot(repo: string) {
  return {
    status: g(repo, ["status", "--porcelain"]),
    head: g(repo, ["rev-parse", "HEAD"]),
    refs: g(repo, ["for-each-ref"]),
    branch: g(repo, ["branch", "--show-current"]),
  };
}

const real = gitVersion(os.tmpdir());
const hasMergeTree = !!real && (real.major > 2 || (real.major === 2 && real.minor >= 38));

describe("previewMerge input checks (always run)", () => {
  const missing = path.join(os.tmpdir(), "tnf-mp-missing-" + Date.now());
  it.each(["main", "tnf/-x", "tnf/a..b"])("bad branch %s gives unknown with a branch reason", (branch) => {
    const r = previewMerge({ repoPath: missing, base: "main", branch });
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("nhánh");
    expect(r.reason).not.toContain("2.38");
    expect(typeof r.checked_at).toBe("number");
    expect(Array.isArray(r.files)).toBe(true);
  });
  it.each(["-x", "a b"])("bad base %j gives unknown", (base) => {
    const r = previewMerge({ repoPath: missing, base, branch: "tnf/proj/run1" });
    expect(r.status).toBe("unknown");
    expect(r.reason).toContain("gốc");
    expect(Array.isArray(r.files)).toBe(true);
  });
  it("old or unknown git version never gives clean", () => {
    const repo = makeRepo();
    g(repo, ["branch", "tnf/proj/run1"]);
    for (const ov of [{ major: 2, minor: 37 }, null]) {
      const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/proj/run1" }, ov);
      expect(r.status).toBe("unknown");
      expect(r.reason).toBe("không kiểm được: cần git 2.38+");
      expect(r.files).toEqual([]);
      expect(typeof r.checked_at).toBe("number");
    }
  });
  it("version comparison accepts 2.38 and 3.0 (override passes the gate, real git decides)", () => {
    const missing2 = path.join(os.tmpdir(), "tnf-mp-missing2-" + Date.now());
    for (const ov of [{ major: 2, minor: 38 }, { major: 3, minor: 0 }]) {
      const r = previewMerge({ repoPath: missing2, base: "main", branch: "tnf/proj/run1" }, ov);
      expect(r.status).toBe("unknown");
      expect(r.reason).not.toBe("không kiểm được: cần git 2.38+");
    }
  });
});

describe.skipIf(!hasMergeTree)("previewMerge with real git", () => {
  it("clean when branch only adds a file", () => {
    const repo = makeRepo();
    g(repo, ["checkout", "-q", "-b", "tnf/proj/run1"]);
    commitFile(repo, "new.txt", "x\n", "add");
    g(repo, ["checkout", "-q", "main"]);
    const before = snapshot(repo);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/proj/run1" });
    expect(r.status).toBe("clean");
    expect(r.files).toEqual([]);
    expect(snapshot(repo)).toEqual(before);
    expect(before.status).toBe("");
  });
  it("conflict lists README.md once and leaves the repo untouched", () => {
    const repo = makeConflictRepo();
    const before = snapshot(repo);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/proj/c1" });
    expect(r.status).toBe("conflict");
    expect(r.files).toEqual(["README.md"]);
    expect(snapshot(repo)).toEqual(before);
    expect(before.status).toBe("");
  });
  it("conflicting files with spaces and non-ASCII names come back unquoted", () => {
    const repo = makeConflictRepo(["my file.txt", "tài liệu.txt"]);
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/proj/c1" });
    expect(r.status).toBe("conflict");
    expect([...r.files].sort()).toEqual(["README.md", "my file.txt", "tài liệu.txt"].sort());
  });
  it("missing branch gives unknown with a reason", () => {
    const repo = makeRepo();
    const r = previewMerge({ repoPath: repo, base: "main", branch: "tnf/proj/nope" });
    expect(r.status).toBe("unknown");
    expect((r.reason ?? "").length).toBeGreaterThan(0);
  });
});
