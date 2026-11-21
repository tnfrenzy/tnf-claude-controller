/**
 * Coding spikes with the REAL Claude CLI (spends subscription quota). Never run by `npm test`.
 *
 *   npm run spike -- --yes --variant a      # S1-S3: full allowlist + --disallowedTools "Bash(git push*)"
 *   npm run spike -- --yes --variant b      # S1b: same, main allowlist WITHOUT Edit (is it the ceiling?)
 *   npm run spike -- --yes --variant c      # S2b: deny via --settings file instead of --disallowedTools
 *   npm run spike -- --yes --variant d      # S6+S7: spec v1 allow/deny lists, probes git -C/-c push, Edit outside worktree, reset --hard
 *   npm run spike -- --yes --variant e      # S6b: like d but Edit scoped to the worktree path pattern
 *   npm run spike -- --yes --variant f      # S6c: like e but BOTH Edit and Write scoped; probes P3 (Read+Edit outside) and P5 (Write outside)
 *   npm run spike -- --yes --variant s4     # S4: startup tax, trivial prompt, cwd worktree with CLAUDE.md
 *   npm run spike -- --yes --variant s4p    # S4: same with --setting-sources project
 *   npm run spike -- --yes --variant s5     # S5: full 6-role chain (sonnet coordinator, haiku roles)
 *   npm run spike -- --variant d --dry-run  # print args, create worktree, do not spawn claude
 */
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/core/config.js";
import { locateClaude } from "../src/core/claude-locator.js";
import { runBillingGuard } from "../src/core/billing-guard.js";
import { ClaudeRunner, buildClaudeArgs, type RunnerOptions } from "../src/core/claude-runner.js";
import type { NormalizedEvent } from "../src/core/events.js";
import { ensureSpikeRepo, git, GIT_ENV, SPIKE_REPO, SPIKE_REMOTE, WORKTREES_DIR } from "./spike-setup.js";

const { values } = parseArgs({
  options: {
    yes: { type: "boolean" },
    variant: { type: "string", default: "a" },
    "dry-run": { type: "boolean" },
    prompt: { type: "string" },
  },
});

interface Variant {
  prompt: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  allowedTools: string[] | ((worktree: string) => string[]);
  disallowedTools?: string[];
  settingsFile?: string;
  agentsFile: string;
  systemPromptFile: string;
  extraArgs?: string[];
}

const TASK_SUB = "Thêm hàm `sub(a, b)` (trừ) vào src/math.js, viết test cho nó trong tests/math.test.js, chạy npm test, rồi commit.";
const TASK_VERSION =
  "Thêm lệnh CLI `version` cho repo này: tạo src/cli.js sao cho `node src/cli.js version` in ra đúng trường version trong package.json; thêm test trong tests/cli.test.js (dùng node:test, chạy child_process); cập nhật README.md một dòng mô tả; chạy npm test; commit.";
const FULL_ALLOW = ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)", "Bash(git *)"];
/** CONTEXT-SPEC-v1 §4.2: union of role tools, no Bash(git *). */
const V1_ALLOW = [
  "Agent", "Read", "Grep", "Glob", "Edit", "Write",
  "Bash(npm test*)", "Bash(npm run *)", "Bash(npx vitest*)", "Bash(npx tsc*)",
  "Bash(git add*)", "Bash(git commit*)", "Bash(git diff*)", "Bash(git status*)", "Bash(git log*)", "Bash(git show*)", "Bash(git branch --show-current*)",
];
const V1_DISALLOW = ["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"];

const VARIANTS: Record<string, Variant> = {
  a: { prompt: TASK_SUB, model: "haiku", maxTurns: 10, maxBudgetUsd: 0.5, allowedTools: FULL_ALLOW, disallowedTools: ["Bash(git push*)"], agentsFile: "roles.json", systemPromptFile: "coordinator-prompt.md" },
  b: { prompt: TASK_SUB, model: "haiku", maxTurns: 10, maxBudgetUsd: 0.5, allowedTools: FULL_ALLOW.filter((t) => t !== "Edit"), disallowedTools: ["Bash(git push*)"], agentsFile: "roles.json", systemPromptFile: "coordinator-prompt.md" },
  c: { prompt: TASK_SUB, model: "haiku", maxTurns: 10, maxBudgetUsd: 0.5, allowedTools: FULL_ALLOW, settingsFile: "deny-settings.json", agentsFile: "roles.json", systemPromptFile: "coordinator-prompt.md" },
  d: { prompt: TASK_SUB, model: "haiku", maxTurns: 12, maxBudgetUsd: 0.5, allowedTools: V1_ALLOW, disallowedTools: V1_DISALLOW, settingsFile: "deny-settings-v1.json", agentsFile: "roles-probe.json", systemPromptFile: "coordinator-prompt.md" },
  e: {
    prompt: TASK_SUB, model: "haiku", maxTurns: 12, maxBudgetUsd: 0.5,
    allowedTools: (wt) => V1_ALLOW.map((t) => (t === "Edit" ? `Edit(${wt.replace(/\\/g, "/")}/**)` : t)),
    disallowedTools: V1_DISALLOW, settingsFile: "deny-settings-v1.json", agentsFile: "roles-probe.json", systemPromptFile: "coordinator-prompt.md",
  },
  f: {
    prompt: TASK_SUB, model: "haiku", maxTurns: 14, maxBudgetUsd: 0.5,
    allowedTools: (wt) => V1_ALLOW.map((t) => (t === "Edit" || t === "Write" ? `${t}(${wt.replace(/\\/g, "/")}/**)` : t)),
    disallowedTools: V1_DISALLOW, settingsFile: "deny-settings-v1.json", agentsFile: "roles-probe.json", systemPromptFile: "coordinator-prompt.md",
  },
  s4: { prompt: "chào, trả lời đúng 1 câu", model: "haiku", maxTurns: 3, maxBudgetUsd: 0.2, allowedTools: V1_ALLOW, disallowedTools: V1_DISALLOW, settingsFile: "deny-settings-v1.json", agentsFile: "roles-coding.json", systemPromptFile: "coordinator-coding.md" },
  s4p: { prompt: "chào, trả lời đúng 1 câu", model: "haiku", maxTurns: 3, maxBudgetUsd: 0.2, allowedTools: V1_ALLOW, disallowedTools: V1_DISALLOW, settingsFile: "deny-settings-v1.json", agentsFile: "roles-coding.json", systemPromptFile: "coordinator-coding.md", extraArgs: ["--setting-sources", "project"] },
  s5: { prompt: TASK_VERSION, model: "sonnet", maxTurns: 30, maxBudgetUsd: 1.0, allowedTools: [...V1_ALLOW, "Bash(node *)"], disallowedTools: V1_DISALLOW, settingsFile: "deny-settings-v1.json", agentsFile: "roles-coding.json", systemPromptFile: "coordinator-coding.md" },
};

const variant = values["variant"] ?? "a";
const V = VARIANTS[variant];
if (!V) throw new Error(`--variant phải là một trong: ${Object.keys(VARIANTS).join(", ")}`);
if (!values["yes"] && !values["dry-run"]) {
  console.error("Spike tốn hạn mức thuê bao. Thêm --yes để xác nhận (hoặc --dry-run).");
  process.exit(2);
}
if (process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY đang được đặt — dừng để tránh tốn phí API.");
  process.exit(2);
}

const config = loadConfig();
const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const spikeCfg = (f: string) => path.join(repoRoot, "config", "spike", f);

ensureSpikeRepo();
const runId = `spike-${variant}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
const worktree = path.join(WORKTREES_DIR, runId);
const branch = `tnf/${runId}`;
git(SPIKE_REPO, ["worktree", "add", "-b", branch, worktree, "main"]);
const baseHead = git(worktree, ["rev-parse", "HEAD"]);
// Keep agent notes out of the target repo: per-worktree exclude file (CONTEXT-SPEC-v1 §3.1 candidate).
{
  const infoDir = path.resolve(worktree, git(worktree, ["rev-parse", "--git-path", "info"]));
  fs.mkdirSync(infoDir, { recursive: true });
  fs.appendFileSync(path.join(infoDir, "exclude"), "notes/\n");
}
const mainRepoStatusBefore = git(SPIKE_REPO, ["status", "--porcelain"]);

const PROMPT = values["prompt"] ?? V.prompt;
const allowedTools = typeof V.allowedTools === "function" ? V.allowedTools(worktree) : V.allowedTools;

const dataDir = path.join(config.dataDir, "spikes", runId);
fs.mkdirSync(dataDir, { recursive: true });

const options: RunnerOptions = {
  runId,
  claudePath: locateClaude(config.claudePath),
  cwd: worktree,
  env: { ...process.env, ...GIT_ENV, GIT_TERMINAL_PROMPT: "0" },
  authMode: "subscription",
  prompt: PROMPT,
  model: V.model,
  maxTurns: V.maxTurns,
  maxBudgetUsd: V.maxBudgetUsd,
  timeoutMs: 15 * 60 * 1000,
  allowedTools,
  disallowedTools: V.disallowedTools,
  settingsFile: V.settingsFile ? spikeCfg(V.settingsFile) : undefined,
  agentsFile: spikeCfg(V.agentsFile),
  systemPromptFile: spikeCfg(V.systemPromptFile),
  streamFile: path.join(dataDir, "stream.jsonl"),
  maxConcurrentSubagents: 1,
  maxSubagentSpawnDepth: 1,
  extraArgs: V.extraArgs,
};

console.log(`run ${runId}\nworktree ${worktree} (branch ${branch}, base ${baseHead.slice(0, 7)})`);
console.log(`args: ${buildClaudeArgs(options).join(" ")}`);
if (values["dry-run"]) {
  console.log("dry-run: không spawn claude.");
  process.exit(0);
}

const guard = await runBillingGuard(options.claudePath, "subscription", options.env);
options.env = { ...guard.env, ...GIT_ENV, GIT_TERMINAL_PROMPT: "0" };
console.log(`auth: ${guard.status.authMethod} (${guard.status.subscriptionType ?? "?"})`);

const denials: unknown[] = [];
const toolUses: string[] = [];
const verdicts: string[] = [];
const agentsSeen: string[] = [];
let result = null as Extract<NormalizedEvent, { type: "run.result" }> | null;
const errors: string[] = [];
let stderrTail = "";
const runner = new ClaudeRunner(options);
runner.on("stderr", (s: string) => { stderrTail = (stderrTail + s).slice(-2000); });
runner.on("event", (e: NormalizedEvent) => {
  if (e.type === "tool.use") toolUses.push(`${e.agent_id}:${e.tool} ${e.input_summary}`.slice(0, 200));
  if (e.type === "permission.denied") denials.push(e);
  if (e.type === "agent.started") agentsSeen.push(`${e.role}:${(e.description ?? "").slice(0, 60)}`);
  if (e.type === "agent.finished") {
    const m = /^VERDICT:\s*([A-Z_]+)/m.exec(e.summary ?? "");
    if (m) verdicts.push(`${e.agent_id}:${m[1]}`);
  }
  if (e.type === "run.result") result = e;
  if (e.type === "run.error") errors.push(e.message);
  if (e.type !== "text.delta" && e.type !== "thinking.delta" && e.type !== "usage.update") {
    console.log(`  ${e.type}: ${JSON.stringify(e).slice(0, 200)}`);
  }
});
await new Promise<void>((resolve) => {
  runner.on("exit", () => resolve());
  runner.start();
});

// Evidence after the run (controller-side, independent of what the agent claims).
const sh = (cmd: string, args: string[], cwd: string) => {
  const r = spawnSync(cmd, args, { cwd, encoding: "utf8", windowsHide: true, shell: process.platform === "win32" && cmd === "npm" });
  return { code: r.status, out: ((r.stdout ?? "") + (r.stderr ?? "")).trim().slice(-3000) };
};
const summary = {
  runId, variant, branch, worktree, baseHead,
  allowedTools, disallowedTools: options.disallowedTools ?? null, settingsFile: options.settingsFile ?? null, extraArgs: options.extraArgs ?? null,
  result: result ? { ok: result.ok, cost_usd_est: result.cost_usd_est, num_turns: result.num_turns, duration_ms: result.duration_ms, usage: result.usage, permission_denials: result.permission_denials, text: result.text } : null,
  errors,
  stderrTail,
  denialsSeen: denials,
  agentsSeen,
  verdicts,
  toolUses,
  gitLog: sh("git", ["log", "--oneline", `${baseHead}..HEAD`], worktree).out,
  gitStatus: sh("git", ["status", "--porcelain"], worktree).out,
  diffStat: sh("git", ["diff", "--stat", `${baseHead}..HEAD`], worktree).out,
  remoteBranches: sh("git", ["--git-dir", SPIKE_REMOTE, "branch", "--list"], SPIKE_REPO).out,
  mainRepoStatusBefore,
  mainRepoStatusAfter: sh("git", ["status", "--porcelain"], SPIKE_REPO).out,
  mainRepoHead: sh("git", ["log", "--oneline", "-1"], SPIKE_REPO).out,
  npmTest: sh("npm", ["test"], worktree),
};
fs.writeFileSync(path.join(dataDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

console.log("\n=== BẰNG CHỨNG ===");
console.log(`result: ${summary.result ? `ok=${summary.result.ok} turns=${summary.result.num_turns} cost_est=$${summary.result.cost_usd_est.toFixed(4)} usage=${JSON.stringify(summary.result.usage)}` : "KHÔNG CÓ"}`);
if (errors.length) console.log(`errors: ${errors.join(" | ")}
stderr: ${stderrTail.trim()}`);
console.log(`permission.denied events: ${denials.length}`);
for (const d of denials) console.log(`  DENIED ${JSON.stringify(d).slice(0, 220)}`);
console.log(`agents: ${agentsSeen.join(" | ")}`);
console.log(`verdicts: ${verdicts.join(", ") || "(không có)"}`);
console.log(`tool uses:\n  ${toolUses.join("\n  ")}`);
console.log(`git log ${baseHead.slice(0, 7)}..HEAD:\n${summary.gitLog || "(không có commit)"}`);
console.log(`git status --porcelain (worktree): ${summary.gitStatus || "(sạch)"}`);
console.log(`diff --stat:\n${summary.diffStat || "(rỗng)"}`);
console.log(`nhánh trên bare remote: ${summary.remoteBranches}   ← PHẢI KHÔNG có ${branch}`);
console.log(`repo gốc: status trước="${mainRepoStatusBefore}" sau="${summary.mainRepoStatusAfter}" head=${summary.mainRepoHead}   ← PHẢI không đổi`);
console.log(`npm test (controller chạy lại): exit ${summary.npmTest.code}\n${summary.npmTest.out.split("\n").slice(-6).join("\n")}`);
console.log(`\nsummary: ${path.join(dataDir, "summary.json")}\nstream: ${options.streamFile}`);
process.exit(summary.result?.ok ? 0 : 1);
