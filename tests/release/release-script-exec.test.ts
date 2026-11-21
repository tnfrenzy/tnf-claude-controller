import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import type { ReleaseConfig } from "../../src/core/release/config.js";
import { defaultRunner, executeRelease, type CommandRunner, type FetchLike } from "../../src/core/release/pipeline.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

const FAKE_BASH = path.join(os.tmpdir(), "fake-git", "bin", "bash.exe");
const env = { TNF_GIT_BASH: FAKE_BASH } as NodeJS.ProcessEnv;
const exists = (p: string) => p === FAKE_BASH || fs.existsSync(p);

function mk(scriptBody: string): { repo: string; dataDir: string; keyAbs: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-se-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-seb-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sed-"));
  dirs.push(repo, bare, dataDir);
  G(bare, ["init", "--bare", "-b", "main"]);
  G(repo, ["init", "-b", "main"]);
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.writeFileSync(path.join(repo, "scripts", "deploy.sh"), scriptBody);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: {} }));
  fs.writeFileSync(path.join(repo, "key"), "k");
  G(repo, ["add", "scripts", "package.json"]);
  G(repo, ["commit", "-m", "init"]);
  G(repo, ["remote", "add", "origin", bare]);
  G(repo, ["push", "origin", "main"]);
  fs.writeFileSync(path.join(repo, ".git", "info", "exclude"), "key\n");
  return { repo, dataDir, keyAbs: path.join(repo, "key") };
}

const script = { type: "project-script", scriptPath: "scripts/deploy.sh", target: "deploy@example.com", keyPath: "key", keyEnvName: "DEPLOY_KEY_PATH" };
const cfg = (...steps: unknown[]): ReleaseConfig => ({ extraScripts: [], steps: steps as never });

/** "Fake bash": runs the sample script with node instead (the script is JS, named .sh). */
const nodeAsBash: CommandRunner = (argv, opts) => defaultRunner([process.execPath, argv[1]!, argv[2]!], opts);

describe("project-script execution", () => {
  it("masks the key path in the log", async () => {
    const { repo, dataDir, keyAbs } = mk("console.log('key=' + process.env.DEPLOY_KEY_PATH, 'target=' + process.argv[2]);\n");
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg(script), runner: nodeAsBash, exists, env });
    expect(log.status).toBe("success");
    const out = log.steps[0]!.output;
    expect(out).toContain("target=deploy@example.com");
    expect(out).toContain("[ẩn]");
    expect(out).not.toContain(keyAbs);
    expect(out).not.toContain(keyAbs.replace(/\\/g, "/"));
  });

  it("passes a minimal env and a time limit to the runner", async () => {
    const { repo, dataDir, keyAbs } = mk("x\n");
    let seen: { env?: NodeJS.ProcessEnv; timeoutMs?: number } = {};
    const runner: CommandRunner = async (_argv, opts) => {
      seen = opts;
      return { exitCode: 0, output: "" };
    };
    await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg(script), runner, exists, env });
    expect(seen.timeoutMs).toBe(30 * 60 * 1000);
    expect(seen.env?.["DEPLOY_KEY_PATH"]).toBe(keyAbs);
    expect(seen.env?.["PATH"]).toBeDefined();
    expect(Object.keys(seen.env ?? {})).not.toContain("TNF_GIT_BASH");
  });

  it("fails and stops on timeout", async () => {
    const { repo, dataDir } = mk("setTimeout(() => {}, 60000);\n");
    const log = await executeRelease({
      dataDir, projectName: "demo", repoPath: repo, baseBranch: "main",
      config: cfg(script, { type: "healthcheck", url: "https://example.com/", expectStatus: 200 }),
      runner: nodeAsBash, exists, env, scriptTimeoutMs: 300,
    });
    expect(log.status).toBe("failed");
    expect(log.steps[0]!.status).toBe("failed");
    expect(log.steps[0]!.output).toMatch(/quá thời hạn/);
    expect(log.steps[1]!.status).toBe("skipped");
  });

  it("fails without running when a precondition is missing", async () => {
    const { repo, dataDir } = mk("x\n");
    let ran = false;
    const runner: CommandRunner = async () => {
      ran = true;
      return { exitCode: 0, output: "" };
    };
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg({ ...script, keyPath: "nokey" }), runner, exists, env });
    expect(ran).toBe(false);
    expect(log.status).toBe("failed");
    expect(log.steps[0]!.output).toMatch(/khóa SSH/);
  });
});

describe("healthcheck result and incremental log", () => {
  const hc = { type: "healthcheck", url: "https://example.com/health", expectStatus: 200 };

  it("reports 200 as ok", async () => {
    const { repo, dataDir } = mk("x\n");
    const fetch: FetchLike = async () => ({ status: 200 });
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg(hc), fetch, exists, env });
    expect(log.status).toBe("success");
    expect(log.steps[0]!.health).toEqual({ ok: true, status: 200 });
  });

  it("reports 500 as failed without rollback", async () => {
    const { repo, dataDir } = mk("x\n");
    const head = G(repo, ["rev-parse", "HEAD"]);
    const fetch: FetchLike = async () => ({ status: 500 });
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg(hc), fetch, exists, env });
    expect(log.status).toBe("failed");
    expect(log.steps[0]!.health).toEqual({ ok: false, status: 500 });
    expect(G(repo, ["rev-parse", "HEAD"])).toBe(head);
  });

  it("writes log.json between steps", async () => {
    const { repo, dataDir } = mk("x\n");
    let mid: { status: string; steps: Array<{ status: string }> } | null = null;
    const runner: CommandRunner = async () => ({ exitCode: 0, output: "done" });
    const fetch: FetchLike = async () => {
      const dir = path.join(dataDir, "releases");
      const id = fs.readdirSync(dir)[0]!;
      mid = JSON.parse(fs.readFileSync(path.join(dir, id, "log.json"), "utf8"));
      return { status: 200 };
    };
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg(script, hc), runner, fetch, exists, env });
    expect(log.status).toBe("success");
    expect(mid).not.toBeNull();
    expect(mid!.status).toBe("running");
    expect(mid!.steps[0]!.status).toBe("ok");
  });
});
