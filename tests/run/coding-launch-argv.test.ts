import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { runGit } from "../../src/core/git/git.js";
import { MCP_PRESETS } from "../../src/core/mcp/mcp-registry.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";

// Real RunManager coding launch with the fake CLI: asserts the argv that would reach `claude`.
const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const PROJECT = "argvproj";
const BASE_DENY = ["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"];

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
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-argv-"));
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
      allowedTools: ["Agent"],
      agentsFile: path.join(root, "roles.json"),
      systemPromptFile: path.join(root, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: BASE_DENY,
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  } as unknown as ControllerConfig;
}

describe("real coding launch argv (fake CLI)", () => {
  let cfg: ControllerConfig;
  let store: RunStore;
  let mgr: RunManager;
  let argsFile: string;

  beforeEach(() => {
    cfg = tmpConfig();
    store = new RunStore(":memory:");
    const repo = makeRepo(cfg.repoRoot);
    argsFile = path.join(cfg.repoRoot, "args.json");
    store.upsertProject({ name: PROJECT, repo_path: repo, base_branch: "main", allowed_commands: [] });
    mgr = new RunManager({ config: cfg, store, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX, FAKE_CLAUDE_ARGS_FILE: argsFile } });
  });
  afterEach(() => {
    store.close();
    fs.rmSync(cfg.repoRoot, { recursive: true, force: true });
  });

  /** Values after `flag` up to the next `--flag` (variadic flags). */
  const valuesOf = (a: string[], flag: string): string[] => {
    const i = a.indexOf(flag);
    if (i < 0) return [];
    const out: string[] = [];
    for (let k = i + 1; k < a.length && !a[k]!.startsWith("--"); k++) out.push(...a[k]!.split(","));
    return out;
  };
  const argsOf = (): string[] => JSON.parse(fs.readFileSync(argsFile, "utf8")) as string[];

  it("the shipped controller.json carries the three base deny rules this test relies on", () => {
    const real = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config", "controller.json"), "utf8"));
    for (const r of BASE_DENY) expect(real.defaults.coding.disallowedTools).toContain(r);
  });

  it("default environment: strict MCP, base deny rules, no --mcp-config", async () => {
    const rec = await mgr.startRun({ prompt: "làm", project: PROJECT });
    await mgr.waitFor(rec.id);
    const a = argsOf();
    expect(a).toContain("--strict-mcp-config");
    expect(a).not.toContain("--mcp-config");
    const dis = valuesOf(a, "--disallowedTools");
    for (const r of BASE_DENY) expect(dis).toContain(r);
    expect(fs.existsSync(path.join(cfg.dataDir, "runs", rec.id, "mcp.json"))).toBe(false);
  });

  it("grants {fileWrite:false} + Desktop Commander full: mcp-config file, allow/deny rules, secrets stay out of the run dir", async () => {
    fs.mkdirSync(cfg.dataDir, { recursive: true });
    const dc = { ...MCP_PRESETS.find((p) => p.id === "desktop-commander")!, enabled: true, env: { DC_SECRET: "TOPSECRET-123" } };
    fs.writeFileSync(path.join(cfg.dataDir, "mcp-servers.json"), JSON.stringify([dc], null, 2), "utf8");
    mgr.setGrants(PROJECT, { fileWrite: false, mcp: { "desktop-commander": "full" } });
    const rec = await mgr.startRun({ prompt: "làm", project: PROJECT });
    await mgr.waitFor(rec.id);
    const run = store.getRun(rec.id)!;
    const a = argsOf();
    const i = a.indexOf("--mcp-config");
    expect(i).toBeGreaterThan(-1);
    expect(a[i + 1]).toBe(path.join(cfg.dataDir, "runs", rec.id, "mcp.json"));
    expect(a[i + 2]).toMatch(/^--/); // variadic flag: must be followed by another flag
    expect(a).toContain("--strict-mcp-config");
    expect(valuesOf(a, "--allowedTools")).toContain("mcp__desktop-commander");
    const dis = valuesOf(a, "--disallowedTools");
    expect(dis).toEqual(expect.arrayContaining(["mcp__desktop-commander__start_process", "mcp__desktop-commander__set_config_value"]));
    const wt = run.worktree_path!.replace(/\\/g, "/");
    expect(dis).toEqual(expect.arrayContaining([`Edit(${wt}/**)`, `Write(${wt}/**)`, `NotebookEdit(${wt}/**)`]));
    for (const r of BASE_DENY) expect(dis).toContain(r);
    // plaintext connector secrets never land in the run dir, its artifacts, or the output folder
    expect(fs.existsSync(path.join(run.run_dir, "mcp.json"))).toBe(false);
    expect(store.getArtifacts(rec.id).map((x) => x.rel_path)).not.toContain("mcp.json");
  });
});
