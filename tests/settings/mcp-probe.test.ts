import path from "node:path";
import { describe, expect, it } from "vitest";
import { probeMcp } from "../../src/core/mcp/mcp-probe.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-mcp-server.mjs");

describe("probeMcp", () => {
  it("lists tools of a stdio server", async () => {
    const r = await probeMcp({ id: "f", name: "f", kind: "stdio", command: process.execPath, args: [FAKE], enabled: true }, 15_000);
    expect(r).toEqual({ ok: true, tools: ["read_file", "write_file"] });
  });
  it("reports a spawn failure in Vietnamese", async () => {
    const r = await probeMcp({ id: "f", name: "f", kind: "stdio", command: "no-such-binary-xyz", enabled: true }, 5_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Không/);
  });
  const fake = (mode: string, ms: number) =>
    probeMcp({ id: "f", name: "f", kind: "stdio", command: process.execPath, args: [FAKE], env: { FAKE_MCP_MODE: mode }, enabled: true }, ms);
  it("reports an early exit without crashing, with stderr tail", async () => {
    const r = await fake("exit", 15_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/thoát/);
    expect(r.error).toMatch(/boom/);
  });
  it("reports a JSON-RPC error", async () => {
    const r = await fake("error", 15_000);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/nope/);
  });
  it("times out", async () => {
    const r = await fake("hang", 500);
    expect(r.ok).toBe(false);
    expect(r.error).toMatch(/Hết thời gian/);
  });
  it("does not leak billing env to the child but passes the server's own env", async () => {
    const prev = process.env.ANTHROPIC_API_KEY;
    process.env.ANTHROPIC_API_KEY = "sk-test-should-not-leak";
    try {
      const r = await probeMcp({ id: "f", name: "f", kind: "stdio", command: process.execPath, args: [FAKE], env: { FAKE_MCP_MODE: "envecho", OWN_VAR: "mine" }, enabled: true }, 15_000);
      expect(r).toEqual({ ok: true, tools: ["api_key_hidden", "own_mine"] });
    } finally {
      if (prev === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = prev;
    }
  });
  it("refuses http/cli servers", async () => {
    const r = await probeMcp({ id: "h", name: "h", kind: "http", url: "https://x", enabled: true });
    expect(r.ok).toBe(false);
  });
});
