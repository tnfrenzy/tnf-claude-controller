import { describe, expect, it } from "vitest";
import { parseScope, scopeConflict, buildScopePrompt } from "../../src/core/run/scope-guard.js";

const sure = (files: string[]) => ({ files, confident: true });

describe("parseScope", () => {
  it("reads the last json block", () => {
    const r = parseScope('text\n```json\n{"files":["src/a.ts","ui/src/pages/"],"confident":true}\n```');
    expect(r).toEqual({ files: ["src/a.ts", "ui/src/pages/"], confident: true });
  });
  it("normalises paths and drops unsafe ones", () => {
    const r = parseScope('{"files":[".\\\\src\\\\a.ts","../x","C:/y","src/a.ts"],"confident":true}');
    expect(r.files).toEqual(["src/a.ts"]);
  });
  it("is unsure when not confident, empty or unreadable", () => {
    expect(parseScope('{"files":["a.ts"],"confident":false}').confident).toBe(false);
    expect(parseScope('{"files":[],"confident":true}').confident).toBe(false);
    expect(parseScope("không có json").confident).toBe(false);
    expect(parseScope("").confident).toBe(false);
  });
});

describe("scopeConflict", () => {
  it("overlapping file or folder conflicts", () => {
    expect(scopeConflict({ id: "a", scope: sure(["src/a.ts"]) }, { id: "b", scope: sure(["src/a.ts"]) }, []).conflict).toBe(true);
    expect(scopeConflict({ id: "a", scope: sure(["src/"]) }, { id: "b", scope: sure(["src/core/x.ts"]) }, []).conflict).toBe(true);
  });
  it("disjoint scopes do not conflict, a shared hotspot does", () => {
    expect(scopeConflict({ id: "a", scope: sure(["src/a.ts"]) }, { id: "b", scope: sure(["ui/b.ts"]) }, []).conflict).toBe(false);
    expect(scopeConflict({ id: "a", scope: sure(["package.json"]) }, { id: "b", scope: sure(["package.json"]) }, ["package.json"]).conflict).toBe(true);
  });
  it("unsure on either side conflicts (when in doubt, wait)", () => {
    const u = { files: [], confident: false, note: "mơ hồ" };
    expect(scopeConflict({ id: "a", scope: u }, { id: "b", scope: sure(["x.ts"]) }, []).conflict).toBe(true);
    expect(scopeConflict({ id: "a", scope: sure(["x.ts"]) }, { id: "b", scope: u }, []).reason).toContain("b");
  });
  it("prompt builder caps the command and lists hotspots", () => {
    const p = buildScopePrompt("x".repeat(9000), ["package.json"]);
    expect(p.length).toBeLessThan(5000);
    expect(p).toContain("package.json");
  });
});
