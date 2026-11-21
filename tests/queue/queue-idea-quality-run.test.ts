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
import { lessonsPath, readLessons } from "../../src/core/ideas/lessons.js";
const SPLIT_FIX = path.resolve(__dirname, "..", "..", "fixtures", "queue-split.stream.jsonl");

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


describe("idea quality: queued command prompt and outcome", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;

  function setup(extraEnv: Record<string, string>, queueExtra: Record<string, unknown> = {}): void {
    cfg = tmpConfig();
    Object.assign(cfg.queue, queueExtra);
    store = new RunStore(":memory:");
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: PROJECT, repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX_COMMIT, ...extraEnv } });
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

  it("embeds the idea blueprint and the command contract between the body and the preamble", async () => {
    setup({ FAKE_CLAUDE_GIT_COMMIT: "1" });
    const body = "Thêm nút xuất báo cáo";
    mgr.queue.addCommands(PROJECT, [{ id: "ui", title: "UI", body, sourceRef: "idea1", verify: "npx vitest run tests/ui.test.ts", consumes: ["buildReport"], acceptance: ["Nút hiện ở trang lịch sử"] }], { hasRepo: true });
    mgr.queue.setIdeaMeta(PROJECT, "idea1", { blueprint: { goal: "Xuất báo cáo CSV", constraints: [], architecture: "", interfaces: [{ owner: "core", name: "buildReport(rows)", description: "" }] } });
    mgr.queue.transition(PROJECT, "ui", "đã duyệt");
    const rec = await mgr.startQueuedCommand(PROJECT, "ui");
    await mgr.waitFor(rec.id);
    const prompt = store.getRun(rec.id)!.prompt;
    const preamble = buildQueuePreamble(cfg);
    expect(prompt.startsWith(`${body}\n\n`)).toBe(true);
    expect(prompt.endsWith(preamble)).toBe(true);
    const goal = prompt.indexOf("Xuất báo cáo CSV");
    expect(goal).toBeGreaterThan(body.length);
    expect(goal).toBeLessThan(prompt.indexOf(preamble));
    expect(prompt).toContain("Dùng (consumes): buildReport");
    expect(prompt).toContain("- Nút hiện ở trang lịch sử");
  });
  it('a failed queued command writes one lesson line (deduplicated) when queue.lessons is on', async () => {
    setup({}, { lessons: { enabled: true } });
    mgr.queue.addCommands(PROJECT, [{ id: 'f1', title: 'Nút xuất', body: 'Làm nút', ideaTitle: 'Báo cáo', files: ['ui/a.tsx'], verify: 'npm test' }], { hasRepo: true });
    mgr.queue.transition(PROJECT, 'f1', 'đã duyệt');
    const rec = await mgr.startQueuedCommand(PROJECT, 'f1');
    await mgr.waitFor(rec.id);
    await waitStatus('f1', 'lỗi');
    const file = lessonsPath(cfg.dataDir, PROJECT);
    const text = fs.readFileSync(file, 'utf8');
    expect(text).toContain('Lệnh "Nút xuất" (f1, ý tưởng "Báo cáo") lỗi');
    expect(text).toContain('không có commit');
    expect(readLessons(cfg.dataDir, PROJECT).split("\n")).toHaveLength(1);
  });

  it('lessons off: a failed command writes nothing', async () => {
    setup({}, { lessons: { enabled: false } });
    mgr.queue.addCommands(PROJECT, [{ id: 'f2', title: 'X', body: 'Làm X' }], { hasRepo: true });
    mgr.queue.transition(PROJECT, 'f2', 'đã duyệt');
    const rec = await mgr.startQueuedCommand(PROJECT, 'f2');
    await mgr.waitFor(rec.id);
    await waitStatus('f2', 'lỗi');
    expect(fs.existsSync(lessonsPath(cfg.dataDir, PROJECT))).toBe(false);
  });

  it('kind research runs read-only (no worktree, no commit) and ends merged so dependents unlock', async () => {
    setup({ FAKE_CLAUDE_FIXTURE: SPLIT_FIX, FAKE_CLAUDE_ARGS_FILE: path.join(os.tmpdir(), 'tnf-research-args-' + process.pid + '.json') });
    mgr.queue.addCommands(PROJECT, [{ id: 'r1', title: 'Khảo sát', body: 'Tìm hiểu cách xuất CSV', kind: 'research' }, { id: 'c2', title: 'Làm', body: 'Làm', dependsOn: ['r1'] }], { hasRepo: true });
    mgr.queue.transition(PROJECT, 'r1', 'đã duyệt');
    const rec = await mgr.startQueuedCommand(PROJECT, 'r1');
    await mgr.waitFor(rec.id);
    await waitStatus('r1', 'đã gộp');
    const run = store.getRun(rec.id)!;
    expect(run.kind).toBe('research');
    expect(run.worktree_path ?? null).toBeNull();
    expect(run.prompt).not.toContain(buildQueuePreamble(cfg));
    const argv = JSON.parse(fs.readFileSync(path.join(os.tmpdir(), 'tnf-research-args-' + process.pid + '.json'), 'utf8')) as string[];
    const at = argv.indexOf('--allowedTools');
    const allowed: string[] = [];
    for (let i = at + 1; i < argv.length && !argv[i]!.startsWith('--'); i++) allowed.push(argv[i]!);
    expect(allowed.join(' ')).toContain('Read(');
    expect(allowed.join(' ')).not.toMatch(/Edit|Write|Bash/);
    expect(mgr.queue.get(PROJECT, 'r1')!.branch).toBeNull();
  });
});
