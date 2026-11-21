import { describe, expect, it } from "vitest";
import { GROUP_FIELDS, addDir, connectorRows, isLocalHost, outputGroup, removeDir, setMcpAccess } from "../../ui/src/settings/grantsView";
import type { GrantsView } from "../../ui/src/api";

const base: GrantsView = { fileWrite: true, web: true, cmdNode: true, cmdPython: true, cmdNative: true, cmdBasic: true, cmdInstall: true, gitRestore: true, anyProcess: false, preview: false, extraDirs: [], mcp: {} };

describe("grantsView", () => {
  it("setMcpAccess sets and clears (off removes the key)", () => {
    const g = setMcpAccess(base, "desktop-commander", "read");
    expect(g.mcp).toEqual({ "desktop-commander": "read" });
    expect(setMcpAccess(g, "desktop-commander", "off").mcp).toEqual({});
    expect(base.mcp).toEqual({});
  });
  it("addDir adds, removeDir removes", () => {
    const a = addDir(base, "D:\\Docs");
    expect(a.extraDirs).toEqual([{ path: "D:\\Docs", write: false }]);
    expect(removeDir(a, "D:\\Docs").extraDirs).toEqual([]);
    expect(base.extraDirs).toEqual([]);
  });
  it("addDir normalises, ignores duplicates (case-insensitive) and empty input", () => {
    const a = addDir(base, "  D:\\Docs\\  ");
    expect(a.extraDirs[0]!.path).toBe("D:\\Docs");
    expect(addDir(a, "d:\\docs/")).toBe(a);
    expect(addDir(a, "   ")).toBe(a);
    expect(addDir(base, "D:\\").extraDirs[0]!.path).toBe("D:\\");
  });
  it("GROUP_FIELDS lists the eight group ticks (anyProcess is rendered separately)", () => {
    expect(GROUP_FIELDS.map((f) => f.key)).toEqual(["fileWrite", "web", "cmdNode", "cmdPython", "cmdNative", "cmdBasic", "cmdInstall", "gitRestore"]);
  });
  it("isLocalHost", () => {
    expect(isLocalHost("localhost")).toBe(true);
    expect(isLocalHost("127.0.0.1")).toBe(true);
    expect(isLocalHost("[::1]")).toBe(true);
    expect(isLocalHost("my-pc.tailnet.ts.net")).toBe(false);
  });
  it("connectorRows keeps only configured claude.ai connectors", () => {
    const rows = connectorRows([
      { name: "claude.ai Gmail", target: "x", status: "connected" },
      { name: "claude.ai Notion", target: "x", status: "needs_auth" },
      { name: "claude.ai Old", target: "x", status: "not_configured" },
      { name: "plugin:data:hex", target: "x", status: "connected" },
      { name: "desktop-commander", target: "x", status: "connected" },
    ]);
    expect(rows.map((r) => r.id)).toEqual(["claude.ai Gmail", "claude.ai Notion"]);
    expect(rows.every((r) => r.canRead === false)).toBe(true);
  });
  it("outputGroup normalises a slug to the server's group pattern", () => {
    const ok = /^[a-z0-9][a-z0-9_-]{0,60}$/;
    expect(outputGroup("my-skill_1")).toBe("my-skill_1");
    expect(outputGroup("My Skill!")).toBe("my-skill");
    expect(outputGroup("___")).toBe("skill");
    expect(outputGroup("x".repeat(100)).length).toBe(61);
    for (const s of ["My Skill!", "___", "-a", "Ünï"]) expect(ok.test(outputGroup(s))).toBe(true);
  });
});
