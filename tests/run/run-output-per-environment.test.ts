import { describe, expect, it } from "vitest";
import path from "node:path";
import { projectSlug, runBranchName, runWorktreePath } from "../../src/core/git/git.js";

describe("per-environment run output", () => {
  it("puts the worktree inside the environment folder and names the branch after it", () => {
    expect(runWorktreePath("W", "controller", "20261102-1-abc")).toBe(path.join("W", "controller", "20261102-1-abc"));
    expect(runBranchName("controller", "20261102-1-abc")).toBe("tnf/controller/20261102-1-abc");
  });
  it("keeps environments apart", () => {
    expect(runBranchName("Platform", "r1")).not.toBe(runBranchName("controller", "r1"));
  });
  it("makes safe slugs from Vietnamese or odd names", () => {
    expect(projectSlug("Huấn luyện AI")).toBe("huan-luyen-ai");
    expect(projectSlug("../x y")).toBe("x-y");
    expect(projectSlug("???")).toBe("default");
  });
});
