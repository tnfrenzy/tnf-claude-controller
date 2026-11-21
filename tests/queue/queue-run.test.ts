import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import { buildQueuePreamble } from "../../src/core/queue/queue-preamble.js";
import type { QueueStatus } from "../../src/core/queue/queue-store.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_COMMIT = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const PREAMBLE_SRC = path.resolve(__dirname, "..", "..", "config", "queue-preamble.md");
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];
const PROJECT = "spike";

/** Throwaway target repo with one commit on main (identity set locally; the machine has none). */
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

function tmpConfig(maxParallel = 2): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qrun-"));
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

describe("queued command runs with fake CLI", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, ...extra });

  function setup(extraEnv: Record<string, string>, maxParallel = 2): void {
    cfg = tmpConfig(maxParallel);
    store = new RunStore(":memory:");
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: PROJECT, repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, ...extraEnv }) });
  }

  /** Add a command and approve it. */
  function approved(id: string, extra: { body?: string; dependsOn?: string[]; files?: string[] } = {}): void {
    mgr.queue.addCommands(PROJECT, [{ id, title: id, body: extra.body ?? `Làm việc ${id}`, dependsOn: extra.dependsOn, files: extra.files }], { hasRepo: true });
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

  describe("with commits", () => {
    beforeEach(() => setup({ FAKE_CLAUDE_GIT_COMMIT: "1" }));

    it("case 1: finished run with a commit -> command is 'đã commit' with runId, branch and real cost", async () => {
      approved("c1");
      const rec = await mgr.startQueuedCommand(PROJECT, "c1");
      await mgr.waitFor(rec.id);
      await waitStatus("c1", "đã commit");
      const cmd = mgr.queue.get(PROJECT, "c1")!;
      const run = store.getRun(rec.id)!;
      expect(cmd.runId).toBe(rec.id);
      expect(cmd.branch).toBe(`tnf/${PROJECT}/${rec.id}`);
      expect(run.status).toBe("done");
      expect(run.cost_usd_est).toBeGreaterThan(0);
      expect(cmd.estCostUsd).toBeCloseTo(run.cost_usd_est);
    });

    it("case 3: releaseRun succeeds -> command is 'đã gộp'", async () => {
      approved("c3");
      const rec = await mgr.startQueuedCommand(PROJECT, "c3");
      await mgr.waitFor(rec.id);
      await waitStatus("c3", "đã commit");
      const r = mgr.releaseRun(rec.id);
      expect(r.merged).toBe(true);
      expect(mgr.queue.get(PROJECT, "c3")!.status).toBe("đã gộp");
    });

    it("case 4: refused while dependsOn is not merged; command stays 'đã duyệt' and no run is created", async () => {
      approved("a");
      approved("b", { dependsOn: ["a"] });
      const before = store.listRuns({}).length;
      await expect(mgr.startQueuedCommand(PROJECT, "b")).rejects.toThrow(/chờ a/);
      expect(mgr.queue.get(PROJECT, "b")!.status).toBe("đã duyệt");
      expect(mgr.queue.get(PROJECT, "b")!.runId).toBeNull();
      expect(store.listRuns({}).length).toBe(before);
    });

    it("case 6: preamble comes after the body and ends the prompt", async () => {
      const body = "Thêm hàm sub vào src/sub.js";
      approved("c6", { body });
      const rec = await mgr.startQueuedCommand(PROJECT, "c6");
      await mgr.waitFor(rec.id);
      const prompt = store.getRun(rec.id)!.prompt;
      const preamble = buildQueuePreamble(cfg);
      expect(preamble.length).toBeGreaterThan(0);
      expect(prompt.indexOf(body)).toBe(0);
      expect(prompt.indexOf(body)).toBeLessThan(prompt.indexOf(preamble));
      expect(prompt.endsWith(preamble)).toBe(true);
      expect(prompt).toBe(`${body}\n\n${preamble}`);
    });

    it("case 7: a plain run is unaffected (no queue.json, no preamble, normal status)", async () => {
      const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: PROJECT });
      const done = (await mgr.waitFor(rec.id))!;
      expect(done.status).toBe("done");
      expect(done.commits).toHaveLength(1);
      expect(done.prompt).toBe("Thêm hàm sub");
      expect(done.prompt).not.toContain(buildQueuePreamble(cfg));
      expect(fs.existsSync(path.join(cfg.dataDir, "projects", PROJECT, "queue.json"))).toBe(false);
    });
  });

  describe("active-based slots and chain liveness", () => {
    beforeEach(() => setup({ FAKE_CLAUDE_GIT_COMMIT: "1" }));

    const mkRun = (id: string, parent: string | null = null, status: "running" | "done" = "running") =>
      store.createRun({
        id, status, prompt: "p", mode: "coding", model: "sonnet", session_id: null, parent_run_id: parent,
        project: PROJECT, claude_version: null, run_dir: cfg.repoRoot, kind: "coding",
      });
    const setActive = (id: string) => (mgr as unknown as { active: Map<string, unknown> }).active.set(id, {});
    const clearActive = (id: string) => (mgr as unknown as { active: Map<string, unknown> }).active.delete(id);

    it("(a) orphan DB runs do not take parallel slots", async () => {
      mkRun("o1");
      mkRun("o2");
      expect(mgr.codingActiveCount()).toBe(0);
      approved("x1");
      const rec = await mgr.startQueuedCommand(PROJECT, "x1");
      await mgr.waitFor(rec.id);
      expect(mgr.queue.get(PROJECT, "x1")!.runId).toBe(rec.id);
    });

    it("(b) isQueueRunLive follows follow-up children", () => {
      mkRun("pa");
      mkRun("pb", "pa");
      approved("y1");
      mgr.queue.transition(PROJECT, "y1", "đang chạy", { runId: "pa" });
      const cmd = mgr.queue.get(PROJECT, "y1")!;
      expect(mgr.queueChainRunIds(cmd).sort()).toEqual(["pa", "pb"]);
      expect(mgr.isQueueRunLive(cmd)).toBe(false);
      setActive("pb");
      expect(mgr.isQueueRunLive(cmd)).toBe(true);
      clearActive("pb");
      expect(mgr.isQueueRunLive(cmd)).toBe(false);
    });

    it("(c) closeOrphanQueueRuns closes orphans in the chain, skips live and unrelated runs", () => {
      mkRun("ca");
      mkRun("cb", "ca");
      mkRun("cc", "ca");
      mkRun("other");
      approved("z1");
      mgr.queue.transition(PROJECT, "z1", "đang chạy", { runId: "ca" });
      setActive("cc");
      const closed = mgr.closeOrphanQueueRuns(mgr.queue.get(PROJECT, "z1")!);
      expect(closed.sort()).toEqual(["ca", "cb"]);
      expect(store.getRun("ca")!.status).toBe("error");
      expect(store.getRun("ca")!.error).toContain("xác nhận tay");
      expect(store.getRun("cb")!.status).toBe("error");
      expect(store.getRun("cc")!.status).toBe("running");
      expect(store.getRun("other")!.status).toBe("running");
      clearActive("cc");
    });

    const sync = (id: string) => (mgr as unknown as { syncQueueOnExit(r: string, p: string): void }).syncQueueOnExit(id, PROJECT);
    const finish = (id: string, commits: boolean) =>
      store.updateRun(id, { status: "done", commits: commits ? [{ hash: "abc1234", subject: "feat: x" }] : [] });

    it("syncQueueOnExit: follow-up of a running command with a commit -> 'đã commit' with the new runId", () => {
      mkRun("fa", null, "done");
      mkRun("fb", "fa");
      approved("f1");
      mgr.queue.transition(PROJECT, "f1", "đang chạy", { runId: "fa" });
      finish("fb", true);
      sync("fb");
      const cmd = mgr.queue.get(PROJECT, "f1")!;
      expect(cmd.status).toBe("đã commit");
      expect(cmd.runId).toBe("fb");
    });

    it("syncQueueOnExit: failed command rescued by a follow-up with a commit; without commit it stays 'lỗi'", () => {
      mkRun("ga", null, "done");
      mkRun("gb", "ga");
      mkRun("gc", "ga");
      approved("g1");
      mgr.queue.transition(PROJECT, "g1", "đang chạy", { runId: "ga" });
      mgr.queue.transition(PROJECT, "g1", "lỗi");
      finish("gb", false);
      sync("gb");
      expect(mgr.queue.get(PROJECT, "g1")!.status).toBe("lỗi");
      finish("gc", true);
      sync("gc");
      const cmd = mgr.queue.get(PROJECT, "g1")!;
      expect(cmd.status).toBe("đã commit");
      expect(cmd.runId).toBe("gc");
    });

    it("syncQueueOnExit: follow-up without a commit sends a running command to 'lỗi'; unrelated run changes nothing", () => {
      mkRun("ha", null, "done");
      mkRun("hb", "ha");
      mkRun("unrelated");
      approved("h1");
      mgr.queue.transition(PROJECT, "h1", "đang chạy", { runId: "ha" });
      finish("unrelated", true);
      sync("unrelated");
      expect(mgr.queue.get(PROJECT, "h1")!.status).toBe("đang chạy");
      finish("hb", false);
      sync("hb");
      expect(mgr.queue.get(PROJECT, "h1")!.status).toBe("lỗi");
    });
  });

  it("case 2: run without a commit -> command is 'lỗi'", async () => {
    setup({});
    approved("c2");
    const rec = await mgr.startQueuedCommand(PROJECT, "c2");
    await mgr.waitFor(rec.id);
    await waitStatus("c2", "lỗi");
    const cmd = mgr.queue.get(PROJECT, "c2")!;
    expect(cmd.runId).toBe(rec.id);
    expect(cmd.status).toBe("lỗi");
  });

  it("case 5: refused when no slot is free, including two back-to-back calls without await", async () => {
    setup({ FAKE_CLAUDE_HANG: "1" }, 1);
    approved("s1");
    approved("s2");
    approved("s3");
    // Two calls at once: only one may take the single slot.
    const settled = await Promise.allSettled([mgr.startQueuedCommand(PROJECT, "s1"), mgr.startQueuedCommand(PROJECT, "s2")]);
    const ok = settled.filter((s) => s.status === "fulfilled");
    const bad = settled.filter((s) => s.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect(String((bad[0] as PromiseRejectedResult).reason)).toMatch(/chờ chỗ/);
    // The slot is now held by a really running run: a third command is refused too.
    await expect(mgr.startQueuedCommand(PROJECT, "s3")).rejects.toThrow(/chờ chỗ/);
    expect(mgr.queue.get(PROJECT, "s3")!.status).toBe("đã duyệt");
    const runningCmd = mgr.queue.list(PROJECT).find((c) => c.status === "đang chạy")!;
    expect(runningCmd).toBeTruthy();
    mgr.cancel(runningCmd.runId!);
    await mgr.waitFor(runningCmd.runId!);
  });
});
