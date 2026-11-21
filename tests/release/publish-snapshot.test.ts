import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

// An agent environment may export git identity vars that override the identities these tests set up.
for (const k of ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"]) delete process.env[k];

const script = path.resolve("scripts/publish-snapshot.mjs");
const ID = ["-c", "user.name=dev", "-c", "user.email=dev@example.com"];

let root: string;
let repo: string;
let bare: string;

const git = (cwd: string, ...a: string[]) => {
  const r = spawnSync("git", a, { cwd, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`git ${a.join(" ")}: ${r.stderr}`);
  return r.stdout.trim();
};
// GIT_AUTHOR_*/GIT_COMMITTER_* in the environment override `-c user.name`, so strip them.
const cleanEnv = () => Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^GIT_(AUTHOR|COMMITTER)_/.test(k)));
const publish = (...extra: string[]) => spawnSync(process.execPath, [script, "--repo", repo, ...extra], { encoding: "utf8", env: cleanEnv() });
const remoteRefs = () => spawnSync("git", ["for-each-ref", "refs/heads"], { cwd: bare, encoding: "utf8" }).stdout.trim();

beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pub-"));
  repo = path.join(root, "proj");
  bare = path.join(root, "remote.git");
  fs.mkdirSync(repo);
  fs.mkdirSync(bare);
  git(bare, "init", "--bare", "-q", "-b", "main");
  git(repo, "init", "-q", "-b", "main");
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "demo", version: "0.1.0" }));
  fs.writeFileSync(path.join(repo, "a.txt"), "hello\n");
  fs.writeFileSync(path.join(repo, ".gitignore"), ".publish-config.json\n.privacy-denylist\n");
  git(repo, ...ID, "add", "-A");
  git(repo, ...ID, "commit", "-q", "-m", "old history 1");
  fs.writeFileSync(path.join(repo, "b.txt"), "more\n");
  git(repo, ...ID, "add", "-A");
  git(repo, ...ID, "commit", "-q", "-m", "old history 2");
  git(repo, "remote", "add", "origin", bare);
  fs.writeFileSync(path.join(repo, ".publish-config.json"), JSON.stringify({ author: { name: "pub", email: "pub@example.com" }, expectedRemoteUrl: bare }));
});

afterEach(() => {
  spawnSync("git", ["worktree", "prune"], { cwd: repo });
  fs.rmSync(root, { recursive: true, force: true });
});

describe("publish-snapshot", () => {
  it("builds a one-commit snapshot and pushes nothing by default", () => {
    const r = publish();
    expect(r.status).toBe(0);
    const snap = path.join(root, "proj-public-snapshot");
    expect(fs.existsSync(path.join(snap, "a.txt"))).toBe(true);
    expect(git(snap, "log", "--format=%an <%ae>").split("\n")).toEqual(["pub <pub@example.com>"]);
    expect(remoteRefs()).toBe("");
  });

  it("pushes the snapshot (no old history) only with --push --yes", () => {
    expect(publish("--push").status).toBe(1);
    expect(remoteRefs()).toBe("");
    const r = publish("--push", "--yes");
    expect(r.status).toBe(0);
    expect(git(bare, "log", "main", "--format=%s")).toBe("demo 0.1.0 (public snapshot)");
    expect(git(bare, "log", "main", "--format=%an")).toBe("pub");
  });

  it("stops and pushes nothing when the privacy scan finds a real email", () => {
    fs.writeFileSync(path.join(repo, "notes.md"), `contact: ${"someone" + "@"}${"real-company" + ".org"}\n`);
    git(repo, ...ID, "add", "-A");
    git(repo, ...ID, "commit", "-q", "-m", "leak");
    const r = publish("--push", "--yes");
    expect(r.status).toBe(1);
    expect(remoteRefs()).toBe("");
    expect(fs.existsSync(path.join(root, "proj-public-snapshot"))).toBe(false);
  });

  it("refuses a dirty tree, a wrong branch and a remote that is not the expected one", () => {
    fs.writeFileSync(path.join(repo, "a.txt"), "changed\n");
    expect(publish().status).toBe(1);
    git(repo, "checkout", "-q", "--", "a.txt");
    git(repo, "checkout", "-q", "-b", "side");
    expect(publish().status).toBe(1);
    git(repo, "checkout", "-q", "main");
    fs.writeFileSync(path.join(repo, ".publish-config.json"), JSON.stringify({ expectedRemoteUrl: "https://example.com/other.git" }));
    expect(publish("--push", "--yes").status).toBe(1);
    expect(remoteRefs()).toBe("");
  });
});
