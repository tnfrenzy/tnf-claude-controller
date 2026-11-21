import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import type { QueueStatus } from "../../src/core/queue/queue-store.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_COMMIT = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const PREAMBLE_SRC = path.resolve(__dirname, "..", "..", "config", "queue-preamble.md");
const TOKEN = "q".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];
const PROJECT = "qapi";

let started: StartedServer;
let base: string;
let root: string;

function makeRepo(dir: string): string {
  const r = path.join(dir, "target-repo");
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

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-qapi-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  fs.copyFileSync(PREAMBLE_SRC, path.join(root, "config", "queue-preamble.md"));
  const config = {
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
    queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [] },
  } as unknown as ControllerConfig;
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" },
  });
  base = `http://127.0.0.1:${started.policy.port}`;
  started.manager.store.upsertProject({ name: PROJECT, repo_path: makeRepo(root), base_branch: "main", allowed_commands: [] });
  started.manager.store.upsertProject({ name: "default", repo_path: null, base_branch: "main", allowed_commands: [] });
  started.manager.store.upsertProject({ name: "norepo", repo_path: null, base_branch: "main", allowed_commands: [] });
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const q = (suffix = "", name = PROJECT) => `${base}/api/projects/${name}/queue${suffix}`;

function add(id: string, extra: { body?: string; dependsOn?: string[]; files?: string[] } = {}, approve = false): void {
  started.manager.queue.addCommands(PROJECT, [{ id, title: id, body: extra.body ?? `Làm việc ${id}`, dependsOn: extra.dependsOn, files: extra.files }], { hasRepo: true });
  if (approve) started.manager.queue.transition(PROJECT, id, "đã duyệt");
}

async function waitStatus(id: string, want: QueueStatus, timeoutMs = 30_000): Promise<void> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    if (started.manager.queue.get(PROJECT, id)?.status === want) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error(`Lệnh ${id} không tới "${want}"`);
}

const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) });
const patch = (url: string, body: unknown) => fetch(url, { method: "PATCH", headers: H, body: JSON.stringify(body) });

describe("queue API", () => {
  it("rejects requests without token (401)", async () => {
    expect((await fetch(q())).status).toBe(401);
    expect((await fetch(q("/x"), { method: "PATCH", headers: { "content-type": "application/json" }, body: "{}" })).status).toBe(401);
    expect((await fetch(q("/x/skip"), { method: "POST" })).status).toBe(401);
  });

  it("returns 404 for unknown project, 400 for default/no-repo project, 404 for unknown command", async () => {
    const nf = await fetch(q("", "ghost"), { headers: H });
    expect(nf.status).toBe(404);
    expect(((await nf.json()) as { error: string }).error).toBe("project_not_found");
    for (const name of ["default", "norepo"]) {
      const r = await fetch(q("", name), { headers: H });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("no_repo");
    }
    expect((await patch(q("/nope"), { title: "x" })).status).toBe(404);
    expect((await post(q("/nope/skip"))).status).toBe(404);
    expect((await post(q("/nope/approve-run"))).status).toBe(404);
  });

  it("GET returns commands with references, warnings, locks and cost note", async () => {
    started.manager.queue.addCommands(
      PROJECT,
      [{ id: "g1", title: "g1", body: "Xem https://example.com/doc rồi làm", files: ["src/g1.ts"], references: [{ url: "https://example.com/doc", note: "tài liệu" }] } as never],
      { hasRepo: true },
    );
    const r = await fetch(q(), { headers: H });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { commands: Record<string, any>[]; costNote: string; totalEstimatedCostUsd: number; maxParallel: number };
    const c = j.commands.find((x) => x.id === "g1")!;
    expect(c.status).toBe("chờ duyệt");
    expect(Array.isArray(c.references)).toBe(true);
    expect(Array.isArray(c.warnings)).toBe(true);
    expect(c.locks.edit.locked).toBe(false);
    expect(c.locks.skip).toBeDefined();
    expect(c.locks.approveRun).toBeDefined();
    expect(typeof j.costNote).toBe("string");
    expect(j.costNote.length).toBeGreaterThan(0);
    expect(typeof j.totalEstimatedCostUsd).toBe("number");
    expect(j.maxParallel).toBeGreaterThan(0);
  });

  it("PATCH rejects forbidden pattern, stores URL with warning, resets approved to pending, 409 when ran", async () => {
    add("p1", {}, true);
    const bad = await patch(q("/p1"), { body: "chạy git push origin main" });
    expect(bad.status).toBe(400);
    expect(started.manager.queue.get(PROJECT, "p1")!.body).toBe("Làm việc p1");

    expect((await patch(q("/p1"), { title: 5 })).status).toBe(400);
    expect((await patch(q("/p1"), { dependsOn: ["p1"] })).status).toBe(400);
    expect((await patch(q("/p1"), { dependsOn: ["khong-co"] })).status).toBe(400);
    expect((await patch(q("/p1"), {})).status).toBe(400);

    const ok = await patch(q("/p1"), { body: "Đọc https://example.com/x rồi sửa", title: "Tiêu đề mới" });
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { command: { status: string; title: string; warnings: string[] } };
    expect(j.command.status).toBe("chờ duyệt");
    expect(j.command.title).toBe("Tiêu đề mới");
    expect(j.command.warnings.join(" ")).toMatch(/URL/);
    expect(started.manager.queue.get(PROJECT, "p1")!.warnings?.join(" ")).toMatch(/URL/);

    started.manager.queue.transition(PROJECT, "p1", "bỏ qua");
    expect((await patch(q("/p1"), { title: "lại" })).status).toBe(409);
  });

  it("skip: 200 then 409 when it cannot transition", async () => {
    add("s1");
    const r = await post(q("/s1/skip"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { command: { status: string } }).command.status).toBe("bỏ qua");
    expect((await post(q("/s1/skip"))).status).toBe(409);
    expect((await post(q("/s1/approve-run"))).status).toBe(409);
  });

  it("approve-run creates a run; refused (started:false) while dependency is unmerged", async () => {
    add("a1");
    add("a2", { dependsOn: ["a1"] });
    const blocked = await post(q("/a2/approve-run"));
    expect(blocked.status).toBe(200);
    const bj = (await blocked.json()) as { started: boolean; reasons: string[] };
    expect(bj.started).toBe(false);
    expect(bj.reasons.length).toBeGreaterThan(0);

    const r = await post(q("/a1/approve-run"));
    expect(r.status).toBe(200);
    const j = (await r.json()) as { started: boolean; run: { id: string } };
    expect(j.started).toBe(true);
    await started.manager.waitFor(j.run.id);
    await waitStatus("a1", "đã commit");
    expect(started.manager.queue.get(PROJECT, "a1")!.runId).toBe(j.run.id);
  });

  it("run-parallel: validates input, rejects violating group with reasons per command, runs a valid group", async () => {
    expect((await post(q("/run-parallel"), { ids: "x" })).status).toBe(400);
    expect((await post(q("/run-parallel"), { ids: [] })).status).toBe(400);
    expect((await post(q("/run-parallel"), { ids: ["khong-co"] })).status).toBe(404);

    add("x1", { files: ["src/same.ts"] });
    add("x2", { files: ["src/same.ts"] });
    const before = started.manager.store.listRuns({}).length;
    const bad = await post(q("/run-parallel"), { ids: ["x1", "x2"] });
    expect(bad.status).toBe(200);
    const bj = (await bad.json()) as { started: unknown[]; rejected: { id: string; reasons: string[] }[] };
    expect(bj.started).toEqual([]);
    expect(bj.rejected.map((x) => x.id).sort()).toEqual(["x1", "x2"]);
    for (const x of bj.rejected) expect(x.reasons.join(" ")).toMatch(/src\/same\.ts/);
    expect(started.manager.store.listRuns({}).length).toBe(before);
    expect(started.manager.queue.get(PROJECT, "x1")!.runId).toBeNull();

    add("y1", { files: ["src/y1.ts"] });
    add("y2", { files: ["src/y2.ts"] });
    const ok = await post(q("/run-parallel"), { ids: ["y1", "y2"] });
    expect(ok.status).toBe(200);
    const oj = (await ok.json()) as { started: { id: string; run: { id: string } }[]; rejected: unknown[] };
    expect(oj.rejected).toEqual([]);
    expect(oj.started.map((s) => s.id).sort()).toEqual(["y1", "y2"]);
    for (const s of oj.started) await started.manager.waitFor(s.run.id);
  });
});

describe("queue API manual recovery actions", () => {
  const mgr = () => started.manager;
  const active = () => (mgr() as unknown as { active: Map<string, unknown> }).active;
  const mkRun = (id: string, parent: string | null = null, commits = 0) => {
    mgr().store.createRun({
      id, status: "running", prompt: "p", mode: "coding", model: "sonnet", session_id: null, parent_run_id: parent,
      project: PROJECT, claude_version: null, run_dir: root, kind: "coding",
    });
    if (commits) mgr().store.updateRun(id, { commits: Array.from({ length: commits }, (_, i) => ({ hash: `abc${i}`, subject: "feat: x" })) });
  };
  /** Command in status "đang chạy" with a DB run (orphan unless put into active). */
  const running = (id: string, runId: string, commits = 0) => {
    add(id, {}, true);
    mkRun(runId, null, commits);
    mgr().queue.transition(PROJECT, id, "đang chạy", { runId });
  };
  const status = (id: string) => mgr().queue.get(PROJECT, id)!.status;
  const cmdOf = async (id: string) => {
    const j = (await (await fetch(q(), { headers: H })).json()) as { commands: Record<string, any>[] };
    return j.commands.find((c) => c.id === id)!;
  };

  it("confirm-done: orphan running -> đã commit and closes orphan run; wrong state -> 409", async () => {
    running("r1", "run-r1");
    const r = await post(q("/r1/confirm-done"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { command: { status: string } }).command.status).toBe("đã commit");
    expect(mgr().store.getRun("run-r1")!.status).toBe("error");
    expect((await post(q("/r1/confirm-done"))).status).toBe(409);
    add("r1b");
    expect((await post(q("/r1b/confirm-done"))).status).toBe(409);
  });

  it("confirm-done: from 'lỗi' -> đã commit keeps runId", async () => {
    running("r2", "run-r2");
    mgr().queue.transition(PROJECT, "r2", "lỗi");
    const r = await post(q("/r2/confirm-done"));
    expect(r.status).toBe(200);
    expect(mgr().queue.get(PROJECT, "r2")!.runId).toBe("run-r2");
  });

  it("confirm-done and mark-failed with a live run -> 409 and the run is not closed", async () => {
    running("l1", "run-l1");
    active().set("run-l1", {});
    try {
      expect((await post(q("/l1/confirm-done"))).status).toBe(409);
      expect((await post(q("/l1/mark-failed"))).status).toBe(409);
      expect(status("l1")).toBe("đang chạy");
      expect(mgr().store.getRun("run-l1")!.status).toBe("running");
      expect((await cmdOf("l1")).runLive).toBe(true);
    } finally {
      active().delete("run-l1");
    }
  });

  it("mark-failed: orphan running -> lỗi and closes orphan run; wrong state -> 409", async () => {
    running("m1", "run-m1");
    const r = await post(q("/m1/mark-failed"));
    expect(r.status).toBe(200);
    expect(status("m1")).toBe("lỗi");
    expect(mgr().store.getRun("run-m1")!.status).toBe("error");
    expect((await post(q("/m1/mark-failed"))).status).toBe(409);
  });

  it("confirm-merged unlocks the dependent command; wrong state -> 409", async () => {
    add("d1", {}, true);
    add("d2", { dependsOn: ["d1"] }, true);
    expect((await post(q("/d1/confirm-merged"))).status).toBe(409);
    running("dd", "run-dd");
    mgr().queue.transition(PROJECT, "dd", "đã commit");
    const r = await post(q("/dd/confirm-merged"));
    expect(r.status).toBe(200);
    expect(status("dd")).toBe("đã gộp");
    mgr().queue.transition(PROJECT, "d1", "đang chạy");
    mgr().queue.transition(PROJECT, "d1", "đã commit");
    expect((await post(q("/d1/confirm-merged"))).status).toBe(200);
    const c = await cmdOf("d2");
    expect(c.locks.approveRun.reasons.join(" ")).not.toMatch(/chờ d1/);
  });

  it("retry: lỗi -> đã duyệt without starting; wrong state -> 409; approve-run from lỗi -> 409", async () => {
    running("t1", "run-t1");
    mgr().queue.transition(PROJECT, "t1", "lỗi");
    expect((await post(q("/t1/approve-run"))).status).toBe(409);
    expect(status("t1")).toBe("lỗi");
    const r = await post(q("/t1/retry"));
    expect(r.status).toBe(200);
    expect(status("t1")).toBe("đã duyệt");
    expect(mgr().queue.get(PROJECT, "t1")!.runId).toBeNull();
    expect((await post(q("/t1/retry"))).status).toBe(409);
  });

  it("unskip: bỏ qua -> chờ duyệt; wrong state -> 409", async () => {
    add("u1");
    expect((await post(q("/u1/unskip"))).status).toBe(409);
    await post(q("/u1/skip"));
    const r = await post(q("/u1/unskip"));
    expect(r.status).toBe(200);
    expect(status("u1")).toBe("chờ duyệt");
  });

  it("two orphan runs do not block approve-run of another command after confirm-done", async () => {
    const q0 = mgr().config.queue.maxParallel;
    mgr().config.queue.maxParallel = 2;
    try {
      running("o1", "run-o1");
      mkRun("run-o2");
      add("o3", {}, true);
      expect((await post(q("/o1/confirm-done"))).status).toBe(200);
      const r = await post(q("/o3/approve-run"));
      expect(r.status).toBe(200);
      const j = (await r.json()) as { started: boolean; reasons?: string[]; run?: { id: string } };
      expect(j.reasons?.join(" ") ?? "").not.toMatch(/Không đủ chỗ|chờ chỗ/);
      expect(j.started).toBe(true);
      await mgr().waitFor(j.run!.id);
    } finally {
      mgr().config.queue.maxParallel = q0;
    }
  });

  it("describe returns runLive and runCommitCount", async () => {
    running("v1", "run-v1", 2);
    const c = await cmdOf("v1");
    expect(c.runLive).toBe(false);
    expect(c.runCommitCount).toBe(2);
    add("v2");
    const c2 = await cmdOf("v2");
    expect(c2.runLive).toBe(false);
    expect(c2.runCommitCount).toBe(0);
  });
});
