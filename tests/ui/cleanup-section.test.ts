import { describe, expect, it } from "vitest";
import { parseDays, skipReasonKey, summarize } from "../../ui/src/settings/cleanupSection";
import type { CleanupCandidate, CleanupPlan } from "../../ui/src/types";

const cand = (runIds: string[]): CleanupCandidate => ({
  runIds, worktreePath: "w", branch: "b", repoPath: "r", baseBranch: "main", estimatedBytes: 10,
});

describe("parseDays", () => {
  it("accepts whole numbers", () => {
    expect(parseDays("0")).toBe(0);
    expect(parseDays("7")).toBe(7);
    expect(parseDays(" 30 ")).toBe(30);
  });
  it("rejects bad input", () => {
    for (const s of ["", "  ", "-1", "abc", "1.5", "1e3"]) expect(parseDays(s)).toBeNull();
  });
});

describe("skipReasonKey", () => {
  const all = ["active", "no_worktree", "no_branch", "no_project", "too_recent", "shared_worktree", "outside_worktrees_dir", "missing", "uncommitted", "unmerged", "status_unknown", "error"];
  it("maps all 12 reasons", () => {
    expect(all).toHaveLength(12);
    for (const r of all) expect(skipReasonKey(r)).toBe(`cleanup_skip_${r}`);
  });
  it("falls back for unknown", () => {
    expect(skipReasonKey("foo")).toBe("cleanup_skip_other");
    expect(skipReasonKey("toString")).toBe("cleanup_skip_other");
  });
});

describe("summarize", () => {
  it("empty plan", () => {
    expect(summarize({ candidates: [], skipped: [], totalBytes: 0 })).toEqual({ n: 0, totalBytes: 0 });
  });
  it("counts runs not candidates", () => {
    const plan: CleanupPlan = { candidates: [cand(["a"]), cand(["b", "c", "d"])], skipped: [], totalBytes: 20 };
    expect(plan.candidates.length).toBe(2);
    expect(summarize(plan)).toEqual({ n: 4, totalBytes: 20 });
  });
});
