import { describe, expect, it } from "vitest";
import { buildFollowupPrompt, patchFingerprint, planSubmit, type DraftComment } from "../../ui/src/run/diffComments";
import { allowedFilesOf } from "../../ui/src/run/diffCommentSubmit";

const mk = (file: string) =>
  `diff --git a/${file} b/${file}\n--- a/${file}\n+++ b/${file}\n@@ -1,1 +1,1 @@\n-a\n+b\n`;

describe("allowedFilesOf", () => {
  it("merges patches and dedupes", () => {
    const files = allowedFilesOf(mk("a.ts") + mk("b.ts"), mk("b.ts") + mk("c.ts"));
    expect(files.sort()).toEqual(["a.ts", "b.ts", "c.ts"]);
  });
  it("skips empty and undefined", () => {
    expect(allowedFilesOf("", undefined, mk("a.ts"))).toEqual(["a.ts"]);
  });
});

describe("planSubmit", () => {
  const fp = patchFingerprint("x");
  const d = (file: string, fingerprint = fp): DraftComment => ({ file, line: 1, side: "new", text: "fix", fingerprint });
  it("reports files outside the allowed list", () => {
    const r = planSubmit({ drafts: [d("z.ts")], allowedFiles: ["a.ts"], currentFingerprint: fp });
    expect(r.errors.length).toBe(1);
  });
  it("flags stale when fingerprint differs", () => {
    expect(planSubmit({ drafts: [d("a.ts", "other")], allowedFiles: ["a.ts"], currentFingerprint: fp }).stale).toBe(true);
    expect(planSubmit({ drafts: [d("a.ts")], allowedFiles: ["a.ts"], currentFingerprint: fp }).stale).toBe(false);
  });
  it("strips fingerprint and matches buildFollowupPrompt", () => {
    const r = planSubmit({ drafts: [d("a.ts")], allowedFiles: ["a.ts"], currentFingerprint: fp });
    expect(r.errors).toEqual([]);
    expect(r.comments[0]).toEqual({ file: "a.ts", line: 1, side: "new", text: "fix" });
    expect(r.prompt).toBe(buildFollowupPrompt(r.comments));
  });
});
