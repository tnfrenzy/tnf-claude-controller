import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import type { ReleaseConfig } from "../../src/core/release/config.js";
import { buildReleasePlan, executeRelease, ReleasePlanError, type CommandRunner } from "../../src/core/release/pipeline.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function mk(withRemote: boolean): { repo: string; bare: string; dataDir: string } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-push-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-bare-"));
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-pdata-"));
  dirs.push(repo, bare, dataDir);
  G(bare, ["init", "--bare", "-b", "main"]);
  G(repo, ["init", "-b", "main"]);
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "x", version: "1.2.3", scripts: { test: "x" } }, null, 2));
  G(repo, ["add", "-A"]);
  G(repo, ["commit", "-m", "init"]);
  if (withRemote) G(repo, ["remote", "add", "origin", bare]);
  return { repo, bare, dataDir };
}

const cfg = (extra: Record<string, unknown> = {}): ReleaseConfig => ({
  extraScripts: [],
  steps: [{ type: "bump" }, { type: "tag", prefix: "v" }, { type: "git-push", remote: "origin", ...extra } as never],
});

describe("git-push plan", () => {
  it("plans branch and tag pushes with exact argv", () => {
    const { repo } = mk(true);
    const plan = buildReleasePlan({ repoPath: repo, baseBranch: "main", config: cfg(), version: "1.2.4" });
    const pushes = plan.filter((c) => c.type === "git-push").map((c) => c.argv);
    expect(pushes).toEqual([["git", "push", "origin", "main"], ["git", "push", "origin", "v1.2.4"]]);
  });

  it("uses configured branch and tag", () => {
    const { repo } = mk(true);
    const plan = buildReleasePlan({ repoPath: repo, baseBranch: "main", config: cfg({ branch: "release", tag: "rc1" }), version: "1.2.4" });
    expect(plan.filter((c) => c.type === "git-push").map((c) => c.argv[3])).toEqual(["release", "rc1"]);
  });

  it("rejects force-like or colon refs", () => {
    const { repo } = mk(true);
    for (const bad of ["--force", "+main", "a:b"]) {
      expect(() => buildReleasePlan({ repoPath: repo, baseBranch: "main", config: cfg({ branch: bad }), version: "1.2.4" })).toThrow(ReleasePlanError);
    }
  });

  it("refuses a runner argv containing --force", async () => {
    const { repo, dataDir } = mk(true);
    const seen: string[][] = [];
    const runner: CommandRunner = async (argv) => {
      seen.push(argv);
      return { exitCode: 0, output: "" };
    };
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg({ branch: "x" }), runner });
    expect(seen.flat()).not.toContain("--force");
    expect(log.status).toBe("success");
  });

  it("stops when the remote does not exist", async () => {
    const { repo, dataDir } = mk(false);
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg() });
    expect(log.status).toBe("failed");
    expect(log.steps[2]!.status).toBe("failed");
    expect(log.steps[2]!.output).toContain("không tồn tại");
  });

  it("passes GIT_TERMINAL_PROMPT=0 and keeps inherited env for push", async () => {
    const { repo, dataDir } = mk(true);
    const envs: Array<NodeJS.ProcessEnv | undefined> = [];
    const runner: CommandRunner = async (argv, o) => {
      if (argv[1] === "push") envs.push(o.env);
      return { exitCode: 0, output: "" };
    };
    await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg(), runner, env: { PATH: "p", HOME: "h" } as NodeJS.ProcessEnv });
    expect(envs).toHaveLength(2);
    expect(envs[0]!["GIT_TERMINAL_PROMPT"]).toBe("0");
    expect(envs[0]!["HOME"]).toBe("h");
  });

  it("really pushes branch and tag into a temp bare repo", async () => {
    const { repo, bare, dataDir } = mk(true);
    const log = await executeRelease({ dataDir, projectName: "demo", repoPath: repo, baseBranch: "main", config: cfg() });
    expect(log.error ?? "").toBe("");
    expect(log.status).toBe("success");
    expect(G(bare, ["rev-parse", "main"])).toBe(G(repo, ["rev-parse", "HEAD"]));
    expect(G(bare, ["tag", "-l"])).toContain("v1.2.4");
  });
});
