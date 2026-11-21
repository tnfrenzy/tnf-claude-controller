import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { parseClaudeVersion, readClaudeVersion, readControllerVersion } from "../../src/core/app/version.js";
import { canRead } from "../helpers/junction.js";
import { parseAgentFileText, readAgentFile } from "../../src/core/run/extras.js";
import { DatabaseSync } from "node:sqlite";
import { RunStore } from "../../src/core/run/run-store.js";
import { formatBytes, parseOlderThan, runCleanupCommand } from "../../src/cli-cleanup.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

describe("version helpers", () => {
  let dir: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-version-"));
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("reads version from package.json", () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: "9.8.7" }));
    expect(readControllerVersion(dir)).toBe("9.8.7");
  });

  it("throws when package.json is missing", () => {
    expect(() => readControllerVersion(dir)).toThrow();
  });

  it("throws on broken JSON", () => {
    fs.writeFileSync(path.join(dir, "package.json"), "{not json");
    expect(() => readControllerVersion(dir)).toThrow();
  });

  it("throws when version is missing or not a string", () => {
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "x" }));
    expect(() => readControllerVersion(dir)).toThrow();
    fs.writeFileSync(path.join(dir, "package.json"), JSON.stringify({ version: 5 }));
    expect(() => readControllerVersion(dir)).toThrow();
  });

  it("matches the real package.json", () => {
    const expected = (JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8")) as { version: string }).version;
    expect(readControllerVersion(ROOT)).toBe(expected);
  });

  it("parses claude --version output", () => {
    expect(parseClaudeVersion("2.1.301 (Claude Code)")).toBe("2.1.301");
    expect(parseClaudeVersion("2.1.301\n")).toBe("2.1.301");
    expect(parseClaudeVersion("garbage")).toBeNull();
  });

  it("returns null for a nonexistent claude path", () => {
    expect(readClaudeVersion(path.join(dir, "no-such-claude.exe"), {})).toBeNull();
  });
});

describe("agent file parsing", () => {
  it("parses a JSON object and rejects bad JSON / non-objects / missing file in Vietnamese", () => {
    expect(parseAgentFileText('{"a":{"description":"d","prompt":"p"}}')).toHaveProperty("a");
    expect(() => parseAgentFileText("{not json")).toThrow(/JSON/);
    expect(() => parseAgentFileText("[1]")).toThrow(/đối tượng/);
    expect(() => readAgentFile(path.join(os.tmpdir(), "tnf-no-such-agent-file.json"))).toThrow(/Không đọc được/);
  });
});

describe.skipIf(process.platform !== "win32")("tnf open --print (isolated config and browser lookup)", () => {
  let dir: string;
  let emptyDir: string;
  let cfgFile: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-open-"));
    emptyDir = path.join(dir, "empty");
    fs.mkdirSync(emptyDir);
    fs.mkdirSync(path.join(dir, "config"));
    fs.mkdirSync(path.join(dir, "data"));
    cfgFile = path.join(dir, "config", "controller.json");
    fs.writeFileSync(cfgFile, JSON.stringify({ workspaceDir: "./ws", dataDir: "./data" }), "utf8");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const runOpen = (pathDir: string) => {
    const env: NodeJS.ProcessEnv = {};
    for (const [k, v] of Object.entries(process.env)) {
      if (!/^(path|programfiles|programfiles\(x86\)|programw6432|localappdata)$/i.test(k)) env[k] = v;
    }
    env["PATH"] = pathDir;
    env["TNF_CONFIG"] = cfgFile;
    env["ProgramFiles"] = emptyDir;
    env["ProgramFiles(x86)"] = emptyDir;
    env["LOCALAPPDATA"] = emptyDir;
    return spawnSync(process.execPath, [tsx, path.join(ROOT, "src", "cli.ts"), "open", "--print"], { cwd: ROOT, encoding: "utf8", timeout: 60_000, env });
  };

  it("without a token file exits non-zero with a Vietnamese message", () => {
    const r = runOpen(emptyDir);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Chưa có token/i);
  }, 90_000);

  it("falls back to the default browser message and never prints the token", () => {
    fs.writeFileSync(path.join(dir, "data", "controller.token"), "SECRETTOKEN123", "utf8");
    const r = runOpen(emptyDir);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Không tìm thấy Edge\/Chrome/);
    expect(r.stdout).not.toContain("SECRETTOKEN123");
  }, 90_000);

  it("picks edge when msedge.exe is in PATH", () => {
    fs.writeFileSync(path.join(dir, "data", "controller.token"), "SECRETTOKEN123", "utf8");
    const bin = path.join(dir, "bin");
    fs.mkdirSync(bin);
    fs.writeFileSync(path.join(bin, "msedge.exe"), "");
    const r = runOpen(bin);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/Edge/);
    expect(r.stdout).not.toContain("SECRETTOKEN123");
  }, 90_000);
});

describe("tnf run --skill / --agent-file (fake CLI, isolated config)", () => {
  let dir: string;
  let cfgFile: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cli-"));
    fs.mkdirSync(path.join(dir, "config"));
    // the CLI looks for fixtures/fake-claude.mjs next to the config root
    fs.symlinkSync(path.join(ROOT, "fixtures"), path.join(dir, "fixtures"), "junction");
    cfgFile = path.join(dir, "config", "controller.json");
    fs.writeFileSync(cfgFile, JSON.stringify({
      workspaceDir: "./ws",
      dataDir: "./data",
      defaults: {
        research: {
          agentsFile: path.join(ROOT, "config", "roles-research.json"),
          systemPromptFile: path.join(ROOT, "config", "coordinator-research.md"),
          allowedTools: ["Agent", "WebSearch", "WebFetch", "Read", "Write"],
          maxRoleCalls: 4,
        },
      },
    }), "utf8");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const runCli = (args: string[]) =>
    spawnSync(process.execPath, [tsx, path.join(ROOT, "src", "cli.ts"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      env: { ...process.env, TNF_CONFIG: cfgFile, TNF_FAKE_CLAUDE: "1" },
    });

  // skipped in sandboxes that cannot read through junctions (fixtures junction, UNKNOWN -4094)
  it.skipIf(!canRead)("repeated --skill creates a research run and exits 0", () => {
    const r = runCli(["run", "demo", "--skill", "foo", "--skill", "bar"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/run \S+ · research/);
  }, 90_000);

  it.skipIf(!canRead)("valid --agent-file is accepted", () => {
    const f = path.join(dir, "agents.json");
    fs.writeFileSync(f, JSON.stringify({ "wording-reviewer": { description: "Reviews wording", prompt: "You review wording." } }), "utf8");
    const r = runCli(["run", "demo", "--agent-file", f]);
    expect(r.status).toBe(0);
    expect(r.stdout).toMatch(/run \S+ · research/);
  }, 90_000);

  it("--lib with an unknown item id fails with a Vietnamese error before any run starts", () => {
    const r = runCli(["run", "demo", "--lib", "ghost"]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/Không tìm thấy mục thư viện "ghost"/);
  }, 90_000);

  it("malformed --agent-file prints a Vietnamese error and exits non-zero", () => {
    const f = path.join(dir, "bad.json");
    fs.writeFileSync(f, "{not json", "utf8");
    const r = runCli(["run", "demo", "--agent-file", f]);
    expect(r.status).not.toBe(0);
    expect(r.stderr).toMatch(/JSON hợp lệ/);
    const missing = runCli(["run", "demo", "--agent-file", path.join(dir, "missing.json")]);
    expect(missing.status).not.toBe(0);
    expect(missing.stderr).toMatch(/Không đọc được/);
  }, 90_000);
});

describe("tnf cleanup CLI", () => {
  let dir: string;
  let cfgFile: string;
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cleanup-cli-"));
    fs.mkdirSync(path.join(dir, "config"));
    cfgFile = path.join(dir, "config", "controller.json");
    fs.writeFileSync(cfgFile, JSON.stringify({ workspaceDir: "./ws", dataDir: "./data" }), "utf8");
  });
  afterEach(() => {
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const tsx = path.join(ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const runCli = (args: string[], input?: string) =>
    spawnSync(process.execPath, [tsx, path.join(ROOT, "src", "cli.ts"), ...args], {
      cwd: ROOT,
      encoding: "utf8",
      timeout: 60_000,
      input,
      env: { ...process.env, TNF_CONFIG: cfgFile, TNF_FAKE_CLAUDE: "1" },
    });

  it("empty DB: --dry-run exits 0 and reports 0 runs", () => {
    const r = runCli(["cleanup", "--dry-run"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("Sẽ dọn: 0 run");
  }, 90_000);

  it("--older-than 0 exits 2 with a message naming the option", () => {
    const r = runCli(["cleanup", "--older-than", "0"]);
    expect(r.status).toBe(2);
    expect(r.stderr).toContain("--older-than");
  }, 90_000);

  it("--older-than abc exits 2", () => {
    const r = runCli(["cleanup", "--older-than", "abc", "--dry-run"]);
    expect(r.status).toBe(2);
  }, 90_000);

  it("skips a run whose worktree directory is gone (missing)", () => {
    const dbFile = path.join(dir, "data", "controller.db");
    fs.mkdirSync(path.join(dir, "data"), { recursive: true });
    const repo = path.join(dir, "repo");
    fs.mkdirSync(repo);
    const id = "run-old-1";
    const store = new RunStore(dbFile);
    store.upsertProject({ name: "p", repo_path: repo, base_branch: "main", allowed_commands: [] });
    store.createRun({ id, status: "done", prompt: "x", mode: "coding", model: "m", session_id: null, parent_run_id: null, project: "p", claude_version: null, run_dir: path.join(dir, "runs", id) });
    store.updateRun(id, { status: "done", worktree_path: path.join(dir, "ws", "worktrees", "p", id), branch: `tnf/${id}` } as never);
    store.close();
    const db = new DatabaseSync(dbFile);
    db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(Date.now() - 30 * 86_400_000, id);
    db.close();
    const r = runCli(["cleanup", "--dry-run", "--older-than", "1"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain(id);
    expect(r.stdout).toContain("không còn");
    expect(r.stdout).not.toContain("chưa đủ");
  }, 90_000);

  it("help mentions tnf cleanup", () => {
    const r = runCli(["help"]);
    expect(r.status).toBe(0);
    expect(r.stdout).toContain("tnf cleanup");
  }, 90_000);
});

describe("tnf cleanup module", () => {
  const DAY = 86_400_000;
  let dir: string;
  let dbFile: string;
  let store: RunStore;
  let config: { workspaceDir: string; worktreesDir: string };
  let removeCalls: unknown[];
  let outLines: string[];
  let errLines: string[];
  beforeEach(() => {
    dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cleanup-"));
    dbFile = path.join(dir, "data", "controller.db");
    store = new RunStore(dbFile);
    config = { workspaceDir: path.join(dir, "ws"), worktreesDir: path.join(dir, "worktrees") };
    fs.mkdirSync(config.workspaceDir, { recursive: true });
    removeCalls = [];
    outLines = [];
    errLines = [];
  });
  afterEach(() => {
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });

  const baseCtx = (extra: Record<string, unknown> = {}) => ({
    config,
    store,
    now: Date.now(),
    out: (l: string) => outLines.push(l),
    err: (l: string) => errLines.push(l),
    planDeps: {
      exists: () => true,
      worktreeStatus: () => ({ ok: true, dirty: false }),
      isBranchMerged: () => true,
      measureBytes: () => 5 * 1024 * 1024,
    },
    executeDeps: {
      worktreeStatus: () => ({ ok: true, dirty: false }),
      unlinkNodeModules: () => {},
      removeWorktree: ((o: unknown) => {
        removeCalls.push(o);
      }) as never,
    },
    ...extra,
  });

  function seedRuns(): { oldId: string; newId: string } {
    store.upsertProject({ name: "p", repo_path: path.join(dir, "repo"), base_branch: "main", allowed_commands: [] });
    const mk = (id: string) => {
      store.createRun({ id, status: "done", prompt: "x", mode: "coding", model: "m", session_id: null, parent_run_id: null, project: "p", claude_version: null, run_dir: path.join(dir, "runs", id) });
      store.updateRun(id, { status: "done", worktree_path: path.join(config.worktreesDir, "p", id), branch: `tnf/${id}` } as never);
    };
    mk("old1");
    mk("new1");
    store.close();
    const db = new DatabaseSync(dbFile);
    db.prepare("UPDATE runs SET updated_at = ? WHERE id = ?").run(Date.now() - 30 * DAY, "old1");
    db.close();
    store = new RunStore(dbFile);
    return { oldId: "old1", newId: "new1" };
  }

  it("(a) parseOlderThan", () => {
    expect(parseOlderThan("7")).toBe(7);
    expect(parseOlderThan(undefined)).toBe(14);
    for (const bad of ["0", "-1", "abc", "1.5"]) expect(parseOlderThan(bad)).toBeNull();
  });

  it("(b) formatBytes", () => {
    expect(formatBytes(0)).toBe("0.0 B");
    expect(formatBytes(1536)).toBe("1.5 KB");
    expect(formatBytes(5 * 1024 * 1024)).toBe("5.0 MB");
  });

  it("(c) --dry-run lists candidates and skips without confirm or removal", async () => {
    seedRuns();
    let asked = 0;
    const code = await runCleanupCommand(["--dry-run", "--older-than", "14"], baseCtx({ confirm: async () => { asked++; return true; } }));
    const text = outLines.join("\n");
    expect(code).toBe(0);
    expect(text).toContain("Sẽ dọn: 1 run");
    expect(text).toContain("5.0 MB");
    expect(text).toMatch(/new1\s+chưa đủ 14 ngày/);
    expect(asked).toBe(0);
    expect(removeCalls.length).toBe(0);
  });

  it("(d) declined confirmation removes nothing", async () => {
    seedRuns();
    const code = await runCleanupCommand([], baseCtx({ confirm: async () => false }));
    expect(code).toBe(0);
    expect(outLines.join("\n")).toContain("Đã hủy");
    expect(removeCalls.length).toBe(0);
  });

  it("(e) accepted confirmation removes the worktree once", async () => {
    seedRuns();
    const code = await runCleanupCommand([], baseCtx({ confirm: async () => true }));
    expect(code).toBe(0);
    expect(removeCalls.length).toBe(1);
  });

  it("(f) old inbox-staging with zero candidates still asks, and survives a decline", async () => {
    const inbox = path.join(config.workspaceDir, "inbox-staging", "abandoned");
    fs.mkdirSync(inbox, { recursive: true });
    const old = new Date(Date.now() - 30 * DAY);
    fs.utimesSync(inbox, old, old);
    let asked = 0;
    const code = await runCleanupCommand([], baseCtx({ confirm: async () => { asked++; return false; } }));
    expect(code).toBe(0);
    expect(asked).toBe(1);
    expect(fs.existsSync(inbox)).toBe(true);
    expect(outLines.join("\n")).toContain("Đã hủy");
  });

  it("(g) nothing to do skips the confirmation", async () => {
    let asked = 0;
    const code = await runCleanupCommand([], baseCtx({ confirm: async () => { asked++; return true; } }));
    expect(code).toBe(0);
    expect(asked).toBe(0);
    expect(outLines.join("\n")).toContain("Không có gì để dọn");
  });

  it("(h) invalid --older-than exits 2", async () => {
    const code = await runCleanupCommand(["--older-than", "abc"], baseCtx());
    expect(code).toBe(2);
    expect(errLines.join("\n")).toContain("--older-than");
  });
});
