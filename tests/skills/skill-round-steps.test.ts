import { describe, it, expect } from "vitest";
import {
  extractLastJsonBlock, parseComposeResult, parseGradeResult, parseTrialResult,
  buildGradePrompt, buildTrialPrompt, buildComposePrompt, isAllowedComposePath
} from "../../src/core/skill-workshop/round-steps.js";

describe("round-steps attachments", () => {
  const files = [{ name: "a.csv", size: 5, text: "x,y\n1,2" }, { name: "p.dwg", size: 2048 }];
  it("trial prompt has text content and binary listing; unchanged without files", () => {
    const base = buildTrialPrompt({ skillMd: "S", input: "in" });
    expect(buildTrialPrompt({ skillMd: "S", input: "in", inputFiles: [] })).toBe(base);
    const p = buildTrialPrompt({ skillMd: "S", input: "in", inputFiles: files });
    expect(p).toContain("x,y\n1,2");
    expect(p).toContain("- p.dwg (2.0 KB)");
  });
  it("grade prompt has expected files; unchanged without files", () => {
    const base = buildGradePrompt({ rubricAiCriteria: [], input: "i", output: "o" });
    expect(buildGradePrompt({ rubricAiCriteria: [], input: "i", output: "o", expectedFiles: [] })).toBe(base);
    const p = buildGradePrompt({ rubricAiCriteria: [], input: "i", output: "o", expectedFiles: files });
    expect(p).toContain("TỆP KẾT QUẢ MONG ĐỢI");
    expect(p).toContain("x,y\n1,2");
    expect(p).toContain("p.dwg");
  });
  it("attachment paths never allowed for compose", () => {
    expect(isAllowedComposePath("examples/holdout-1/input/a.txt")).toBe(false);
    expect(isAllowedComposePath("examples/train-1/input/a.txt")).toBe(false);
  });
});

const wrap = (o: unknown) => "text\n```json\n" + JSON.stringify(o) + "\n```\n";

describe("round-steps", () => {
  it("takes the last json block", () => {
    expect(extractLastJsonBlock('```json\n{"a":1}\n```\nx\n```json\n{"b":2}\n```')).toBe('{"b":2}');
    expect(extractLastJsonBlock("none")).toBeNull();
  });
  it("rejects broken JSON", () => {
    const r = parseTrialResult("```json\n{oops\n```");
    expect(r.ok).toBe(false);
  });
  it("accepts allowed compose paths", () => {
    const r = parseComposeResult(wrap({ files: [{ path: "SKILL.md", content: "x" }, { path: "examples/train-1.json", content: "{}" }] }));
    expect(r.ok).toBe(true);
  });
  it("rejects traversal, holdout, meta and rounds", () => {
    for (const p of ["../x.md", "examples/holdout-1.json", "meta.json", "rounds.json", "/etc/passwd", "scripts/../a"]) {
      expect(parseComposeResult(wrap({ files: [{ path: p, content: "x" }] })).ok).toBe(false);
    }
  });
  it("rejects ratio out of range, unknown id and missing id", () => {
    expect(parseGradeResult(wrap({ scores: [{ id: "a", ratio: 1.2, reason: "" }] }), ["a"]).ok).toBe(false);
    expect(parseGradeResult(wrap({ scores: [{ id: "z", ratio: 0.5, reason: "" }] }), ["a"]).ok).toBe(false);
    expect(parseGradeResult(wrap({ scores: [] }), ["a"]).ok).toBe(false);
    const ok = parseGradeResult(wrap({ scores: [{ id: "a", ratio: 0.5, reason: "ổn" }] }), ["a"]);
    expect(ok.ok).toBe(true);
  });
  it("grade prompt does not contain SKILL.md content", () => {
    const p = buildGradePrompt({ rubricAiCriteria: [{ id: "a", label: "A" }], input: { q: 1 }, output: "out" });
    expect(p).not.toContain("SECRET-SKILL-BODY");
    const t = buildTrialPrompt({ skillMd: "SECRET-SKILL-BODY", input: { q: 1 } });
    expect(t).toContain("SECRET-SKILL-BODY");
  });
  it("trial prompt rejects oversized SKILL.md", () => {
    expect(() => buildTrialPrompt({ skillMd: "x".repeat(49 * 1024), input: 1 })).toThrow(/48 KB/);
  });
  it("compose prompt omits holdout files", () => {
    const p = buildComposePrompt({ goal: "g", files: { "SKILL.md": "s", "examples/holdout-1.json": "HOLD" }, criteria: [] });
    expect(p).not.toContain("HOLD");
  });
});
