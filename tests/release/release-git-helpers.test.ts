import { describe, it, expect, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { remoteExists, isTracked, commitInRemote } from "../../src/core/git/git.js";

const ENV = { ...process.env, GIT_AUTHOR_NAME: "T", GIT_AUTHOR_EMAIL: "t@example.com", GIT_COMMITTER_NAME: "T", GIT_COMMITTER_EMAIL: "t@example.com" };
const g = (cwd: string, args: string[]) => execFileSync("git", args, { cwd, env: ENV, encoding: "utf8" });

let tmp = "";
let repo = "";
let bare = "";

beforeAll(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-gh-"));
  repo = path.join(tmp, "repo");
  bare = path.join(tmp, "bare.git");
  fs.mkdirSync(repo);
  g(repo, ["init", "-q", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "a.sh"), "echo a\n");
  g(repo, ["add", "-A"]);
  g(repo, ["commit", "-q", "-m", "init"]);
  fs.mkdirSync(bare);
  g(bare, ["init", "-q", "--bare"]);
  g(repo, ["remote", "add", "origin", bare]);
}, 120000);

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true });
});

describe("release git helpers", () => {
  it("remoteExists", () => {
    expect(remoteExists(repo, "origin")).toBe(true);
    expect(remoteExists(repo, "nope")).toBe(false);
    expect(remoteExists(repo, "--all")).toBe(false);
  });

  it("isTracked", () => {
    fs.writeFileSync(path.join(repo, "b.sh"), "echo b\n");
    expect(isTracked(repo, "a.sh")).toBe(true);
    expect(isTracked(repo, "b.sh")).toBe(false);
    expect(isTracked(repo, "missing.sh")).toBe(false);
    fs.rmSync(path.join(repo, "b.sh"));
  });

  it("commitInRemote: false before push, true after, false after a new commit", () => {
    expect(commitInRemote(repo, "origin", "main")).toBe(false);
    g(repo, ["push", "-q", "origin", "main"]);
    expect(commitInRemote(repo, "origin", "main")).toBe(true);
    expect(commitInRemote(repo, "nope", "main")).toBe(false);
    expect(commitInRemote(repo, "origin", "other")).toBe(false);
    fs.writeFileSync(path.join(repo, "c.txt"), "c\n");
    g(repo, ["add", "-A"]);
    g(repo, ["commit", "-q", "-m", "second"]);
    expect(commitInRemote(repo, "origin", "main")).toBe(false);
  });
});
