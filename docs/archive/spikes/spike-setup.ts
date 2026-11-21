/**
 * Creates the throwaway target repo used by the coding spike (no Claude calls, no tokens).
 * Idempotent: re-running leaves an existing repo untouched.
 *
 *   npm run spike:setup
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { loadConfig } from "../src/core/config.js";

const config = loadConfig();
export const SPIKE_REPO = path.join(config.workspaceDir, "spike-repo");
export const SPIKE_REMOTE = path.join(config.workspaceDir, "spike-remote.git");
export const WORKTREES_DIR = path.join(config.workspaceDir, "worktrees");
/** Identity the controller gives every agent process (never the user's own). */
export const GIT_ENV = {
  GIT_AUTHOR_NAME: "TNF Agent",
  GIT_AUTHOR_EMAIL: "agent@example.com",
  GIT_COMMITTER_NAME: "TNF Agent",
  GIT_COMMITTER_EMAIL: "agent@example.com",
};

export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const r = spawnSync("git", args, { cwd, env: { ...env, ...GIT_ENV }, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${r.stderr}`);
  return r.stdout.trim();
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

export function ensureSpikeRepo(): void {
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  if (!fs.existsSync(SPIKE_REMOTE)) {
    fs.mkdirSync(SPIKE_REMOTE, { recursive: true });
    git(SPIKE_REMOTE, ["init", "--bare", "-b", "main"]);
  }
  if (fs.existsSync(path.join(SPIKE_REPO, ".git"))) return;
  fs.mkdirSync(SPIKE_REPO, { recursive: true });
  write(path.join(SPIKE_REPO, "package.json"), JSON.stringify({
    name: "spike-repo", version: "0.1.0", private: true, type: "module",
    scripts: { test: "node --test" },
  }, null, 2) + "\n");
  write(path.join(SPIKE_REPO, "src", "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  write(path.join(SPIKE_REPO, "tests", "math.test.js"),
    "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { add } from \"../src/math.js\";\n\ntest(\"add\", () => {\n  assert.equal(add(2, 3), 5);\n});\n");
  write(path.join(SPIKE_REPO, "README.md"), "# spike-repo\n\nThrowaway repo for TNF controller coding spikes. `npm test` runs node:test.\n");
  write(path.join(SPIKE_REPO, ".gitignore"), "node_modules/\n");
  git(SPIKE_REPO, ["init", "-b", "main"]);
  git(SPIKE_REPO, ["config", "core.autocrlf", "false"]);
  git(SPIKE_REPO, ["add", "-A"]);
  git(SPIKE_REPO, ["commit", "-m", "chore: initial spike repo"]);
  git(SPIKE_REPO, ["remote", "add", "origin", SPIKE_REMOTE]);
  git(SPIKE_REPO, ["push", "-u", "origin", "main"]);
}

const isMain = process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  ensureSpikeRepo();
  console.log(`spike repo: ${SPIKE_REPO}\nremote: ${SPIKE_REMOTE}\nhead: ${git(SPIKE_REPO, ["log", "--oneline", "-1"])}`);
}
