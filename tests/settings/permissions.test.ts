import { describe, expect, it } from "vitest";
import { CODING_ENV_TOOLS, buildCodingAllowedTools, buildResearchAllowedTools, buildScoutWebTools, skillRules, validateAllowedCommand } from "../../src/core/run/permissions.js";
import { validateExtraAgents, validateSkills } from "../../src/core/run/extras.js";

describe("validateAllowedCommand", () => {
  it("accepts Bash(<prefix>*) rules", () => {
    expect(validateAllowedCommand("Bash(pytest*)")).toBeNull();
    expect(validateAllowedCommand("Bash(dotnet test*)")).toBeNull();
    expect(validateAllowedCommand("Bash(npm run lint)")).toBeNull();
  });
  it("rejects non-Bash rules and chained/expanded commands", () => {
    expect(validateAllowedCommand("Edit")).toMatch(/Bash\(/);
    expect(validateAllowedCommand("Bash(a && b*)")).toMatch(/&&/);
    expect(validateAllowedCommand("Bash(a; b*)")).toMatch(/;/);
    expect(validateAllowedCommand("Bash(cat x | tail*)")).toMatch(/\|/);
    expect(validateAllowedCommand("Bash($(x)*)")).toMatch(/\$/);
    expect(validateAllowedCommand("Bash(`x`*)")).toMatch(/`/);
    expect(validateAllowedCommand("Bash()")).not.toBeNull();
    expect(validateAllowedCommand("Bash(*)")).not.toBeNull();
    expect(validateAllowedCommand("Bash(git *)")).not.toBeNull();
  });
});

describe("buildCodingAllowedTools", () => {
  const base = ["Agent", "Read", "Edit", "Write", "Bash(npm test*)"];
  it("scopes Edit/Write to the worktree, adds notes Write, keeps the rest, uses forward slashes", () => {
    const tools = buildCodingAllowedTools({ base, projectCommands: [], worktreePath: "D:\\ws\\worktrees\\r1", runDir: "D:\\ws\\runs\\r1" });
    expect(tools.slice(0, 6)).toEqual(["Agent", "Read", "Edit(D:/ws/worktrees/r1/**)", "Write(D:/ws/worktrees/r1/**)", "Write(D:/ws/runs/r1/notes/**)", "Bash(npm test*)"]);
    expect(tools).toContain("NotebookEdit(D:/ws/worktrees/r1/**)");
    expect(tools).toEqual(expect.arrayContaining([...CODING_ENV_TOOLS]));
  });
  it("appends validated project commands without duplicates", () => {
    const tools = buildCodingAllowedTools({ base, projectCommands: ["Bash(node *)", "Bash(npm test*)", "Bash(node *)"], worktreePath: "/wt", runDir: "/rd" });
    expect(tools.filter((t) => t === "Bash(node *)")).toHaveLength(1);
    expect(tools.filter((t) => t === "Bash(npm test*)")).toHaveLength(1);
  });
  it("throws on an invalid project command", () => {
    expect(() => buildCodingAllowedTools({ base, projectCommands: ["Bash(x && y*)"], worktreePath: "/wt", runDir: "/rd" })).toThrow(/allowed_commands/);
  });
  it("environment baseline has web, search shell and no blanket or push/publish rights", () => {
    expect(CODING_ENV_TOOLS).toEqual(expect.arrayContaining(["WebSearch", "WebFetch", "TodoWrite", "Bash(grep *)", "Bash(npx *)"]));
    for (const t of CODING_ENV_TOOLS) {
      if (t.startsWith("Bash(") && !t.startsWith("Bash(powershell -NoProfile")) expect(validateAllowedCommand(t), t).toBeNull();
      if (t.startsWith("Bash(powershell")) expect(t).toMatch(/-File scripts\/(start|stop)\.ps1/);
      expect(t).not.toMatch(/push|reset --hard|rm -rf/);
      expect(t).not.toBe("Bash(*)");
    }
  });
  it("adds Skill(<name>) rules and nothing else (no new Bash)", () => {
    const plain = buildCodingAllowedTools({ base, projectCommands: [], worktreePath: "/wt", runDir: "/rd" });
    const withSkills = buildCodingAllowedTools({ base, projectCommands: [], worktreePath: "/wt", runDir: "/rd", skills: ["pdf", "ns:thing"] });
    expect(withSkills).toEqual([...plain, "Skill(pdf)", "Skill(ns:thing)"]);
    expect(withSkills.filter((t) => t.startsWith("Bash"))).toEqual(plain.filter((t) => t.startsWith("Bash")));
  });
  it("buildScoutWebTools is exactly WebSearch+WebFetch and the coding list now includes them too", () => {
    expect(buildScoutWebTools()).toEqual(["WebSearch", "WebFetch"]);
    const plain = buildCodingAllowedTools({ base, projectCommands: [], worktreePath: "/wt", runDir: "/rd" });
    expect(plain).toContain("WebSearch");
    expect(plain).toContain("WebFetch");
  });
});

describe("skills in research allowlist", () => {
  it("appends Skill(x) and leaves the base untouched without skills", () => {
    const base = ["Agent", "WebSearch", "Read", "Write"];
    expect(buildResearchAllowedTools(base)).toEqual(base);
    expect(buildResearchAllowedTools(base, ["foo"])).toEqual([...base, "Skill(foo)"]);
  });
  it("rejects bad skill names", () => {
    for (const bad of ["a b", "x)", "Bash(*)", "../x", "", "a;b"]) expect(() => skillRules([bad])).toThrow(/skill/i);
  });
});

describe("extras validation", () => {
  const ok = { description: "Reviews docs", prompt: "You review docs." };
  it("accepts a clean agent and fills default read-only tools", () => {
    const r = validateExtraAgents({ "doc-reviewer": ok }, ["analyst"]);
    expect(r["doc-reviewer"]).toEqual({ ...ok, tools: ["Read", "Grep", "Glob"] });
  });
  it("rejects clashing names, bad names, Bash/* tools, unknown keys, too many agents", () => {
    expect(() => validateExtraAgents({ analyst: ok }, ["analyst"])).toThrow(/trùng/);
    expect(() => validateExtraAgents({ "Bad Name": ok }, [])).toThrow(/không hợp lệ/);
    expect(() => validateExtraAgents({ a: { ...ok, tools: ["Bash"] } }, [])).toThrow(/danh sách an toàn/);
    expect(() => validateExtraAgents({ a: { ...ok, tools: ["*"] } }, [])).toThrow(/danh sách an toàn/);
    expect(() => validateExtraAgents({ a: { ...ok, tools: ["Bash(npm test*)"] } }, [])).toThrow(/danh sách an toàn/);
    expect(() => validateExtraAgents({ a: { ...ok, $comment: "x" } }, [])).toThrow(/khóa/);
    const six = Object.fromEntries(["a", "b", "c", "d", "e", "f"].map((n) => [n, ok]));
    expect(() => validateExtraAgents(six, [])).toThrow(/Tối đa 5/);
    expect(() => validateExtraAgents({ a: { ...ok, prompt: "x".repeat(5000) } }, [])).toThrow(/Prompt/);
    expect(() => validateExtraAgents([ok], [])).toThrow(/đối tượng/);
  });
  it("validates skills: limit 10, name pattern, dedupe", () => {
    expect(validateSkills(["a", "a", " b "])).toEqual(["a", "b"]);
    expect(validateSkills(undefined)).toEqual([]);
    expect(() => validateSkills(Array.from({ length: 11 }, (_, i) => `s${i}`))).toThrow(/Tối đa 10/);
    expect(() => validateSkills(["bad name"])).toThrow(/Tên skill/);
    expect(() => validateSkills("x")).toThrow(/mảng/);
  });
});
