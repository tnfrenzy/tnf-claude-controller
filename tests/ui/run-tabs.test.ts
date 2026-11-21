import { describe, expect, it } from "vitest";
import { normalizeTab, runTabIds } from "../../ui/src/run/runTabs";

describe("run tabs", () => {
  it("coding run has five tabs in order", () => {
    expect(runTabIds(true)).toEqual(["timeline", "result", "changes", "preview", "details"]);
    expect(normalizeTab("preview")).toBe("preview");
  });
  it("research run hides changes", () => {
    expect(runTabIds(false)).toEqual(["timeline", "result", "details"]);
  });
  it("maps old tabs to new", () => {
    expect(normalizeTab("report")).toBe("result");
    expect(normalizeTab("diff")).toBe("changes");
    expect(normalizeTab("test")).toBe("changes");
    expect(normalizeTab("env")).toBe("details");
    expect(normalizeTab("files")).toBe("details");
    expect(normalizeTab("bogus")).toBe("timeline");
    expect(normalizeTab(undefined)).toBe("timeline");
  });
});
