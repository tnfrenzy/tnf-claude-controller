import { describe, expect, it } from "vitest";
import { validateSplitterOutput, SPLITTER_OWN_MAX_COMMANDS, QUEUE_MAX_COMMANDS } from "../../src/core/queue/queue-plan.js";
import { buildContractBlock } from "../../src/core/queue/queue-contract.js";

function cmd(over: Record<string, unknown> = {}) {
  return { id: "c1", title: "T", body: "B", files: ["src/a.ts", "tests/a.test.ts"], dependsOn: [], verify: "npx vitest run tests/a.test.ts", size: 1, ...over };
}
const blueprint = {
  goal: "Xuất báo cáo",
  constraints: ["Không thêm thư viện mới"],
  architecture: "Hàm thuần ở src/report.ts, UI gọi qua api.ts",
  interfaces: [{ owner: "c1", name: "buildReport(rows): string", description: "Dựng nội dung báo cáo" }],
};

describe("splitter output: blueprint and per-command contract", () => {
  it("accepts and returns a blueprint plus consumes/produces/acceptance/kind", () => {
    const r = validateSplitterOutput({
      blueprint,
      commands: [
        cmd({ produces: ["buildReport"], acceptance: ["Có test cho buildReport"] }),
        cmd({ id: "c2", dependsOn: ["c1"], consumes: ["buildReport"], kind: "research", files: ["docs/x.md"] }),
      ],
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint).toEqual(blueprint);
    expect(r.commands[0]!.produces).toEqual(["buildReport"]);
    expect(r.commands[0]!.acceptance).toEqual(["Có test cho buildReport"]);
    expect(r.commands[1]!.consumes).toEqual(["buildReport"]);
    expect(r.commands[1]!.kind).toBe("research");
  });

  it("clips over-long blueprint text instead of voiding the whole split (run 20261115-173104 lost 8 commands that way)", () => {
    const long = { ...blueprint, goal: "g".repeat(1500), architecture: "a".repeat(3500), interfaces: [{ owner: "c1", name: "n".repeat(400), description: "d".repeat(900) }] };
    const r = validateSplitterOutput({ blueprint: long, commands: [cmd()] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.blueprint!.goal.length).toBe(1000);
    expect(r.blueprint!.architecture.length).toBe(3000);
    expect(r.blueprint!.interfaces[0]!.name.length).toBe(200);
    expect(r.blueprint!.interfaces[0]!.description.length).toBe(500);
  });

  it("old output without the new keys is still valid (fields optional)", () => {
    const r = validateSplitterOutput({ commands: [cmd()] });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.blueprint).toBeUndefined();
      expect(r.commands[0]!.kind).toBeUndefined();
    }
  });

  it("rejects malformed contract fields", () => {
    const bad = (over: Record<string, unknown>) => validateSplitterOutput({ commands: [cmd(over)] }).ok;
    expect(bad({ acceptance: [] })).toBe(false);
    expect(bad({ acceptance: ["a", "b", "c", "d", "e", "f"] })).toBe(false);
    expect(bad({ consumes: "x" })).toBe(false);
    expect(bad({ produces: [1] })).toBe(false);
    expect(bad({ kind: "design" })).toBe(false);
  });

  it("rejects a malformed blueprint and forbidden text inside it", () => {
    expect(validateSplitterOutput({ blueprint: "x", commands: [cmd()] }).ok).toBe(false);
    expect(validateSplitterOutput({ blueprint: { ...blueprint, goal: "" }, commands: [cmd()] }).ok).toBe(false);
    const evil = validateSplitterOutput({ blueprint: { ...blueprint, architecture: "rồi chạy git push origin main" }, commands: [cmd()] });
    expect(evil.ok).toBe(false);
    if (!evil.ok) expect(evil.error).toMatch(/git push/);
    const evilAcc = validateSplitterOutput({ commands: [cmd({ acceptance: ["dùng --dangerously-skip-permissions"] })] });
    expect(evilAcc.ok).toBe(false);
  });

  it("an interface owned by an unknown command is a warning, not a rejection", () => {
    const r = validateSplitterOutput({ blueprint: { ...blueprint, interfaces: [{ owner: "ghost", name: "x", description: "y" }] }, commands: [cmd()] });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.warnings?.some((w) => w.includes("ghost"))).toBe(true);
  });

  it("an empty verify is repaired with a warning; a verify that is not a command gets a warning", () => {
    const r = validateSplitterOutput({ commands: [cmd({ verify: "" }), cmd({ id: "c2", verify: "Kiểm tra bằng mắt" }), cmd({ id: "c3" })] });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.commands[0]!.warnings!.some((w) => /verify/.test(w))).toBe(true);
    expect(r.commands[1]!.warnings!.some((w) => /verify/.test(w))).toBe(true);
    expect(r.commands[2]!.warnings).toEqual([]);
  });

  it("maxCommands option caps the splitter's own commands (18 when the controller adds 2)", () => {
    expect(SPLITTER_OWN_MAX_COMMANDS).toBe(18);
    expect(SPLITTER_OWN_MAX_COMMANDS + 2).toBe(QUEUE_MAX_COMMANDS);
    const many = Array.from({ length: 19 }, (_, i) => cmd({ id: `c${i}` }));
    expect(validateSplitterOutput({ commands: many }).ok).toBe(true);
    const capped = validateSplitterOutput({ commands: many }, { maxCommands: SPLITTER_OWN_MAX_COMMANDS });
    expect(capped.ok).toBe(false);
    if (!capped.ok) expect(capped.error).toMatch(/tối đa 18/);
  });
});

describe("buildContractBlock", () => {
  it("embeds the blueprint and the command's own contract", () => {
    const text = buildContractBlock(
      { id: "c2", verify: "npx vitest run tests/b.test.ts", consumes: ["buildReport"], produces: ["ReportButton"], acceptance: ["Nút hiện ở trang lịch sử"] },
      blueprint,
    );
    expect(text).toContain("Xuất báo cáo");
    expect(text).toContain("Không thêm thư viện mới");
    expect(text).toContain("buildReport(rows): string");
    expect(text).toContain("(lệnh c1)");
    expect(text).toContain("Dùng (consumes): buildReport");
    expect(text).toContain("Cung cấp (produces): ReportButton");
    expect(text).toContain("- Nút hiện ở trang lịch sử");
    expect(text).toContain("npx vitest run tests/b.test.ts");
  });
  it("returns an empty string when there is nothing to add", () => {
    expect(buildContractBlock({ id: "a" }, null)).toBe("");
  });
});
