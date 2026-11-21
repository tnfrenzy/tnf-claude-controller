import { describe, expect, it } from "vitest";
import { pickLatestRun } from "../../ui/src/office/useProjectRun.js";

const r = (id: string, project: string, status: string, created_at: number) => ({ id, project, status, created_at });

describe("pickLatestRun", () => {
  it("picks the newest running run of the project", () => {
    const runs = [r("a", "p", "running", 1), r("b", "p", "running", 5), r("c", "q", "running", 9), r("d", "p", "done", 20)];
    expect(pickLatestRun(runs, "p")?.id).toBe("b");
  });
  it("returns null when nothing is running", () => {
    expect(pickLatestRun([r("a", "p", "done", 1)], "p")).toBeNull();
    expect(pickLatestRun([], "p")).toBeNull();
  });
  it("empty project matches the shared default floor", () => {
    const runs = [r("a", "", "running", 1), r("b", "x", "running", 2)];
    expect(pickLatestRun(runs, "")?.id).toBe("a");
    expect(pickLatestRun(runs, "default")?.id).toBe("a");
  });
});
