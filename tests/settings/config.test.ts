import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CODING_MIN_ROLE_CALLS_EFFECTIVE, DEFAULT_KNOWN_ENV_FAILURES, loadConfig } from "../../src/core/app/config.js";

const dirs: string[] = [];
function writeConfig(json: unknown): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cfg-"));
  dirs.push(root);
  fs.mkdirSync(path.join(root, "config"));
  const file = path.join(root, "config", "controller.json");
  fs.writeFileSync(file, JSON.stringify(json), "utf8");
  return file;
}
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

describe("loadConfig – coding/research defaults", () => {
  it("fills coding defaults per CONTEXT-SPEC-v1 §4.2–4.3 when the section is missing", () => {
    const cfg = loadConfig(writeConfig({ defaults: {} }));
    const c = cfg.defaults.coding;
    expect(c.extraArgs).toEqual(["--setting-sources", "project"]);
    expect(c.allowedTools).toContain("Bash(node *)");
    expect(c.allowedTools).not.toContain("Bash(git *)");
    expect(c.disallowedTools).toEqual(["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"]);
    expect(c.settingsFile).toBe(path.join(cfg.repoRoot, "config", "deny-settings.json"));
    expect(c.agentsFile).toBe(path.join(cfg.repoRoot, "config", "roles-coding.json"));
    expect(c.maxRoleCalls).toBe(CODING_MIN_ROLE_CALLS_EFFECTIVE);
  });
  it("derives research defaults from the legacy flat fields and keeps the flat fields as aliases", () => {
    const cfg = loadConfig(writeConfig({ defaults: { allowedTools: ["Agent", "Read"], extraArgs: ["--x"], agentsFile: "./config/r.json" } }));
    expect(cfg.defaults.research.allowedTools).toEqual(["Agent", "Read"]);
    expect(cfg.defaults.research.extraArgs).toEqual(["--x"]);
    expect(cfg.defaults.research.agentsFile).toBe(path.join(cfg.repoRoot, "config", "r.json"));
    expect(cfg.defaults.allowedTools).toEqual(cfg.defaults.research.allowedTools);
    expect(cfg.defaults.agentsFile).toBe(cfg.defaults.research.agentsFile);
    expect(cfg.defaults.research.settingsFile).toBeUndefined();
  });
  it("reads explicit defaults.coding and worktreesDir", () => {
    const cfg = loadConfig(writeConfig({ worktreesDir: "../wt", defaults: { coding: { extraArgs: [], allowedTools: ["Agent"], maxRoleCalls: 3 } } }));
    expect(cfg.defaults.coding.extraArgs).toEqual([]);
    expect(cfg.defaults.coding.allowedTools).toEqual(["Agent"]);
    expect(cfg.defaults.coding.maxRoleCalls).toBe(CODING_MIN_ROLE_CALLS_EFFECTIVE);
    expect(cfg.worktreesDir).toBe(path.resolve(cfg.repoRoot, "..", "wt"));
  });
  it("defaults worktreesDir to <workspaceDir>/worktrees", () => {
    const cfg = loadConfig(writeConfig({ workspaceDir: "../ws", defaults: {} }));
    expect(cfg.worktreesDir).toBe(path.join(cfg.workspaceDir, "worktrees"));
  });
  it("loads the real config/controller.json", () => {
    const cfg = loadConfig();
    expect(cfg.defaults.coding.extraArgs).toEqual(["--setting-sources", "project"]);
    expect(fs.existsSync(cfg.defaults.coding.settingsFile!)).toBe(true);
    expect(fs.existsSync(cfg.defaults.coding.agentsFile)).toBe(true);
    expect(fs.existsSync(cfg.defaults.coding.systemPromptFile)).toBe(true);
    expect(fs.existsSync(cfg.defaults.research.agentsFile)).toBe(true);
  });
});

describe("loadConfig – coding contextScan", () => {
  it("is on by default for coding (CLAUDE.md first), absent for research", () => {
    const cfg = loadConfig(writeConfig({ defaults: {} }));
    expect(cfg.defaults.coding.contextScan).toEqual({ enabled: true, maxBytes: 16384, files: ["CLAUDE.md", "docs/HANDOVER.md", "README.md"] });
    expect(cfg.defaults.research.contextScan).toBeUndefined();
    expect(loadConfig().defaults.coding.contextScan?.enabled).toBe(true);
  });
  it("can be switched off and tuned", () => {
    const cfg = loadConfig(writeConfig({ defaults: { coding: { contextScan: { enabled: false, maxBytes: 100, files: ["NOTES.md"] } } } }));
    expect(cfg.defaults.coding.contextScan).toEqual({ enabled: false, maxBytes: 100, files: ["NOTES.md"] });
    const partial = loadConfig(writeConfig({ defaults: { coding: { contextScan: { enabled: false } } } }));
    expect(partial.defaults.coding.contextScan?.maxBytes).toBe(16384);
  });
  it("rejects bad maxBytes/enabled/files with a Vietnamese error", () => {
    for (const bad of [{ maxBytes: 0 }, { maxBytes: 1.5 }, { maxBytes: "9" }, { maxBytes: 10_000_000 }, { enabled: "yes" }, { files: "README.md" }, { files: [1] }]) {
      expect(() => loadConfig(writeConfig({ defaults: { coding: { contextScan: bad } } }))).toThrow(/contextScan/);
    }
  });
});

describe("loadConfig – research role files (Phase 5.2 split)", () => {
  it("points research defaults at roles-research.json / coordinator-research.md with maxRoleCalls 10", () => {
    const cfg = loadConfig();
    expect(cfg.defaults.research.agentsFile).toBe(path.join(cfg.repoRoot, "config", "roles-research.json"));
    expect(cfg.defaults.research.systemPromptFile).toBe(path.join(cfg.repoRoot, "config", "coordinator-research.md"));
    expect(cfg.defaults.research.maxRoleCalls).toBe(10);
    expect(fs.readFileSync(cfg.defaults.research.systemPromptFile, "utf8")).toContain("{{maxRoleCalls}}");
    expect(fs.readFileSync(cfg.defaults.coding.systemPromptFile, "utf8")).toContain("{{maxRoleCalls}}");
    expect(fs.readFileSync(cfg.defaults.coding.systemPromptFile, "utf8")).toContain("{{contextBlock}}");
  });
  it("coding roles file has only description/prompt/tools/model keys and prompts under 3 KB", () => {
    const cfg = loadConfig();
    const roles = JSON.parse(fs.readFileSync(cfg.defaults.coding.agentsFile, "utf8")) as Record<string, Record<string, unknown>>;
    expect(Object.keys(roles)).toEqual(["analyst", "planner", "critic", "implementer", "qa", "debug"]);
    for (const [name, r] of Object.entries(roles)) {
      expect(Object.keys(r).sort()).toEqual(["description", "model", "prompt", "tools"]);
      expect(Buffer.byteLength(String(r["prompt"]))).toBeLessThan(3072);
      if (name === "implementer" || name === "debug") expect(r["model"]).toBe("sonnet");
      if (name === "critic" || name === "qa") expect(String(r["prompt"])).toContain("VERDICT:");
      if ((r["tools"] as string[]).includes("Bash")) expect(String(r["prompt"])).toContain("ONE simple command per Bash call");
    }
  });
});

describe("loadConfig – server.allowedOrigins (5.5 phone tunnel)", () => {
  it("defaults to [] and keeps only well-formed origins, lower-cased, without trailing slash", () => {
    expect(loadConfig(writeConfig({})).server.allowedOrigins).toEqual([]);
    const cfg = loadConfig(writeConfig({ server: { allowedOrigins: ["HTTPS://PC.tail1234.ts.net/", "https://pc.tail1234.ts.net", "http://a.example:8080", "pc.ts.net", "https://x/y", "ftp://z", 5] } }));
    expect(cfg.server.allowedOrigins).toEqual(["https://pc.tail1234.ts.net", "http://a.example:8080"]);
    expect(cfg.server.host).toBe("127.0.0.1");
  });
});

describe("config paths – %ENV% expansion (5.6 installed layout)", () => {
  it("expands %LOCALAPPDATA% style references and leaves unknown names alone", async () => {
    const { expandEnv } = await import("../../src/core/app/config.js");
    expect(expandEnv("%LOCALAPPDATA%\\TNF\\Controller\\data", { LOCALAPPDATA: "C:\\Users\\x\\AppData\\Local" })).toBe("C:\\Users\\x\\AppData\\Local\\TNF\\Controller\\data");
    expect(expandEnv("%NOPE%\\a", {})).toBe("%NOPE%\\a");
    expect(expandEnv("../plain", {})).toBe("../plain");
  });
});

describe("loadConfig – coding nodeModules", () => {
  it("defaults to copy with a 600 MB cap (also for the shipped controller.json), absent for research", () => {
    const cfg = loadConfig(writeConfig({ defaults: {} }));
    expect(cfg.defaults.coding.nodeModules).toEqual({ mode: "copy", maxBytes: 600 * 1024 * 1024 });
    expect(cfg.defaults.research.nodeModules).toBeUndefined();
    expect(loadConfig().defaults.coding.nodeModules).toEqual({ mode: "copy", maxBytes: 600 * 1024 * 1024 });
  });
  it("can be tuned; missing keys keep the defaults", () => {
    const cfg = loadConfig(writeConfig({ defaults: { coding: { nodeModules: { mode: "junction", maxMb: 50 } } } }));
    expect(cfg.defaults.coding.nodeModules).toEqual({ mode: "junction", maxBytes: 50 * 1024 * 1024 });
    const partial = loadConfig(writeConfig({ defaults: { coding: { nodeModules: { maxMb: 10 } } } }));
    expect(partial.defaults.coding.nodeModules).toEqual({ mode: "copy", maxBytes: 10 * 1024 * 1024 });
    expect(loadConfig(writeConfig({ defaults: { coding: { nodeModules: { mode: "none" } } } })).defaults.coding.nodeModules?.mode).toBe("none");
  });
  it("rejects a bad mode or maxMb with a Vietnamese error", () => {
    for (const bad of [{ mode: "symlink" }, { mode: 1 }, { maxMb: 0 }, { maxMb: 1.5 }, { maxMb: "9" }, { maxMb: 100_000 }]) {
      expect(() => loadConfig(writeConfig({ defaults: { coding: { nodeModules: bad } } }))).toThrow(/nodeModules/);
    }
    expect(() => loadConfig(writeConfig({ defaults: { coding: { nodeModules: "copy" } } }))).toThrow(/nodeModules/);
  });
});

describe("loadConfig – coding maxRoleCalls floor", () => {
  it("raises an old installed value (the former default of 8) to the minimum the slice chain needs", () => {
    const cfg = loadConfig(writeConfig({ defaults: { coding: { maxRoleCalls: 8 } } }));
    expect(cfg.defaults.coding.maxRoleCalls).toBe(CODING_MIN_ROLE_CALLS_EFFECTIVE);
  });
  it("raises a file value of 14 to 20 and keeps 25", () => {
    expect(loadConfig(writeConfig({ defaults: { coding: { maxRoleCalls: 14 } } })).defaults.coding.maxRoleCalls).toBe(20);
    expect(loadConfig(writeConfig({ defaults: { coding: { maxRoleCalls: 25 } } })).defaults.coding.maxRoleCalls).toBe(25);
  });
  it("keeps a larger configured value and does not touch research", () => {
    expect(loadConfig(writeConfig({ defaults: { coding: { maxRoleCalls: 22 } } })).defaults.coding.maxRoleCalls).toBe(22);
    expect(loadConfig(writeConfig({ defaults: { research: { maxRoleCalls: 2 } } })).defaults.research.maxRoleCalls).toBe(2);
  });
  it("uses defaults for missing ceiling, callTimeoutMinutes and knownEnvFailures", () => {
    const cfg = loadConfig(writeConfig({ defaults: {} }));
    expect(cfg.limits.maxRoleCallsCeiling).toBe(30);
    expect(cfg.defaults.coding.callTimeoutMinutes).toBe(20);
    expect(cfg.defaults.coding.knownEnvFailures).toEqual(["UNKNOWN: unknown error", "-4094", "EPERM junction"]);
    expect(DEFAULT_KNOWN_ENV_FAILURES).toHaveLength(3);
  });
  it("reads configured ceiling, timeout and signatures", () => {
    const cfg = loadConfig(writeConfig({ defaults: { coding: { callTimeoutMinutes: 15, knownEnvFailures: ["X1"] } }, limits: { maxRoleCallsCeiling: 40 } }));
    expect(cfg.limits.maxRoleCallsCeiling).toBe(40);
    expect(cfg.defaults.coding.callTimeoutMinutes).toBe(15);
    expect(cfg.defaults.coding.knownEnvFailures).toEqual(["X1"]);
  });
});
