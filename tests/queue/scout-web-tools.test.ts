import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { runGit } from "../../src/core/git/git.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_COMMIT = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];
const WEB = ["WebSearch", "WebFetch"];

function makeRepo(root: string): string {
  const r = path.join(root, "target-repo");
  fs.mkdirSync(r, { recursive: true });
  const g = (args: string[]) => {
    const res = runGit(r, args);
    if (res.code !== 0) throw new Error(res.stderr);
  };
  g(["init", "-b", "main"]);
  g(["config", "core.autocrlf", "false"]);
  g(["config", "user.name", "Test User"]);
  g(["config", "user.email", "test@example.com"]);
  fs.writeFileSync(path.join(r, "README.md"), "# target\n");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  return r;
}

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-scout-"));
  return {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "workspace"),
    worktreesDir: path.join(root, "workspace", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: RESEARCH_TOOLS,
      agentsFile: path.join(root, "roles.json"),
      systemPromptFile: path.join(root, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: RESEARCH_TOOLS, agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: ["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"],
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  };
}

describe("web tools are part of every coding run (scout adds nothing extra)", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, ...extra });
  const mk = (fixture: string, argsFile: string) => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: fixture, FAKE_CLAUDE_GIT_COMMIT: "1", FAKE_CLAUDE_ARGS_FILE: argsFile }) });
  };
  const readArgs = (f: string) => JSON.parse(fs.readFileSync(f, "utf8")) as string[];
  const allowedSection = (args: string[]): string[] => {
    const i = args.indexOf("--allowedTools");
    const out: string[] = [];
    for (let k = i + 1; k < args.length && !args[k]!.startsWith("--"); k++) out.push(args[k]!);
    return out;
  };

  beforeEach(() => {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  it("(a) plain coding run has web tools", async () => {
    const f = path.join(cfg.repoRoot, "a.json");
    mk(FIX_COMMIT, f);
    const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" });
    await mgr.waitFor(rec.id);
    const args = readArgs(f);
    for (const t of WEB) expect(args).toContain(t);
  }, 120_000);

  it("(b) scout run adds nothing beyond the plain web baseline, Edit/Write stay scoped, disallowedTools kept; (c) follow-up does not inherit", async () => {
    const plainFile = path.join(cfg.repoRoot, "plain.json");
    mk(FIX_COMMIT, plainFile);
    const plain = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" });
    await mgr.waitFor(plain.id);

    const f = path.join(cfg.repoRoot, "b.json");
    mk(FIX_COMMIT, f);
    const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike", scout: true });
    const done = (await mgr.waitFor(rec.id))!;
    const args = readArgs(f);
    const wt = done.worktree_path!.replace(/\\/g, "/");
    for (const t of WEB) expect(args).toContain(t);
    expect(args).toContain(`Edit(${wt}/**)`);
    expect(args).toContain(`Write(${wt}/**)`);
    expect(args).not.toContain("Edit");
    expect(args).not.toContain("Write");
    expect(args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--disallowedTools") + 4)).toEqual(cfg.defaults.coding.disallowedTools);
    const norm = (a: string[], w: string, rd: string) => allowedSection(a).map((t) => t.replace(w, "<wt>").replace(rd, "<rd>"));
    const plainRec = store.getRun(plain.id)!;
    const plainWt = plainRec.worktree_path!.replace(/\\/g, "/");
    const extra = norm(args, wt, done.run_dir.replace(/\\/g, "/")).filter((t) => !norm(readArgs(plainFile), plainWt, plainRec.run_dir.replace(/\\/g, "/")).includes(t));
    expect(extra).toEqual([]);

    const f2 = path.join(cfg.repoRoot, "c.json");
    mk(FIX_COMMIT, f2);
    const fu = await mgr.followup(rec.id, "hỏi tiếp");
    await mgr.waitFor(fu.id);
    const fargs = readArgs(f2);
    for (const t of WEB) expect(fargs).toContain(t);
  }, 120_000);

  it("research run ignores scout: allowedTools identical to a plain research run", async () => {
    const f1 = path.join(cfg.repoRoot, "r1.json");
    mk("roles", f1);
    const r1 = await mgr.startRun({ prompt: "Phân tích website example.com" });
    await mgr.waitFor(r1.id);
    const f2 = path.join(cfg.repoRoot, "r2.json");
    mk("roles", f2);
    const r2 = await mgr.startRun({ prompt: "Phân tích website example.com", scout: true });
    await mgr.waitFor(r2.id);
    expect(allowedSection(readArgs(f2))).toEqual(allowedSection(readArgs(f1)));
    expect(allowedSection(readArgs(f2))).toEqual(expect.arrayContaining(RESEARCH_TOOLS));
  }, 120_000);
});
