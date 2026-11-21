import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const PROJECT = "spike";
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];

function makeRepo(root: string): string {
  const r = path.join(root, "target-repo");
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

function tmpConfig(): ControllerConfig {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ro-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  return {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
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
        disallowedTools: ["Bash(git push*)"],
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
    queue: { maxParallel: 2, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [] },
  } as unknown as ControllerConfig;
}

describe("read-only single-agent run", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  let repo: string;
  let argsFile: string;

  beforeEach(() => {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
    repo = makeRepo(cfg.repoRoot);
    argsFile = path.join(cfg.repoRoot, "args.json");
    store.upsertProject({ name: PROJECT, repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX, FAKE_CLAUDE_ARGS_FILE: argsFile } });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  const tools = ["Read(" + "X/**)", "Grep(X/**)", "WebSearch"];
  const argsOf = (): string[] => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];
  const after = (a: string[], flag: string): string => a[a.indexOf(flag) + 1]!;

  it("runs as research/queue-split without worktree and with the read-only argv", async () => {
    const rec = await mgr.startRun({ prompt: "chia ý tưởng", project: PROJECT, readOnly: { systemPrompt: "SYS PROMPT", allowedTools: tools, addDirs: [repo] } });
    await mgr.waitFor(rec.id);
    const run = store.getRun(rec.id)!;
    expect(run.kind).toBe("research");
    expect(run.mode.endsWith("+queue-split")).toBe(true);
    expect(run.worktree_path).toBeNull();
    expect(fs.existsSync(cfg.worktreesDir)).toBe(false);
    const a = argsOf();
    expect(a).toContain("--allowedTools");
    const i = a.indexOf("--allowedTools");
    const list: string[] = [];
    for (let k = i + 1; k < a.length && !a[k]!.startsWith("--"); k++) list.push(a[k]!);
    expect(list.join(",").split(",")).toEqual(expect.arrayContaining(tools));
    expect(list.join(",")).not.toMatch(/Agent|Bash|Edit|Write\b/);
    const dis = a.indexOf("--disallowedTools");
    expect(dis).toBeGreaterThan(-1);
    const disText = a.slice(dis + 1, dis + 8).join(",");
    for (const t of ["Bash", "Edit", "Write", "NotebookEdit", "Agent"]) expect(disText).toContain(t);
    expect(after(a, "--settings")).toBe(cfg.defaults.coding.settingsFile);
    expect(after(a, "--setting-sources")).toBe("project");
    expect(after(a, "--add-dir")).toBe(repo);
    expect(a).not.toContain("--agents");
    expect(a).toContain("--max-budget-usd");
    expect(fs.readFileSync(after(a, "--append-system-prompt-file"), "utf8")).toBe("SYS PROMPT");
  });

  it("refuses a Bash tool and creates no run", async () => {
    await expect(mgr.startRun({ prompt: "x", project: PROJECT, readOnly: { systemPrompt: "s", allowedTools: ["Bash(ls)"], addDirs: [] } })).rejects.toThrow(/chỉ đọc/);
    expect(store.listRuns({ project: PROJECT, limit: 10 }).length).toBe(0);
  });

  it("control: a normal run on a repo project is still coding", async () => {
    const rec = await mgr.startRun({ prompt: "làm", project: PROJECT });
    await mgr.waitFor(rec.id);
    expect(store.getRun(rec.id)!.kind).toBe("coding");
  });
});
