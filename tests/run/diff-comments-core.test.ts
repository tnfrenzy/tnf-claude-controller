import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  diffFilesOfRun,
  validateDiffComments,
  formatCommentsPrompt,
  prepareCommentsFollowup,
} from "../../src/core/run/diff-comments.js";

let dir: string;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "diffc-"));
});
afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const patch2 =
  "diff --git a/src/a.ts b/src/a.ts\nindex 1..2 100644\n--- a/src/a.ts\n+++ b/src/a.ts\n@@ -1 +1 @@\n-x\n+y\n" +
  "diff --git a/docs/b.md b/docs/b.md\n--- a/docs/b.md\n+++ b/docs/b.md\n@@ -1 +1 @@\n-1\n+2\n";

describe("diffFilesOfRun", () => {
  it("reads files from diff.patch", () => {
    fs.writeFileSync(path.join(dir, "diff.patch"), patch2);
    expect(diffFilesOfRun(dir)).toEqual(new Set(["src/a.ts", "docs/b.md"]));
  });
  it("merges uncommitted.patch and dedupes", () => {
    fs.writeFileSync(path.join(dir, "diff.patch"), patch2);
    fs.writeFileSync(
      path.join(dir, "uncommitted.patch"),
      "diff --git a/src/a.ts b/src/a.ts\n--- a/src/a.ts\n+++ b/src/a.ts\ndiff --git a/c.ts b/c.ts\n"
    );
    expect(diffFilesOfRun(dir)).toEqual(new Set(["src/a.ts", "docs/b.md", "c.ts"]));
  });
  it("throws when diff.patch is missing", () => {
    expect(() => diffFilesOfRun(dir)).toThrow(/diff\.patch/);
  });
  it("decodes quoted and spaced names without crashing", () => {
    fs.writeFileSync(
      path.join(dir, "diff.patch"),
      'diff --git "a/d\\303\\240.txt" "b/d\\303\\240.txt"\n' +
        'diff --git "a/q\\"x\\\\y.txt" "b/q\\"x\\\\y.txt"\n' +
        "diff --git a/my file.txt b/my file.txt\n" +
        "diff --git garbage\n"
    );
    expect(diffFilesOfRun(dir)).toEqual(new Set(["dà.txt", 'q"x\\y.txt', "my file.txt"]));
  });
});

const allowed = new Set(["src/a.ts", "docs/b.md"]);
const good = { file: "src/a.ts", line: 3, text: "sửa chỗ này" };

describe("validateDiffComments", () => {
  it("accepts valid input and defaults side to new", () => {
    const r = validateDiffComments([good, { ...good, side: "old" }], allowed);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.comments[0].side).toBe("new");
      expect(r.comments[1].side).toBe("old");
    }
  });
  it("rejects non-array, empty, and >50", () => {
    expect(validateDiffComments("x", allowed).ok).toBe(false);
    expect(validateDiffComments([], allowed).ok).toBe(false);
    expect(validateDiffComments(Array(51).fill(good), allowed).ok).toBe(false);
    expect(validateDiffComments(Array(50).fill(good), allowed).ok).toBe(true);
  });
  it("rejects bad files", () => {
    for (const file of ["other.ts", "/src/a.ts", "C:/x", "../src/a.ts", "src\\a.ts"]) {
      const r = validateDiffComments([{ ...good, file }], allowed);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.message).toContain("#1");
    }
  });
  it("rejects bad lines", () => {
    for (const line of [0, -1, 1.5, "3"]) {
      expect(validateDiffComments([good, { ...good, line }], allowed).ok).toBe(false);
    }
  });
  it("rejects bad text", () => {
    expect(validateDiffComments([{ ...good, text: "  " }], allowed).ok).toBe(false);
    expect(validateDiffComments([{ ...good, text: "a".repeat(2001) }], allowed).ok).toBe(false);
    expect(validateDiffComments([{ ...good, text: "a".repeat(2000) }], allowed).ok).toBe(true);
  });
  it("rejects bad side", () => {
    expect(validateDiffComments([{ ...good, side: "left" }], allowed).ok).toBe(false);
  });
});

describe("formatCommentsPrompt", () => {
  it("sorts, marks old, indents, keeps $&", () => {
    const p = formatCommentsPrompt([
      { file: "b.ts", line: 1, side: "new", text: "z" },
      { file: "a.ts", line: 9, side: "old", text: "dòng 1\ndòng 2 $& $'" },
      { file: "a.ts", line: 2, side: "new", text: "k" },
    ]);
    expect(p).toBe(
      [
        "Hãy sửa đúng các chỗ được chỉ ra dưới đây trong diff hiện tại, không sửa chỗ khác:",
        "",
        "- a.ts:2 — k",
        "- a.ts:9 (cũ) — dòng 1\n  dòng 2 $& $'",
        "- b.ts:1 — z",
      ].join("\n")
    );
  });
});

describe("prepareCommentsFollowup", () => {
  it("rejects non-coding parent", () => {
    fs.writeFileSync(path.join(dir, "diff.patch"), patch2);
    expect(prepareCommentsFollowup(dir, "research", [good]).ok).toBe(false);
  });
  it("reports missing diff.patch", () => {
    const r = prepareCommentsFollowup(dir, "coding", [good]);
    expect(r.ok).toBe(false);
  });
  it("reports invalid comments", () => {
    fs.writeFileSync(path.join(dir, "diff.patch"), patch2);
    expect(prepareCommentsFollowup(dir, "coding", [{ ...good, file: "nope" }]).ok).toBe(false);
  });
  it("returns prompt for valid comments", () => {
    fs.writeFileSync(path.join(dir, "diff.patch"), patch2);
    const r = prepareCommentsFollowup(dir, "coding", [good]);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.prompt).toContain("src/a.ts:3 — sửa chỗ này");
  });
});
