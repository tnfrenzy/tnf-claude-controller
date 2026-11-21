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

function tmpConfig(maxParallel: number): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qall-"));
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
    queue: { maxParallel, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [], splitter: { webSearch: true, maxWebCalls: 20 } },
  } as unknown as ControllerConfig;
}

describe("run-all options for startQueuedCommand", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  let repo: string;

  function setup(extraEnv: Record<string, string>, maxParallel = 2): void {
    cfg = tmpConfig(maxParallel);
    store = new RunStore(":memory:");
    repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: PROJECT, repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX_COMMIT, ...extraEnv } });
  }
  function approved(id: string, dependsOn: string[] = []): void {
    mgr.queue.addCommands(PROJECT, [{ id, title: id, body: `Làm ${id}`, dependsOn, files: [`src/${id}.ts`] }], { hasRepo: true });
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

  it("(a)(b) committed dep: default refuses; runAll starts from the dep branch", async () => {
    setup({ FAKE_CLAUDE_GIT_COMMIT: "1" });
    approved("a");
    const ra = await mgr.startQueuedCommand(PROJECT, "a");
    await mgr.waitFor(ra.id);
    await waitStatus("a", "đã commit");
    approved("b", ["a"]);
    await expect(mgr.startQueuedCommand(PROJECT, "b")).rejects.toThrow(/chờ gộp a/);
    const depBranch = mgr.queue.get(PROJECT, "a")!.branch!;
    const depHead = runGit(repo, ["rev-parse", depBranch]).stdout.trim();
    expect(depHead).not.toBe(runGit(repo, ["rev-parse", "main"]).stdout.trim());
    const rb = await mgr.startQueuedCommand(PROJECT, "b", { unlockMode: "runAll" });
    await mgr.waitFor(rb.id);
    expect(store.getRun(rb.id)!.base_sha).toBe(depHead);
  });

  it("(c) maxParallel=2 + runAll starts two in parallel; the third waits", async () => {
    setup({ FAKE_CLAUDE_HANG: "1" }, 2);
    approved("s1");
    approved("s2");
    approved("s3");
    const r1 = await mgr.startQueuedCommand(PROJECT, "s1", { unlockMode: "runAll" });
    const r2 = await mgr.startQueuedCommand(PROJECT, "s2", { unlockMode: "runAll" });
    await expect(mgr.startQueuedCommand(PROJECT, "s3", { unlockMode: "runAll" })).rejects.toThrow(/chờ chỗ/);
    expect(mgr.queue.get(PROJECT, "s3")!.status).toBe("đã duyệt");
    mgr.cancel(r1.id);
    mgr.cancel(r2.id);
    await mgr.waitFor(r1.id);
    await mgr.waitFor(r2.id);
  });

  it("(e) maxParallel=3 + runAll starts three in parallel; the fourth waits", async () => {
    setup({ FAKE_CLAUDE_HANG: "1" }, 3);
    for (const id of ["s1", "s2", "s3", "s4"]) approved(id);
    const runs = [];
    for (const id of ["s1", "s2", "s3"]) runs.push(await mgr.startQueuedCommand(PROJECT, id, { unlockMode: "runAll" }));
    await expect(mgr.startQueuedCommand(PROJECT, "s4", { unlockMode: "runAll" })).rejects.toThrow(/chờ chỗ/);
    expect(mgr.queue.get(PROJECT, "s4")!.status).toBe("đã duyệt");
    for (const r of runs) mgr.cancel(r.id);
    for (const r of runs) await mgr.waitFor(r.id);
  });

  it("(d) maxParallel=1 + runAll starts one; the second waits", async () => {
    setup({ FAKE_CLAUDE_HANG: "1" }, 1);
    approved("s1");
    approved("s2");
    const r1 = await mgr.startQueuedCommand(PROJECT, "s1", { unlockMode: "runAll" });
    await expect(mgr.startQueuedCommand(PROJECT, "s2", { unlockMode: "runAll" })).rejects.toThrow(/chờ chỗ/);
    expect(mgr.queue.get(PROJECT, "s2")!.status).toBe("đã duyệt");
    mgr.cancel(r1.id);
    await mgr.waitFor(r1.id);
  });
});
