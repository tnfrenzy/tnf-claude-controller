import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import { RELEASE_TEMPLATES, type ReleaseConfig } from "../../src/core/release/config.js";
import { executeRelease, listReleases, readReleaseLog, type CommandRunner } from "../../src/core/release/pipeline.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
const FAKE_ISCC = path.join(os.tmpdir(), "fake-inno", "ISCC.exe");
const dirs: string[] = [];

function mk(): { repo: string; dataDir: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-run-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-data-"));
  dirs.push(repo, dataDir);
  G(repo, ["init", "-b", "main"]);
  fs.writeFileSync(
    path.join(repo, "package.json"),
    JSON.stringify({ name: "x", version: "1.2.3", scripts: { test: "x", package: "x", installer: "x", "build:ui": "x" } }, null, 2),
  );
  G(repo, ["add", "-A"]);
  G(repo, ["commit", "-m", "init"]);
  return { repo, dataDir };
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const ok: CommandRunner = async () => ({ exitCode: 0, output: "fine" });
const existsFake = (p: string) => p === FAKE_ISCC || fs.existsSync(p);
const ENV = { TNF_ISCC: FAKE_ISCC } as NodeJS.ProcessEnv;

describe("executeRelease", () => {
  it("runs the whole windows-installer chain in order and hashes the Setup", async () => {
    const { repo, dataDir } = mk();
    const calls: string[][] = [];
    const runner: CommandRunner = async (argv, o) => {
      calls.push(argv);
      if (argv[0] === FAKE_ISCC) {
        fs.mkdirSync(path.join(o.cwd, "build"), { recursive: true });
        fs.writeFileSync(path.join(o.cwd, "build", "TNF-CLI-Setup-1.2.4.exe"), "setup-bytes");
      }
      return { exitCode: 0, output: "ok" };
    };
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: RELEASE_TEMPLATES["windows-installer"]!, runner, exists: existsFake, env: ENV });
    expect(log.status).toBe("success");
    expect(log.steps.map((s) => s.status)).toEqual(["ok", "ok", "ok", "ok"]);
    expect(calls.map((c) => c.slice(-1)[0])).toEqual(["test", "package", "installer/setup.iss"]);
    expect(calls[2]).toEqual([FAKE_ISCC, "/DMyAppVersion=1.2.4", "installer/setup.iss"]);
    expect(log.artifact!.size).toBe(11);
    expect(log.artifact!.sha256).toBe(crypto.createHash("sha256").update("setup-bytes").digest("hex"));
    expect(G(repo, ["log", "-1", "--format=%s"])).toBe("chore(release): 1.2.4");
    expect(readReleaseLog(dataDir, log.id)!.version).toBe("1.2.4");
    expect(listReleases(dataDir)[0]!.id).toBe(log.id);
  });

  it("stops at a failing step and skips the rest, warning about the bump commit", async () => {
    const { repo, dataDir } = mk();
    let n = 0;
    const runner: CommandRunner = async () => (++n === 1 ? { exitCode: 0, output: "" } : { exitCode: 1, output: "boom" });
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: RELEASE_TEMPLATES["windows-installer"]!, runner, exists: existsFake, env: ENV });
    expect(log.status).toBe("failed");
    expect(log.steps.map((s) => s.status)).toEqual(["ok", "ok", "failed", "skipped"]);
    expect(log.warnings.join(" ")).toContain("chore(release): 1.2.4");
  });

  it("masks tokens in output and argv before writing the log", async () => {
    const { repo, dataDir } = mk();
    const runner: CommandRunner = async () => ({ exitCode: 0, output: "token=abc123 ghp_abcdefghijklmnop1234" });
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: { extraScripts: [], steps: [{ type: "build", script: "test" }] }, runner });
    const raw = fs.readFileSync(path.join(dataDir, "releases", log.id, "log.json"), "utf8");
    expect(raw).not.toContain("abc123");
    expect(raw).not.toContain("ghp_abcdef");
  });

  it("reports a Vietnamese error when Inno Setup is missing", async () => {
    const { repo, dataDir } = mk();
    const log = await executeRelease({
      dataDir, projectName: "demo", repoPath: repo, baseBranch: "main",
      config: { extraScripts: [], steps: [{ type: "build", script: "installer" }] },
      runner: ok, exists: () => false, env: {},
    });
    expect(log.status).toBe("failed");
    expect(log.error).toContain("Không tìm thấy Inno Setup 6");
  });

  it("healthcheck with the wrong status fails; right status passes", async () => {
    const { repo, dataDir } = mk();
    const config = { extraScripts: [], steps: [{ type: "healthcheck" as const, url: "https://example.com/", expectStatus: 200 }] };
    const bad = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config, runner: ok, fetch: async () => ({ status: 502 }) });
    expect(bad.status).toBe("failed");
    expect(bad.error).toContain("502");
    const good = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config, runner: ok, fetch: async () => ({ status: 200 }) });
    expect(good.status).toBe("success");
  });

  it("never hands --force to the runner and fails on dirty repo", async () => {
    const { repo, dataDir } = mk();
    const calls: string[][] = [];
    const runner: CommandRunner = async (argv) => {
      calls.push(argv);
      return { exitCode: 0, output: "" };
    };
    const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-bare-"));
    dirs.push(bare);
    G(bare, ["init", "--bare", "-b", "main"]);
    G(repo, ["remote", "add", "origin", bare]);
    const config: ReleaseConfig = {
      extraScripts: [],
      steps: [{ type: "bump" }, { type: "tag", prefix: "v" }, { type: "git-push", remote: "origin" }, { type: "healthcheck", url: "https://example.com/", expectStatus: 200 }],
    };
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config, runner, fetch: async () => ({ status: 200 }) });
    expect(log.status).toBe("success");
    expect(JSON.stringify(calls)).not.toContain("--force");
    fs.writeFileSync(path.join(repo, "dirty.txt"), "d");
    const dirty = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config, runner });
    expect(dirty.status).toBe("failed");
    expect(dirty.steps.every((s) => s.status === "skipped")).toBe(true);
  });
});
