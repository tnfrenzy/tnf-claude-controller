import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_COMMIT = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const PREAMBLE_SRC = path.resolve(__dirname, "..", "..", "config", "queue-preamble.md");
const TOKEN = "a".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];
const PROJECT = "appr";

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-appr-"));
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
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const q = (suffix = "") => `${base}/api/projects/${PROJECT}/queue${suffix}`;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) });

function add(id: string, sourceRef: string): void {
  started.manager.queue.addCommands(PROJECT, [{ id, title: id, body: `Làm việc ${id}`, files: [`src/${id}.ts`], sourceRef }], { hasRepo: true });
}
const status = (id: string) => started.manager.queue.get(PROJECT, id)?.status;

describe("queue approve-all API", () => {
  it("rejects requests without token (401)", async () => {
    expect((await fetch(q("/approve-all"), { method: "POST" })).status).toBe(401);
  });

  it("missing or invalid sourceRef is 400", async () => {
    expect((await post(q("/approve-all"))).status).toBe(400);
    expect((await post(q("/approve-all"), { sourceRef: "" })).status).toBe(400);
    expect((await post(q("/approve-all"), { sourceRef: 5 })).status).toBe(400);
  });

  it("approves only pending commands of the given idea and starts nothing", async () => {
    add("a1", "idea-A");
    add("a2", "idea-A");
    add("a3", "idea-A");
    add("a4", "idea-A");
    add("b1", "idea-B");
    started.manager.queue.transition(PROJECT, "a3", "đã duyệt");
    started.manager.queue.transition(PROJECT, "a4", "bỏ qua");
    const r = await post(q("/approve-all"), { sourceRef: "idea-A" });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { approved: string[] };
    expect(body.approved.sort()).toEqual(["a1", "a2"]);
    expect(status("a1")).toBe("đã duyệt");
    expect(status("a2")).toBe("đã duyệt");
    expect(status("a3")).toBe("đã duyệt");
    expect(status("a4")).toBe("bỏ qua");
    expect(status("b1")).toBe("chờ duyệt");
    expect(started.manager.queue.list(PROJECT).some((c) => c.status === "đang chạy")).toBe(false);
    expect(started.manager.queueRunAll.status(PROJECT).active).toBe(false);
  });

  it("returns empty list when nothing is pending", async () => {
    const r = await post(q("/approve-all"), { sourceRef: "idea-none" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { approved: string[] }).approved).toEqual([]);
  });
});
