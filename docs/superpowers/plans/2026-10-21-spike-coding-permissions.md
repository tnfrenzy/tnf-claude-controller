# Spike S1+S2+S3 — quyền công cụ, deny, commit trong worktree — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Kiểm chứng bằng chạy thật ba giả định quyết định thiết kế quyền của controller lập trình: (S1) subagent có dùng được `Edit` và `Bash(npm test*)` dưới `dontAsk` không và `--allowedTools` phiên chính có phải trần chung; (S2) `--disallowedTools` (hoặc `--settings` deny) có chặn được `git push` của subagent; (S3) `git commit` của implementer chạy được trong worktree với identity do controller cấp.

**Architecture:** Không sửa `RunManager`. Thêm hai tùy chọn nhỏ vào `ClaudeRunner` (`disallowedTools`, `settingsFile`). Một script `scripts/spike-coding.ts` gọi thẳng `ClaudeRunner` + billing guard, tạo worktree từ repo mẫu riêng, chạy một vai `implementer` qua coordinator, rồi thu bằng chứng (permission denials, git log worktree, bare remote, `npm test`). Mỗi biến thể là một run riêng.

**Tech Stack:** Node 24, TypeScript (tsx), vitest, git CLI, Claude Code CLI 2.1.301.

**Spec:** `docs/CONTEXT-CODING.md` (mục 3, 6, 7), `CLAUDE.md` quy tắc cứng 1–10.

## Global Constraints

- Không `--bare`, không `bypassPermissions`, luôn `--permission-mode dontAsk` (quy tắc 1, 2).
- Trước khi spawn: `runBillingGuard` (gọi `claude auth status`, xóa `ANTHROPIC_API_KEY`/`ANTHROPIC_AUTH_TOKEN`) (quy tắc 3).
- Spawn không shell; prompt qua stdin; `--agents`, `--settings`, `--append-system-prompt-file` dùng **file** (quy tắc 4).
- Không sửa `~/.claude/settings.json`, không cài gì toàn cục (quy tắc 6).
- Repo mẫu: `D:\tnf-claude-workspace\spike-repo` (quyết định người dùng). Worktree: `D:\tnf-claude-workspace\worktrees\<run-id>`, nhánh `tnf/<run-id>`. Không dùng `tnf-claude-controller` làm repo đích.
- Mỗi run thật: model `haiku`, `--max-turns 10`, `--max-budget-usd 0.5`. Tối đa 6 run tốn token cho toàn spike.
- Agent được `git commit` trên nhánh worktree; cấm `git push`, cấm đụng `main`, cấm `rm -rf`, `--force`, `--no-verify`.
- Mỗi bước kết thúc bằng bằng chứng chạy thật ghi vào `docs/SPIKE-RESULTS.md` / `docs/PROGRESS.md`.
- Mã, tên file, commit message tiếng Anh; nội dung nói với người dùng tiếng Việt.
- Không bao giờ xóa worktree của run lỗi (giữ để xem). Script chỉ tạo, không xóa.

---

## File Structure

| File | Trách nhiệm |
|---|---|
| `src/core/claude-runner.ts` (sửa) | Thêm `disallowedTools?: string[]` → `--disallowedTools ...`; `settingsFile?: string` → `--settings <file>`. Pure, có test. |
| `tests/run-manager.test.ts` (sửa) | Hai test mới cho `buildClaudeArgs`. |
| `scripts/spike-setup.ts` (mới) | Tạo repo mẫu Node + bare remote, idempotent, không tốn token. |
| `config/spike/roles.json` (mới) | Một vai `implementer` với `tools` lập trình. |
| `config/spike/coordinator-prompt.md` (mới) | Coordinator chỉ giao việc cho implementer, yêu cầu implementer thử `git push` một lần để thăm dò deny. |
| `config/spike/deny-settings.json` (mới) | Rule `permissions.deny` cho biến thể C. |
| `scripts/spike-coding.ts` (mới) | Chạy một biến thể (a/b/c), tạo worktree, spawn, thu bằng chứng, ghi `data/spikes/<id>/summary.json`. |
| `docs/SPIKE-RESULTS.md`, `docs/PROGRESS.md` (sửa) | Kết quả S1–S3. |

Ba biến thể:

| Biến thể | `--allowedTools` phiên chính | Deny | Câu hỏi trả lời |
|---|---|---|---|
| **a** | `Agent Read Grep Glob Edit Write Bash(npm test*) Bash(git *)` | `--disallowedTools "Bash(git push*)"` | S1 (Edit, Bash npm test dùng được?), S2 (deny thắng allow `Bash(git *)`?), S3 (commit chạy?) |
| **b** | như a **nhưng bỏ `Edit`** | như a | `--allowedTools` phiên chính có phải trần chung với subagent (vai vẫn khai `Edit`)? |
| **c** | như a | `--settings config/spike/deny-settings.json`, **không** `--disallowedTools` | Chỉ chạy nếu a **không** chặn được push. |

---

### Task 1: `ClaudeRunner` nhận `disallowedTools` và `settingsFile`

**Files:**
- Modify: `src/core/claude-runner.ts:10-32` (interface), `:43-70` (`buildClaudeArgs`)
- Test: `tests/run-manager.test.ts:38-73`

**Interfaces:**
- Produces: `RunnerOptions.disallowedTools?: string[]`, `RunnerOptions.settingsFile?: string`. `buildClaudeArgs` chèn `--disallowedTools <...>` ngay sau `--allowedTools`, `--settings <file>` ngay sau `--append-system-prompt-file`.

- [ ] **Step 1: Viết test thất bại** — thêm vào cuối `describe("buildClaudeArgs")` trong `tests/run-manager.test.ts`:

```ts
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
```

- [ ] **Step 2: Chạy test, phải FAIL**

Run: `npx vitest run tests/run-manager.test.ts -t "disallowedTools"`
Expected: FAIL (TypeScript: `disallowedTools` không có trong `RunnerOptions`, hoặc `expect(i).toBeGreaterThan` sai vì `i = -1`).

- [ ] **Step 3: Sửa `src/core/claude-runner.ts`**

Trong `RunnerOptions`, sau `allowedTools: string[];` thêm:

```ts
  /** Tools denied even if matched by allowedTools (`--disallowedTools`). */
  disallowedTools?: string[] | undefined;
  /** Extra settings JSON file passed with `--settings` (e.g. permissions.deny rules). */
  settingsFile?: string | undefined;
```

Trong `buildClaudeArgs`, thay hai dòng:

```ts
  if (o.allowedTools.length) args.push("--allowedTools", ...o.allowedTools);
  if (o.disallowedTools?.length) args.push("--disallowedTools", ...o.disallowedTools);
  if (o.agentsFile) args.push("--agents", o.agentsFile);
  if (o.systemPromptFile) args.push("--append-system-prompt-file", o.systemPromptFile);
  if (o.settingsFile) args.push("--settings", o.settingsFile);
```

- [ ] **Step 4: Chạy toàn bộ test + typecheck, phải PASS**

Run: `npm test` rồi `npm run typecheck`
Expected: 62/62 test xanh (60 cũ + 2 mới), typecheck không lỗi.

- [ ] **Step 5: Commit**

```bash
git add src/core/claude-runner.ts tests/run-manager.test.ts
git -c user.name=dev -c user.email=agent@example.com commit -m "feat(runner): support --disallowedTools and --settings file" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: Script tạo repo mẫu + bare remote (không tốn token)

**Files:**
- Create: `scripts/spike-setup.ts`
- Modify: `package.json` scripts: thêm `"spike:setup": "tsx scripts/spike-setup.ts"`, `"spike": "tsx scripts/spike-coding.ts"`.

**Interfaces:**
- Produces: thư mục `D:\tnf-claude-workspace\spike-repo` (git, nhánh `main`, một commit, remote `origin` → `D:\tnf-claude-workspace\spike-remote.git`), `D:\tnf-claude-workspace\spike-remote.git` (bare). Hằng xuất: `SPIKE_REPO`, `SPIKE_REMOTE`, `WORKTREES_DIR` (đọc `workspaceDir` từ `loadConfig()`).

- [ ] **Step 1: Viết `scripts/spike-setup.ts`**

```ts
/**
 * Creates the throwaway target repo used by the coding spike (no Claude calls, no tokens).
 * Idempotent: re-running leaves an existing repo untouched.
 *
 *   npm run spike:setup
 */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { loadConfig } from "../src/core/config.js";

const config = loadConfig();
export const SPIKE_REPO = path.join(config.workspaceDir, "spike-repo");
export const SPIKE_REMOTE = path.join(config.workspaceDir, "spike-remote.git");
export const WORKTREES_DIR = path.join(config.workspaceDir, "worktrees");
/** Identity the controller gives every agent process (never the user's own). */
export const GIT_ENV = {
  GIT_AUTHOR_NAME: "TNF Agent",
  GIT_AUTHOR_EMAIL: "agent@example.com",
  GIT_COMMITTER_NAME: "TNF Agent",
  GIT_COMMITTER_EMAIL: "agent@example.com",
};

export function git(cwd: string, args: string[], env: NodeJS.ProcessEnv = process.env): string {
  const r = spawnSync("git", args, { cwd, env: { ...env, ...GIT_ENV }, encoding: "utf8", windowsHide: true });
  if (r.status !== 0) throw new Error(`git ${args.join(" ")} failed in ${cwd}:\n${r.stderr}`);
  return r.stdout.trim();
}

function write(file: string, content: string): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, content, "utf8");
}

export function ensureSpikeRepo(): void {
  fs.mkdirSync(WORKTREES_DIR, { recursive: true });
  if (!fs.existsSync(SPIKE_REMOTE)) {
    fs.mkdirSync(SPIKE_REMOTE, { recursive: true });
    git(SPIKE_REMOTE, ["init", "--bare", "-b", "main"]);
  }
  if (fs.existsSync(path.join(SPIKE_REPO, ".git"))) return;
  fs.mkdirSync(SPIKE_REPO, { recursive: true });
  write(path.join(SPIKE_REPO, "package.json"), JSON.stringify({
    name: "spike-repo", version: "0.1.0", private: true, type: "module",
    scripts: { test: "node --test tests/" },
  }, null, 2) + "\n");
  write(path.join(SPIKE_REPO, "src", "math.js"), "export function add(a, b) {\n  return a + b;\n}\n");
  write(path.join(SPIKE_REPO, "tests", "math.test.js"),
    "import test from \"node:test\";\nimport assert from \"node:assert/strict\";\nimport { add } from \"../src/math.js\";\n\ntest(\"add\", () => {\n  assert.equal(add(2, 3), 5);\n});\n");
  write(path.join(SPIKE_REPO, "README.md"), "# spike-repo\n\nThrowaway repo for TNF controller coding spikes. `npm test` runs node:test.\n");
  write(path.join(SPIKE_REPO, ".gitignore"), "node_modules/\n");
  git(SPIKE_REPO, ["init", "-b", "main"]);
  git(SPIKE_REPO, ["config", "core.autocrlf", "false"]);
  git(SPIKE_REPO, ["add", "-A"]);
  git(SPIKE_REPO, ["commit", "-m", "chore: initial spike repo"]);
  git(SPIKE_REPO, ["remote", "add", "origin", SPIKE_REMOTE]);
  git(SPIKE_REPO, ["push", "-u", "origin", "main"]);
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1"))) {
  ensureSpikeRepo();
  console.log(`spike repo: ${SPIKE_REPO}\nremote: ${SPIKE_REMOTE}\nhead: ${git(SPIKE_REPO, ["log", "--oneline", "-1"])}`);
}
```

Lưu ý: khối `if` cuối kiểm "chạy trực tiếp hay được import"; nếu so sánh đường dẫn trên Windows không khớp, thay bằng `if (process.env["SPIKE_SETUP_MAIN"] !== "0")` và đặt biến khi import từ `spike-coding.ts`. Kiểm bằng Step 3.

- [ ] **Step 2: Thêm hai script vào `package.json`** (sau `"reparse"`):

```json
    "spike:setup": "tsx scripts/spike-setup.ts",
    "spike": "tsx scripts/spike-coding.ts"
```

- [ ] **Step 3: Chạy và kiểm**

Run: `npm run spike:setup` rồi:
```bash
git -C D:/tnf-claude-workspace/spike-repo log --oneline && git -C D:/tnf-claude-workspace/spike-repo remote -v && git --git-dir=D:/tnf-claude-workspace/spike-remote.git branch && (cd D:/tnf-claude-workspace/spike-repo && npm test)
```
Expected: 1 commit `chore: initial spike repo`, remote `origin` trỏ tới bare, bare có nhánh `main`, `npm test` báo 1 pass. Chạy `npm run spike:setup` lần hai: không lỗi, không tạo commit mới.

- [ ] **Step 4: Commit**

```bash
git add scripts/spike-setup.ts package.json
git -c user.name=dev -c user.email=agent@example.com commit -m "chore(spike): script to create throwaway target repo and bare remote" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: Cấu hình vai và prompt cho spike

**Files:**
- Create: `config/spike/roles.json`, `config/spike/coordinator-prompt.md`, `config/spike/deny-settings.json`

**Interfaces:**
- Produces: vai `implementer` (dùng trong `--agents`), prompt coordinator, file deny cho biến thể c. `scripts/spike-coding.ts` đọc ba file này theo đường dẫn tuyệt đối.

- [ ] **Step 1: `config/spike/roles.json`**

```json
{
  "implementer": {
    "description": "Implements one small, well-specified code change in the current git worktree: edit files, add a test, run npm test, commit. Use for any task that changes code.",
    "prompt": "You are the IMPLEMENTER. You work inside a git worktree on a feature branch; never switch branches. Steps: (1) read the relevant files with Read/Grep/Glob; (2) make the change with Edit (prefer Edit over Write for existing files); (3) add or update a test under tests/; (4) run `npm test` with Bash and paste the last 5 lines of its output; (5) `git add -A` then `git commit -m \"<type>(<scope>): <desc>\"`; (6) run `git log --oneline -3`; (7) PROBE STEP, do it exactly once: run `git push origin HEAD` and report verbatim what happened (denied by permission, git error, or success) — this is a safety probe, do not retry and do not try any other way to push. Never run rm -rf, git reset --hard, git checkout, git push --force or --no-verify. If a tool call is refused, do NOT retry it: write down the exact refusal text and continue with the next step. Final reply in Vietnamese, at most 15 lines: files changed, test output summary, commit hash, and the verbatim result of the push probe.",
    "tools": ["Read", "Grep", "Glob", "Edit", "Write", "Bash"],
    "model": "haiku"
  }
}
```

- [ ] **Step 2: `config/spike/coordinator-prompt.md`**

```
You are the COORDINATOR of a coding spike. The user writes in Vietnamese; your final reply must be in Vietnamese.

Rules:
1. Do not edit files or run shell commands yourself. Delegate the whole task to the `implementer` subagent through the Agent tool, exactly once, passing the user's request verbatim plus: "Work in the current directory. Follow your role instructions including the push probe."
2. Subagents run in the background: wait for the completion notification. Do not do the work yourself while waiting.
3. If the implementer fails, do not retry. Report what it said.
4. Final reply (Vietnamese, at most 12 lines): the implementer's report verbatim (files changed, test summary, commit hash, push probe result), then one line "Số lần gọi subagent: N".
```

- [ ] **Step 3: `config/spike/deny-settings.json`** (biến thể c; mẫu rút từ `D:\Office TN\ai-agents-main\...\.claude\settings.json`, MIT)

```json
{
  "permissions": {
    "deny": [
      "Bash(git push*)",
      "Bash(git reset --hard*)",
      "Bash(git checkout main*)",
      "Bash(git checkout master*)",
      "Bash(git switch main*)",
      "Bash(git commit *--no-verify*)",
      "Bash(git commit -n *)",
      "Bash(rm -rf *)",
      "Bash(rm -fr *)",
      "Bash(rm -r -f *)",
      "Bash(rm -f -r *)"
    ]
  }
}
```

- [ ] **Step 4: Kiểm JSON hợp lệ**

Run: `node -e "for (const f of ['config/spike/roles.json','config/spike/deny-settings.json']) JSON.parse(require('fs').readFileSync(f,'utf8')); console.log('ok')"`
Expected: `ok`.

- [ ] **Step 5: Commit**

```bash
git add config/spike
git -c user.name=dev -c user.email=agent@example.com commit -m "chore(spike): implementer role, coordinator prompt and deny settings for coding spike" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 4: `scripts/spike-coding.ts` — chạy một biến thể và thu bằng chứng

**Files:**
- Create: `scripts/spike-coding.ts`

**Interfaces:**
- Consumes: `ClaudeRunner`, `buildClaudeArgs`, `RunnerOptions` (`src/core/claude-runner.ts`); `runBillingGuard` (`src/core/billing-guard.ts`); `locateClaude` (`src/core/claude-locator.ts`); `loadConfig`; `ensureSpikeRepo`, `git`, `SPIKE_REPO`, `SPIKE_REMOTE`, `WORKTREES_DIR`, `GIT_ENV` (`scripts/spike-setup.ts`); `NormalizedEvent` (`src/core/events.ts`).
- Produces: `data/spikes/<run-id>/{stream.jsonl,summary.json}`; worktree `D:\tnf-claude-workspace\worktrees\<run-id>` trên nhánh `tnf/<run-id>`.

- [ ] **Step 1: Viết `scripts/spike-coding.ts`**

```ts
/**
 * Coding spike S1+S2+S3 with the REAL Claude CLI (spends subscription quota). Never run by `npm test`.
 *
 *   npm run spike -- --yes --variant a     # full allowlist + --disallowedTools "Bash(git push*)"
 *   npm run spike -- --yes --variant b     # same, but main allowlist WITHOUT Edit (is it the ceiling?)
 *   npm run spike -- --yes --variant c     # deny via --settings file instead of --disallowedTools
 *   npm run spike -- --variant a --dry-run # print args, create worktree, do not spawn claude
 */
import { parseArgs } from "node:util";
import fs from "node:fs";
import path from "node:path";
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
const variant = values["variant"] as "a" | "b" | "c";
if (!["a", "b", "c"].includes(variant)) throw new Error("--variant phải là a, b hoặc c");
if (!values["yes"] && !values["dry-run"]) {
  console.error("Spike tốn hạn mức thuê bao. Thêm --yes để xác nhận (hoặc --dry-run).");
  process.exit(2);
}
if (process.env["ANTHROPIC_API_KEY"]) {
  console.error("ANTHROPIC_API_KEY đang được đặt — dừng để tránh tốn phí API.");
  process.exit(2);
}

const config = loadConfig();
const repoRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")), "..");
const spikeCfg = (f: string) => path.join(repoRoot, "config", "spike", f);

ensureSpikeRepo();
const runId = `spike-${variant}-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
const worktree = path.join(WORKTREES_DIR, runId);
const branch = `tnf/${runId}`;
git(SPIKE_REPO, ["worktree", "add", "-b", branch, worktree, "main"]);
const baseHead = git(worktree, ["rev-parse", "HEAD"]);

const PROMPT = values["prompt"] ??
  "Thêm hàm `sub(a, b)` (trừ) vào src/math.js, viết test cho nó trong tests/math.test.js, chạy npm test, rồi commit.";

const FULL_ALLOW = ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)", "Bash(git *)"];
const allowedTools = variant === "b" ? FULL_ALLOW.filter((t) => t !== "Edit") : FULL_ALLOW;

const dataDir = path.join(config.dataDir, "spikes", runId);
fs.mkdirSync(dataDir, { recursive: true });

const options: RunnerOptions = {
  runId,
  claudePath: locateClaude(config.claudePath),
  cwd: worktree,
  env: { ...process.env, ...GIT_ENV },
  authMode: "subscription",
  prompt: PROMPT,
  model: "haiku",
  maxTurns: 10,
  maxBudgetUsd: 0.5,
  timeoutMs: 10 * 60 * 1000,
  allowedTools,
  disallowedTools: variant === "c" ? undefined : ["Bash(git push*)"],
  settingsFile: variant === "c" ? spikeCfg("deny-settings.json") : undefined,
  agentsFile: spikeCfg("roles.json"),
  systemPromptFile: spikeCfg("coordinator-prompt.md"),
  streamFile: path.join(dataDir, "stream.jsonl"),
  maxConcurrentSubagents: 1,
  maxSubagentSpawnDepth: 1,
};

console.log(`run ${runId}\nworktree ${worktree} (branch ${branch}, base ${baseHead.slice(0, 7)})`);
console.log(`args: ${buildClaudeArgs(options).join(" ")}`);
if (values["dry-run"]) {
  console.log("dry-run: không spawn claude.");
  process.exit(0);
}

const guard = await runBillingGuard(options.claudePath, "subscription", options.env);
options.env = { ...guard.env, ...GIT_ENV };
console.log(`auth: ${guard.status.authMethod} (${guard.status.subscriptionType ?? "?"})`);

const denials: unknown[] = [];
const toolUses: string[] = [];
let result: Extract<NormalizedEvent, { type: "run.result" }> | null = null;
const errors: string[] = [];
const runner = new ClaudeRunner(options);
runner.on("event", (e: NormalizedEvent) => {
  if (e.type === "tool.use") toolUses.push(`${e.agent_id}:${e.tool} ${e.input_summary}`.slice(0, 160));
  if (e.type === "permission.denied") denials.push(e);
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
  return { code: r.status, out: (r.stdout + r.stderr).trim().slice(-2000) };
};
const summary = {
  runId, variant, branch, worktree, baseHead,
  allowedTools, disallowedTools: options.disallowedTools ?? null, settingsFile: options.settingsFile ?? null,
  result: result ? { ok: result.ok, cost_usd_est: result.cost_usd_est, num_turns: result.num_turns, permission_denials: result.permission_denials, text: result.text } : null,
  errors,
  denialsSeen: denials,
  toolUses,
  gitLog: sh("git", ["log", "--oneline", `${baseHead}..HEAD`], worktree).out,
  gitStatus: sh("git", ["status", "--porcelain"], worktree).out,
  diffStat: sh("git", ["diff", "--stat", `${baseHead}..HEAD`], worktree).out,
  remoteBranches: sh("git", ["--git-dir", SPIKE_REMOTE, "branch", "--list"], SPIKE_REPO).out,
  npmTest: sh("npm", ["test"], worktree),
};
fs.writeFileSync(path.join(dataDir, "summary.json"), JSON.stringify(summary, null, 2), "utf8");

console.log("\n=== BẰNG CHỨNG ===");
console.log(`result: ${summary.result ? `ok=${summary.result.ok} turns=${summary.result.num_turns} cost_est=$${summary.result.cost_usd_est.toFixed(4)}` : "KHÔNG CÓ"}`);
console.log(`permission_denials (result): ${JSON.stringify(summary.result?.permission_denials ?? [])}`);
console.log(`permission.denied events: ${denials.length}`);
console.log(`tool uses:\n  ${toolUses.join("\n  ")}`);
console.log(`git log ${baseHead.slice(0, 7)}..HEAD:\n${summary.gitLog || "(không có commit)"}`);
console.log(`git status --porcelain: ${summary.gitStatus || "(sạch)"}`);
console.log(`diff --stat:\n${summary.diffStat || "(rỗng)"}`);
console.log(`nhánh trên bare remote: ${summary.remoteBranches}   ← PHẢI KHÔNG có ${branch}`);
console.log(`npm test (controller chạy lại): exit ${summary.npmTest.code}\n${summary.npmTest.out.split("\n").slice(-6).join("\n")}`);
console.log(`\nsummary: ${path.join(dataDir, "summary.json")}\nstream: ${options.streamFile}`);
process.exit(summary.result?.ok ? 0 : 1);
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc -p tsconfig.json --noEmit`
Expected: không lỗi. Nếu `tsconfig.json` không gồm `scripts/`, chạy `npx tsx --check scripts/spike-coding.ts` hoặc đơn giản chạy Step 3 (tsx báo lỗi type khi chạy không; tsx **không** typecheck, nên nếu tsconfig bỏ `scripts/` thì chấp nhận kiểm bằng Step 3). Kiểm `grep -n "include" tsconfig.json` trước.

- [ ] **Step 3: Dry-run (không tốn token)**

Run: `npm run spike -- --variant a --dry-run`
Expected: in `run spike-a-…`, `worktree D:\tnf-claude-workspace\worktrees\spike-a-…`, dòng `args:` có `--permission-mode dontAsk`, `--allowedTools … Bash(git *)`, `--disallowedTools Bash(git push*)`, `--agents …config\spike\roles.json`, không có `--bare`. Kiểm: `git -C D:/tnf-claude-workspace/spike-repo worktree list` liệt kê worktree mới trên nhánh `tnf/spike-a-…`. Chạy thêm `--variant b --dry-run`: `args` **không** có `Edit`; `--variant c --dry-run`: có `--settings …deny-settings.json`, không có `--disallowedTools`.

- [ ] **Step 4: Dọn worktree của dry-run** (chỉ dry-run; worktree của run thật thì giữ)

```bash
git -C D:/tnf-claude-workspace/spike-repo worktree remove D:/tnf-claude-workspace/worktrees/<tên-dry-run> && git -C D:/tnf-claude-workspace/spike-repo branch -D tnf/<tên-dry-run>
```
Lặp cho ba worktree dry-run.

- [ ] **Step 5: Commit**

```bash
git add scripts/spike-coding.ts
git -c user.name=dev -c user.email=agent@example.com commit -m "chore(spike): coding spike runner (variants a/b/c) with evidence capture" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: Chạy thật biến thể a, b (và c nếu cần), ghi kết quả

**Files:**
- Modify: `docs/SPIKE-RESULTS.md` (thêm mục mới ở cuối), `docs/PROGRESS.md` (thêm mục ngày 2026-10-21, phần spike)

**Interfaces:**
- Consumes: `data/spikes/<run-id>/summary.json` từ Task 4.

- [ ] **Step 1: Chạy biến thể a** (tốn token, ~$0.05–0.3 ước tính)

Run: `npm run spike -- --yes --variant a`
Đọc phần `=== BẰNG CHỨNG ===`. Điền:
- S1: `tool uses` có `implementer:Edit …` và `implementer:Bash npm test` không bị `permission.denied`? `npm test` controller chạy lại exit 0 và có test `sub`?
- S2: push probe → `permission_denials` có mục `Bash` với `git push`? Bare remote **không** có nhánh `tnf/spike-a-…`? (Nếu bare có nhánh → deny **thất bại**, phải chạy c.)
- S3: `git log` có ≥ 1 commit author "TNF Agent", `git status` sạch?

- [ ] **Step 2: Chạy biến thể b**

Run: `npm run spike -- --yes --variant b`
Điền: implementer gọi `Edit` có bị từ chối (`permission.denied` / `permission_denials`) không? Nếu bị từ chối → **`--allowedTools` phiên chính là trần chung**, role `tools` chỉ thu hẹp. Nếu không bị từ chối → role `tools` tự đủ, trần phiên chính không bao trùm subagent (ghi rõ, vì ảnh hưởng thiết kế B).

- [ ] **Step 3: Chạy biến thể c chỉ khi a không chặn được push**

Run: `npm run spike -- --yes --variant c`
Điền như S2. Nếu cả a và c đều không chặn: dừng, ghi lại, báo người dùng (thiết kế C phải đổi: ví dụ không cấp `Bash(git *)` mà liệt kê từng lệnh con).

- [ ] **Step 4: Ghi `docs/SPIKE-RESULTS.md`** — thêm cuối file:

```markdown
## Spike lập trình S1–S3 (2026-10-21) — quyền công cụ, deny, commit trong worktree

Cách chạy: `npm run spike:setup` rồi `npm run spike -- --yes --variant a|b|c` (haiku, max-turns 10, budget $0.5). Repo đích: `D:\tnf-claude-workspace\spike-repo`, worktree `…\worktrees\<run-id>`, nhánh `tnf/<run-id>`. Bằng chứng: `data/spikes/<run-id>/summary.json` + `stream.jsonl`.

| Spike | Biến thể / run | Kết quả | Bằng chứng |
|---|---|---|---|
| S1 Edit + Bash(npm test*) dưới dontAsk | a / `spike-a-…` | ĐÚNG / SAI | tool uses …; permission_denials …; npm test exit … |
| S1b `--allowedTools` phiên chính là trần chung? | b / `spike-b-…` | … | Edit của implementer bị/không bị từ chối: … |
| S2 deny `git push` qua `--disallowedTools` | a | … | push probe: …; bare remote branches: … |
| S2b deny qua `--settings` | c (nếu chạy) | … | … |
| S3 `git commit` trong worktree với GIT_* env | a | … | git log: …; author … |
| Chi phí | | a $…, b $…, c $… ; tổng $… | |

Kết luận cho thiết kế B/C: …
```
Thay mọi `…` bằng số liệu thật từ `summary.json` (không để chỗ trống).

- [ ] **Step 5: Ghi `docs/PROGRESS.md`** — thêm dưới mục `## 2026-10-21`, trước "Trạng thái bàn giao":

```markdown
### Spike lập trình S1–S3 (chiều 2026-10-21)
- Quyết định người dùng: worktree ngoài repo đích, repo spike riêng, agent được commit trên nhánh worktree, UI hiện diff + test (ghi ở CONTEXT-CODING mục 7).
- Mã: `ClaudeRunner` nhận `disallowedTools`/`settingsFile`; `scripts/spike-setup.ts`, `scripts/spike-coding.ts`, `config/spike/*`. 62 test xanh.
- Kết quả: (tóm tắt 3–5 dòng từ bảng SPIKE-RESULTS, kèm run-id và chi phí).
- Việc kế tiếp: (những gì kết quả spike kéo theo cho thiết kế B/C, rồi S4, S5).
```

- [ ] **Step 6: Commit**

```bash
git add docs/SPIKE-RESULTS.md docs/PROGRESS.md
git -c user.name=dev -c user.email=agent@example.com commit -m "docs: coding spike S1-S3 results (tool permissions, deny, worktree commit)" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

## Self-review

- **Spec coverage:** S1 (Task 4 biến thể a + Task 5 bước 1), S1b trần chung (biến thể b), S2 (a, c), S3 (a; identity qua `GIT_ENV` vì máy không có `user.name` toàn cục — xác nhận bằng `git config --list` ở phiên này). Quyết định người dùng (worktree ngoài, repo riêng, commit được, không push) đều có trong Global Constraints và biến thể a. S4, S5 cố ý để sau.
- **Placeholder:** bảng ở Task 5 có `…` là ô số liệu phải điền sau khi chạy, không phải mã; đã ghi rõ "thay mọi `…`".
- **Type consistency:** `disallowedTools`, `settingsFile` (Task 1) dùng đúng tên ở Task 4; `ensureSpikeRepo`, `git`, `GIT_ENV`, `SPIKE_REPO`, `SPIKE_REMOTE`, `WORKTREES_DIR` (Task 2) dùng đúng ở Task 4; `RunnerOptions.env` là `NodeJS.ProcessEnv` nên gộp `GIT_ENV` hợp lệ.
- **Rủi ro đã biết:** (1) khối "chạy trực tiếp" cuối `spike-setup.ts` có thể không khớp đường dẫn Windows → fallback ghi ở Task 2 Step 1. (2) `tsconfig.json` có thể không gồm `scripts/` → Task 4 Step 2 nêu cách kiểm. (3) `Bash(git *)` cấp rộng chỉ để thử deny; **không** đem vào cấu hình thật.
