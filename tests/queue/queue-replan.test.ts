import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import { QueueStore } from "../../src/core/queue/queue-store.js";
import { queueSpent } from "../../src/core/queue/queue-budget.js";
import { loadReplan, replanCosts, replanDir, runReplan, type ReplanDeps } from "../../src/core/queue/queue-replan.js";
import type { ReadOnlySpec } from "../../src/core/run/run-manager.js";

const PROJ = "demo";

function cmd(over: Record<string, unknown> = {}): Record<string, unknown> {
  return { id: "n", title: "N", body: "Làm N", files: ["src/n.ts"], dependsOn: [], verify: "npm test", size: 1, ...over };
}
function fence(commands: unknown[], remove: unknown[] = []): string {
  return "Đề xuất:\n```json\n" + JSON.stringify({ commands, remove }) + "\n```\n";
}

describe("queue-replan", () => {
  let root: string;
  let cfg: ControllerConfig;
  let queue: QueueStore;
  let repo: string;
  let calls: { prompt: string; readOnly: ReadOnlySpec; maxBudgetUsd?: number }[];
  let reply: { status: string; result_text?: string; cost_usd_est?: number; error?: string };

  function git(args: string[]): void {
    const r = runGit(repo, args);
    if (r.code !== 0) throw new Error(`git ${args.join(" ")}: ${r.stderr}`);
  }

  function deps(): ReplanDeps {
    return {
      config: cfg,
      queue,
      getProject: (n) => (n === PROJ ? { repo_path: repo, base_branch: "main" } : null),
      manager: {
        startRun: async (input) => {
          calls.push(input);
          return { id: `r${calls.length}` } as never;
        },
        waitFor: async (id) => ({ id, ...reply }) as never,
      },
    };
  }

  function enable(on: boolean): void {
    (cfg.queue as { replan: { enabled: boolean } }).replan = { enabled: on };
  }

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-replan-"));
    cfg = {
      dataDir: path.join(root, "data"),
      queue: { maxParallel: 2, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [], splitter: { webSearch: true, maxWebCalls: 20 } },
    } as unknown as ControllerConfig;
    repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    for (const a of [["init", "-b", "main"], ["config", "user.name", "T"], ["config", "user.email", "t@example.com"]]) git(a);
    fs.writeFileSync(path.join(repo, "a.txt"), "a\n");
    git(["add", "-A"]);
    git(["commit", "-m", "init"]);
    git(["checkout", "-b", "tnf/src"]);
    fs.writeFileSync(path.join(repo, "feature.txt"), "feature line\n");
    git(["add", "-A"]);
    git(["commit", "-m", "feat: feature"]);
    git(["checkout", "main"]);
    queue = new QueueStore(cfg.dataDir);
    queue.addCommands(
      PROJ,
      [
        { id: "src", title: "Nguồn", body: "b" },
        { id: "pend", title: "Chờ", body: "b" },
        { id: "appr", title: "Duyệt", body: "b" },
        { id: "run", title: "Chạy", body: "b" },
      ],
      { hasRepo: true },
    );
    queue.transition(PROJ, "src", "đã duyệt");
    queue.transition(PROJ, "src", "đang chạy", { runId: "x" });
    queue.transition(PROJ, "src", "đã commit", { branch: "tnf/src", estCostUsd: 0.5 });
    queue.transition(PROJ, "src", "đã gộp");
    queue.transition(PROJ, "appr", "đã duyệt");
    queue.transition(PROJ, "run", "đã duyệt");
    queue.transition(PROJ, "run", "đang chạy", { runId: "y" });
    calls = [];
    reply = { status: "done", result_text: fence([cmd()]), cost_usd_est: 0.3 };
  });
  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  const input = { project: PROJ, sourceId: "src", branch: "tnf/src" };

  it("does nothing when disabled", async () => {
    const r = await runReplan(deps(), input);
    expect(r.ran).toBe(false);
    expect(calls).toHaveLength(0);
    expect(loadReplan(replanDir(cfg.dataDir, PROJ)).runs).toEqual([]);
  });

  it("runs when enabled, with read-only tools and the real diff in the prompt", async () => {
    enable(true);
    const r = await runReplan(deps(), input);
    expect(r.ran).toBe(true);
    expect(calls).toHaveLength(1);
    const c = calls[0]!;
    expect(c.prompt).toContain("feature.txt");
    expect(c.prompt).toContain("feature line");
    expect(c.prompt).toContain("pend [chờ duyệt]");
    expect(c.readOnly.allowedTools.join(" ")).not.toMatch(/Bash|Edit|Write/);
    expect(r.proposals.map((p) => p.kind)).toEqual(["thêm"]);
    expect(queue.get(PROJ, "n")!.status).toBe("chờ duyệt");
  });

  it("proposes edit/remove for pending commands only; approved and running are untouched", async () => {
    enable(true);
    reply.result_text = fence(
      [cmd({ id: "pend", body: "Làm lại" }), cmd({ id: "appr", body: "Sửa" }), cmd({ id: "run", body: "Sửa" }), cmd({ id: "src", body: "Sửa" })],
      ["pend", "appr", "run"],
    );
    const before = queue.list(PROJ).map((c) => ({ id: c.id, body: c.body, status: c.status }));
    const r = await runReplan(deps(), input);
    const edits = r.proposals.filter((p) => p.kind === "sửa").map((p) => p.targetId);
    const removes = r.proposals.filter((p) => p.kind === "bỏ").map((p) => p.targetId);
    expect(edits).toEqual(["pend"]);
    expect(removes).toEqual(["pend"]);
    expect(r.rejected.length).toBe(5);
    const after = queue.list(PROJ).map((c) => ({ id: c.id, body: c.body, status: c.status }));
    expect(after).toEqual(before);
    expect(loadReplan(replanDir(cfg.dataDir, PROJ)).proposals).toHaveLength(2);
  });

  it("rejects unsafe bodies", async () => {
    enable(true);
    reply.result_text = fence([cmd({ id: "pend", body: "chạy git push origin main" })]);
    const r = await runReplan(deps(), input);
    expect(r.proposals).toEqual([]);
    expect(r.rejected.join(" ")).toMatch(/git push/);
  });

  it("adds the replan cost to the queue budget, including failed runs", async () => {
    enable(true);
    const dir = replanDir(cfg.dataDir, PROJ);
    const base = queueSpent(queue.list(PROJ), replanCosts(dir));
    await runReplan(deps(), input);
    expect(replanCosts(dir)).toEqual([0.3]);
    expect(queueSpent(queue.list(PROJ), replanCosts(dir))).toBeCloseTo(base + 0.3, 5);
    reply = { status: "error", error: "hết ngân sách", cost_usd_est: 0.2 };
    const r = await runReplan(deps(), input);
    expect(r.proposals).toEqual([]);
    expect(replanCosts(dir)).toEqual([0.3, 0.2]);
  });

  it("skips when the queue budget is reached", async () => {
    enable(true);
    (cfg.queue as { maxBudgetUsd: number }).maxBudgetUsd = 0.5;
    const r = await runReplan(deps(), input);
    expect(r.ran).toBe(false);
    expect(calls).toHaveLength(0);
  });
});
