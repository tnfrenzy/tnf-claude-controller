import { describe, expect, it } from "vitest";
import { floorsFromRuns } from "../../ui/src/office/iso/floors";

const run = (id: string, project: string, status: string, created_at: number) => ({ id, project, status, created_at });

describe("floorsFromRuns", () => {
  it("always has the shared floor, idle when there are no runs", () => {
    expect(floorsFromRuns([])).toEqual([{ project: "default", number: 1, runId: null, running: false }]);
  });
  it("groups by project and picks the newest running run", () => {
    const f = floorsFromRuns([
      run("a", "alpha", "running", 10),
      run("b", "alpha", "running", 20),
      run("c", "alpha", "done", 30),
      run("d", "beta", "done", 5),
    ]);
    expect(f.map((x) => x.project)).toEqual(["default", "alpha", "beta"]);
    expect(f[1]).toMatchObject({ runId: "b", running: true, number: 2 });
    expect(f[2]).toMatchObject({ runId: null, running: false });
  });
  it("puts runs without a project on the shared floor", () => {
    const f = floorsFromRuns([run("x", "default", "running", 1), run("y", "", "running", 2)]);
    expect(f).toHaveLength(1);
    expect(f[0]).toMatchObject({ project: "default", runId: "y", running: true });
  });
});
