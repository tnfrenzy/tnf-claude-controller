import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import type { QueueStatus } from "../../src/core/queue/queue-store.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_COMMIT = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const PREAMBLE_SRC = path.resolve(__dirname, "..", "..", "config", "queue-preamble.md");
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];
const PROJECT = "spike";
const IDEA = "idea-A";

function makeRepo(root: string): string {
  const r = path.join(root, "target-repo");
  fs.mkdirSync(r, { recursive: true });
  const g = (args: string[]) => {
    const res = runGit(r, args);
    if (res.code !== 0) throw new Error(res.stderr);
    return res.stdout.trim();
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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qidea-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.copyFileSync(PREAMBLE_SRC, path.join(root, "config", "queue-preamble.md"));
  return {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }],
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
    queue: { maxParallel: 2, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [], splitter: { webSearch: true, maxWebCalls: 20 } },
  } as unknown as ControllerConfig;
}

describe("idea run-all reuses one worktree/branch", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;

  function setup(): void {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: PROJECT, repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({
      config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE],
      env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" },
    });
  }
  function approved(id: string, dependsOn: string[] = [], sourceRef = IDEA): void {
    mgr.queue.addCommands(PROJECT, [{ id, title: id, body: `Làm ${id}`, dependsOn, files: [`src/${id}.ts`], sourceRef }], { hasRepo: true });
    mgr.queue.transition(PROJECT, id, "đã duyệt");
  }
  async function waitStatus(id: string, want: QueueStatus, timeoutMs = 30_000): Promise<void> {
    const t0 = Date.now();
    while (Date.now() - t0 < timeoutMs) {
      if (mgr.queue.get(PROJECT, id)?.status === want) return;
      await new Promise((r) => setTimeout(r, 50));
    }
    throw new Error(`Lệnh ${id} không tới "${want}" (đang "${mgr.queue.get(PROJECT, id)?.status}")`);
  }

  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  it("(a)(b)(c) second idea task runs in the first task's worktree from its new HEAD", async () => {
    setup();
    approved("t1");
    approved("t2", ["t1"]);
    const r1 = await mgr.startQueuedCommand(PROJECT, "t1", { unlockMode: "runAll", ideaRef: IDEA });
    await mgr.waitFor(r1.id);
    await waitStatus("t1", "đã commit");
    const run1 = store.getRun(r1.id)!;
    const head1 = runGit(run1.worktree_path!, ["rev-parse", "HEAD"]).stdout.trim();
    expect(head1).not.toBe(run1.base_sha);

    const r2 = await mgr.startQueuedCommand(PROJECT, "t2", { unlockMode: "runAll", ideaRef: IDEA });
    await mgr.waitFor(r2.id);
    const run2 = store.getRun(r2.id)!;
    expect(run2.worktree_path).toBe(run1.worktree_path);
    expect(run2.branch).toBe(run1.branch);
    expect(run2.base_sha).toBe(head1);
    expect(run2.base_sha).not.toBe(run1.base_sha);
    await waitStatus("t2", "đã commit");
    expect(mgr.queue.get(PROJECT, "t1")!.branch).toBe(mgr.queue.get(PROJECT, "t2")!.branch);
  });

  it("(d) without ideaRef a new worktree is created", async () => {
    setup();
    approved("t1");
    approved("t2", ["t1"]);
    const r1 = await mgr.startQueuedCommand(PROJECT, "t1", { unlockMode: "runAll", ideaRef: IDEA });
    await mgr.waitFor(r1.id);
    await waitStatus("t1", "đã commit");
    const r2 = await mgr.startQueuedCommand(PROJECT, "t2", { unlockMode: "runAll" });
    await mgr.waitFor(r2.id);
    const run1 = store.getRun(r1.id)!;
    const run2 = store.getRun(r2.id)!;
    expect(run2.worktree_path).not.toBe(run1.worktree_path);
    expect(run2.branch).not.toBe(run1.branch);
  });
});
