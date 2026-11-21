import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_OK = path.resolve(__dirname, "..", "..", "fixtures", "queue-split.stream.jsonl");
const TOKEN = "s".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];
const PROJECT = "splapi";
const IDEA = "Thêm tính năng xuất báo cáo cho trang lịch sử";

let started: StartedServer;
let base: string;
let root: string;
const env: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_FIXTURE: FIX_OK };
let argsCounter = 0;

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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-splapi-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
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
    queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [], splitter: { webSearch: true, maxWebCalls: 20 } },
  } as unknown as ControllerConfig;
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env });
  base = `http://127.0.0.1:${started.policy.port}`;
  started.manager.store.upsertProject({ name: PROJECT, repo_path: makeRepo(root), base_branch: "main", allowed_commands: [] });
  started.manager.store.upsertProject({ name: "default", repo_path: null, base_branch: "main", allowed_commands: [] });
  started.manager.store.upsertProject({ name: "norepo", repo_path: null, base_branch: "main", allowed_commands: [] });
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const sp = (suffix = "", name = PROJECT) => `${base}/api/projects/${name}/queue/split${suffix}`;
const post = (body: unknown, name = PROJECT) => fetch(sp("", name), { method: "POST", headers: H, body: JSON.stringify(body) });

interface JobBody {
  runId: string;
  state: "running" | "done" | "error";
  commands?: number;
  costUsd?: number;
  error?: string;
}

async function getJob(runId: string, name = PROJECT): Promise<JobBody> {
  const r = await fetch(sp(`/${runId}`, name), { headers: H });
  expect(r.status).toBe(200);
  return (await r.json()) as JobBody;
}

async function waitDone(runId: string, timeoutMs = 60_000): Promise<JobBody> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const j = await getJob(runId);
    if (j.state !== "running") return j;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("split job không xong");
}

/** Start a split with its own args file, wait for the job to finish, return argv given to the fake CLI. */
async function splitWithArgs(body: Record<string, unknown>): Promise<string[]> {
  const argsFile = path.join(root, `args-${argsCounter++}.json`);
  env["FAKE_CLAUDE_ARGS_FILE"] = argsFile;
  try {
    const r = await post({ idea: IDEA, ...body });
    expect(r.status).toBe(202);
    const { runId } = (await r.json()) as { runId: string };
    const j = await waitDone(runId);
    expect(j.state).toBe("done");
    return JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
  } finally {
    delete env["FAKE_CLAUDE_ARGS_FILE"];
  }
}

function allowedToolsOf(args: string[]): string {
  const i = args.indexOf("--allowedTools");
  expect(i).toBeGreaterThanOrEqual(0);
  return args.slice(i + 1, i + 40).join(" ");
}

describe("queue split API", () => {
  it("rejects requests without token (401) and with a foreign Origin", async () => {
    expect((await fetch(sp(), { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ idea: IDEA }) })).status).toBe(401);
    expect((await fetch(sp("/x"))).status).toBe(401);
    const bad = await fetch(sp(), { method: "POST", headers: { ...H, origin: "http://evil.example.com" }, body: JSON.stringify({ idea: IDEA }) });
    expect(bad.status).toBeGreaterThanOrEqual(400);
    expect(bad.status).not.toBe(202);
  });

  it("returns 404 for unknown project and 400 no_repo for default/no-repo projects", async () => {
    expect((await post({ idea: IDEA }, "ghost")).status).toBe(404);
    for (const name of ["default", "norepo"]) {
      const r = await post({ idea: IDEA }, name);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("no_repo");
    }
  });

  it("validates idea and webSearch (400)", async () => {
    expect((await post({ idea: "" })).status).toBe(400);
    expect((await post({ idea: "   \n " })).status).toBe(400);
    expect((await post({})).status).toBe(400);
    expect((await post({ idea: 42 })).status).toBe(400);
    const long = await post({ idea: "á".repeat(2001) });
    expect(long.status).toBe(400);
    // length is counted after trim: 2000 chars padded with spaces is still accepted size-wise (checked in the OK case below)
    const en = await post({ idea: "Add an export button to the history page" });
    expect(en.status).toBe(400);
    expect(((await en.json()) as { message: string }).message).toMatch(/tiếng Việt/);
    expect((await post({ idea: IDEA, webSearch: "yes" })).status).toBe(400);
  });

  it("returns 404 for an unknown run id", async () => {
    expect((await fetch(sp("/nope"), { headers: H })).status).toBe(404);
  });

  it("accepts a valid idea (202), finishes with 2 commands, pending approval", async () => {
    const r = await post({ idea: `  ${IDEA}  ` });
    expect(r.status).toBe(202);
    const { runId } = (await r.json()) as { runId: string };
    expect(runId).toBeTruthy();
    const j = await waitDone(runId);
    expect(j.state).toBe("done");
    expect(j.commands).toBe(2);
    expect(typeof j.costUsd).toBe("number");
    const list = await fetch(`${base}/api/projects/${PROJECT}/queue`, { headers: H });
    expect(list.status).toBe(200);
    const pending = started.manager.queue.list(PROJECT).filter((c) => c.sourceRef === runId);
    expect(pending).toHaveLength(2);
    expect(pending.every((c) => c.status === "chờ duyệt")).toBe(true);
    // a job of another project is not visible
    expect((await fetch(sp(`/${runId}`, "norepo"), { headers: H })).status).toBe(400);
  });

  it("answers 409 split_busy for a second request while one is running", async () => {
    const [a, b] = await Promise.all([post({ idea: IDEA }), post({ idea: IDEA })]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([202, 409]);
    const ok = a.status === 202 ? a : b;
    const bad = a.status === 409 ? a : b;
    expect(((await bad.json()) as { error: string }).error).toBe("split_busy");
    const { runId } = (await ok.json()) as { runId: string };
    expect((await waitDone(runId)).state).toBe("done");
  });

  it("webSearch false has no WebSearch/WebFetch tools, true has them", async () => {
    const off = allowedToolsOf(await splitWithArgs({ webSearch: false }));
    expect(off).not.toMatch(/WebSearch|WebFetch/);
    const on = allowedToolsOf(await splitWithArgs({ webSearch: true }));
    expect(on).toMatch(/WebSearch/);
    expect(on).toMatch(/WebFetch/);
  });

  it("omitted webSearch follows config queue.splitter.webSearch", async () => {
    const cfg = started.manager.config.queue as unknown as { splitter: { webSearch: boolean } };
    const saved = cfg.splitter.webSearch;
    try {
      cfg.splitter.webSearch = false;
      expect(allowedToolsOf(await splitWithArgs({}))).not.toMatch(/WebSearch|WebFetch/);
      cfg.splitter.webSearch = true;
      expect(allowedToolsOf(await splitWithArgs({}))).toMatch(/WebSearch/);
    } finally {
      cfg.splitter.webSearch = saved;
    }
  });

  it("scout source: valid ref stored on commands; bad input 400; default stays manual", async () => {
    const ref = "20261028-120000-abc123#fix-login";
    const r = await post({ idea: IDEA, source: "scout", sourceRef: ref });
    expect(r.status).toBe(202);
    const { runId } = (await r.json()) as { runId: string };
    expect((await waitDone(runId)).state).toBe("done");
    const scoutCmds = started.manager.queue.list(PROJECT).filter((c) => c.sourceRef === ref);
    expect(scoutCmds.length).toBeGreaterThan(0);
    expect(scoutCmds.every((c) => c.source === "scout" && c.status === "chờ duyệt")).toBe(true);

    expect((await post({ idea: IDEA, source: "scout" })).status).toBe(400);
    expect((await post({ idea: IDEA, source: "scout", sourceRef: "bad ref" })).status).toBe(400);
    expect((await post({ idea: IDEA, source: "scout", sourceRef: "abc#UPPER" })).status).toBe(400);
    expect((await post({ idea: IDEA, source: "weird", sourceRef: ref })).status).toBe(400);
    expect((await post({ idea: IDEA, sourceRef: ref })).status).toBe(400);

    const m = await post({ idea: IDEA });
    expect(m.status).toBe(202);
    const mid = ((await m.json()) as { runId: string }).runId;
    await waitDone(mid);
    const manual = started.manager.queue.list(PROJECT).filter((c) => c.sourceRef === mid);
    expect(manual.length).toBeGreaterThan(0);
    expect(manual.every((c) => c.source === "manual")).toBe(true);
  });

  it("/api/status exposes queue.splitter", async () => {
    const r = await fetch(`${base}/api/status`, { headers: H });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { queue?: { splitter: { webSearch: boolean; maxWebCalls: number } } };
    expect(body.queue?.splitter).toEqual({ webSearch: true, maxWebCalls: 20 });
  });
});
