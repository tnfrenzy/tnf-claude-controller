import { describe, it, expect } from "vitest";
import { shouldShowMergePrecheck } from "../../ui/src/run/mergePrecheckVisible";

describe("shouldShowMergePrecheck", () => {
  it("true for coding + branch + merged false", () => {
    expect(shouldShowMergePrecheck({ kind: "coding", branch: "tnf/x", merged: false })).toBe(true);
  });
  it("false when merged", () => {
    expect(shouldShowMergePrecheck({ kind: "coding", branch: "tnf/x", merged: true })).toBe(false);
  });
  it("false when merged undefined", () => {
    expect(shouldShowMergePrecheck({ kind: "coding", branch: "tnf/x" })).toBe(false);
  });
  it("false when branch empty or null", () => {
    expect(shouldShowMergePrecheck({ kind: "coding", branch: "", merged: false })).toBe(false);
    expect(shouldShowMergePrecheck({ kind: "coding", branch: null, merged: false })).toBe(false);
  });
  it("false for research", () => {
    expect(shouldShowMergePrecheck({ kind: "research", branch: "b", merged: false })).toBe(false);
  });
  it("false for null/undefined", () => {
    expect(shouldShowMergePrecheck(null)).toBe(false);
    expect(shouldShowMergePrecheck(undefined)).toBe(false);
  });
});
