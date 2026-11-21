import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { prepareAgyRoleAgents } from "../../src/core/run/providers/agy-agent-files.js";
import { runPhasedCoding } from "../../src/core/run/phase-orchestrator.js";
import { createW3DRunStep } from "../../src/core/workshop3d/step-adapter.js";
import { createManagerRunStep } from "../../src/core/skill-workshop/run-step.js";

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const FAKE_CLAUDE = path.join(REPO_ROOT, "fixtures", "fake-claude.mjs");
const FAKE_AGY = path.join(REPO_ROOT, "fixtures", "fake-agy.mjs");

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
  spawnSync("git", ["-c", "user.name=dev", "-c", "user.email=dev@example.com", "commit", "-m", "init"], { cwd: dir, windowsHide: true });
}

afterEach(() => {
  while (tmpDirs.length) {
    const d = tmpDirs.pop()!;
    try { fs.rmSync(d, { recursive: true, force: true }); } catch { /* ignore */ }
  }
});

describe("Level D: prepareAgyRoleAgents & phased coding (Claude + Antigravity mixed)", () => {
  it("materializes temporary .agents/agents/<role>/agent.md hidden via info/exclude and cleans up cleanly", () => {
    const repo = makeTmp("tnf-agy-agents-");
    initGitRepo(repo);

    const handle = prepareAgyRoleAgents(repo, {
      critic: { description: "Read-only critic", prompt: "Return VERDICT: APPROVED" },
    });
    expect(handle.rolesWritten).toEqual(["critic"]);
    expect(fs.existsSync(path.join(repo, ".agents", "agents", "critic", "agent.md"))).toBe(true);
    // Excluded via .git/info/exclude so git status stays completely clean and .gitignore is untouched
    const statusDuring = spawnSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8", windowsHide: true }).stdout.trim();
    expect(statusDuring).toBe("");
    expect(fs.existsSync(path.join(repo, ".gitignore"))).toBe(false);

    handle.cleanup();
    expect(fs.existsSync(path.join(repo, ".agents"))).toBe(false);
    const statusAfter = spawnSync("git", ["status", "--short"], { cwd: repo, encoding: "utf8", windowsHide: true }).stdout.trim();
    expect(statusAfter).toBe("");
  });

  it("runs phased coding mixing Claude (analyst) and Antigravity (critic, implementer, qa) in one worktree", async () => {
    const tmp = makeTmp("tnf-phased-");
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
      env: { ...process.env, FAKE_CLAUDE_FIXTURE: "hello", FAKE_AGY_GIT_COMMIT: "1" },
    });

    try {
      const agyAcc = manager.cliAccounts.add({ id: "agy-main", label: "Antigravity Main", provider: "antigravity" });
      manager.addProject({ name: "mixed-proj", repo_path: repo, base_branch: "main" });

      const result = await runPhasedCoding(manager, {
        prompt: "Thêm tính năng mẫu phối hợp Claude và Antigravity",
        project: "mixed-proj",
        phases: ["analyst", "critic", "implementer", "qa"],
        phaseAccounts: {
          analyst: { accountId: "claude-default" },
          critic: { accountId: agyAcc.id },
          implementer: { accountId: agyAcc.id },
          qa: { accountId: agyAcc.id },
        },
      });

      expect(result.ok).toBe(true);
      expect(result.phases).toHaveLength(4);
      expect(result.phases[0]!.phase).toBe("analyst");
      expect(result.phases[0]!.provider).toBe("claude");
      expect(result.phases[1]!.phase).toBe("critic");
      expect(result.phases[1]!.provider).toBe("antigravity");
      expect(result.phases[1]!.verdict).toBe("APPROVED");
      expect(result.phases[2]!.phase).toBe("implementer");
      expect(result.phases[2]!.provider).toBe("antigravity");
      expect(result.phases[3]!.phase).toBe("qa");
      expect(result.phases[3]!.provider).toBe("antigravity");
      expect(result.phases[3]!.verdict).toBe("PASS");

      // Worktree must not have leftover .agents directory
      expect(result.worktreePath).toBeTruthy();
      expect(fs.existsSync(path.join(result.worktreePath!, ".agents"))).toBe(false);
    } finally {
      store.close();
    }
  });
});

describe("Level B: per-role CLI routing in Workshop 3D & Skill Workshop", () => {
  it("routes individual roles to configured accounts via resolveRoleAssignment", async () => {
    const calls: Array<{ prompt: string; accountId?: string; model?: string }> = [];
    const fakeMgr = {
      startRun: async (input: { prompt: string; accountId?: string; model?: string }) => {
        calls.push({
          prompt: input.prompt,
          ...(input.accountId ? { accountId: input.accountId } : {}),
          ...(input.model ? { model: input.model } : {}),
        });
        return { id: `r-${calls.length}` };
      },
      waitFor: async () => ({ id: "r-1", status: "done", result_text: "ok", cost_usd_est: 0 }),
      cancel: () => true,
      resolveRoleAssignment: (role: string) =>
        role === "visual-reviewer" ? { accountId: "agy-main", model: "gemini-4-neon-high" } : {},
    };

    const { runStep: w3dStep } = createW3DRunStep(fakeMgr as never);
    const sessionDir = makeTmp("tnf-w3d-role-");
    await w3dStep("visual-reviewer", "Review render", sessionDir);
    expect(calls[0]?.accountId).toBe("agy-main");
    expect(calls[0]?.model).toBe("gemini-4-neon-high");

    const { runStep: skillStep } = createManagerRunStep({
      ...fakeMgr,
      resolveRoleAssignment: (role: string) => (role === "grade" ? { accountId: "agy-main" } : {}),
    } as never);
    await skillStep("grade", "Grade output");
    expect(calls[1]?.accountId).toBe("agy-main");
  });
});
