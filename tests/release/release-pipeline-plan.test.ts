import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AGENT_GIT_ENV, git } from "../../src/core/git/git.js";
import { RELEASE_TEMPLATES } from "../../src/core/release/config.js";
import { buildReleasePlan, dryRunRelease, ReleasePlanError, runPreconditions } from "../../src/core/release/pipeline.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });

describe("release plan and dry-run", () => {
  let repo: string;
  beforeAll(() => {
    repo = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rel-plan-"));
    G(repo, ["init", "-b", "main"]);
    fs.writeFileSync(
      path.join(repo, "package.json"),
      JSON.stringify({ name: "x", version: "1.2.3", scripts: { test: "x", package: "x", installer: "x", "build:ui": "x" } }, null, 2),
    );
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "init"]);
    G(repo, ["checkout", "-b", "tnf/r1"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "a"]);
    G(repo, ["checkout", "main"]);
  });
  afterAll(() => fs.rmSync(repo, { recursive: true, force: true }));

  it("plans windows-installer", () => {
    const plan = buildReleasePlan({ repoPath: repo, baseBranch: "main", config: RELEASE_TEMPLATES["windows-installer"]!, version: "1.2.4" });
    expect(plan.map((p) => p.type)).toEqual(["build", "bump", "build", "build"]);
    // test runs BEFORE the version bump, so a failing test leaves no release commit behind
    expect(plan[0]!.argv.slice(-2)).toEqual(["run", "test"]);
    expect(plan[1]!.argv).toEqual(["git", "commit", "-m", "chore(release): 1.2.4"]);
    expect(plan[3]!.argv).toEqual(["ISCC", "/DMyAppVersion=1.2.4", "installer/setup.iss"]);
  });

  it("plans web-vps with fixed ssh, tag and push without --force", () => {
    const legacy = {
      extraScripts: [],
      steps: [
        { type: "tag" as const, prefix: "v" },
        { type: "git-push" as const, remote: "origin" },
        { type: "ssh-deploy" as const, host: "example.com", user: "deploy", port: 22, keyPath: "keys/deploy_key", remoteDir: "/var/www/app" },
      ],
    };
    const plan = buildReleasePlan({ repoPath: repo, baseBranch: "main", config: legacy, version: "1.2.4" });
    const argvs = plan.map((p) => p.argv);
    expect(argvs).toContainEqual(["git", "tag", "v1.2.4"]);
    expect(argvs).toContainEqual(["git", "push", "origin", "main"]);
    expect(argvs).toContainEqual(["git", "push", "origin", "v1.2.4"]);
    const ssh = argvs.find((a) => a[0] === "ssh")!;
    expect(ssh.slice(0, 9)).toEqual(["ssh", "-i", "keys/deploy_key", "-p", "22", "-o", "BatchMode=yes", "deploy@example.com", "--"]);
    expect(ssh[9]).toBe("cd /var/www/app && git pull --ff-only");
    expect(JSON.stringify(argvs)).not.toMatch(/--force|-f"|shell/);
  });

  it("fails when a script is missing from package.json", () => {
    const cfg = { extraScripts: ["lint"], steps: [{ type: "build" as const, script: "lint" }] };
    expect(() => buildReleasePlan({ repoPath: repo, baseBranch: "main", config: cfg, version: "1.0.0" })).toThrow(ReleasePlanError);
  });

  it("dry-run changes nothing", () => {
    const head = G(repo, ["rev-parse", "HEAD"]);
    const r = dryRunRelease({ repoPath: repo, baseBranch: "main", config: RELEASE_TEMPLATES["windows-installer"]!, branch: null });
    expect(r.version).toBe("1.2.4");
    expect(r.preconditions.ok).toBe(true);
    expect(r.plan.length).toBe(4);
    expect(G(repo, ["rev-parse", "HEAD"])).toBe(head);
    expect(G(repo, ["status", "--porcelain"]).trim()).toBe("");
  });

  it("preconditions fail: unmerged, wrong branch, dirty", () => {
    const unmerged = runPreconditions({ repoPath: repo, baseBranch: "main", branch: "tnf/r1" });
    expect(unmerged.ok).toBe(false);
    expect(unmerged.message).toContain("chưa được commit vào main");
    expect(runPreconditions({ repoPath: repo, baseBranch: "develop" }).message).toContain("không phải nhánh base");
    fs.writeFileSync(path.join(repo, "dirty.txt"), "d");
    expect(runPreconditions({ repoPath: repo, baseBranch: "main" }).message).toContain("chưa commit");
    fs.rmSync(path.join(repo, "dirty.txt"));
  });
});
