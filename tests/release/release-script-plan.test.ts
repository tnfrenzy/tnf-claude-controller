import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import type { ReleaseConfig } from "../../src/core/release/config.js";
import { buildReleasePlan, ReleasePlanError } from "../../src/core/release/pipeline.js";
import { checkScriptReady, type ScriptReadyInput } from "../../src/core/release/preconditions.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });
const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop()!, { recursive: true, force: true });
});

function mk(): { repo: string; input: ScriptReadyInput } {
  const repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sp-"));
  const bare = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-spb-"));
  dirs.push(repo, bare);
  G(bare, ["init", "--bare", "-b", "main"]);
  G(repo, ["init", "-b", "main"]);
  fs.mkdirSync(path.join(repo, "scripts"));
  fs.writeFileSync(path.join(repo, "scripts", "deploy.sh"), "echo hi\n");
  fs.writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "x", version: "1.0.0", scripts: {} }));
  fs.writeFileSync(path.join(repo, "key"), "k");
  G(repo, ["add", "scripts", "package.json"]);
  G(repo, ["commit", "-m", "init"]);
  G(repo, ["remote", "add", "origin", bare]);
  G(repo, ["push", "origin", "main"]);
  fs.writeFileSync(path.join(repo, ".git", "info", "exclude"), "key\nscripts/untracked.sh\n");
  return {
    repo,
    input: { repo, base: "main", remote: "origin", scriptPath: "scripts/deploy.sh", target: "deploy@example.com", keyPath: "key", bashPath: "/fake/bash.exe" },
  };
}

const cfg = (over: Record<string, unknown> = {}): ReleaseConfig => ({
  extraScripts: [],
  steps: [{ type: "project-script", scriptPath: "scripts/deploy.sh", target: "deploy@example.com", keyPath: "key", keyEnvName: "DEPLOY_KEY_PATH", ...over } as never],
});

describe("project-script plan", () => {
  it("plans bash + script + target without the key path", () => {
    const { repo } = mk();
    const plan = buildReleasePlan({ repoPath: repo, baseBranch: "main", config: cfg(), version: "1.0.0", bashPath: "/fake/bash.exe" });
    expect(plan).toHaveLength(1);
    expect(plan[0]!.argv).toEqual(["/fake/bash.exe", "scripts/deploy.sh", "deploy@example.com"]);
    expect(plan[0]!.cwd).toBe(repo);
    expect(plan[0]!.description).toContain("DEPLOY_KEY_PATH");
    expect(plan[0]!.argv.join(" ")).not.toContain("key ");
  });

  it("rejects .. path, bad extension and bad target in plan", () => {
    const { repo } = mk();
    for (const over of [{ scriptPath: "../x.sh" }, { scriptPath: "scripts/a.txt" }, { target: "bad target" }, { scriptPath: "/abs/x.sh" }]) {
      expect(() => buildReleasePlan({ repoPath: repo, baseBranch: "main", config: cfg(over), version: "1.0.0" })).toThrow(ReleasePlanError);
    }
  });
});

describe("checkScriptReady", () => {
  it("passes when everything is in place", () => {
    const { input } = mk();
    expect(() => checkScriptReady(input)).not.toThrow();
  });

  it("rejects .. path and bad target", () => {
    const { input } = mk();
    expect(() => checkScriptReady({ ...input, scriptPath: "scripts/../deploy.sh" })).toThrow(/\.\./);
    expect(() => checkScriptReady({ ...input, target: "nope" })).toThrow(/user@host/);
  });

  it("rejects untracked script", () => {
    const { repo, input } = mk();
    fs.writeFileSync(path.join(repo, "scripts", "untracked.sh"), "x");
    expect(() => checkScriptReady({ ...input, scriptPath: "scripts/untracked.sh" })).toThrow(/theo dõi/);
  });

  it("rejects dirty repo", () => {
    const { repo, input } = mk();
    fs.appendFileSync(path.join(repo, "scripts", "deploy.sh"), "more\n");
    expect(() => checkScriptReady(input)).toThrow(/chưa commit/);
  });

  it("rejects wrong branch", () => {
    const { input } = mk();
    expect(() => checkScriptReady({ ...input, base: "develop" })).toThrow(/nhánh base/);
  });

  it("rejects commit not in remote", () => {
    const { repo, input } = mk();
    fs.appendFileSync(path.join(repo, "scripts", "deploy.sh"), "more\n");
    G(repo, ["commit", "-am", "local only"]);
    expect(() => checkScriptReady(input)).toThrow(/chưa có trong remote/);
  });

  it("rejects missing key and missing bash", () => {
    const { input } = mk();
    expect(() => checkScriptReady({ ...input, keyPath: "nokey" })).toThrow(/khóa SSH/);
    expect(() => checkScriptReady({ ...input, bashPath: null })).toThrow(/bash/);
  });
});
