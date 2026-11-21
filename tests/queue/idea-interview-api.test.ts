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
const PROJECT = "ivapi";
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
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ivapi-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  const config = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }, { id: "opus", label: "opus" }],
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
    queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [], splitter: { webSearch: false, maxWebCalls: 20, interview: true, critic: true, autoIntegrate: true }, lessons: { enabled: true } },
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


const fx = (name: string) => path.resolve(__dirname, "..", "..", "fixtures", `${name}.stream.jsonl`);
const sp = (suffix = "") => `${base}/api/projects/${PROJECT}/queue/split${suffix}`;
const post = (url: string, body: unknown) => fetch(url, { method: "POST", headers: H, body: JSON.stringify(body) });
let seqN = 0;
/** Replay `names` in order for the next agent runs. */
function sequence(names: string[]): void {
  env["FAKE_CLAUDE_SEQUENCE"] = names.map(fx).join("|");
  env["FAKE_CLAUDE_COUNTER_FILE"] = path.join(root, `seq-${seqN++}.txt`);
}

interface Job { runId: string; state: string; stage?: string; questions?: string[]; commands?: number; error?: string }
async function waitState(id: string, done: (j: Job) => boolean, timeoutMs = 60_000): Promise<Job> {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const r = await fetch(sp(`/${id}`), { headers: H });
    if (r.status === 200) {
      const j = (await r.json()) as Job;
      if (done(j)) return j;
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error("job không tới trạng thái mong đợi");
}
const settled = (j: Job) => j.state !== "running";

describe("idea interview API", () => {
  it("questions -> persisted awaiting_user -> answers -> split with critic and auto commands", async () => {
    sequence(["idea-interview-questions"]);
    const r = await post(sp(), { idea: IDEA });
    expect(r.status).toBe(202);
    const { runId } = (await r.json()) as { runId: string };
    const j = await waitState(runId, settled);
    expect(j.state).toBe("questions");
    expect(j.questions).toEqual(["Xuất CSV hay PDF?", "Có cần lọc theo ngày không?"]);
    const file = path.join(root, "data", "projects", PROJECT, "interviews", `${runId}.json`);
    expect(JSON.parse(fs.readFileSync(file, "utf8")).state).toBe("awaiting_user");
    const list = (await (await fetch(`${base}/api/projects/${PROJECT}/queue`, { headers: H })).json()) as { interviews: Array<{ id: string; questions: string[] }> };
    expect(list.interviews.map((i) => i.id)).toContain(runId);

    sequence(["idea-split-blueprint", "idea-critic-ok"]);
    const a = await post(sp(`/${runId}/answers`), { answers: ["CSV", "Có"] });
    expect(a.status).toBe(202);
    expect(((await a.json()) as { runId: string }).runId).toBe(runId);
    const done = await waitState(runId, (x) => x.state === "done" || x.state === "error");
    expect(done.error).toBeUndefined();
    expect(done.state).toBe("done");
    expect(done.commands).toBe(4);
    expect(fs.existsSync(file)).toBe(false);
    const view = (await (await fetch(`${base}/api/projects/${PROJECT}/queue`, { headers: H })).json()) as {
      commands: Array<{ id: string; auto?: string; sourceRef: string }>;
      ideas: Record<string, { interview?: { answers: string[] }; blueprint?: { goal: string } }>;
    };
    const auto = view.commands.filter((c) => c.auto);
    expect(auto.map((c) => c.auto)).toEqual(["integrate", "final-review"]);
    const meta = view.ideas[auto[0]!.sourceRef]!;
    expect(meta.interview!.answers).toEqual(["CSV", "Có"]);
    expect(meta.blueprint!.goal).toMatch(/CSV/);
  });

  it("a pending interview written before a restart is still served from disk", async () => {
    const { savePendingInterview } = await import("../../src/core/ideas/idea-interview-store.js");
    savePendingInterview(path.join(root, "data"), { id: "old-run-1", project: PROJECT, idea: IDEA, source: "manual", webSearch: false, questions: ["Q1?"], state: "awaiting_user", createdAt: 1, costUsd: 0.01 });
    const j = (await (await fetch(sp("/old-run-1"), { headers: H })).json()) as Job;
    expect(j).toMatchObject({ state: "questions", questions: ["Q1?"] });
  });

  it("skip answers lets the splitter decide; dismiss removes; unknown id is 404", async () => {
    const { savePendingInterview, loadPendingInterview } = await import("../../src/core/ideas/idea-interview-store.js");
    const dataDir = path.join(root, "data");
    savePendingInterview(dataDir, { id: "skip-run-1", project: PROJECT, idea: IDEA, source: "manual", webSearch: false, questions: ["Q1?"], state: "awaiting_user", createdAt: 2, costUsd: 0 });
    sequence(["idea-split-blueprint", "idea-critic-ok"]);
    expect((await post(sp("/skip-run-1/answers"), { skip: true })).status).toBe(202);
    expect((await waitState("skip-run-1", (x) => x.state === "done" || x.state === "error")).state).toBe("done");
    const ideas = started.manager.queue.listIdeaMeta(PROJECT);
    expect(Object.values(ideas).some((m) => m.interview?.skipped === true)).toBe(true);

    savePendingInterview(dataDir, { id: "drop-run-1", project: PROJECT, idea: IDEA, source: "manual", webSearch: false, questions: ["Q?"], state: "awaiting_user", createdAt: 3, costUsd: 0 });
    expect((await post(sp("/drop-run-1/answers"), { dismiss: true })).status).toBe(200);
    expect(loadPendingInterview(dataDir, PROJECT, "drop-run-1")).toBeNull();
    expect((await post(sp("/nope/answers"), { answers: [] })).status).toBe(404);
    expect((await post(sp("/skip-run-1/answers"), { answers: "x" })).status).toBe(404);
  });

  it("ready interview goes straight to the split in the same job; skipInterview skips the interviewer", async () => {
    sequence(["idea-interview-ready", "idea-split-blueprint", "idea-critic-ok"]);
    const r = await post(sp(), { idea: IDEA });
    const { runId } = (await r.json()) as { runId: string };
    const j = await waitState(runId, settled);
    expect(j.state).toBe("done");
    expect(j.commands).toBe(4);

    sequence(["idea-split-blueprint", "idea-critic-ok"]);
    const r2 = await post(sp(), { idea: IDEA, skipInterview: true });
    const id2 = ((await r2.json()) as { runId: string }).runId;
    const j2 = await waitState(id2, settled);
    expect(j2.state).toBe("done");
    expect(started.manager.queue.list(PROJECT).filter((c) => c.sourceRef === id2)).toHaveLength(4);
    expect((await post(sp(), { idea: IDEA, skipInterview: "yes" })).status).toBe(400);
  });
});
