import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";
import { runGit } from "../../src/core/git/git.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "t".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const PATCH =
  "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n";

let started: StartedServer;
let base: string;
let root: string;
let parentId: string;
let worktree: string;

const post = (body: unknown, headers: Record<string, string> = H) =>
  fetch(`${base}/api/runs/${parentId}/followup`, { method: "POST", headers, body: JSON.stringify(body) });

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-dca-"));
  const config: ControllerConfig = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: ["Agent"],
      agentsFile: path.join(root, "roles.json"),
      systemPromptFile: path.join(root, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
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
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_WRITE_ARTIFACTS: "1" },
    openDirectory: () => undefined,
  });
  base = `http://127.0.0.1:${started.policy.port}`;

  const repo = path.join(root, "proj-repo");
  fs.mkdirSync(repo, { recursive: true });
  const g = (args: string[]) => {
    const res = runGit(repo, args);
    if (res.code !== 0) throw new Error(res.stderr);
  };
  g(["init", "-b", "main"]);
  g(["config", "user.name", "T"]);
  g(["config", "user.email", "t@example.com"]);
  fs.writeFileSync(path.join(repo, "a.txt"), "a");
  g(["add", "-A"]);
  g(["commit", "-m", "init"]);
  const created = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "spike", repo_path: repo, base_branch: "main" }) });
  expect(created.status).toBe(201);
  const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "sửa", project: "spike" }) });
  expect(r.status).toBe(201);
  const { run } = (await r.json()) as { run: { id: string; kind: string; run_dir: string; worktree_path: string } };
  expect(run.kind).toBe("coding");
  parentId = run.id;
  await started.manager.waitFor(run.id);
  const rec = started.manager.store.getRun(run.id)!;
  worktree = rec.worktree_path ?? "";
  fs.writeFileSync(path.join(rec.run_dir, "diff.patch"), PATCH);
  if (!rec.session_id) started.manager.store.updateRun(run.id, { session_id: "sess-1" });
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const ok = { file: "src/a.ts", line: 1, text: "đổi tên hàm" };

describe("POST /api/runs/:id/followup with comments", () => {
  it("rejects a missing token", async () => {
    const res = await post({ comments: [ok] }, { "content-type": "application/json" });
    expect(res.status).toBe(401);
  });
  it("rejects a foreign Origin", async () => {
    const res = await post({ comments: [ok] }, { ...H, origin: "http://evil.example" });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: string }).error).toBe("bad_origin");
  });
  it("400 invalid_comments for a file outside the diff", async () => {
    const res = await post({ comments: [{ file: "other.ts", line: 1, text: "x" }] });
    expect(res.status).toBe(400);
    const j = (await res.json()) as { error: string; message: string };
    expect(j.error).toBe("invalid_comments");
    expect(j.message).toMatch(/diff|nhận xét|tệp|file/i);
  });
  it("400 invalid_comments for 51 comments", async () => {
    const res = await post({ comments: Array.from({ length: 51 }, () => ok) });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_comments");
  });
  it("400 invalid_comments for a 2001-char comment", async () => {
    const res = await post({ comments: [{ ...ok, text: "a".repeat(2001) }] });
    expect(res.status).toBe(400);
    expect(((await res.json()) as { error: string }).error).toBe("invalid_comments");
  });
  it("400 empty_followup for empty prompt without comments or with []", async () => {
    for (const body of [{ prompt: "" }, { prompt: "  ", comments: [] }, {}]) {
      const res = await post(body);
      expect(res.status).toBe(400);
      expect(((await res.json()) as { error: string }).error).toBe("empty_followup");
    }
  });
  it("201 child run whose prompt lists 'file:dòng — nhận xét'", async () => {
    const res = await post({ comments: [ok] });
    expect(res.status).toBe(201);
    const { run } = (await res.json()) as { run: { id: string; parent_run_id: string } };
    expect(run.parent_run_id).toBe(parentId);
    expect(started.manager.store.getRun(run.id)!.prompt).toContain("src/a.ts:1 — đổi tên hàm");
    await started.manager.waitFor(run.id);
    expect(fs.existsSync(worktree)).toBe(true);
  });
  it("50 x 2000 chars is not rejected by the body limit or validation", async () => {
    // the previous child run regenerated diff.patch from the real worktree; restore the sample patch
    fs.writeFileSync(path.join(started.manager.store.getRun(parentId)!.run_dir, "diff.patch"), PATCH);
    const text = "b".repeat(2000);
    const res = await post({ comments: Array.from({ length: 50 }, () => ({ file: "src/a.ts", line: 1, text })) });
    expect(res.status).not.toBe(413);
    const j = (await res.json()) as { error?: string; run?: { id: string } };
    expect(j.error).not.toBe("invalid_comments");
    expect(res.status).toBe(201);
    await started.manager.waitFor(j.run!.id);
  });
});
