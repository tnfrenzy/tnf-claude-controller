import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

const docPath = path.resolve(__dirname, "..", "..", "docs", "LIBRARY-IMPORT.md");
const specPath = path.resolve(__dirname, "..", "..", "docs", "CONTEXT-SPEC-v1.md");

describe("docs/LIBRARY-IMPORT.md", () => {
  it("exists", () => {
    expect(existsSync(docPath)).toBe(true);
  });

  const doc = existsSync(docPath) ? readFileSync(docPath, "utf8") : "";

  it("mentions key limits and the endpoint", () => {
    expect(doc).toContain("Bash");
    expect(doc).toContain("4000");
    expect(doc).toContain("131072");
    expect(doc).toContain("/api/library/import");
    expect(doc).toMatch(/\b30\b/);
  });

  it("states that prompt content safety is not checked", () => {
    expect(doc.toLowerCase()).toContain("không kiểm an toàn nội dung prompt");
  });

  it("is linked from CONTEXT-SPEC-v1.md", () => {
    expect(readFileSync(specPath, "utf8")).toContain("LIBRARY-IMPORT.md");
  });

  it("has no 413 and no Windows user paths", () => {
    expect(doc).not.toContain("413");
    expect(doc).not.toMatch(/[A-Za-z]:\\Users\\/);
  });
});
