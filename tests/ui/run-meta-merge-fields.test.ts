import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

describe("RunMeta merge fields", () => {
  it("declares merged and merge_precheck", () => {
    const src = readFileSync("ui/src/api.ts", "utf8");
    const m = /export interface RunMeta \{[\s\S]*?\n\}/.exec(src);
    expect(m).not.toBeNull();
    expect(m![0]).toContain("merged?: boolean");
    expect(m![0]).toContain("merge_precheck?: MergePrecheck | null");
  });
});
