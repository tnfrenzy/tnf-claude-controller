import { describe, expect, it } from "vitest";
import {
  ATTACH_FILE_MAX_BYTES, ATTACH_MAX_PER_SIDE, ATTACH_TOTAL_MAX_BYTES, TEXT_FILE_EXTENSIONS, buildAttachmentPlan, buildSkillFiles,
  emptyDraft, isBinaryFileName, isValidAttachName, skillCreateError, skillFieldId, validateSkillDraft, validateSkillDraftFields
} from "../../ui/src/skills/skillCreate";
import { ATTACH_LIMITS, TEXT_EXTENSIONS, validateAttachmentName } from "../../src/core/skill-workshop/attachments";
import { validatePackageInput } from "../../src/core/skill-workshop/package";

function good() {
  const d = emptyDraft();
  d.title = "Tóm tắt email";
  d.inputDesc = "Nội dung email";
  d.outputDesc = "Bản tóm tắt ngắn";
  d.examples = [
    { input: "a", expected: "A", holdout: false },
    { input: "b", expected: "B", holdout: true }
  ];
  return d;
}

describe("validateSkillDraftFields", () => {
  it("valid draft: no issues, no firstKey", () => {
    const v = validateSkillDraftFields(good());
    expect(v.issues).toEqual([]);
    expect(v.firstKey).toBeUndefined();
  });
  it("flags each missing field with its key", () => {
    const d = emptyDraft();
    const v = validateSkillDraftFields(d);
    expect(v.firstKey).toBe("title");
    for (const k of ["title", "inputDesc", "outputDesc", "ex.0.input", "ex.0.expected", "ex.1.input", "ex.1.expected"]) {
      expect(v.byKey[k]).toBeTruthy();
    }
  });
  it("missing expected only", () => {
    const g = good();
    g.examples[1]!.expected = "  ";
    const v = validateSkillDraftFields(g);
    expect(v.firstKey).toBe("ex.1.expected");
    expect(v.byKey["ex.1.expected"]).toContain("đầu ra mong muốn");
  });
  it("missing holdout is an error", () => {
    const g = good();
    g.examples.forEach((e) => (e.holdout = false));
    const v = validateSkillDraftFields(g);
    expect(v.firstKey).toBe("holdout");
  });
  it("bad pass score and rounds", () => {
    const g = good();
    g.passScore = Number.NaN;
    g.maxRounds = 0;
    const v = validateSkillDraftFields(g);
    expect(v.firstKey).toBe("passScore");
    expect(v.byKey["maxRounds"]).toBeTruthy();
  });
  it("skillFieldId is a stable DOM id", () => {
    expect(skillFieldId("ex.1.input")).toBe("skillf-ex-1-input");
  });
});

describe("either-text-or-file rule and attachments", () => {
  const f = (name: string, size = 10) => ({ name, size });
  it("only text passes; only files passes; both empty fails", () => {
    const g = good();
    expect(validateSkillDraftFields(g).issues).toEqual([]);
    g.examples[0] = { input: "", expected: "", holdout: false, inputFiles: [f("a.csv")], expectedFiles: [f("b.json")] };
    expect(validateSkillDraftFields(g).issues).toEqual([]);
    g.examples[0] = { input: "", expected: "x", holdout: false, inputFiles: [], expectedFiles: [] };
    const v = validateSkillDraftFields(g);
    expect(v.byKey["ex.0.input"]).toContain("hoặc thêm tệp");
    expect(v.byKey["ex.0.expected"]).toBeUndefined();
  });
  it("rejects big file, bad name, too many, total over cap", () => {
    const g = good();
    g.examples[0]!.inputFiles = [f("big.txt", 1024 * 1024 + 1)];
    expect(validateSkillDraftFields(g).byKey["ex.0.input"]).toContain("1 MB");
    g.examples[0]!.inputFiles = [f("../x.txt"), f("a b.txt")];
    expect(validateSkillDraftFields(g).byKey["ex.0.input"]).toContain("không hợp lệ");
    g.examples[0]!.inputFiles = Array.from({ length: 11 }, (_, i) => f(`f${i}.txt`));
    expect(validateSkillDraftFields(g).byKey["ex.0.input"]).toContain("tối đa 10");
    const h = good();
    h.examples[0]!.inputFiles = Array.from({ length: 5 }, (_, i) => f(`f${i}.txt`, 1024 * 1024));
    expect(validateSkillDraftFields(h).byKey["examples"]).toContain("4 MB");
  });
  it("classifies binary vs text names", () => {
    for (const n of ["a.dwg", "a.sldprt", "a.xlsx", "a.pdf", "a.PNG"]) expect(isBinaryFileName(n)).toBe(true);
    for (const n of ["a.txt", "a.json", "a.CSV"]) expect(isBinaryFileName(n)).toBe(false);
  });
  it("keeps constants in sync with the server module", () => {
    expect([...TEXT_FILE_EXTENSIONS]).toEqual([...TEXT_EXTENSIONS]);
    expect(ATTACH_FILE_MAX_BYTES).toBe(ATTACH_LIMITS.fileBytes);
    expect(ATTACH_TOTAL_MAX_BYTES).toBe(ATTACH_LIMITS.totalBytes);
    expect(ATTACH_MAX_PER_SIDE).toBe(ATTACH_LIMITS.filesPerSide);
    for (const n of ["ok.txt", "../a.txt", "a/b.txt", "có dấu.txt", "", "a b.txt", "x..y.txt", ".hid"]) {
      let serverOk = true;
      try {
        validateAttachmentName(n);
      } catch {
        serverOk = false;
      }
      expect(isValidAttachName(n)).toBe(serverOk);
    }
  });
  it("attachment plan uses train/holdout numbering in order", () => {
    const d = good();
    d.examples = [
      { input: "", expected: "e", holdout: true, inputFiles: [f("h.csv")] },
      { input: "a", expected: "", holdout: false, expectedFiles: [f("o1.txt"), f("o2.dwg")] },
      { input: "", expected: "", holdout: false, inputFiles: [f("i.txt")], expectedFiles: [f("e.txt")] }
    ];
    expect(buildAttachmentPlan(d.examples)).toEqual([
      { pair: "holdout-1", side: "input", names: ["h.csv"] },
      { pair: "train-1", side: "expected", names: ["o1.txt", "o2.dwg"] },
      { pair: "train-2", side: "input", names: ["i.txt"] },
      { pair: "train-2", side: "expected", names: ["e.txt"] }
    ]);
    expect(Object.keys(buildSkillFiles(d).files)).toContain("examples/train-2.json");
  });
});

describe("skillCreate", () => {
  it("defaults 90 and 5", () => {
    const d = emptyDraft();
    expect(d.passScore).toBe(90);
    expect(d.maxRounds).toBe(5);
  });
  it("valid draft has no errors", () => {
    expect(validateSkillDraft(good())).toEqual([]);
  });
  it("missing name, descriptions, pairs and holdout give errors", () => {
    const d = emptyDraft();
    d.examples = [];
    expect(validateSkillDraft(d).length).toBeGreaterThanOrEqual(4);
    const g = good();
    g.examples = [{ input: "a", expected: "A", holdout: false }];
    expect(validateSkillDraft(g).join(" ")).toContain("giữ lại");
  });
  it("rejects files over 64 KB and bad numbers", () => {
    const g = good();
    g.examples[0]!.input = "x".repeat(70 * 1024);
    expect(validateSkillDraft(g).join(" ")).toContain("64 KB");
    const h = good();
    h.passScore = 0;
    h.maxRounds = 21;
    expect(validateSkillDraft(h).length).toBe(2);
  });
  it("builds files accepted by the server validator", () => {
    const { files, goal } = buildSkillFiles(good());
    expect(Object.keys(files).sort()).toEqual(["SKILL.md", "eval/rubric.json", "examples/holdout-1.json", "examples/train-1.json"]);
    expect(goal.length).toBeLessThanOrEqual(1000);
    const rubric = JSON.parse(files["eval/rubric.json"]!);
    expect(rubric.criteria.reduce((s: number, c: { weight: number }) => s + c.weight, 0)).toBe(100);
    expect(JSON.parse(files["examples/train-1.json"]!)).toEqual({ input: "a", expected: "A" });
    expect(JSON.parse(files["examples/holdout-1.json"]!)).toEqual({ input: "b", expected: "B" });
    expect(() => validatePackageInput(files)).not.toThrow();
  });
  it("maps server errors to Vietnamese", () => {
    expect(skillCreateError(409, "skill_exists", "x")).toContain("trùng tên");
    expect(skillCreateError(400, "bad_slug", "x")).toContain("a-z");
    expect(skillCreateError(500, undefined, "lỗi")).toBe("lỗi");
  });
});
