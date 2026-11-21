import { describe, expect, it } from "vitest";
import { CODING_ENV_TOOLS, buildCodingAllowedTools } from "../../src/core/run/permissions.js";
import { DEFAULT_GRANTS, grantsAddDirs, grantsToAllowedTools, mcpPrefix, planMcp, resolveGrants, sanitizeGrants, validateExtraDir, grantsToDisallowedTools } from "../../src/core/run/grants.js";
import type { McpServer } from "../../src/core/mcp/mcp-registry.js";

const dc: McpServer = {
  id: "desktop-commander", name: "Desktop Commander", kind: "stdio", command: "cmd", args: ["/c", "npx", "-y", "x"], enabled: true,
  writeTools: ["write_file", "edit_block"], processTools: ["start_process"], blockedTools: ["set_config_value"],
};

describe("grants -> allowlist", () => {
  it("default grants reproduce CODING_ENV_TOOLS exactly", () => {
    expect(new Set(grantsToAllowedTools(DEFAULT_GRANTS))).toEqual(new Set(CODING_ENV_TOOLS));
    expect(grantsToAllowedTools(DEFAULT_GRANTS).length).toBe(CODING_ENV_TOOLS.length);
  });
  it("unticking a group removes only its rules", () => {
    const out = grantsToAllowedTools({ ...DEFAULT_GRANTS, web: false, cmdNode: false });
    expect(out).not.toContain("WebSearch");
    expect(out).not.toContain("Bash(npm *)");
    expect(out).toContain("Bash(pytest*)");
  });
  it("extra dirs add scoped rules and --add-dir", () => {
    const g = { ...DEFAULT_GRANTS, extraDirs: [{ path: "D:\\Docs", write: false }, { path: "D:\\Out", write: true }] };
    const out = grantsToAllowedTools(g);
    expect(out).toContain("Read(D:/Docs/**)");
    expect(out).not.toContain("Edit(D:/Docs/**)");
    expect(out).toContain("Edit(D:/Out/**)");
    expect(out).toContain("Write(D:/Out/**)");
    expect(grantsAddDirs(g)).toEqual(["D:\\Docs", "D:\\Out"]);
  });
  it("buildCodingAllowedTools without grants is unchanged; fileWrite=false drops Edit/Write in the worktree", () => {
    const base = ["Agent", "Read", "Edit", "Write"];
    const o = { base, projectCommands: [], worktreePath: "D:\\wt\\r1", runDir: "D:\\runs\\r1" };
    const legacy = buildCodingAllowedTools(o);
    expect(legacy).toContain("Edit(D:/wt/r1/**)");
    const ro = buildCodingAllowedTools({ ...o, grants: { ...DEFAULT_GRANTS, fileWrite: false } });
    expect(ro).not.toContain("Edit(D:/wt/r1/**)");
    expect(ro).not.toContain("Write(D:/wt/r1/**)");
    expect(ro).toContain("Write(D:/runs/r1/notes/**)");
  });
});

describe("sanitizeGrants / resolveGrants / validateExtraDir", () => {
  it("fills defaults and drops junk", () => {
    const g = sanitizeGrants({ web: false, evil: true, mcp: { a: "full", b: "root" }, extraDirs: [{ path: "D:\\x", write: 1 }, { path: 5 }] });
    expect(g.web).toBe(false);
    expect(g.cmdNode).toBe(true);
    expect(g.mcp).toEqual({ a: "full" });
    expect(g.extraDirs).toEqual([{ path: "D:\\x", write: false }]);
    expect((g as unknown as Record<string, unknown>)["evil"]).toBeUndefined();
  });
  it("project grants win over app default, default over built-in", () => {
    expect(resolveGrants(null, { web: false }).web).toBe(false);
    expect(resolveGrants({ web: true }, { web: false }).web).toBe(true);
    expect(resolveGrants({}, { web: false }).web).toBe(false);
    expect(resolveGrants(null, null)).toEqual(DEFAULT_GRANTS);
  });
  it("rejects relative, drive-root and dotdot dirs", () => {
    expect(validateExtraDir("docs")).toMatch(/tuyệt đối/);
    expect(validateExtraDir("D:\\")).toMatch(/gốc/);
    expect(validateExtraDir("D:\\a\\..\\b")).toMatch(/\.\./);
    expect(validateExtraDir("D:\\Docs")).toBeNull();
  });
  it("rejects glob metacharacters, dot segments and root variants", () => {
    for (const bad of ["D:\\*", "D:\\a(b)", "D:\\a[1]", "D:\\a?", "D:\\a{b}"]) expect(validateExtraDir(bad), bad).toMatch(/ký tự/);
    for (const bad of ["D:\\.", "D:/./"]) expect(validateExtraDir(bad), bad).toMatch(/đoạn "\."/);
    expect(validateExtraDir("D:/")).toMatch(/gốc/);
    expect(validateExtraDir("/")).toMatch(/gốc/);
    expect(validateExtraDir("D:\\Docs\\")).toBeNull();
  });
});

describe("planMcp", () => {
  it("off -> no config, no flags", () => {
    const p = planMcp(DEFAULT_GRANTS, [dc]);
    expect(p.config).toBeNull();
    expect(p.allowed).toEqual([]);
  });
  it("full blocks process tools and config tools unless anyProcess", () => {
    const g = { ...DEFAULT_GRANTS, mcp: { "desktop-commander": "full" as const } };
    const p = planMcp(g, [dc]);
    expect(p.strict).toBe(true);
    expect(p.allowed).toEqual(["mcp__desktop-commander"]);
    expect(p.disallowed).toEqual(expect.arrayContaining(["mcp__desktop-commander__start_process", "mcp__desktop-commander__set_config_value"]));
    expect(p.disallowed).not.toContain("mcp__desktop-commander__write_file");
    expect(p.config).toEqual({ mcpServers: { "desktop-commander": { command: "cmd", args: ["/c", "npx", "-y", "x"] } } });
    const open = planMcp({ ...g, anyProcess: true }, [dc]);
    expect(open.disallowed).not.toContain("mcp__desktop-commander__start_process");
    expect(open.disallowed).toContain("mcp__desktop-commander__set_config_value");
  });
  it("read blocks process tools even when anyProcess is on", () => {
    const p = planMcp({ ...DEFAULT_GRANTS, anyProcess: true, mcp: { "desktop-commander": "read" } }, [dc]);
    expect(p.disallowed).toContain("mcp__desktop-commander__start_process");
    const full = planMcp({ ...DEFAULT_GRANTS, anyProcess: true, mcp: { "desktop-commander": "full" } }, [dc]);
    expect(full.disallowed).not.toContain("mcp__desktop-commander__start_process");
  });
  it("read also blocks write tools", () => {
    const p = planMcp({ ...DEFAULT_GRANTS, mcp: { "desktop-commander": "read" } }, [dc]);
    expect(p.disallowed).toEqual(expect.arrayContaining(["mcp__desktop-commander__write_file", "mcp__desktop-commander__edit_block"]));
  });
  it("cli servers: granted -> non-strict; not granted -> whole server denied", () => {
    const drive: McpServer = { id: "claude.ai Google Drive", name: "claude.ai Google Drive", kind: "cli", enabled: true };
    const slack: McpServer = { id: "plugin:design:slack", name: "plugin:design:slack", kind: "cli", enabled: true };
    const p = planMcp({ ...DEFAULT_GRANTS, mcp: { "claude.ai Google Drive": "full" } }, [drive, slack]);
    expect(p.strict).toBe(false);
    expect(p.config).toBeNull();
    expect(p.allowed).toEqual([mcpPrefix("claude.ai Google Drive")]);
    expect(p.disallowed).toContain("mcp__plugin_design_slack");
    expect(mcpPrefix("claude.ai Google Drive")).toBe("mcp__claude_ai_Google_Drive");
  });
});

describe("grantsToDisallowedTools", () => {
  const wt = "D:\\wt\\r1";
  it("default => empty", () => expect(grantsToDisallowedTools(DEFAULT_GRANTS, wt)).toEqual([]));
  it("web:false denies web tools", () => {
    expect(grantsToDisallowedTools({ ...DEFAULT_GRANTS, web: false }, wt)).toEqual(expect.arrayContaining(["WebSearch", "WebFetch"]));
  });
  it("cmdNode:false denies node rules only", () => {
    const out = grantsToDisallowedTools({ ...DEFAULT_GRANTS, cmdNode: false }, wt);
    expect(out).toContain("Bash(npm *)");
    expect(out).not.toContain("Bash(pytest*)");
  });
  it("fileWrite:false denies worktree edits but not notes", () => {
    const out = grantsToDisallowedTools({ ...DEFAULT_GRANTS, fileWrite: false }, wt);
    expect(out).toEqual(["Edit(D:/wt/r1/**)", "Write(D:/wt/r1/**)", "NotebookEdit(D:/wt/r1/**)"]);
  });
  it("extra dir write:false denies Edit/Write, write:true does not", () => {
    const out = grantsToDisallowedTools({ ...DEFAULT_GRANTS, extraDirs: [{ path: "D:\\Docs", write: false }, { path: "D:\\Out", write: true }] }, wt);
    expect(out).toEqual(["Edit(D:/Docs/**)", "Write(D:/Docs/**)"]);
  });
});

describe("preview grant", () => {
  it("is off by default and survives sanitize", () => {
    expect(DEFAULT_GRANTS.preview).toBe(false);
    expect(sanitizeGrants({}).preview).toBe(false);
    expect(sanitizeGrants({ preview: true }).preview).toBe(true);
    expect(sanitizeGrants({ preview: "yes" }).preview).toBe(false);
  });
  it("adds no allow/deny rules", () => {
    const on = { ...DEFAULT_GRANTS, preview: true };
    expect(grantsToAllowedTools(on)).toEqual(grantsToAllowedTools(DEFAULT_GRANTS));
    expect(grantsToDisallowedTools(on, "D:/wt")).toEqual(grantsToDisallowedTools(DEFAULT_GRANTS, "D:/wt"));
  });
});
