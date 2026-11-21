import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { DEFAULT_GRANTS, planMcp } from "../../src/core/run/grants.js";
import { mcpRunArgs, readCliSnapshot, writeCliSnapshot } from "../../src/core/mcp/mcp-cli.js";
import { MCP_PRESETS } from "../../src/core/mcp/mcp-registry.js";

const dc = { ...MCP_PRESETS[0]!, enabled: true };
const cliOdoo = { id: "claude.ai Odoo", name: "claude.ai Odoo", kind: "cli" as const, enabled: true };

describe("mcpRunArgs", () => {
  it("nothing granted -> strict flag only (connectors off), no file", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const r = mcpRunArgs(planMcp(DEFAULT_GRANTS, [dc]), DEFAULT_GRANTS, dir);
    expect(r).toEqual({ extraArgs: ["--strict-mcp-config"], disallowed: [], allowed: [] });
    expect(fs.existsSync(path.join(dir, "mcp.json"))).toBe(false);
  });
  it("granted -> mcp.json, strict flag, --mcp-config followed by a flag (variadic safety), add-dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const g = { ...DEFAULT_GRANTS, mcp: { "desktop-commander": "full" as const }, extraDirs: [{ path: "D:\\Docs", write: false }] };
    const r = mcpRunArgs(planMcp(g, [dc]), g, dir);
    const i = r.extraArgs.indexOf("--mcp-config");
    expect(r.extraArgs[i + 1]).toBe(path.join(dir, "mcp.json")); // dir is the config dir (data/runs/<id>), not the run dir
    expect(r.extraArgs[i + 2]).toMatch(/^--/);
    expect(r.extraArgs).toContain("--strict-mcp-config");
    expect(r.extraArgs).toEqual(expect.arrayContaining(["--add-dir", "D:\\Docs"]));
    expect(JSON.parse(fs.readFileSync(path.join(dir, "mcp.json"), "utf8")).mcpServers["desktop-commander"].command).toBe("cmd");
    expect(r.allowed).toEqual(["mcp__desktop-commander"]);
    expect(r.disallowed).toContain("mcp__desktop-commander__start_process");
  });
  it("only extra dirs -> strict flag plus --add-dir", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const g = { ...DEFAULT_GRANTS, extraDirs: [{ path: "D:\\Docs", write: true }] };
    expect(mcpRunArgs(planMcp(g, [dc]), g, dir).extraArgs).toEqual(["--strict-mcp-config", "--add-dir", "D:\\Docs"]);
  });
  it("granted cli connector -> no strict flag", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
    const g = { ...DEFAULT_GRANTS, mcp: { "claude.ai Odoo": "full" as const } };
    const r = mcpRunArgs(planMcp(g, [cliOdoo]), g, dir);
    expect(r.extraArgs).not.toContain("--strict-mcp-config");
    expect(r.allowed).toEqual(["mcp__claude_ai_Odoo"]);
  });
  it("config/controller.json coding extraArgs start with a flag (variadic --mcp-config safety)", () => {
    const cfg = JSON.parse(fs.readFileSync(path.join(__dirname, "..", "..", "config", "controller.json"), "utf8"));
    expect(cfg.defaults.coding.extraArgs[0]).toMatch(/^--/);
  });
});

describe("cli snapshot", () => {
  it("writes and reads back", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-snap-"));
    expect(readCliSnapshot(dir)).toBeNull();
    writeCliSnapshot(dir, [{ name: "a", target: "t", status: "connected" }]);
    expect(readCliSnapshot(dir)?.items[0]?.name).toBe("a");
  });
});
