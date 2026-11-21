import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { CliAccountStore } from "../../src/core/run/cli-accounts.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { parseAgyModelsOutput, sanitizeAgyEnv } from "../../src/core/run/providers/agy-guard.js";
import { buildAgySettings, claudeBashRuleToAgy } from "../../src/core/run/providers/agy-permissions.js";
import { AgyStreamParser } from "../../src/core/run/providers/agy-stream-parser.js";
import { autoDistributeRoleModels, DEFAULT_AGY_MODELS, resolveModelForProvider } from "../../src/core/run/providers/model-distribution.js";
import { startServer } from "../../src/server/index.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FAKE_CLAUDE = path.join(REPO_ROOT, "fixtures", "fake-claude.mjs");
const FAKE_AGY = path.join(REPO_ROOT, "fixtures", "fake-agy.mjs");

const tmpDirs: string[] = [];
function makeTmp(prefix: string): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  tmpDirs.push(dir);
  return dir;
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("CliAccountStore & model distribution", () => {
  it("manages isolated Claude accounts, Antigravity accounts, and cooldown failover", () => {
    const dataDir = makeTmp("tnf-acc-");
    const store = new CliAccountStore(dataDir);

    const initial = store.list();
    expect(initial).toHaveLength(1);
    expect(initial[0]!.id).toBe("claude-default");
    expect(initial[0]!.configDir).toBeNull();

    const claude2 = store.add({ label: "Claude Phu", provider: "claude", isolated: true });
    expect(claude2.configDir).toBe(path.join(dataDir, "cli-profiles", claude2.id));
    expect(fs.existsSync(claude2.configDir!)).toBe(true);

    const env2 = store.envForAccount(claude2, { PATH: "x" });
    expect(env2["CLAUDE_CONFIG_DIR"]).toBe(claude2.configDir);

    const agy = store.add({ label: "Antigravity Main", provider: "antigravity" });
    expect(agy.configDir).toBeNull();

    // Auto failover disabled by default -> returns default even if cooling down
    expect(store.resolveAccount({ isCoolingDown: (id) => id === "claude-default" }).id).toBe("claude-default");

    // Enable same-provider failover -> picks claude2 when claude-default is cooling down
    store.updateSettings({ autoFailover: true, crossProviderFailover: false });
    expect(store.resolveAccount({ isCoolingDown: (id) => id === "claude-default" }).id).toBe(claude2.id);

    // If both Claude accounts cool down and crossProviderFailover is off -> stays on requested/default
    expect(store.resolveAccount({ isCoolingDown: (id) => id !== agy.id }).id).toBe("claude-default");

    // Enable cross-provider failover -> falls over to agy
    store.updateSettings({ autoFailover: true, crossProviderFailover: true });
    expect(store.resolveAccount({ isCoolingDown: (id) => id !== agy.id }).id).toBe(agy.id);

    store.setDefault(agy.id);
    expect(store.getDefault().id).toBe(agy.id);
    expect(store.remove(claude2.id)).toBe(true);
  });

  it("auto-distributes models cleanly across Claude and Antigravity", () => {
    expect(resolveModelForProvider({ provider: "antigravity", requestedModel: "opus", available: DEFAULT_AGY_MODELS })).toBe("gemini-4-neon-high");
    expect(resolveModelForProvider({ provider: "antigravity", requestedModel: "haiku", available: DEFAULT_AGY_MODELS })).toBe("gemini-3.8-flash-low");
    expect(resolveModelForProvider({ provider: "antigravity", requestedModel: "sonnet", available: DEFAULT_AGY_MODELS })).toBe("gemini-4-argon-medium");
    expect(resolveModelForProvider({ provider: "claude", requestedModel: "gemini-4-neon-high", available: [] })).toBe("opus");
    expect(resolveModelForProvider({ provider: "claude", requestedModel: "gemini-3.8-flash-low", available: [] })).toBe("haiku");

    const roleMap = autoDistributeRoleModels("antigravity", ["analyst", "implementer", "cad-modeler"], DEFAULT_AGY_MODELS);
    expect(roleMap["analyst"]).toBe("gemini-3.8-flash-low");
    expect(roleMap["implementer"]).toBe("gemini-4-argon-medium");
    expect(roleMap["cad-modeler"]).toBe("gemini-4-neon-high");
  });
});

describe("Antigravity guard, permissions & stream parser", () => {
  it("strips API key and ADC env vars and enforces useG1Credits=false", () => {
    const clean = sanitizeAgyEnv({
      PATH: "ok",
      GEMINI_API_KEY: "secret",
      GOOGLE_API_KEY: "secret2",
      AGY_ADC_AUTH: "true",
      GOOGLE_GENAI_USE_VERTEXAI: "true",
      GOOGLE_CLOUD_PROJECT: "p1",
    });
    expect(clean["PATH"]).toBe("ok");
    expect(clean["GEMINI_API_KEY"]).toBeUndefined();
    expect(clean["GOOGLE_API_KEY"]).toBeUndefined();
    expect(clean["AGY_ADC_AUTH"]).toBeUndefined();
    expect(clean["GOOGLE_GENAI_USE_VERTEXAI"]).toBeUndefined();
    expect(clean["GOOGLE_CLOUD_PROJECT"]).toBeUndefined();

    const settings = buildAgySettings({
      cwd: "D:\\work\\wt",
      allowedTools: ["Read", "Edit", "Write", "Bash(git status*)", "Bash(npm test*)"],
      disallowedTools: ["Bash(git push*)"],
    });
    expect(settings.useG1Credits).toBe(false);
    expect(settings.modelProvider).toBe("");
    expect(settings.permissions.allow).toContain("command(regex:^git status.*$)");
    expect(settings.permissions.deny.some((r) => r.includes("push"))).toBe(true);
    expect(claudeBashRuleToAgy("Bash(*)")).toBeNull();

    const ro = buildAgySettings({ cwd: "D:\\work\\wt", readOnly: true, allowedTools: ["Read"] });
    expect(ro.permissions.allow).toContain("read_file(*)");
    expect(ro.permissions.deny).toContain("command(*)");
    expect(ro.permissions.deny).toContain("write_file(*)");

    const codingBypass = buildAgySettings({ cwd: "D:\\work\\wt", permissionMode: "bypassPermissions", allowedTools: ["Read", "Edit", "Write"] });
    expect(codingBypass.permissions.allow).toContain("command(*)");
    expect(codingBypass.permissions.allow).toContain("write_file(*)");
    expect(codingBypass.permissions.deny.some((r) => r.includes("push"))).toBe(true);
    expect(codingBypass.permissions.deny).toContain("write_file(.git/)");
  });

  it("parses agy models output", () => {
    const parsed = parseAgyModelsOutput("Fetching available models...\ngemini-4-neon-high\tGemini 4 Neon (High)\ngemini-3.8-flash-low\tGemini 3.8 Flash (Low)\n");
    expect(parsed).toHaveLength(2);
    expect(parsed[0]).toEqual({ id: "gemini-4-neon-high", label: "Gemini 4 Neon (High)", tier: "strong" });
    expect(parsed[1]).toEqual({ id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low)", tier: "light" });
  });

  it("parses agy stream-json including soft-deny, test output and verdict", () => {
    const p = new AgyStreamParser("r1", "1.5.13");
    const ev1 = p.feedLine(JSON.stringify({ event: "init", conversation_id: "c-1", init: { model: "gemini-3.8-flash-low", tools: ["run_command"] } }));
    expect(ev1[0]?.type).toBe("run.started");
    expect(p.sessionId).toBe("c-1");

    const evTool = p.feedLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 1,
          state: "DONE",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: { name: "run_command", parameters: { CommandLine: "npm test" }, output: "Tests 5 passed" },
        },
      }),
    );
    expect(evTool.some((e) => e.type === "tool.result" && e.ok)).toBe(true);
    expect(p.lastTestOutput?.command).toBe("npm test");

    const evRes = p.feedLine(
      JSON.stringify({
        event: "result",
        result: { conversation_id: "c-1", status: "SUCCESS", response: "VERDICT: PASS\nAll good.", duration_seconds: 1.5, num_turns: 1, usage: { input_tokens: 100, output_tokens: 20, thinking_tokens: 5, cache_read_tokens: 10 } },
      }),
    );
    expect(evRes.some((e) => e.type === "agent.verdict" && e.verdict === "PASS")).toBe(true);
    const fin = p.finalize();
    expect(fin.some((e) => e.type === "run.result" && e.ok && e.usage.output === 25)).toBe(true);

    // Soft-deny case
    const p2 = new AgyStreamParser("r2", "1.5.13");
    p2.feedLine(JSON.stringify({ event: "init", conversation_id: "c-2", init: { model: "gemini-3.8-flash-low" } }));
    const denied = p2.feedLine(
      JSON.stringify({
        event: "step_update",
        step_update: {
          step_index: 1,
          state: "ERROR",
          step_type: "tool",
          tool_name: "run_command",
          tool_info: { name: "run_command", parameters: { CommandLine: "git push" }, error: { message: "permission check failed" } },
        },
      }),
    );
    expect(denied.some((e) => e.type === "permission.denied")).toBe(true);
    p2.feedLine(JSON.stringify({ event: "result", result: { conversation_id: "c-2", status: "SUCCESS", response: "", duration_seconds: 0.2, num_turns: 1 } }));
    const fin2 = p2.finalize();
    expect(fin2.some((e) => e.type === "run.result" && !e.ok)).toBe(true);
    expect(fin2.some((e) => e.type === "run.error" && e.kind === "permission_denied")).toBe(true);
  });
});

describe("RunManager + Server integration with Antigravity CLI", () => {
  it("runs research, followup, coding worktree, and API account management with fake-agy", async () => {
    const tmp = makeTmp("tnf-agy-int-");
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
      env: { ...process.env, FAKE_CLAUDE_FIXTURE: "hello", FAKE_AGY_GIT_COMMIT: "1" },
      automationIntervalMs: 0,
    });

    try {
      const headers = { "X-Controller-Token": started.policy.token, "Content-Type": "application/json" };
      const base = `http://127.0.0.1:${started.policy.port}`;

      // 1. Add Antigravity CLI account via API
      const addRes = await fetch(`${base}/api/cli/accounts`, {
        method: "POST",
        headers,
        body: JSON.stringify({ id: "agy-main", label: "Antigravity Main", provider: "antigravity" }),
      });
      expect(addRes.status).toBe(201);

      // 2. Check Antigravity account status via API
      const chkRes = await fetch(`${base}/api/cli/accounts/agy-main/check`, { method: "POST", headers });
      expect(chkRes.status).toBe(200);
      const chkJson = (await chkRes.json()) as { status: { loggedIn: boolean; provider: string; models: unknown[] } };
      expect(chkJson.status.loggedIn).toBe(true);
      expect(chkJson.status.provider).toBe("antigravity");
      expect(chkJson.status.models.length).toBeGreaterThanOrEqual(3);

      // 3. Run a research task on Antigravity account with Claude alias "opus" -> auto-mapped to gemini-4-neon-high
      const runRes = await fetch(`${base}/api/runs`, {
        method: "POST",
        headers,
        body: JSON.stringify({ prompt: "Xin chào Antigravity", account_id: "agy-main", model: "opus", roles: false }),
      });
      expect(runRes.status).toBe(201);
      const { run } = (await runRes.json()) as { run: { id: string; provider: string; account_id: string; model: string } };
      expect(run.provider).toBe("antigravity");
      expect(run.account_id).toBe("agy-main");
      expect(run.model).toBe("gemini-4-neon-high");

      const done = await started.manager.waitFor(run.id);
      expect(done?.status).toBe("done");
      expect(done?.session_id).toBe("fake-agy-conv-001");
      expect(done?.result_text).toContain("Antigravity CLI");

      // 4. Follow-up inherits account_id & provider automatically
      const fu = await started.manager.followup(run.id, "Hỏi tiếp");
      expect(fu.provider).toBe("antigravity");
      expect(fu.account_id).toBe("agy-main");
      const fuDone = await started.manager.waitFor(fu.id);
      expect(fuDone?.status).toBe("done");

      // 5. Coding run in a real git repo using Antigravity CLI
      const repoDir = path.join(tmp, "sample-repo");
      fs.mkdirSync(repoDir, { recursive: true });
      spawnSync("git", ["init", "-b", "main"], { cwd: repoDir, windowsHide: true });
      fs.writeFileSync(path.join(repoDir, "README.md"), "# Demo\n", "utf8");
      spawnSync("git", ["add", "-A"], { cwd: repoDir, windowsHide: true });
      spawnSync("git", ["-c", "user.name=dev", "-c", "user.email=dev@example.com", "commit", "-m", "init"], { cwd: repoDir, windowsHide: true });

      started.manager.addProject({ name: "demo-agy", repo_path: repoDir, base_branch: "main" });
      const projAccRes = await fetch(`${base}/api/projects/demo-agy/account`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ account_id: "agy-main" }),
      });
      expect(projAccRes.status).toBe(200);

      const codeRun = await started.manager.startRun({ prompt: "Thêm file thử bằng agy", project: "demo-agy" });
      expect(codeRun.provider).toBe("antigravity");
      const codeDone = await started.manager.waitFor(codeRun.id);
      expect(codeDone?.status).toBe("done");
      expect(codeDone?.commits.length).toBeGreaterThanOrEqual(1);
      expect(fs.readFileSync(path.join(codeDone!.run_dir, "test-result.txt"), "utf8")).toContain("npm test");

      // 6. Role accounts API
      const raRes = await fetch(`${base}/api/cli/role-accounts`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ role_accounts: { critic: { accountId: "agy-main", model: "gemini-4-neon-high" } } }),
      });
      expect(raRes.status).toBe(200);
      expect(started.manager.resolveRoleAssignment("critic").accountId).toBe("agy-main");

      // 7. Persistent cooldown + clear cooldown API + Tuning accepts AGY & Codex models
      const futureMs = Date.now() + 30 * 60_000;
      started.manager.markAccountCooldown("claude-default", futureMs);
      expect(new CliAccountStore(cfg.dataDir).getCooldownUntil("claude-default")).toBeGreaterThan(Date.now());
      const listRes = await fetch(`${base}/api/cli/accounts`, { headers });
      const listJson = (await listRes.json()) as { cooldowns?: Record<string, number> };
      expect(listJson.cooldowns?.["claude-default"]).toBeGreaterThan(Date.now());
      const clearRes = await fetch(`${base}/api/cli/accounts/claude-default/cooldown`, { method: "DELETE", headers });
      expect(clearRes.status).toBe(200);
      expect(started.manager.isAccountCoolingDown("claude-default")).toBe(false);

      const tuneGet = await fetch(`${base}/api/settings/tuning`, { headers });
      expect(tuneGet.status).toBe(200);
      const tuneJson = (await tuneGet.json()) as { models: { id: string; provider?: string }[] };
      expect(tuneJson.models.some((m) => m.provider === "antigravity")).toBe(true);
      expect(tuneJson.models.some((m) => m.provider === "codex")).toBe(true);
      const tunePut = await fetch(`${base}/api/settings/tuning`, {
        method: "PUT",
        headers,
        body: JSON.stringify({ defaultModel: "gemini-4-neon-medium" }),
      });
      expect(tunePut.status).toBe(200);
    } finally {
      await started.close();
    }
  });
});
