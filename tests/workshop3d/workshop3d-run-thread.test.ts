import { describe, it, expect } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";

function mk(store: RunStore, id: string, prompt: string, forked: string | null = null) {
  store.createRun({ id, status: "done", prompt, mode: "x", model: "sonnet", session_id: null, parent_run_id: null, project: "workshop3d", claude_version: null, run_dir: "d", forked_from_run_id: forked });
}

describe("groupWorkshopRuns", () => {
  it("puts the role calls of one session in one thread, and a second session in its own", () => {
    const store = new RunStore(":memory:");
    mk(store, "r1", "x C:/d/workshop3d/20261113-013151-b8296a/inbox/a.jpg");
    mk(store, "r2", "no path in this one");
    mk(store, "r3", "y C:/d/workshop3d/20261113-013151-b8296a/renders/a.png");
    mk(store, "r4", "z C:/d/workshop3d/20261114-010000-aaaaaa/inbox/a.jpg");
    expect(store.groupWorkshopRuns()).toBe(2);
    expect(store.groupWorkshopRuns()).toBe(0);
    const { runs, total } = store.listRunThreads({});
    expect(total).toBe(2);
    expect(runs.filter((r) => r.forked_from_run_id === "r1").map((r) => r.id).sort()).toEqual(["r2", "r3"]);
    expect(runs.find((r) => r.id === "r4")!.forked_from_run_id).toBeNull();
  });
});
