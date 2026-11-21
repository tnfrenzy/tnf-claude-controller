import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { REPO_ROOT } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import {
  AUTO_INTEGRATE_ID, AUTO_REVIEW_ID, autoIntegrationCommands, buildCriticPrompt, buildInterviewPrompt, interviewBlock,
  normalizeAnswers, parseCriticOutput, parseInterviewOutput, resplitBlock,
} from "../../src/core/ideas/idea-agents.js";
import { appendLesson } from "../../src/core/ideas/lessons.js";
import { validateSplitterOutput, type QueueCommand } from "../../src/core/queue/queue-plan.js";
import { QueueStore } from "../../src/core/queue/queue-store.js";
import { buildSplitterPrompt, interviewIdea, parseSplitterOutput, splitIdea, type SplitManager } from "../../src/core/ideas/queue-split.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const fx = (name: string) => path.resolve(__dirname, "..", "..", "fixtures", `${name}.stream.jsonl`);
const PROJ = "spike";
const fence = (o: unknown) => "```json\n" + JSON.stringify(o) + "\n```";

function cmd(id: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return { id, title: id, body: `Làm ${id}`, files: [`src/${id}.ts`], dependsOn: [], verify: "npm test", size: 1, ...over };
}

describe("idea agents: pure parts", () => {
  it("interviewer output: questions (max 5, trimmed) or ready; garbage counts as ready-less error", () => {
    const q = parseInterviewOutput(fence({ questions: [" a? ", "", "b?", "c?", "d?", "e?", "f?"] }));
    expect(q).toEqual({ ok: true, ready: false, questions: ["a?", "b?", "c?", "d?", "e?"] });
    expect(parseInterviewOutput(fence({ ready: true }))).toEqual({ ok: true, ready: true });
    expect(parseInterviewOutput(fence({ questions: [] }))).toEqual({ ok: true, ready: true });
    expect(parseInterviewOutput("không có json").ok).toBe(false);
  });

  it("critic output: unknown kinds become gap, empty notes dropped, pass only when no issue", () => {
    const r = parseCriticOutput(fence({ ok: false, issues: [{ kind: "contract", commandId: "a", note: "lệch tên" }, { kind: "??", note: "x" }, { kind: "gap", note: "" }] }));
    expect(r).toEqual({ ok: true, pass: false, issues: [{ commandId: "a", kind: "contract", note: "lệch tên" }, { kind: "gap", note: "x" }] });
    expect(parseCriticOutput(fence({ ok: true, issues: [] }))).toEqual({ ok: true, pass: true, issues: [] });
    expect(parseCriticOutput("???").ok).toBe(false);
  });

  it("prompts wrap idea, answers, lessons and the split as untrusted data", () => {
    const ip = buildInterviewPrompt({ idea: "xuất báo cáo", lessons: "- bài học" });
    expect(ip).toContain("<<<IDEA\nxuất báo cáo\nIDEA>>>");
    expect(ip).toContain("<<<LESSONS");
    expect(ip).toContain("không tin cậy");
    const answers = { questions: ["CSV hay PDF?"], answers: ["CSV"], skipped: false };
    const cp = buildCriticPrompt({ idea: "xuất báo cáo", split: { commands: [cmd("a")] }, interview: answers });
    expect(cp).toContain("<<<SPLIT");
    expect(cp).toContain("Đáp: CSV");
    expect(cp).toMatch(/file_conflict/);
    const sp = buildSplitterPrompt({ idea: "xuất báo cáo", webSearch: false, maxCommands: 18, interview: answers, lessons: "- bài học cũ" });
    expect(sp).toContain("tối đa 18 lệnh");
    expect(sp).toContain("integrate và final-review");
    expect(sp).toContain("<<<ANSWERS");
    expect(sp).toContain("<<<LESSONS\n- bài học cũ");
    const skip = interviewBlock({ questions: ["CSV hay PDF?"], answers: ["", ""], skipped: true })!;
    expect(skip).toContain("Bỏ qua, tự quyết");
    expect(normalizeAnswers(["a", "b"], ["x", 5, "y"])).toEqual(["x", ""]);
    const rs = resplitBlock({ commands: [cmd("a")] }, [{ kind: "too_big", commandId: "a", note: "tách đôi" }]);
    expect(rs).toContain("LẦN CHIA LẠI duy nhất");
    expect(rs).toContain("[too_big] a: tách đôi");
  });

  it("auto commands: integrate depends on every command, final-review on integrate", () => {
    const [integ, review] = autoIntegrationCommands([cmd("a"), cmd("b", { dependsOn: ["a"] })], { goal: "G", constraints: [], architecture: "", interfaces: [] });
    expect(integ!.id).toBe(AUTO_INTEGRATE_ID);
    expect(integ!.dependsOn).toEqual(["a", "b"]);
    expect(integ!.auto).toBe("integrate");
    expect(integ!.body).toMatch(/toàn bộ test, typecheck và build/);
    expect(integ!.body).toMatch(/đóng gói và cấu hình/);
    expect(review!.id).toBe(AUTO_REVIEW_ID);
    expect(review!.dependsOn).toEqual([AUTO_INTEGRATE_ID]);
    expect(review!.body).toMatch(/blueprint/);
    // auto command bodies pass the same safety check as the splitter's.
    expect(validateSplitterOutput({ commands: [cmd("a"), { ...integ!, dependsOn: ["a"], auto: undefined, acceptance: integ!.acceptance }].map(({ auto: _a, ...c }) => c) }).ok).toBe(true);
  });

  it("splitter cap is 18 when told so", () => {
    const many = Array.from({ length: 19 }, (_, i) => cmd(`c${i}`));
    expect(parseSplitterOutput(fence({ commands: many })).ok).toBe(true);
    expect(parseSplitterOutput(fence({ commands: many }), { maxCommands: 18 }).ok).toBe(false);
  });

  it("parses a bare splitter object whose blueprint comes first", () => {
    const text = "Kết quả:\n" + JSON.stringify({ blueprint: { goal: "G", constraints: [], architecture: "", interfaces: [] }, commands: [cmd("a")] });
    const r = parseSplitterOutput(text);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.blueprint?.goal).toBe("G");
  });

  it("roles-queue.json has the three read-only idea roles", () => {
    const roles = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, "config", "roles-queue.json"), "utf8")) as Record<string, { tools: string[]; prompt: string }>;
    for (const r of ["idea-interviewer", "idea-critic"]) {
      expect(roles[r]!.tools).toEqual(["Read", "Grep", "Glob"]);
      expect(roles[r]!.prompt).toContain("```json");
      expect(roles[r]!.prompt).toContain("không tin cậy");
    }
    expect(roles["idea-splitter"]!.prompt).toContain("tối đa 18 lệnh");
    expect(roles["idea-splitter"]!.prompt).toContain("blueprint");
    expect(roles["idea-splitter"]!.prompt).toContain("LỆNH CHẠY ĐƯỢC");
    expect(roles["idea-splitter"]!.prompt).toContain("research");
  });
});

describe("idea pipeline with the fake CLI", () => {
  let root: string;
  let cfg: ControllerConfig;
  let store: RunStore;
  let queue: QueueStore;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ideapipe-"));
    const tools = ["Agent", "Read", "Write"];
    cfg = {
      repoRoot: root, claudePath: null, models: [{ id: "sonnet", label: "sonnet" }, { id: "opus", label: "opus" }],
      workspaceDir: path.join(root, "workspace"), worktreesDir: path.join(root, "workspace", "worktrees"), dataDir: path.join(root, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
      defaults: {
        authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: tools,
        agentsFile: path.join(root, "r.json"), systemPromptFile: path.join(root, "c.md"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
        research: { allowedTools: tools, agentsFile: path.join(root, "r.json"), systemPromptFile: path.join(root, "c.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
        coding: { allowedTools: tools, agentsFile: path.join(root, "rc.json"), systemPromptFile: path.join(root, "cc.md"), settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
      queue: { maxParallel: 2, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [], splitter: { webSearch: false, maxWebCalls: 20, interview: true, critic: true, autoIntegrate: true }, lessons: { enabled: true } },
    } as unknown as ControllerConfig;
    store = new RunStore(":memory:");
    const repo = path.join(root, "repo");
    fs.mkdirSync(repo, { recursive: true });
    for (const a of [["init", "-b", "main"], ["config", "user.name", "T"], ["config", "user.email", "t@example.com"]]) runGit(repo, a);
    fs.writeFileSync(path.join(repo, "README.md"), "# t\n");
    runGit(repo, ["add", "-A"]);
    runGit(repo, ["commit", "-m", "init"]);
    store.upsertProject({ name: PROJ, repo_path: repo, base_branch: "main", allowed_commands: [] });
    queue = new QueueStore(cfg.dataDir);
  });
  afterEach(() => {
    store.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  /** Real RunManager on the fake CLI replaying `seq` in order (one fixture per agent run). */
  const real = (seq: string[], argsDir?: string) => {
    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_SEQUENCE: seq.join("|"), FAKE_CLAUDE_COUNTER_FILE: path.join(root, `count-${Math.random()}`) };
    const mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env });
    const inputs: Array<{ model?: string; maxBudgetUsd?: number; prompt: string }> = [];
    const manager: SplitManager = {
      startRun: async (input) => { inputs.push(input); return mgr.startRun(input as never); },
      waitFor: (id) => mgr.waitFor(id),
    };
    void argsDir;
    return { deps: { manager, queue, config: cfg, getProject: (n: string) => store.getProject(n) }, inputs };
  };

  it("critic issues -> exactly one re-split; integrate + final-review appended; meta stored", async () => {
    const { deps, inputs } = real([fx("idea-split-blueprint"), fx("idea-critic-issues"), fx("idea-resplit-blueprint")]);
    const stages: string[] = [];
    const r = await splitIdea(deps, PROJ, "Xuất báo cáo lịch sử", "manual", { onStage: (s) => stages.push(s) });
    expect(stages).toEqual(["split", "critic", "resplit"]);
    expect(inputs).toHaveLength(3);
    expect(inputs.map((i) => i.model)).toEqual(["opus", "opus", "opus"]);
    expect(inputs[1]!.maxBudgetUsd).toBe(3);
    expect(inputs[2]!.prompt).toContain("LẦN CHIA LẠI duy nhất");
    expect(r.commands.map((c) => c.id)).toEqual(["report-format", "report-core", "report-ui", "integrate", "final-review"]);
    const integ = r.commands.find((c) => c.id === "integrate")!;
    expect(integ.dependsOn).toEqual(["report-format", "report-core", "report-ui"]);
    expect(integ.auto).toBe("integrate");
    expect(r.commands.find((c) => c.id === "final-review")!.dependsOn).toEqual(["integrate"]);
    expect(r.commands[1]!.consumes).toEqual(["formatDate"]);
    expect(r.costUsd).toBeCloseTo(0.09, 5);
    const meta = queue.getIdeaMeta(PROJ, r.runId)!;
    expect(meta.resplit).toBe(true);
    expect(meta.criticIssues).toHaveLength(2);
    expect(meta.criticIssues![1]!.kind).toBe("gap");
    expect(meta.blueprint!.interfaces.map((i) => i.owner)).toEqual(["report-core", "report-format"]);
    expect(r.commands.every((c) => c.sourceRef === r.runId && c.status === "chờ duyệt")).toBe(true);
  });

  it("critic ok -> no re-split; integrate off -> no auto commands", async () => {
    cfg.queue.splitter.autoIntegrate = false;
    const { deps, inputs } = real([fx("idea-split-blueprint"), fx("idea-critic-ok")]);
    const r = await splitIdea(deps, PROJ, "Xuất báo cáo", "manual");
    expect(inputs).toHaveLength(2);
    expect(r.commands.map((c) => c.id)).toEqual(["report-core", "report-ui"]);
    const meta = queue.getIdeaMeta(PROJ, r.runId)!;
    expect(meta.resplit).toBeUndefined();
    expect(meta.criticIssues).toBeUndefined();
    expect(meta.blueprint?.goal).toBe("Xuất báo cáo lịch sử ra CSV");
  });

  it("critic off -> single run, old behaviour", async () => {
    cfg.queue.splitter.critic = false;
    cfg.queue.splitter.autoIntegrate = false;
    const { deps, inputs } = real([fx("idea-split-blueprint")]);
    const r = await splitIdea(deps, PROJ, "Xuất báo cáo", "manual");
    expect(inputs).toHaveLength(1);
    expect(r.commands).toHaveLength(2);
  });

  it("an invalid re-split keeps the first split and records why", async () => {
    const { deps } = real([fx("idea-split-blueprint"), fx("idea-critic-issues"), fx("queue-split-forbidden")]);
    const r = await splitIdea(deps, PROJ, "Xuất báo cáo", "manual");
    expect(r.commands.map((c) => c.id)).toEqual(["report-core", "report-ui", "integrate", "final-review"]);
    const meta = queue.getIdeaMeta(PROJ, r.runId)!;
    expect(meta.resplit).toBeUndefined();
    expect(meta.resplitError).toMatch(/git push/);
    expect(meta.criticIssues).toHaveLength(2);
  });

  it("a failing critic does not block the split", async () => {
    const text = fence({ commands: [cmd("a")] });
    let n = 0;
    const manager: SplitManager = {
      startRun: async () => ({ id: `r${++n}` }),
      waitFor: async (id) => (id === "r1" ? { id, status: "done", result_text: text, cost_usd_est: 0.01 } : { id, status: "error", error: "hết ngân sách", cost_usd_est: 0 }),
    };
    const r = await splitIdea({ manager, queue, config: cfg, getProject: (x) => store.getProject(x) }, PROJ, "x", "manual");
    expect(r.commands.map((c) => c.id)).toEqual(["a", "integrate", "final-review"]);
    expect(queue.getIdeaMeta(PROJ, "r1")!.warnings!.some((w) => /Phản biện không chạy được/.test(w))).toBe(true);
  });

  it("lessons.md and interview answers reach the splitter and critic prompts", async () => {
    appendLesson(cfg.dataDir, PROJ, "Lệnh UI lỗi vì thiếu export");
    const { deps, inputs } = real([fx("idea-split-blueprint"), fx("idea-critic-ok")]);
    await splitIdea(deps, PROJ, "Xuất báo cáo", "manual", { interview: { questions: ["CSV hay PDF?"], answers: ["CSV"], skipped: false } });
    for (const i of inputs) expect(i.prompt).toContain("Lệnh UI lỗi vì thiếu export");
    expect(inputs[0]!.prompt).toContain("Đáp: CSV");
    expect(queue.listIdeaMeta(PROJ)[Object.keys(queue.listIdeaMeta(PROJ))[0]!]!.interview!.answers).toEqual(["CSV"]);
  });

  it("interviewer: questions or ready, read-only tools without web, its own model and budget", async () => {
    cfg.ideaAgents = { interviewModel: "sonnet", interviewBudgetUsd: 1.5 } as never;
    const argsFile = path.join(root, "args.json");
    const env: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_FIXTURE: fx("idea-interview-questions"), FAKE_CLAUDE_ARGS_FILE: argsFile };
    const mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env });
    let seen: { model?: string; maxBudgetUsd?: number } | null = null;
    const manager: SplitManager = { startRun: async (i) => { seen = i; return mgr.startRun(i as never); }, waitFor: (id) => mgr.waitFor(id) };
    const deps = { manager, queue, config: cfg, getProject: (n: string) => store.getProject(n) };
    const r = await interviewIdea(deps, PROJ, "Xuất báo cáo");
    expect(r.ready).toBe(false);
    expect(r.questions).toEqual(["Xuất CSV hay PDF?", "Có cần lọc theo ngày không?"]);
    expect(seen).toMatchObject({ model: "sonnet", maxBudgetUsd: 1.5 });
    const argv = JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
    const at = argv.indexOf("--allowedTools");
    const allowed: string[] = [];
    for (let i = at + 1; i < argv.length && !argv[i]!.startsWith("--"); i++) allowed.push(argv[i]!);
    expect(allowed.join(" ")).toContain("Read(");
    expect(allowed.join(" ")).not.toMatch(/WebSearch|WebFetch|Bash|Edit|Write/);
    const env2: NodeJS.ProcessEnv = { ...process.env, FAKE_CLAUDE_FIXTURE: fx("idea-interview-ready") };
    const mgr2 = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: env2 });
    const ready = await interviewIdea({ ...deps, manager: { startRun: (i) => mgr2.startRun(i as never), waitFor: (id) => mgr2.waitFor(id) } }, PROJ, "Xuất báo cáo");
    expect(ready).toMatchObject({ ready: true, questions: [] });
  });
});
