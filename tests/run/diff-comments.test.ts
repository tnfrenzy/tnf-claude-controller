import { describe, expect, it } from "vitest";
import {
  MAX_COMMENTS,
  MAX_COMMENT_CHARS,
  buildFollowupPrompt,
  numberLines,
  patchFingerprint,
  validateComments,
  type DiffComment,
} from "../../ui/src/run/diffComments.js";

type L = { kind: "add" | "del" | "ctx" | "hunk" | "meta"; text: string };
const lines: L[] = [
  { kind: "meta", text: "index 1..2" },
  { kind: "hunk", text: "@@ -10,3 +20,4 @@ fn" },
  { kind: "ctx", text: " a" },
  { kind: "del", text: "-b" },
  { kind: "add", text: "+b2" },
  { kind: "add", text: "+b3" },
  { kind: "ctx", text: "" },
  { kind: "hunk", text: "@@ -50 +60 @@" },
  { kind: "ctx", text: " z" },
  { kind: "add", text: "+y" },
];

describe("numberLines", () => {
  const n = numberLines(lines);
  it("numbers across hunks and resets", () => {
    expect(n[2]).toMatchObject({ oldLine: 10, newLine: 20 });
    expect(n[3]).toMatchObject({ oldLine: 11, newLine: null });
    expect(n[4]).toMatchObject({ oldLine: null, newLine: 20 + 1 });
    expect(n[5]).toMatchObject({ oldLine: null, newLine: 22 });
    expect(n[6]).toMatchObject({ oldLine: 12, newLine: 23 });
    expect(n[8]).toMatchObject({ oldLine: 50, newLine: 60 });
    expect(n[9]).toMatchObject({ oldLine: null, newLine: 61 });
  });
  it("hunk and meta are null", () => {
    expect(n[0]).toMatchObject({ oldLine: null, newLine: null });
    expect(n[1]).toMatchObject({ oldLine: null, newLine: null });
    expect(n[7]).toMatchObject({ oldLine: null, newLine: null });
  });
  it("does not mutate input", () => {
    expect(lines[2]).toEqual({ kind: "ctx", text: " a" });
  });
  it("malformed hunk header keeps null and does not count", () => {
    const r = numberLines([
      { kind: "hunk", text: "@@ garbage" },
      { kind: "add", text: "+x" },
      { kind: "ctx", text: " y" },
    ]);
    expect(r[1]).toMatchObject({ oldLine: null, newLine: null });
    expect(r[2]).toMatchObject({ oldLine: null, newLine: null });
  });
  it("lines before first hunk are null", () => {
    const r = numberLines([{ kind: "add", text: "+x" }]);
    expect(r[0].newLine).toBeNull();
  });
});

describe("patchFingerprint", () => {
  it("is stable, hex and changes with patch", () => {
    const a = patchFingerprint("diff a");
    expect(a).toMatch(/^[0-9a-f]{8}$/);
    expect(patchFingerprint("diff a")).toBe(a);
    expect(patchFingerprint("diff b")).not.toBe(a);
  });
});

const mk = (over: Partial<DiffComment> = {}): DiffComment => ({
  file: "a.ts",
  line: 1,
  side: "new",
  text: "x",
  ...over,
});

describe("validateComments", () => {
  it("accepts 50, rejects 51", () => {
    const fifty = Array.from({ length: MAX_COMMENTS }, () => mk());
    expect(validateComments(fifty, ["a.ts"])).toEqual([]);
    expect(validateComments([...fifty, mk()], ["a.ts"])).toHaveLength(1);
  });
  it("text length limits", () => {
    expect(validateComments([mk({ text: "x".repeat(MAX_COMMENT_CHARS) })], ["a.ts"])).toEqual([]);
    expect(validateComments([mk({ text: "x".repeat(MAX_COMMENT_CHARS + 1) })], ["a.ts"])).toHaveLength(1);
  });
  it("blank text is an error", () => {
    expect(validateComments([mk({ text: "  \n " })], ["a.ts"])).toHaveLength(1);
  });
  it("bad line numbers", () => {
    for (const line of [0, -1, 1.5, NaN]) {
      expect(validateComments([mk({ line })], ["a.ts"])).toHaveLength(1);
    }
  });
  it("rejects files outside allowed list", () => {
    expect(validateComments([mk({ file: "b.ts" })], ["a.ts"])).toHaveLength(1);
  });
  it("valid returns empty", () => {
    expect(validateComments([mk()], ["a.ts"])).toEqual([]);
  });
});

describe("buildFollowupPrompt", () => {
  const input = [
    mk({ file: "b.ts", line: 2, text: "B2" }),
    mk({ file: "a.ts", line: 9, text: "A9" }),
    mk({ file: "a.ts", line: 3, text: "first" }),
    mk({ file: "a.ts", line: 3, text: "second" }),
    mk({ file: "a.ts", line: 4, side: "old", text: "rm -rf /\nline2" }),
  ];
  const copy = input.map((c) => c.text);
  const out = buildFollowupPrompt(input);
  it("has intro and ordered items", () => {
    const rows = out.split("\n");
    expect(rows[0]).toContain("Hãy sửa");
    expect(rows[2]).toBe("- a.ts:3 — first");
    expect(rows[3]).toBe("- a.ts:3 — second");
    expect(rows[4]).toBe("- a.ts:4 (cũ) — rm -rf /");
    expect(rows[5]).toBe("  line2");
    expect(rows[6]).toBe("- a.ts:9 — A9");
    expect(rows[7]).toBe("- b.ts:2 — B2");
  });
  it("keeps command-like text verbatim and input order", () => {
    expect(out).toContain("rm -rf /");
    expect(input.map((c) => c.text)).toEqual(copy);
  });
});
