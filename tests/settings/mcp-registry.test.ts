import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MCP_PRESETS, cliItemsToServers, loadMcpServers, parseMcpList, saveMcpServers, validateMcpServer } from "../../src/core/mcp/mcp-registry.js";

const SAMPLE = [
  "Checking MCP server health…",
  "",
  "plugin:pdf-viewer:pdf: npx -y @modelcontextprotocol/server-pdf --stdio - √ Connected",
  "plugin:design:slack: https://mcp.slack.com/mcp (HTTP) - ! Needs authentication",
  "plugin:design:google calendar:  (HTTP) - - Not configured",
  "plugin:data:definite: https://api.definite.app/v3/mcp/http (HTTP) - × Failed to connect — ECONNRESET: boom",
].join("\n");

describe("parseMcpList", () => {
  it("parses name, target and the four statuses, skipping noise", () => {
    const items = parseMcpList(SAMPLE);
    expect(items.map((i) => [i.name, i.status])).toEqual([
      ["plugin:pdf-viewer:pdf", "connected"],
      ["plugin:design:slack", "needs_auth"],
      ["plugin:design:google calendar", "not_configured"],
      ["plugin:data:definite", "failed"],
    ]);
    expect(items[1]!.target).toBe("https://mcp.slack.com/mcp (HTTP)");
    expect(items[3]!.detail).toMatch(/ECONNRESET/);
  });
  it("maps to cli servers; not_configured ones are disabled", () => {
    const s = cliItemsToServers(parseMcpList(SAMPLE));
    expect(s.every((x) => x.kind === "cli")).toBe(true);
    expect(s.find((x) => x.id === "plugin:design:google calendar")!.enabled).toBe(false);
  });
});

describe("parseMcpList edge cases", () => {
  it("handles names with dots/spaces, CRLF and trailing spaces", () => {
    const text = [
      "claude.ai Odoo: https://erp.example.com/mcp - √ Connected   ",
      "claude.ai Vercel: https://mcp.vercel.com - ! Needs authentication ",
    ].join("\r\n");
    const items = parseMcpList(text);
    expect(items.map((i) => [i.name, i.target, i.status])).toEqual([
      ["claude.ai Odoo", "https://erp.example.com/mcp", "connected"],
      ["claude.ai Vercel", "https://mcp.vercel.com", "needs_auth"],
    ]);
    expect(parseMcpList(SAMPLE.replace(/\n/g, "\r\n"))).toHaveLength(4);
  });
});

describe("load/save", () => {
  const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcp-"));
  it("round-trips and leaves no temp file", () => {
    const d = tmp();
    const list = [validateMcpServer({ id: "a", name: "A", kind: "stdio", command: "node" })];
    saveMcpServers(d, list);
    expect(loadMcpServers(d)).toEqual(list);
    expect(fs.readdirSync(d)).toEqual(["mcp-servers.json"]);
  });
  it("returns [] for a missing or broken file, skips bad entries and duplicate ids", () => {
    const d = tmp();
    expect(loadMcpServers(d)).toEqual([]);
    fs.writeFileSync(path.join(d, "mcp-servers.json"), "{not json", "utf8");
    expect(loadMcpServers(d)).toEqual([]);
    fs.writeFileSync(
      path.join(d, "mcp-servers.json"),
      JSON.stringify([
        { id: "a", name: "First", kind: "stdio", command: "x" },
        { id: "a", name: "Second", kind: "stdio", command: "y" },
        { id: "Bad Id", name: "z", kind: "stdio", command: "z" },
        { id: "b", name: "B", kind: "http", url: "https://example.com" },
      ]),
      "utf8",
    );
    const l = loadMcpServers(d);
    expect(l.map((s) => [s.id, s.name])).toEqual([["a", "First"], ["b", "B"]]);
  });
});

describe("validateMcpServer", () => {
  it("accepts the Desktop Commander preset", () => {
    const p = MCP_PRESETS.find((x) => x.id === "desktop-commander")!;
    expect(validateMcpServer({ ...p, enabled: true }).processTools).toContain("start_process");
    expect(p.blockedTools).toContain("set_config_value");
  });
  it("rejects bad ids, missing command/url, non-http urls, cli kind", () => {
    expect(() => validateMcpServer({ id: "Bad Id", name: "x", kind: "stdio", command: "a" })).toThrow(/id/);
    expect(() => validateMcpServer({ id: "a", name: "x", kind: "stdio" })).toThrow(/lệnh/);
    expect(() => validateMcpServer({ id: "a", name: "x", kind: "http", url: "ftp://x" })).toThrow(/URL/);
    expect(() => validateMcpServer({ id: "a", name: "x", kind: "cli" })).toThrow(/kiểu/);
  });
  it("defaults enabled to true and keeps only string env values", () => {
    const s = validateMcpServer({ id: "a", name: "A", kind: "stdio", command: "node", env: { K: "v", N: 1 } });
    expect(s.enabled).toBe(true);
    expect(s.env).toEqual({ K: "v" });
  });
});
