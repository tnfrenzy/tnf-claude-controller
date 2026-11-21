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
const PROJECT = "rapi";

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-rapi-"));
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

const q = (suffix = "") => `${base}/api/projects/${PROJECT}/queue${suffix}`;
const post = (url: string, body?: unknown) => fetch(url, { method: "POST", headers: H, body: JSON.stringify(body ?? {}) });

function add(id: string, approve: boolean): void {
  started.manager.queue.addCommands(PROJECT, [{ id, title: id, body: `Làm việc ${id}`, files: [`src/${id}.ts`] }], { hasRepo: true });
  if (approve) started.manager.queue.transition(PROJECT, id, "đã duyệt");
}

describe("queue run-all API", () => {
  it("rejects requests without token (401)", async () => {
    expect((await fetch(q("/run-all"), { method: "POST" })).status).toBe(401);
    expect((await fetch(q("/run-all/stop"), { method: "POST" })).status).toBe(401);
  });

  it("start with nothing approved is 409 (not 404), GET exposes runAll", async () => {
    add("pending1", false);
    const r = await post(q("/run-all"));
    expect(r.status).toBe(409);
    const g = (await (await fetch(q(), { headers: H })).json()) as { runAll: { active: boolean } };
    expect(g.runAll.active).toBe(false);
    started.manager.queue.transition(PROJECT, "pending1", "bỏ qua");
  });

  it("start -> active, second start 409, stop -> inactive; a command named run-all does not break the route", async () => {
    add("run-all", true);
    const r = await post(q("/run-all"));
    expect(r.status).toBe(200);
    expect(((await r.json()) as { runAll: { active: boolean } }).runAll.active).toBe(true);
    expect((await post(q("/run-all"))).status).toBe(409);
    const s = await post(q("/run-all/stop"));
    expect(s.status).toBe(200);
    expect(((await s.json()) as { runAll: { active: boolean } }).runAll.active).toBe(false);
    const g = (await (await fetch(q(), { headers: H })).json()) as { runAll: { active: boolean } };
    expect(g.runAll.active).toBe(false);
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000 && started.manager.queue.get(PROJECT, "run-all")?.status === "đang chạy") {
      await new Promise((res) => setTimeout(res, 50));
    }
  });

  it("GET exposes runIds (array, empty before any run) for each command", async () => {
    add("fresh1", false);
    const g = (await (await fetch(q(), { headers: H })).json()) as { commands: { id: string; runIds: string[] }[] };
    for (const c of g.commands) expect(Array.isArray(c.runIds)).toBe(true);
    expect(g.commands.find((c) => c.id === "fresh1")?.runIds).toEqual([]);
    started.manager.queue.transition(PROJECT, "fresh1", "bỏ qua");
  });

  it("rejects a non-string sourceRef with 400", async () => {
    expect((await post(q("/run-all"), { sourceRef: 5 })).status).toBe(400);
    expect((await post(q("/run-all"), { sourceRef: "" })).status).toBe(400);
  });

  it("start scoped to one idea reports runAll.sourceRef", async () => {
    started.manager.queue.addCommands(PROJECT, [{ id: "ideaA1", title: "A1", body: "Làm A1", files: ["src/a1.ts"], sourceRef: "A" }], { hasRepo: true });
    started.manager.queue.transition(PROJECT, "ideaA1", "đã duyệt");
    const r = await post(q("/run-all"), { sourceRef: "A" });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { runAll: { sourceRef: string | null } }).runAll.sourceRef).toBe("A");
    await post(q("/run-all/stop"));
    const t0 = Date.now();
    while (Date.now() - t0 < 30_000 && started.manager.queue.get(PROJECT, "ideaA1")?.status === "đang chạy") {
      await new Promise((res) => setTimeout(res, 50));
    }
  });
});
