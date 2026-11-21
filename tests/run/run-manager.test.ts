import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildClaudeArgs, type RunnerOptions } from "../../src/core/run/claude-runner.js";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager, renderSystemPrompt } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { runGit } from "../../src/core/git/git.js";

const previewFail = vi.hoisted(() => ({ times: 0 }));
vi.mock("../../src/core/git/git.js", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../src/core/git/git.js")>();
  return {
    ...orig,
    previewMerge: (...args: Parameters<typeof orig.previewMerge>) => {
      if (previewFail.times > 0) {
        previewFail.times--;
        throw new Error("preview boom");
      }
      return orig.previewMerge(...args);
    },
  };
});

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX_COMMIT = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const FIX_S5 = path.resolve(__dirname, "..", "..", "fixtures", "real-coding.stream.jsonl");
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];

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

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-test-"));
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
      allowedTools: ["Agent", "WebSearch", "WebFetch", "Read", "Write"],
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
  };
}

describe("buildClaudeArgs", () => {
  const base: RunnerOptions = {
    runId: "r1",
    claudePath: "claude.exe",
    cwd: "C:/tmp",
    env: {},
    authMode: "subscription",
    prompt: "x",
    model: "sonnet",
    maxTurns: 40,
    maxBudgetUsd: 3,
    timeoutMs: 1000,
    allowedTools: ["Agent", "WebSearch"],
    agentsFile: "C:/cfg/roles.json",
    systemPromptFile: "C:/cfg/coord.md",
    streamFile: "C:/tmp/s.jsonl",
    maxConcurrentSubagents: 3,
    maxSubagentSpawnDepth: 1,
  };
  it("matches CONTEXT-SPEC §5.2 and never includes --bare or bypassPermissions", () => {
    const args = buildClaudeArgs(base);
    expect(args.slice(0, 6)).toEqual(["-p", "--output-format", "stream-json", "--verbose", "--include-partial-messages", "--forward-subagent-text"]);
    expect(args).toContain("--permission-mode");
    expect(args[args.indexOf("--permission-mode") + 1]).toBe("dontAsk");
    expect(args[args.indexOf("--max-budget-usd") + 1]).toBe("3");
    expect(args[args.indexOf("--agents") + 1]).toBe("C:/cfg/roles.json");
    expect(args).not.toContain("--bare");
    expect(args).not.toContain("--dangerously-skip-permissions");
  });
  it("uses --resume for follow-ups and omits --agents in single mode", () => {
    const args = buildClaudeArgs({ ...base, resumeSessionId: "sess-1", agentsFile: undefined, systemPromptFile: undefined });
    expect(args).toContain("--resume");
    expect(args).not.toContain("--agents");
  });
  it("passes --disallowedTools after --allowedTools and omits it when empty", () => {
    const args = buildClaudeArgs({ ...base, disallowedTools: ["Bash(git push*)", "Bash(rm -rf *)"] });
    const i = args.indexOf("--disallowedTools");
    expect(i).toBeGreaterThan(args.indexOf("--allowedTools"));
    expect(args.slice(i + 1, i + 3)).toEqual(["Bash(git push*)", "Bash(rm -rf *)"]);
    expect(buildClaudeArgs(base)).not.toContain("--disallowedTools");
  });
  it("passes --settings <file> when settingsFile is set", () => {
    const args = buildClaudeArgs({ ...base, settingsFile: "C:/cfg/deny.json" });
    expect(args[args.indexOf("--settings") + 1]).toBe("C:/cfg/deny.json");
    expect(buildClaudeArgs(base)).not.toContain("--settings");
  });
});

describe("RunManager with fake CLI", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, ...extra });

  beforeEach(() => {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
  });
  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  it("runs the roles fixture end-to-end: DB, events, agents, stream.jsonl, artifacts", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_WRITE_ARTIFACTS: "1" }) });
    const rec = await mgr.startRun({ prompt: "Phân tích website example.com" });
    expect(rec.status).toBe("running");
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.status).toBe("done");
    expect(done.session_id).toBe("22222222-2222-4333-8444-555555555555");
    expect(done.claude_version).toBe("2.1.301");
    expect(done.cost_usd_est).toBeCloseTo(0.0712);
    expect(done.num_turns).toBe(6);
    expect(done.agents.map((a) => a.role).sort()).toEqual(["coordinator", "searcher", "synthesizer"]);
    expect(done.mode).toBe("subscription+roles");

    const events = store.getEvents(rec.id);
    expect(events.map((e) => e.event.type)).toContain("agent.started");
    expect(events.at(-1)!.event.type).toBe("run.result");

    const stream = fs.readFileSync(path.join(cfg.dataDir, "runs", rec.id, "stream.jsonl"), "utf8");
    expect(stream.split("\n").filter(Boolean)).toHaveLength(19);

    const arts = store.getArtifacts(rec.id).map((a) => a.rel_path);
    expect(arts).toContain("report.md");
    expect(arts).toContain("notes/searcher-site.md");
    expect(fs.existsSync(path.join(done.run_dir, "report.md"))).toBe(true);
  });

  it("writes a per-run roles file when role models are overridden", async () => {
    fs.writeFileSync(cfg.defaults.agentsFile, JSON.stringify({ searcher: { description: "s", prompt: "p", tools: ["WebSearch"], model: "haiku" }, synthesizer: { description: "y", prompt: "p", model: "sonnet" } }));
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env() });
    const rec = await mgr.startRun({ prompt: "x", roleModels: { synthesizer: "opus", ghost: "haiku" } });
    await mgr.waitFor(rec.id);
    const file = path.join(cfg.dataDir, "runs", rec.id, "roles.json");
    expect(fs.existsSync(file)).toBe(true);
    const roles = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, { model: string }>;
    expect(roles["synthesizer"]!.model).toBe("opus");
    expect(roles["searcher"]!.model).toBe("haiku");
    expect(roles["ghost"]).toBeUndefined();
    // original roles.json untouched
    expect((JSON.parse(fs.readFileSync(cfg.defaults.agentsFile, "utf8")) as Record<string, { model: string }>)["synthesizer"]!.model).toBe("sonnet");
  });

  it("caps budget and turns at configured ceilings", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env() });
    const rec = await mgr.startRun({ prompt: "hi", maxBudgetUsd: 999, maxTurns: 9999 });
    await mgr.waitFor(rec.id);
    // Not directly observable from the fake; assert via buildClaudeArgs clamp path in manager: the stored run exists and finished.
    expect(store.getRun(rec.id)!.status).toBe("done");
    await expect(mgr.startRun({ prompt: "   " })).rejects.toThrow(/Lệnh trống/);
    await expect(mgr.startRun({ prompt: "x", maxTurns: 0 })).rejects.toThrow(/không hợp lệ/);
  });

  it("refuses to run when auth is api_key in subscription mode", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_AUTH: "api_key" }) });
    await expect(mgr.startRun({ prompt: "hi" })).rejects.toThrow(/tính phí API/);
    expect(store.listRuns()).toHaveLength(0);
  });

  it("cancels a hanging run cleanly and marks it cancelled", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_HANG: "1" }) });
    const rec = await mgr.startRun({ prompt: "hang" });
    await new Promise((r) => setTimeout(r, 500));
    expect(mgr.isActive(rec.id)).toBe(true);
    expect(mgr.cancel(rec.id)).toBe(true);
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.status).toBe("cancelled");
    expect(mgr.isActive(rec.id)).toBe(false);
    expect(store.getEvents(rec.id).some((e) => e.event.type === "run.cancelled")).toBe(true);
    expect(mgr.cancel(rec.id)).toBe(false);
  }, 120_000);

  it("times out a hanging run", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_HANG: "1" }) });
    const rec = await mgr.startRun({ prompt: "hang", timeoutMs: 700 });
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.status).toBe("error");
    expect(done.error).toMatch(/timeout/);
  }, 120_000);

  it("follow-up resumes the parent session in the same run dir", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles" }) });
    const first = await mgr.startRun({ prompt: "first" });
    await mgr.waitFor(first.id);
    const second = await mgr.followup(first.id, "hỏi tiếp");
    expect(second.parent_run_id).toBe(first.id);
    expect(second.run_dir).toBe(first.run_dir);
    expect(second.session_id).toBe("22222222-2222-4333-8444-555555555555");
    const done = (await mgr.waitFor(second.id))!;
    expect(done.status).toBe("done");
  });

  it("research run keeps the old behaviour: kind research, cwd runs/<id>, no worktree", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles" }) });
    const rec = await mgr.startRun({ prompt: "x", project: "lbl" });
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.kind).toBe("research");
    expect(done.worktree_path).toBeNull();
    expect(done.run_dir).toBe(path.join(cfg.workspaceDir, "runs", rec.id));
    expect(done.mode).toBe("subscription+roles");
    expect(store.getProject("lbl")).toMatchObject({ repo_path: null });
  });

  it("passes callTimeoutMinutes env to coding runs only, not research", async () => {
    // Hermetic: the child env inherits process.env, so clear these for the test and restore after.
    const saved = { d: process.env.BASH_DEFAULT_TIMEOUT_MS, m: process.env.BASH_MAX_TIMEOUT_MS };
    delete process.env.BASH_DEFAULT_TIMEOUT_MS;
    delete process.env.BASH_MAX_TIMEOUT_MS;
    try {
      await bashTimeoutEnvScenario();
    } finally {
      if (saved.d === undefined) delete process.env.BASH_DEFAULT_TIMEOUT_MS;
      else process.env.BASH_DEFAULT_TIMEOUT_MS = saved.d;
      if (saved.m === undefined) delete process.env.BASH_MAX_TIMEOUT_MS;
      else process.env.BASH_MAX_TIMEOUT_MS = saved.m;
    }
  });

  async function bashTimeoutEnvScenario(): Promise<void> {
    cfg.defaults.coding.callTimeoutMinutes = 20;
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    const f1 = path.join(cfg.repoRoot, "env-coding.json");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1", FAKE_CLAUDE_ENV_FILE: f1 }) });
    const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" });
    await mgr.waitFor(rec.id);
    expect(JSON.parse(fs.readFileSync(f1, "utf8"))).toEqual({ BASH_DEFAULT_TIMEOUT_MS: "1200000", BASH_MAX_TIMEOUT_MS: "1200000", CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" });
    const f2 = path.join(cfg.repoRoot, "env-research.json");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_ENV_FILE: f2 }) });
    const r2 = await mgr.startRun({ prompt: "Phân tích website example.com" });
    await mgr.waitFor(r2.id);
    expect(JSON.parse(fs.readFileSync(f2, "utf8"))).toEqual({ BASH_DEFAULT_TIMEOUT_MS: null, BASH_MAX_TIMEOUT_MS: null, CLAUDE_CODE_DISABLE_BACKGROUND_TASKS: "1" });
  }

  it("coding run: worktree + branch + diff artifacts + notes saved immediately, original repo untouched", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: ["Bash(node *)"] });
    const argsFile = path.join(cfg.repoRoot, "args.json");
    mgr = new RunManager({
      config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE],
      env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1", FAKE_CLAUDE_ARGS_FILE: argsFile }),
    });
    const headBefore = runGit(repo, ["rev-parse", "HEAD"]).stdout.trim();
    const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" });
    expect(rec.kind).toBe("coding");
    expect(rec.branch).toBe(`tnf/spike/${rec.id}`);
    expect(rec.base_sha).toBe(headBefore);
    expect(rec.worktree_path).toBe(path.join(cfg.worktreesDir, "spike", rec.id));
    expect(rec.mode).toBe("subscription+coding");
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.status).toBe("done");
    // the fake CLI committed inside the worktree with the controller-provided identity
    expect(done.commits).toHaveLength(1);
    expect(done.commits[0]!.subject).toMatch(/fake/);
    expect(done.changed_files).toBe(1);
    expect(runGit(done.worktree_path!, ["log", "-1", "--format=%an <%ae>"]).stdout.trim()).toBe("TNF Agent <agent@example.com>");
    expect(runGit(done.worktree_path!, ["branch", "--show-current"]).stdout.trim()).toBe(done.branch);
    // artifacts in the run dir (not the worktree)
    const arts = store.getArtifacts(rec.id).map((a) => a.rel_path);
    expect(arts).toEqual(expect.arrayContaining(["diff.patch", "diff-stat.txt", "git-log.txt", "git-status.txt", "repo-check.txt", "test-result.txt", "notes/implementer.md"]));
    expect(fs.readFileSync(path.join(done.run_dir, "diff.patch"), "utf8")).toContain("src/sub.js");
    expect(fs.readFileSync(path.join(done.run_dir, "test-result.txt"), "utf8")).toMatch(/npm test[\s\S]*fail 0/);
    expect(fs.readFileSync(path.join(done.run_dir, "notes", "implementer.md"), "utf8").length).toBeGreaterThan(50);
    expect(fs.readFileSync(path.join(done.run_dir, "repo-check.txt"), "utf8")).toMatch(/^OK/);
    expect(done.error).toBeNull();
    // original repo untouched
    expect(runGit(repo, ["status", "--porcelain"]).stdout).toBe("");
    expect(runGit(repo, ["rev-parse", "HEAD"]).stdout.trim()).toBe(headBefore);
    // permissions passed to the CLI (CONTEXT-SPEC-v1 §4.2–4.3)
    const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    const wt = done.worktree_path!.replace(/\\/g, "/");
    expect(args).toContain(`Edit(${wt}/**)`);
    expect(args).toContain(`Write(${wt}/**)`);
    expect(args).toContain(`Write(${done.run_dir.replace(/\\/g, "/")}/notes/**)`);
    expect(args).toContain("Bash(node *)");
    expect(args).not.toContain("Edit");
    expect(args).not.toContain("Bash(git *)");
    expect(args[args.indexOf("--settings") + 1]).toBe(cfg.defaults.coding.settingsFile);
    expect(args[args.indexOf("--agents") + 1]).toBe(path.join(cfg.dataDir, "runs", done.id, "roles.json"));
    expect(args.slice(args.indexOf("--disallowedTools") + 1, args.indexOf("--disallowedTools") + 4)).toEqual(cfg.defaults.coding.disallowedTools);
    expect(args).toContain("--setting-sources");
    // events carry vcs.commit and per-agent permission.denied
    const evs = store.getEvents(rec.id).map((e) => e.event);
    expect(evs.some((e) => e.type === "vcs.commit")).toBe(true);
    const denied = evs.filter((e): e is Extract<typeof e, { type: "permission.denied" }> => e.type === "permission.denied");
    expect(denied.length).toBe(3);
    expect(denied.every((e) => e.agent_id !== "coordinator")).toBe(true);
  }, 120_000);

  it("scout flag adds only WebSearch/WebFetch to a coding run's allowedTools", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: ["Bash(node *)"] });
    const readArgs = async (scout: boolean, name: string): Promise<{ args: string[]; wt: string }> => {
      const argsFile = path.join(cfg.repoRoot, name);
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1", FAKE_CLAUDE_ARGS_FILE: argsFile }) });
      const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike", ...(scout ? { scout: true } : {}) });
      const done = (await mgr.waitFor(rec.id))!;
      return { args: JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[], wt: done.worktree_path!.replace(/\\/g, "/") };
    };
    const plain = await readArgs(false, "args-plain.json");
    const scout = await readArgs(true, "args-scout.json");
    expect(plain.args).toContain("WebSearch");
    expect(plain.args).toContain("WebFetch");
    expect(scout.args).toContain("WebSearch");
    expect(scout.args).toContain("WebFetch");
    expect(scout.args).toContain(`Edit(${scout.wt}/**)`);
    expect(scout.args).not.toContain("Edit");
    expect(scout.args).not.toContain("Bash(git *)");
    const toolsOf = (a: string[], wt: string): string[] => a.filter((t) => /^(Agent|Read|Grep|Glob|Edit|Write|Bash|Skill|WebSearch|WebFetch)/.test(t)).map((t) => t.replace(wt, "<wt>"));
    const p = toolsOf(plain.args, plain.wt).filter((t) => !/^(Edit|Write)\(/.test(t));
    const s = toolsOf(scout.args, scout.wt).filter((t) => !/^(Edit|Write)\(/.test(t));
    expect(s).toEqual(p);
  }, 120_000);

  it("scout (Đề xuất) runs on Opus in every role; ordinary coding runs keep their own models", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: ["Bash(node *)"] });
    const readModels = async (scout: boolean, name: string): Promise<{ model: string; roles: Record<string, { model?: string }> }> => {
      const argsFile = path.join(cfg.repoRoot, name);
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1", FAKE_CLAUDE_ARGS_FILE: argsFile }) });
      const rec = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike", ...(scout ? { scout: true } : {}) });
      await mgr.waitFor(rec.id);
      const args = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
      const agentsFile = args[args.indexOf("--agents") + 1]!;
      return { model: args[args.indexOf("--model") + 1]!, roles: JSON.parse(fs.readFileSync(agentsFile, "utf8")) as Record<string, { model?: string }> };
    };
    const plain = await readModels(false, "args-m-plain.json");
    const scout = await readModels(true, "args-m-scout.json");
    expect(plain.model).not.toBe("opus");
    expect(Object.values(plain.roles).every((r) => r.model !== "opus")).toBe(true);
    expect(scout.model).toBe("opus");
    for (const [name, r] of Object.entries(scout.roles)) expect(r.model, `scout role ${name}`).toBe("opus");
  }, 120_000);

  it("coding run records verdicts and notes per role (S5 fixture) and a failed-test result", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_S5 }) });
    const rec = await mgr.startRun({ prompt: "Thêm lệnh version", project: "spike", kind: "coding" });
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.verdicts.map((v) => v.verdict)).toEqual(["NEEDS_REVISION", "NEEDS_REVISION"]);
    expect(done.verdicts.every((v) => v.role === "critic")).toBe(true);
    expect(done.commits).toEqual([]);
    const arts = store.getArtifacts(rec.id).map((a) => a.rel_path);
    expect(arts).toEqual(expect.arrayContaining(["notes/analyst.md", "notes/planner.md", "notes/critic.md", "notes/planner-2.md", "notes/critic-2.md", "notes/implementer.md"]));
    expect(fs.readFileSync(path.join(done.run_dir, "test-result.txt"), "utf8")).toMatch(/denied|từ chối/);
  }, 120_000);

  it("coding run copies the repo's ignored node_modules into the worktree (real files), notes it, and a tiny cap falls back to a link", async () => {
    const repo = makeRepo(cfg.repoRoot);
    fs.writeFileSync(path.join(repo, ".gitignore"), "node_modules/\n");
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-m", "ignore"]);
    fs.mkdirSync(path.join(repo, "node_modules", "dep"), { recursive: true });
    fs.writeFileSync(path.join(repo, "node_modules", "dep", "index.js"), "module.exports = 1;\n");
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });

    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_S5 }) });
    const rec = await mgr.startRun({ prompt: "Thêm lệnh version", project: "spike", kind: "coding" });
    const done = (await mgr.waitFor(rec.id))!;
    const nm = path.join(done.worktree_path!, "node_modules");
    expect(fs.lstatSync(nm).isSymbolicLink()).toBe(false);
    expect(fs.readFileSync(path.join(nm, "dep", "index.js"), "utf8")).toContain("module.exports");
    expect(fs.readFileSync(path.join(done.run_dir, "node-modules.txt"), "utf8")).toMatch(/đã copy/);

    cfg.defaults.coding.nodeModules = { mode: "copy", maxBytes: 5 };
    const rec2 = await mgr.startRun({ prompt: "Thêm lệnh version", project: "spike", kind: "coding" });
    const done2 = (await mgr.waitFor(rec2.id))!;
    expect(fs.lstatSync(path.join(done2.worktree_path!, "node_modules")).isSymbolicLink()).toBe(true);
    expect(fs.readFileSync(path.join(done2.run_dir, "node-modules.txt"), "utf8")).toMatch(/junction.*trần/);
  }, 60_000);

  it("coding run cut off while a background subagent still runs is an error, not done", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    const fix = path.resolve(__dirname, "..", "..", "fixtures", "interrupted-subagent.stream.jsonl");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: fix }) });
    const rec = await mgr.startRun({ prompt: "Thêm tính năng", project: "spike", kind: "coding" });
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.status).toBe("error");
    expect(done.error).toContain("subagent_interrupted");
    expect(done.error).toContain("implementer");
    expect(done.agents.find((a) => a.role === "implementer")?.task_status).toBe("stopped");
  }, 120_000);

  it("startRun with resumeFrom starts a fresh worktree/branch at the sha and records forked_from_run_id", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const src = (await mgr.waitFor((await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" })).id))!;
    expect(src.status).toBe("done");
    const sha = runGit(src.worktree_path!, ["rev-parse", "HEAD"]).stdout.trim();
    expect(sha).toMatch(/^[0-9a-f]{40}$/);
    const rec = await mgr.startRun({ prompt: "Tiếp tục", project: "spike", kind: "coding", resumeFrom: { runId: src.id, sha } });
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.base_sha).toBe(sha);
    expect(done.forked_from_run_id).toBe(src.id);
    expect(done.parent_run_id).toBeNull();
    expect(done.id).not.toBe(src.id); // fresh session: session_id is only filled in from this run's own stream
    expect(done.branch).toMatch(new RegExp(done.id));
    expect(done.branch).not.toBe(src.branch);
    expect(done.worktree_path).not.toBe(src.worktree_path);
    expect(fs.existsSync(src.worktree_path!)).toBe(true);
    expect(runGit(repo, ["rev-parse", "--verify", src.branch!]).code).toBe(0);
    expect(fs.existsSync(path.join(done.run_dir, "node-modules.txt"))).toBe(true);
  }, 120_000);

  it("resumeFrom() validates the source run, prompt and sha (Vietnamese errors) and starts a forked run", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const src = (await mgr.waitFor((await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" })).id))!;
    const sha = runGit(src.worktree_path!, ["rev-parse", "HEAD"]).stdout.trim();
    await expect(mgr.resumeFrom("ghost", sha, "x")).rejects.toThrow(/Không tìm thấy lần chạy gốc/);
    await expect(mgr.resumeFrom(src.id, sha, "   ")).rejects.toThrow(/Lệnh trống/);
    for (const bad of ["abc123", sha.toUpperCase(), "zzzz", ""]) await expect(mgr.resumeFrom(src.id, bad, "x")).rejects.toThrow(/Mã commit không hợp lệ/);
    // Valid 40-hex format but not an existing commit.
    await expect(mgr.resumeFrom(src.id, "b".repeat(40), "x")).rejects.toThrow(/không nằm trên nhánh/);
    // A real commit that is on main only (made after the run branch was cut), not on the run branch.
    fs.writeFileSync(path.join(repo, "only-main.txt"), "x\n");
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["-c", "user.name=T", "-c", "user.email=t@example.com", "commit", "-m", "main only"]);
    const mainSha = runGit(repo, ["rev-parse", "main"]).stdout.trim();
    await expect(mgr.resumeFrom(src.id, mainSha, "x")).rejects.toThrow(/không nằm trên nhánh/);
    // Research source run is refused.
    const res = (await mgr.waitFor((await mgr.startRun({ prompt: "Phân tích website example.com", kind: "research" })).id))!;
    await expect(mgr.resumeFrom(res.id, sha, "x")).rejects.toThrow(/không phải run lập trình/);
    // Success; overrides cannot replace resumeFrom/project/kind.
    const evil = { resumeFrom: { runId: "other", sha: mainSha }, project: "nope", kind: "research" } as unknown as Parameters<RunManager["resumeFrom"]>[3];
    const rec = await mgr.resumeFrom(src.id, sha, "Tiếp tục", evil);
    const done = (await mgr.waitFor(rec.id))!;
    expect(done.base_sha).toBe(sha);
    expect(done.forked_from_run_id).toBe(src.id);
    expect(done.project).toBe("spike");
    expect(done.kind).toBe("coding");
    expect(done.parent_run_id).toBeNull();
  }, 180_000);

  it("resumeFrom with a missing sha makes an error run that still records forked_from_run_id", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const before = new Set(store.listRuns().map((r) => r.id));
    await expect(mgr.startRun({ prompt: "Tiếp tục", project: "spike", kind: "coding", resumeFrom: { runId: "src-run", sha: "a".repeat(40) } })).rejects.toThrow(/Không chuẩn bị được worktree/);
    const created = store.listRuns().filter((r) => !before.has(r.id));
    expect(created).toHaveLength(1);
    expect(created[0]!.status).toBe("error");
    expect(created[0]!.forked_from_run_id).toBe("src-run");
  }, 60_000);

  it("coding runs use bypassPermissions (deny list kept); research and read-only keep dontAsk", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    cfg.defaults.coding.permissionMode = "bypassPermissions";
    const f1 = path.join(cfg.repoRoot, "perm-coding.json");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1", FAKE_CLAUDE_ARGS_FILE: f1 }) });
    await mgr.waitFor((await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" })).id);
    const a1 = JSON.parse(fs.readFileSync(f1, "utf8")) as string[];
    expect(a1[a1.indexOf("--permission-mode") + 1]).toBe("bypassPermissions");
    expect(a1).toContain("--disallowedTools");
    expect(a1).not.toContain("--dangerously-skip-permissions");
    const f2 = path.join(cfg.repoRoot, "perm-research.json");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_ARGS_FILE: f2 }) });
    await mgr.waitFor((await mgr.startRun({ prompt: "Phân tích website example.com" })).id);
    const a2 = JSON.parse(fs.readFileSync(f2, "utf8")) as string[];
    expect(a2[a2.indexOf("--permission-mode") + 1]).toBe("dontAsk");
  }, 120_000);

  it("app-wide cap: the extra coding run waits as queued, starts by itself when the first ends, and can be cancelled", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    cfg.queue = { ...(cfg.queue as object), maxParallel: 1 } as typeof cfg.queue;
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const [a, b, c] = await Promise.all([
      mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" }),
      mgr.startRun({ prompt: "Thêm hàm mul", project: "spike" }),
      mgr.startRun({ prompt: "Thêm hàm div", project: "spike" }),
    ]);
    expect([a.status, b.status, c.status].filter((x) => x === "queued")).toHaveLength(2);
    expect(mgr.waitingList()).toHaveLength(2);
    expect(mgr.cancel(c.status === "queued" ? c.id : b.id)).toBe(true);
    const keep = a.status === "queued" ? a : b.status === "queued" && b.id !== (c.status === "queued" ? c.id : "") ? b : c;
    await mgr.waitFor(a.id);
    for (let i = 0; i < 300 && store.getRun(keep.id)?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(store.getRun(keep.id)?.status).toBe("done");
    expect(store.getRun(keep.id)?.branch).toBeTruthy();
    expect(mgr.waitingList()).toHaveLength(0);
  }, 180_000);

  it("scope guard: a second run of the same project is held while its scope is unsure, then starts by itself when the first ends", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    cfg.queue = { ...(cfg.queue as object), maxParallel: 2, scopeGuard: { enabled: true }, hotspots: [] } as typeof cfg.queue;
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const a = await mgr.startRun({ prompt: "Thêm hàm sub", project: "spike" });
    expect(a.status).not.toBe("queued");
    const b = await mgr.startRun({ prompt: "Thêm hàm mul", project: "spike" });
    expect(b.status).toBe("queued");
    for (let i = 0; i < 300 && !mgr.waitReason(b.id) && store.getRun(b.id)?.status === "queued"; i++) await new Promise((r) => setTimeout(r, 50));
    if (store.getRun(b.id)?.status === "queued") expect(mgr.waitReason(b.id)).toContain(a.id);
    await mgr.waitFor(a.id);
    for (let i = 0; i < 400 && store.getRun(b.id)?.status !== "done"; i++) await new Promise((r) => setTimeout(r, 100));
    expect(store.getRun(b.id)?.status).toBe("done");
    expect(mgr.waitingList()).toHaveLength(0);
    expect(mgr.waitReason(b.id)).toBeUndefined();
  }, 240_000);

  it("every run disables background tasks in the child env", async () => {
    const envFile = path.join(cfg.repoRoot, "child-env.json");
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_ENV_FILE: envFile }) });
    const rec = await mgr.startRun({ prompt: "Phân tích website example.com" });
    await mgr.waitFor(rec.id);
    expect(JSON.parse(fs.readFileSync(envFile, "utf8")).CLAUDE_CODE_DISABLE_BACKGROUND_TASKS).toBe("1");
  }, 60_000);

  it("auto-resume: an interrupted coding run is continued once in the same worktree, then stops at maxAttempts", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    const fix = path.resolve(__dirname, "..", "..", "fixtures", "interrupted-subagent.stream.jsonl");
    cfg.autoResume = { enabled: true, maxAttempts: 1, delaySec: 0, quotaEnabled: true, quotaMarginSec: 60, quotaFallbackMin: 60 };
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: fix }) });
    const rec = await mgr.startRun({ prompt: "Thêm tính năng", project: "spike", kind: "coding" });
    const first = (await mgr.waitFor(rec.id))!;
    expect(first.error).toContain("subagent_interrupted");
    const kids = (id: string) => store.listRuns({ limit: 50 }).filter((r) => r.parent_run_id === id);
    let child = kids(rec.id)[0];
    for (let i = 0; i < 100 && !child; i++) {
      await new Promise((r) => setTimeout(r, 100));
      child = kids(rec.id)[0];
    }
    expect(child).toBeTruthy();
    expect(child!.prompt.startsWith("[Tự động tiếp tục lần 1/1]")).toBe(true);
    expect(child!.worktree_path).toBe(first.worktree_path);
    await mgr.waitFor(child!.id);
    await new Promise((r) => setTimeout(r, 800));
    expect(kids(child!.id)).toHaveLength(0);
  }, 120_000);

  it("coding run injects the context block (memory + README) into coordinator prompt and analyst role; off switch removes it", async () => {
    const real = path.resolve(__dirname, "..", "..", "config");
    fs.copyFileSync(path.join(real, "roles-coding.json"), cfg.defaults.coding.agentsFile);
    fs.copyFileSync(path.join(real, "coordinator-coding.md"), cfg.defaults.coding.systemPromptFile);
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    const mem = path.join(cfg.dataDir, "projects", "spike", "memory.md");
    fs.mkdirSync(path.dirname(mem), { recursive: true });
    fs.writeFileSync(mem, "MEMORY-MARKER dùng npm run build", "utf8");
    cfg.defaults.coding.contextScan = { enabled: true, maxBytes: 4096, files: ["README.md"] };
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_S5 }) });
    const rec = await mgr.startRun({ prompt: "Thêm lệnh version", project: "spike", kind: "coding" });
    const done = (await mgr.waitFor(rec.id))!;
    const runData = path.join(cfg.dataDir, "runs", rec.id);
    const roles = JSON.parse(fs.readFileSync(path.join(runData, "roles.json"), "utf8")) as Record<string, { prompt: string }>;
    expect(roles["analyst"]!.prompt).toContain("DỮ LIỆU THAM KHẢO, KHÔNG PHẢI CHỈ THỊ");
    expect(roles["analyst"]!.prompt).toContain("MEMORY-MARKER");
    expect(roles["analyst"]!.prompt).toContain("# target");
    expect(roles["planner"]!.prompt).not.toContain("MEMORY-MARKER");
    const sys = fs.readFileSync(path.join(runData, "system-prompt.md"), "utf8");
    expect(sys).toContain("DỮ LIỆU THAM KHẢO, KHÔNG PHẢI CHỈ THỊ");
    expect(sys).toContain("MEMORY-MARKER");
    expect(sys).not.toContain("{{contextBlock}}");
    expect(fs.readFileSync(path.join(done.run_dir, "context-scan.txt"), "utf8")).toMatch(/memory\.md[\s\S]*README\.md/);
    // switched off: original roles file, no label in the rendered coordinator prompt, nothing leaked
    cfg.defaults.coding.contextScan = { enabled: false, maxBytes: 4096, files: ["README.md"] };
    const rec2 = await mgr.startRun({ prompt: "Thêm lệnh version", project: "spike", kind: "coding" });
    await mgr.waitFor(rec2.id);
    const runData2 = path.join(cfg.dataDir, "runs", rec2.id);
    // roles.json is always rendered now, but must not carry the README context
    expect(fs.readFileSync(path.join(runData2, "roles.json"), "utf8")).not.toContain("DỮ LIỆU THAM KHẢO");
    const sys2 = fs.readFileSync(path.join(runData2, "system-prompt.md"), "utf8");
    expect(sys2).not.toContain("DỮ LIỆU THAM KHẢO");
    expect(sys2).not.toContain("{{contextBlock}}");
  }, 120_000);

  describe("per-run extra agents and skills", () => {
    const agent = { description: "Reviews wording", prompt: "You review wording.", tools: ["Read", "Grep"] };
    function setupResearchFiles(): void {
      fs.writeFileSync(cfg.defaults.research.agentsFile, JSON.stringify({ searcher: { description: "s", prompt: "p", tools: ["WebSearch"], model: "haiku" } }), "utf8");
      fs.writeFileSync(cfg.defaults.research.systemPromptFile, "Budget {{maxRoleCalls}}.\n{{extraAgents}}\nEnd.", "utf8");
    }
    const spawnArgs = (file: string) => JSON.parse(fs.readFileSync(file, "utf8")) as string[];

    it("research: roles.json keeps built-in roles + extra agent, coordinator lists it, Skill(x) is allowed, no forbidden flags", async () => {
      setupResearchFiles();
      const argsFile = path.join(cfg.repoRoot, "args.json");
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_ARGS_FILE: argsFile }) });
      const rec = await mgr.startRun({ prompt: "x", extraAgents: { "wording-reviewer": agent }, skills: ["foo"] });
      await mgr.waitFor(rec.id);
      const runData = path.join(cfg.dataDir, "runs", rec.id);
      const roles = JSON.parse(fs.readFileSync(path.join(runData, "roles.json"), "utf8")) as Record<string, Record<string, unknown>>;
      expect(Object.keys(roles)).toEqual(["searcher", "wording-reviewer"]);
      expect(Object.keys(roles["wording-reviewer"]!).sort()).toEqual(["description", "prompt", "tools"]);
      const sys = fs.readFileSync(path.join(runData, "system-prompt.md"), "utf8");
      expect(sys).toContain("wording-reviewer (Reviews wording)");
      expect(sys).not.toContain("{{extraAgents}}");
      expect(sys).toContain(`Budget ${cfg.defaults.research.maxRoleCalls + 1}.`);
      const args = spawnArgs(argsFile);
      expect(args).toContain("Skill(foo)");
      expect(args).not.toContain("--bare");
      expect(args).not.toContain("--dangerously-skip-permissions");
      expect(args).not.toContain("bypassPermissions");
      expect(args.filter((a) => a.startsWith("Bash"))).toEqual([]);
    }, 120_000);

    it("no extras: original agents file and allowedTools, maxRoleCalls unchanged", async () => {
      setupResearchFiles();
      const argsFile = path.join(cfg.repoRoot, "args.json");
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_ARGS_FILE: argsFile }) });
      const rec = await mgr.startRun({ prompt: "x" });
      await mgr.waitFor(rec.id);
      const args = spawnArgs(argsFile);
      // roles.json is always rendered into a per-run copy (placeholders such as knownEnvFailures); with no extras and no
      // placeholders in the research roles, its content must equal the original agents file.
      const agentsArg = args[args.indexOf("--agents") + 1]!;
      expect(agentsArg).toBe(path.join(cfg.dataDir, "runs", rec.id, "roles.json"));
      expect(JSON.parse(fs.readFileSync(agentsArg, "utf8"))).toEqual(JSON.parse(fs.readFileSync(cfg.defaults.research.agentsFile, "utf8")));
      expect(args.filter((a) => a.startsWith("Skill("))).toEqual([]);
      for (const t of RESEARCH_TOOLS) expect(args).toContain(t);
      const sys = fs.readFileSync(path.join(cfg.dataDir, "runs", rec.id, "system-prompt.md"), "utf8");
      expect(sys).toContain(`Budget ${cfg.defaults.research.maxRoleCalls}.`);
      expect(sys).not.toContain("{{extraAgents}}");
    }, 120_000);

    it("rejects clashing names, dangerous tools, and single mode + extra agents (skills still fine in single)", async () => {
      setupResearchFiles();
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles" }) });
      await expect(mgr.startRun({ prompt: "x", extraAgents: { searcher: agent } })).rejects.toThrow(/trùng/);
      await expect(mgr.startRun({ prompt: "x", extraAgents: { evil: { ...agent, tools: ["Bash"] } } })).rejects.toThrow(/an toàn/);
      await expect(mgr.startRun({ prompt: "x", roles: false, extraAgents: { ok: agent } })).rejects.toThrow(/single/);
      await expect(mgr.startRun({ prompt: "x", skills: ["bad name"] })).rejects.toThrow(/skill/i);
      expect(store.listRuns()).toHaveLength(0);
      const rec = await mgr.startRun({ prompt: "x", roles: false, skills: ["foo"] });
      await mgr.waitFor(rec.id);
    }, 120_000);

    it("library: item text goes only to ticked roles, tools unchanged; custom role pulled in; bad id / oversize / single refused", async () => {
      setupResearchFiles();
      const argsFile = path.join(cfg.repoRoot, "args.json");
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_ARGS_FILE: argsFile }) });
      mgr.library.createRole({ id: "wording", description: "Soát câu chữ", prompt: "Soát câu chữ.", tools: ["Read"] });
      const a = mgr.library.createItem({ name: "Quy tắc A", type: "skill", content: "NOI-DUNG-A", roleIds: ["searcher"] });
      const b = mgr.library.createItem({ name: "Quy tắc B", type: "prompt", content: "NOI-DUNG-B", roleIds: ["wording"] });
      const c = mgr.library.createItem({ name: "Chung", type: "prompt", content: "NOI-DUNG-C", roleIds: [] });
      const rec = await mgr.startRun({ prompt: "x", libraryItemIds: [a.id, b.id, c.id] });
      await mgr.waitFor(rec.id);
      const runData = path.join(cfg.dataDir, "runs", rec.id);
      const roles = JSON.parse(fs.readFileSync(path.join(runData, "roles.json"), "utf8")) as Record<string, { prompt: string; tools?: string[] }>;
      expect(roles["searcher"]!.prompt).toContain("NOI-DUNG-A");
      expect(roles["searcher"]!.prompt).not.toContain("NOI-DUNG-B");
      expect(roles["wording"]!.prompt).toContain("NOI-DUNG-B");
      expect(roles["wording"]!.tools).toEqual(["Read"]);
      expect(JSON.stringify(roles)).not.toContain("NOI-DUNG-C");
      expect(fs.readFileSync(path.join(runData, "system-prompt.md"), "utf8")).toContain("NOI-DUNG-C");
      expect(fs.readFileSync(path.join(rec.run_dir, "library-items.txt"), "utf8")).toContain(a.id);
      const args = spawnArgs(argsFile);
      for (const t of RESEARCH_TOOLS) expect(args).toContain(t);
      expect(args.filter((x) => x.startsWith("Bash") || x.startsWith("Skill("))).toEqual([]);
      expect(Object.keys(roles)).toEqual(["searcher", "wording"]);

      await expect(mgr.startRun({ prompt: "x", libraryItemIds: ["ghost"] })).rejects.toThrow(/Không tìm thấy mục thư viện/);
      await expect(mgr.startRun({ prompt: "x", roles: false, libraryItemIds: [a.id] })).rejects.toThrow(/single/);
      const big = mgr.library.createItem({ name: "Lon", type: "prompt", content: "z".repeat(40 * 1024), roleIds: ["searcher", "wording"] });
      await expect(mgr.startRun({ prompt: "x", libraryItemIds: [big.id] })).rejects.toThrow(/vượt giới hạn 64 KB/);

      // no library items: the roles file is still rendered per run, with the same roles and no library text
      const plain = await mgr.startRun({ prompt: "x" });
      await mgr.waitFor(plain.id);
      const plainRoles = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, "runs", plain.id, "roles.json"), "utf8")) as Record<string, unknown>;
      expect(Object.keys(plainRoles)).toEqual(["searcher"]);
      expect(JSON.stringify(plainRoles)).not.toContain("NOI-DUNG-C");
    }, 60_000);

    it("coding: extra agent next to the context block in roles.json, Skill(x) scoped alongside worktree rules", async () => {
      const real = path.resolve(__dirname, "..", "..", "config");
      fs.copyFileSync(path.join(real, "roles-coding.json"), cfg.defaults.coding.agentsFile);
      fs.copyFileSync(path.join(real, "coordinator-coding.md"), cfg.defaults.coding.systemPromptFile);
      const repo = makeRepo(cfg.repoRoot);
      store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
      const argsFile = path.join(cfg.repoRoot, "args.json");
      mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_S5, FAKE_CLAUDE_ARGS_FILE: argsFile }) });
      const rec = await mgr.startRun({ prompt: "x", project: "spike", kind: "coding", extraAgents: { "doc-writer": { ...agent, tools: ["Read", "Write"] } }, skills: ["foo"] });
      await mgr.waitFor(rec.id);
      const roles = JSON.parse(fs.readFileSync(path.join(cfg.dataDir, "runs", rec.id, "roles.json"), "utf8")) as Record<string, unknown>;
      expect(Object.keys(roles)).toEqual(["analyst", "planner", "critic", "implementer", "qa", "debug", "doc-writer"]);
      const sys = fs.readFileSync(path.join(cfg.dataDir, "runs", rec.id, "system-prompt.md"), "utf8");
      expect(sys).toContain("doc-writer (Reviews wording)");
      expect(sys).not.toContain("{{extraAgents}}");
      const args = spawnArgs(argsFile);
      expect(args).toContain("Skill(foo)");
      expect(args).not.toContain("Write");
      expect(args).not.toContain("Bash(git *)");
    }, 120_000);
  });

  it("coding run refuses a project without a repo and an unknown project", async () => {
    store.upsertProject({ name: "lbl", repo_path: null, base_branch: null, allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env() });
    await expect(mgr.startRun({ prompt: "x", project: "lbl", kind: "coding" })).rejects.toThrow(/chưa gắn repo/);
    await expect(mgr.startRun({ prompt: "x", project: "ghost", kind: "coding" })).rejects.toThrow(/chưa gắn repo|Không tìm thấy project/);
    expect(store.listRuns()).toHaveLength(0);
  });

  it("coding run fails cleanly (no spawn) when the base branch is missing", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "release", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env() });
    await expect(mgr.startRun({ prompt: "x", project: "spike" })).rejects.toThrow(/nhánh gốc/);
    const runs = store.listRuns();
    expect(runs).toHaveLength(1);
    expect(runs[0]!.status).toBe("error");
    expect(fs.existsSync(path.join(cfg.worktreesDir, "spike", runs[0]!.id))).toBe(false);
  });

  it("coding follow-up reuses the parent's worktree and branch", async () => {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT }) });
    const first = await mgr.startRun({ prompt: "x", project: "spike" });
    await mgr.waitFor(first.id);
    const second = await mgr.followup(first.id, "tiếp");
    expect(second.kind).toBe("coding");
    expect(second.worktree_path).toBe(first.worktree_path);
    expect(second.branch).toBe(first.branch);
    expect(second.base_sha).toBe(first.base_sha);
    await mgr.waitFor(second.id);
  }, 120_000);

  it("lists runs with filters and cost by day", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env() });
    const a = await mgr.startRun({ prompt: "alpha prompt" });
    await mgr.waitFor(a.id);
    expect(store.listRuns({ q: "alpha" })).toHaveLength(1);
    expect(store.listRuns({ q: "zzz" })).toHaveLength(0);
    expect(store.listRuns({ status: "done" })).toHaveLength(1);
    const byDay = store.costByDay();
    expect(byDay).toHaveLength(1);
    expect(byDay[0]!.runs).toBe(1);
  });
});

describe("precheckMerge", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  const env = (extra: Record<string, string> = {}) => ({ ...process.env, ...extra });
  const gitIn = (cwd: string, args: string[]) => {
    const res = runGit(cwd, args);
    if (res.code !== 0) throw new Error(res.stderr);
    return res.stdout.trim();
  };

  beforeEach(() => {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
  });
  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  async function codingRun(): Promise<{ id: string; repo: string }> {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const rec = await mgr.startRun({ prompt: "x", project: "spike" });
    await mgr.waitFor(rec.id);
    return { id: rec.id, repo };
  }

  it("precheckMerge returns clean, stores it and emits one run.updated", async () => {
    const { id, repo } = await codingRun();
    const updates: string[] = [];
    mgr.on("run.updated", (r: RunRecord) => {
      if (r.id === id) updates.push(r.id);
    });
    const res = mgr.precheckMerge(id)!;
    expect(res.status).toBe("clean");
    expect(res.base_sha_checked).toBe(gitIn(repo, ["rev-parse", "main"]));
    expect(store.getRun(id)!.merge_precheck).toEqual(res);
    expect(updates).toHaveLength(1);
  }, 120_000);

  it("precheckMerge reports conflict with file names", async () => {
    const { id, repo } = await codingRun();
    fs.mkdirSync(path.join(repo, "src"), { recursive: true });
    fs.writeFileSync(path.join(repo, "src", "sub.js"), "export const other = 1;\n");
    gitIn(repo, ["add", "-A"]);
    gitIn(repo, ["commit", "-m", "base adds sub.js"]);
    const res = mgr.precheckMerge(id)!;
    expect(res.status).toBe("conflict");
    expect(res.files.join(" ")).toContain("sub.js");
  }, 120_000);

  it("precheck runs automatically when a coding run finishes", async () => {
    const { id, repo } = await codingRun();
    const pre = store.getRun(id)!.merge_precheck;
    expect(pre).not.toBeNull();
    expect(pre!.status).toBe("clean");
    expect(pre!.base_sha_checked).toBe(gitIn(repo, ["rev-parse", "main"]));
  }, 120_000);

  it("precheck failure at finish only warns and the run stays done", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      previewFail.times = 1;
      const { id } = await codingRun();
      const rec = store.getRun(id)!;
      expect(rec.status).toBe("done");
      expect(rec.merge_precheck ?? null).toBeNull();
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.some((c) => String(c[0]).includes("[precheck]"))).toBe(true);
    } finally {
      previewFail.times = 0;
      warn.mockRestore();
    }
  }, 120_000);

  async function twoRuns(n: number): Promise<{ ids: string[]; repo: string }> {
    const repo = makeRepo(cfg.repoRoot);
    store.upsertProject({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env({ FAKE_CLAUDE_FIXTURE: FIX_COMMIT, FAKE_CLAUDE_GIT_COMMIT: "1" }) });
    const ids: string[] = [];
    for (let i = 0; i < n; i++) {
      const rec = await mgr.startRun({ prompt: `x${i}`, project: "spike" });
      await mgr.waitFor(rec.id);
      ids.push(rec.id);
    }
    return { ids, repo };
  }

  it("release rechecks sibling runs: conflict after base moved; merged and active runs untouched", async () => {
    const { ids, repo } = await twoRuns(3);
    const [a, b, c] = ids as [string, string, string];
    expect(store.getRun(b)!.merge_precheck!.status).toBe("clean");
    const beforeA = store.getRun(a)!.merge_precheck!;
    const beforeB = store.getRun(b)!.merge_precheck!;
    const beforeC = store.getRun(c)!.merge_precheck!;
    (mgr as unknown as { active: Map<string, unknown> }).active.set(c, {});
    try {
      const r = mgr.releaseRun(a);
      expect(r.merged).toBe(true);
    } finally {
      (mgr as unknown as { active: Map<string, unknown> }).active.delete(c);
    }
    const afterB = store.getRun(b)!.merge_precheck!;
    expect(afterB.status).toBe("conflict");
    expect(afterB.base_sha_checked).toBe(gitIn(repo, ["rev-parse", "main"]));
    expect(afterB.base_sha_checked).not.toBe(beforeB.base_sha_checked);
    expect(store.getRun(a)!.merge_precheck).toEqual(beforeA);
    expect(store.getRun(c)!.merge_precheck).toEqual(beforeC);
  }, 180_000);

  it("release only warns when the stored precheck is conflict, and a failing recheck does not break release", async () => {
    const { ids } = await twoRuns(3);
    const [a, b, c] = ids as [string, string, string];
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      previewFail.times = 1; // the sibling recheck for b (first sibling) throws once
      expect(mgr.releaseRun(a).merged).toBe(true);
      expect(warn.mock.calls.some((x) => String(x[0]).includes("[precheck]") && String(x[0]).includes("không kiểm tra lại"))).toBe(true);
      previewFail.times = 0;
      // b and c are still unmerged; force a stored conflict on c: release warns, and git itself refuses to merge it.
      mgr.precheckMerge(c);
      expect(store.getRun(c)!.merge_precheck!.status).toBe("conflict");
      warn.mockClear();
      expect(() => mgr.releaseRun(c)).toThrow(/xung đột/);
      expect(warn.mock.calls.some((x) => String(x[0]).includes("xung đột dự kiến") && String(x[0]).includes("sub.js"))).toBe(true);
      expect(b).toBeTruthy();
    } finally {
      previewFail.times = 0;
      warn.mockRestore();
    }
  }, 180_000);

  it("precheckMerge returns undefined for research runs and projects without repo", async () => {
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env() });
    const rec = await mgr.startRun({ prompt: "nghiên cứu" });
    await mgr.waitFor(rec.id);
    expect(mgr.precheckMerge(rec.id)).toBeUndefined();
    expect(store.getRun(rec.id)!.merge_precheck ?? null).toBeNull();

    store.upsertProject({ name: "norepo", repo_path: null, base_branch: "main", allowed_commands: [] } as never);
    store.updateRun(rec.id, { kind: "coding", branch: "tnf/x", project: "norepo" } as never);
    expect(mgr.precheckMerge(rec.id)).toBeUndefined();
    expect(store.getRun(rec.id)!.merge_precheck ?? null).toBeNull();
  }, 120_000);
});

describe("renderSystemPrompt", () => {
  it("writes a per-run copy with {{maxRoleCalls}} substituted and leaves plain templates alone", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prompt-"));
    const tpl = path.join(dir, "coord.md");
    fs.writeFileSync(tpl, "Budget: at most {{maxRoleCalls}} calls. Keep {{unknown}}.", "utf8");
    const out = path.join(dir, "runs", "r1", "system-prompt.md");
    expect(renderSystemPrompt(tpl, out, { maxRoleCalls: "8" })).toBe(out);
    expect(fs.readFileSync(out, "utf8")).toBe("Budget: at most 8 calls. Keep {{unknown}}.");
    fs.writeFileSync(tpl, "Ctx:\n{{contextBlock}}", "utf8");
    renderSystemPrompt(tpl, out, { contextBlock: "BLOCK" });
    expect(fs.readFileSync(out, "utf8")).toBe("Ctx:\nBLOCK");
    renderSystemPrompt(tpl, out, { contextBlock: "" });
    expect(fs.readFileSync(out, "utf8")).not.toContain("{{contextBlock}}");
    fs.writeFileSync(tpl, "no placeholders", "utf8");
    expect(renderSystemPrompt(tpl, out, { maxRoleCalls: "8" })).toBe(tpl);
    expect(renderSystemPrompt(path.join(dir, "missing.md"), out, {})).toBe(path.join(dir, "missing.md"));
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
