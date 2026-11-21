import { describe, expect, it } from "vitest";
import { effectiveKind } from "../../ui/src/run/runKind.js";

describe("run kind inference", () => {
  it("project with a repo is coding", () => {
    expect(effectiveKind(true)).toBe("coding");
  });
  it("no project or no repo is research", () => {
    expect(effectiveKind(false)).toBe("research");
  });
});
