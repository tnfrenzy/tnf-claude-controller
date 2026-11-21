import { describe, it, expect } from "vitest";
import {
  ATTACH_RE, isTextAttachment, validateAttachmentName, attachmentRel, renderAttachmentsForPrompt, ATTACH_LIMITS
} from "../../src/core/skill-workshop/attachments.js";

describe("skill attachments helpers", () => {
  it("accepts good names", () => {
    expect(validateAttachmentName("a.csv")).toBe("a.csv");
    expect(validateAttachmentName("part_1-v2.dwg")).toBe("part_1-v2.dwg");
  });
  it("rejects bad names", () => {
    for (const n of ["../a.txt", "a/b.txt", "tệp.txt", "", "a b.txt", ".hidden", "a..b"]) {
      expect(() => validateAttachmentName(n), n).toThrow(/không hợp lệ|Thiếu/);
    }
  });
  it("builds relative paths and rejects bad pair/side", () => {
    expect(attachmentRel("train-1", "input", "a.csv")).toBe("examples/train-1/input/a.csv");
    expect(attachmentRel("holdout-12", "expected", "b.json")).toBe("examples/holdout-12/expected/b.json");
    expect(ATTACH_RE.test("examples/train-1/input/a.csv")).toBe(true);
    expect(ATTACH_RE.test("examples/train-0/input/a.csv")).toBe(false);
    expect(() => attachmentRel("x", "input", "a")).toThrow();
    expect(() => attachmentRel("train-1", "other", "a")).toThrow();
    expect(() => attachmentRel("train-1/../x", "input", "a")).toThrow();
  });
  it("classifies extensions", () => {
    for (const n of ["a.txt", "a.JSON", "a.csv", "a.md", "a.yaml"]) expect(isTextAttachment(n), n).toBe(true);
    for (const n of ["a.dwg", "a.sldprt", "a.xlsx", "a.pdf", "a.png", "noext"]) expect(isTextAttachment(n), n).toBe(false);
  });
  it("renders text content, cuts long text and lists binaries", () => {
    const out = renderAttachmentsForPrompt([
      { name: "a.csv", size: 9, text: "x,y\n1,2\n" },
      { name: "big.txt", size: 20000, text: "z".repeat(20000) },
      { name: "p.dwg", size: 2048 }
    ]);
    expect(out).toContain("x,y");
    expect(out).toContain("(đã cắt)");
    expect(out).not.toContain("z".repeat(ATTACH_LIMITS.promptFileBytes + 1));
    expect(out).toContain("- p.dwg (2.0 KB)");
    expect(out).toContain("không đọc được nội dung");
    expect(renderAttachmentsForPrompt([])).toBe("");
  });
});
