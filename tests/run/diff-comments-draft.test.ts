import { describe, expect, it } from "vitest";
import {
  MAX_COMMENTS,
  hasStaleDraft,
  isTooLong,
  removeDraft,
  upsertDraft,
  type DraftComment,
} from "../../ui/src/run/diffComments.js";

const c = (file: string, line: number, text = "t", side: "new" | "old" = "new") => ({ file, line, side, text });

describe("diff comment drafts (pure)", () => {
  it("adds new and replaces same file+line+side", () => {
    let l: DraftComment[] = [];
    l = upsertDraft(l, c("a.ts", 1, "one"), "f1");
    l = upsertDraft(l, c("a.ts", 1, "old side", "old"), "f1");
    expect(l).toHaveLength(2);
    l = upsertDraft(l, c("a.ts", 1, "two"), "f2");
    expect(l).toHaveLength(2);
    expect(l[0]).toEqual({ file: "a.ts", line: 1, side: "new", text: "two", fingerprint: "f2" });
  });
  it("rejects the 51st new comment but still allows replacing", () => {
    let l: DraftComment[] = [];
    for (let i = 1; i <= MAX_COMMENTS; i++) l = upsertDraft(l, c("a.ts", i), "f");
    expect(l).toHaveLength(50);
    expect(upsertDraft(l, c("a.ts", 51), "f")).toBe(l);
    expect(upsertDraft(l, c("a.ts", 3, "edited"), "f")[2]!.text).toBe("edited");
  });
  it("removes by key", () => {
    let l = upsertDraft([], c("a.ts", 1), "f");
    l = upsertDraft(l, c("a.ts", 1, "x", "old"), "f");
    l = removeDraft(l, "a.ts", 1, "new");
    expect(l.map((d) => d.side)).toEqual(["old"]);
  });
  it("isTooLong at the 2000 boundary", () => {
    expect(isTooLong("x".repeat(2000))).toBe(false);
    expect(isTooLong("x".repeat(2001))).toBe(true);
  });
  it("hasStaleDraft", () => {
    const l = upsertDraft([], c("a.ts", 1), "f1");
    expect(hasStaleDraft(l, "f1")).toBe(false);
    expect(hasStaleDraft(l, "f2")).toBe(true);
    expect(hasStaleDraft([], "f2")).toBe(false);
  });
});
