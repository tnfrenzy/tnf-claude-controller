import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { CliAccountStore } from "../../src/core/run/cli-accounts.js";
import { runPhasedCoding } from "../../src/core/run/phase-orchestrator.js";
import { CODEX_FORBIDDEN_ENV_KEYS, sanitizeCodexEnv } from "../../src/core/run/providers/codex-guard.js";
import { buildCodexArgs } from "../../src/core/run/providers/codex-runner.js";
import { CodexStreamParser } from "../../src/core/run/providers/codex-stream-parser.js";
import { DEFAULT_CODEX_MODELS, resolveModelForProvider } from "../../src/core/run/providers/model-distribution.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { startServer } from "../../src/server/index.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FAKE_CLAUDE = path.join(REPO_ROOT, "fixtures", "fake-claude.mjs");
const FAKE_AGY = path.join(REPO_ROOT, "fixtures", "fake-agy.mjs");
const FAKE_CODEX = path.join(REPO_ROOT, "fixtures", "fake-codex.mjs");

const tmpDirs: string[] = [];
function makeTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

function initGitRepo(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
  spawnSync("git", ["init", "-b", "main"], { cwd: dir, windowsHide: true });
  fs.writeFileSync(path.join(dir, "README.md"), "# Test Repo\n", "utf8");
  spawnSync("git", ["add", "-A"], { cwd: dir, windowsHide: true });
  spawnSync("git", ["-c", "user.name=dev", "-c", "user.email=dev@example.com", "commit", "-m", "init"], {
    cwd: dir,
    windowsHide: true,
  });
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try {
      fs.rmSync(d, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  }
});

describe("OpenAI Codex CLI: guard, args & stream parser (offline)", () => {
  it("strips all OpenAI/Azure API keys and keeps CODEX_HOME", () => {
    const input: NodeJS.ProcessEnv = {
      PATH: "/usr/bin",
      CODEX_HOME: "C:\\isolated-codex",
      OPENAI_API_KEY: "sk-live-secret",
      OPENAI_ORG_ID: "org-123",
      OPENAI_PROJECT_ID: "proj-123",
      OPENAI_BASE_URL: "https://evil.example/v1",
      AZURE_OPENAI_API_KEY: "az-secret",
    };
    const clean = sanitizeCodexEnv(input);
    for (const k of CODEX_FORBIDDEN_ENV_KEYS) {
      expect(clean[k]).toBeUndefined();
    }
    expect(clean["CODEX_HOME"]).toBe("C:\\isolated-codex");
    expect(clean["PATH"]).toBe("/usr/bin");
  });

  it("builds safe codex exec args for read-only, workspace-write, and resume (never bypasses sandbox)", () => {
    const baseOpts = {
      runId: "r-test",
      claudePath: "codex",
      cwd: "/tmp/repo",
      streamFile: "/tmp/stream.jsonl",
      prompt: "inspect code",
      model: "gpt-5.3-codex-mini",
      maxTurns: 10,
      maxBudgetUsd: 1,
      timeoutMs: 60_000,
      allowedTools: [],
      disallowedTools: [],
      extraArgs: [],
      env: {},
    };

    const ro = buildCodexArgs({ ...baseOpts, readOnlyMode: true });
    expect(ro).toContain("exec");
    expect(ro).toContain("--json");
    expect(ro).toContain("--sandbox");
    expect(ro).toContain("read-only");
    expect(ro).toContain("--model");
    expect(ro).toContain("gpt-5.3-codex-mini");
    expect(ro).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    const rw = buildCodexArgs({ ...baseOpts, model: "gpt-5.3-codex", readOnlyMode: false });
    expect(rw).toContain("--sandbox");
    expect(rw).toContain("workspace-write");
    expect(rw).not.toContain("--dangerously-bypass-approvals-and-sandbox");

    const resumed = buildCodexArgs({ ...baseOpts, model: "gpt-5.4", resumeSessionId: "thread-abc-123" });
    expect(resumed.slice(0, 4)).toEqual(["exec", "resume", "thread-abc-123", "--json"]);
    expect(resumed).not.toContain("--dangerously-bypass-approvals-and-sandbox");
  });

  it("parses codex exec --json NDJSON stream into NormalizedEvent, verdicts & test output", () => {
    const parser = new CodexStreamParser("r-42", "gpt-5.3-codex", "0.42.0-fake");
    const e1 = parser.feedLine(JSON.stringify({ type: "thread.started", thread_id: "thr-42" }));
    expect(parser.sessionId).toBe("thr-42");
    expect(e1.some((e) => e.type === "run.started" && e.session_id === "thr-42")).toBe(true);

    const e2Start = parser.feedLine(
      JSON.stringify({
        type: "item.started",
        item: { id: "cmd-1", type: "command_execution", command: "npm test" },
      }),
    );
    expect(e2Start.some((e) => e.type === "tool.use" && e.tool === "Bash")).toBe(true);

    const e2Done = parser.feedLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "cmd-1",
          type: "command_execution",
          command: "npm test",
          aggregated_output: "5 passed (5)",
          exit_code: 0,
          status: "completed",
        },
      }),
    );
    expect(e2Done.some((e) => e.type === "tool.result" && e.ok === true)).toBe(true);
    expect(parser.lastTestOutput?.command).toBe("npm test");
    expect(parser.lastTestOutput?.text).toContain("5 passed");

    const e3 = parser.feedLine(
      JSON.stringify({
        type: "item.completed",
        item: {
          id: "msg-1",
          type: "agent_message",
          text: "All checks green.\nVERDICT: APPROVED",
        },
      }),
    );
    expect(e3.some((e) => e.type === "text.message")).toBe(true);
    expect(e3.some((e) => e.type === "agent.verdict" && e.verdict === "APPROVED")).toBe(true);

    const e4 = parser.feedLine(
      JSON.stringify({
        type: "turn.completed",
        usage: { input_tokens: 300, cached_input_tokens: 100, output_tokens: 80 },
      }),
    );
    expect(e4.some((e) => e.type === "usage.update")).toBe(true);
    expect(parser.totalUsage.input).toBe(300);
    expect(parser.totalUsage.cache_read).toBe(100);
    expect(parser.totalUsage.output).toBe(80);

    const fin = parser.finalize();
    expect(fin.some((e) => e.type === "run.result" && e.ok === true)).toBe(true);
  });

  it("isolates Codex accounts via CODEX_HOME and maps models cross-provider", () => {
    const tmp = makeTmp("tnf-codex-store-");
    const store = new CliAccountStore(tmp);
    const acc = store.add({ id: "codex-work", label: "ChatGPT Plus Work", provider: "codex", isolated: true });
    expect(acc.provider).toBe("codex");
    expect(acc.configDir).toBeTruthy();
    expect(fs.existsSync(acc.configDir!)).toBe(true);

    const env = store.envForAccount(acc, { PATH: "/bin" });
    expect(env["CODEX_HOME"]).toBe(acc.configDir);

    expect(resolveModelForProvider({ provider: "codex", requestedModel: "opus", available: DEFAULT_CODEX_MODELS })).toBe("gpt-5.4");
    expect(resolveModelForProvider({ provider: "codex", requestedModel: "haiku", available: DEFAULT_CODEX_MODELS })).toBe("gpt-5.3-codex-mini");
    expect(resolveModelForProvider({ provider: "codex", requestedModel: "sonnet", available: DEFAULT_CODEX_MODELS })).toBe("gpt-5.3-codex");
    expect(resolveModelForProvider({ provider: "codex", requestedModel: "o3", available: DEFAULT_CODEX_MODELS })).toBe("o3");
  });
});

describe("OpenAI Codex CLI: end-to-end offline via fake-codex.mjs & 3-provider phased coding", () => {
  it("supports API account check, research run + resume, and coding worktree commit with fake-codex", async () => {
    const tmp = makeTmp("tnf-codex-e2e-");
    const repo = path.join(tmp, "repo");
    initGitRepo(repo);

    const cfg = loadConfig();
    cfg.dataDir = path.join(tmp, "data");
    cfg.workspaceDir = path.join(tmp, "ws");
    cfg.worktreesDir = path.join(tmp, "wt");

    const started = await startServer({
      config: cfg,
      port: 0,
      claudePath: process.execPath,
      claudeArgsPrefix: [FAKE_CLAUDE],
      agyPath: process.execPath,
      agyArgsPrefix: [FAKE_AGY],
      codexPath: process.execPath,
      codexArgsPrefix: [FAKE_CODEX],
      env: { ...process.env, FAKE_CLAUDE_FIXTURE: "hello", FAKE_CODEX_GIT_COMMIT: "1" },
      automationIntervalMs: 0,
    });

    try {
      const base = `http://127.0.0.1:${started.policy.port}`;
      const headers = { "X-Controller-Token": started.policy.token, "Content-Type": "application/json" };

      // 1. Add Codex CLI account via HTTP API
      const addRes = await fetch(`${base}/api/cli/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "codex-plus", label: "ChatGPT Plus", provider: "codex", isolated: true }),
      });
      expect(addRes.status).toBe(201);
      const added = (await addRes.json()) as { account: { id: string; provider: string; configDir: string | null } };
      expect(added.account.provider).toBe("codex");
      expect(added.account.configDir).toBeTruthy();

      // 2. Check auth status offline via fake-codex
      const checkRes = await fetch(`${base}/api/cli/accounts/codex-plus/check`, { method: "POST", headers });
      expect(checkRes.status).toBe(200);
      const checked = (await checkRes.json()) as { status: { loggedIn: boolean; version: string | null; provider: string } };
      expect(checked.status.loggedIn).toBe(true);
      expect(checked.status.provider).toBe("codex");
      expect(checked.status.version).toBe("0.42.0");

      // 3. Start a research run on Codex CLI + wait until done
      const runRes = await fetch(`${base}/api/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "Tóm tắt cấu trúc dự án", provider: "codex", model: "opus", kind: "research" }),
      });
      expect(runRes.status).toBe(201);
      const { run } = (await runRes.json()) as { run: { id: string; provider: string; model: string } };
      expect(run.provider).toBe("codex");
      expect(run.model).toBe("gpt-5.4");

      const finalRun = await started.manager.waitFor(run.id);
      expect(finalRun?.status).toBe("done");
      expect(finalRun?.provider).toBe("codex");
      expect(finalRun?.model).toBe("gpt-5.4");
      expect(finalRun?.session_id).toBeTruthy();

      // 4. Follow-up on the same Codex session (exercises `codex exec resume`)
      const fuRes = await fetch(`${base}/api/runs/${run.id}/followup`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "Bổ sung thêm chi tiết" }),
      });
      expect(fuRes.status).toBe(201);
      const { run: fuCreated } = (await fuRes.json()) as { run: { id: string; provider: string } };
      const fuRun = await started.manager.waitFor(fuCreated.id);
      expect(fuRun?.status).toBe("done");
      expect(fuRun?.provider).toBe("codex");
      expect(fuRun?.result_text).toContain("resumed:");

      // 5. Coding run on a git repo with Codex CLI (commits + test-result.txt)
      started.manager.addProject({ name: "codex-repo", repo_path: repo, base_branch: "main" });
      const codeRun = await started.manager.startRun({
        prompt: "Tạo file mẫu bằng Codex CLI",
        project: "codex-repo",
        kind: "coding",
        accountId: "codex-plus",
      });
      const doneCode = await started.manager.waitFor(codeRun.id);
      expect(doneCode?.status).toBe("done");
      expect(doneCode?.provider).toBe("codex");
      expect(doneCode?.commits.length).toBeGreaterThanOrEqual(1);
      expect(fs.existsSync(path.join(doneCode!.run_dir, "test-result.txt"))).toBe(true);
    } finally {
      await started.close();
    }
  });

  it("runs 3-provider phased coding mixing Claude + Antigravity + Codex in one git worktree", async () => {
    const tmp = makeTmp("tnf-3cli-phased-");
    const repo = path.join(tmp, "repo");
    initGitRepo(repo);

    const cfg = loadConfig();
    cfg.dataDir = path.join(tmp, "data");
    cfg.workspaceDir = path.join(tmp, "ws");
    cfg.worktreesDir = path.join(tmp, "wt");

    const store = new RunStore(path.join(cfg.dataDir, "controller.db"));
    const manager = new RunManager({
      config: cfg,
      store,
      claudePath: process.execPath,
      claudeArgsPrefix: [FAKE_CLAUDE],
      agyPath: process.execPath,
      agyArgsPrefix: [FAKE_AGY],
      codexPath: process.execPath,
      codexArgsPrefix: [FAKE_CODEX],
      env: { ...process.env, FAKE_CLAUDE_FIXTURE: "hello", FAKE_CODEX_GIT_COMMIT: "1" },
    });

    try {
      const agyAcc = manager.cliAccounts.add({ id: "agy-main", label: "Antigravity", provider: "antigravity" });
      const codexAcc = manager.cliAccounts.add({ id: "codex-main", label: "ChatGPT Codex", provider: "codex" });
      manager.addProject({ name: "tri-cli", repo_path: repo, base_branch: "main" });

      const result = await runPhasedCoding(manager, {
        prompt: "Phối hợp cả 3 CLI: Claude + Antigravity + Codex",
        project: "tri-cli",
        phases: ["analyst", "critic", "implementer", "qa"],
        phaseAccounts: {
          analyst: { accountId: "claude-default" },
          critic: { accountId: agyAcc.id },
          implementer: { accountId: codexAcc.id },
          qa: { accountId: codexAcc.id },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.phases.map((p) => `${p.phase}:${p.provider}`)).toEqual([
        "analyst:claude",
        "critic:antigravity",
        "implementer:codex",
        "qa:codex",
      ]);
      expect(result.phases[1]!.verdict).toBe("APPROVED");
      expect(result.phases[3]!.verdict).toBe("PASS");
    } finally {
      store.close();
    }
  });
});
