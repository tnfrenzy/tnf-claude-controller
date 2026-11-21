import { describe, expect, it } from "vitest";
import { shouldShowQueueMergePrecheck } from "../../ui/src/run/mergePrecheckVisible.js";
import type { MergePrecheck } from "../../ui/src/types.js";

const mk = (status: string) => ({ status, files: [], checked_at: 1 }) as unknown as MergePrecheck;

describe("shouldShowQueueMergePrecheck", () => {
  it("is true for committed command with any precheck", () => {
    for (const s of ["clean", "conflict", "unknown"]) {
      expect(shouldShowQueueMergePrecheck({ status: "đã commit", mergePrecheck: mk(s) })).toBe(true);
    }
  });
  it("is false without precheck", () => {
    expect(shouldShowQueueMergePrecheck({ status: "đã commit", mergePrecheck: null })).toBe(false);
    expect(shouldShowQueueMergePrecheck({ status: "đã commit" })).toBe(false);
  });
  it("is false for other statuses", () => {
    expect(shouldShowQueueMergePrecheck({ status: "đang chạy", mergePrecheck: mk("clean") })).toBe(false);
    expect(shouldShowQueueMergePrecheck({ status: "đã xong", mergePrecheck: mk("clean") })).toBe(false);
  });
  it("is false for null/undefined", () => {
    expect(shouldShowQueueMergePrecheck(null)).toBe(false);
    expect(shouldShowQueueMergePrecheck(undefined)).toBe(false);
  });
});
