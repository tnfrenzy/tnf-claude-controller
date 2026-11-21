import { describe, expect, it } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";
import { groupByIdea, ideasNewestFirst } from "../../ui/src/queue/ideaGroups";
import type { QueueCommand } from "../../ui/src/types";

function mk(store: RunStore, id: string, parent: string | null, project = "p", at = 0) {
  store.createRun({ id, status: "done", prompt: id, mode: "m", model: null, session_id: null, parent_run_id: parent, project, claude_version: null, run_dir: `D:/x/${id}` });
  void at;
}

describe("run store: light queries for the queue and history", () => {
  it("runLinks returns id and parent of a project's runs only", () => {
    const s = new RunStore(":memory:");
    mk(s, "a", null);
    mk(s, "b", "a");
    mk(s, "z", null, "other");
    const links = s.runLinks("p");
    expect(links.map((l) => `${l.id}<-${l.parent_run_id}`).sort()).toEqual(["a<-null", "b<-a"]);
    s.close();
  });
  it("ids / notIds filter in SQL, with matching totals", () => {
    const s = new RunStore(":memory:");
    for (const id of ["a", "b", "c", "d"]) mk(s, id, null);
    expect(s.listRuns({ ids: ["b", "c"] }).map((r) => r.id).sort()).toEqual(["b", "c"]);
    expect(s.countRuns({ ids: ["b", "c"] })).toBe(2);
    expect(s.listRuns({ ids: [] })).toEqual([]);
    expect(s.countRuns({ ids: [] })).toBe(0);
    expect(s.listRuns({ notIds: ["a", "d"] }).map((r) => r.id).sort()).toEqual(["b", "c"]);
    expect(s.countRuns({ notIds: [] })).toBe(4);
    expect(s.listRuns({ notIds: ["a"], limit: 1 })).toHaveLength(1);
    s.close();
  });
});

function cmd(id: string, ref: string | null, createdAt: number): QueueCommand {
  return { id, project: "p", sourceRef: ref, createdAt, status: "chờ duyệt" } as unknown as QueueCommand;
}

describe("ideas are listed newest first", () => {
  it("puts the newest idea on top, keeps its number, and leaves 'Khác' last", () => {
    const groups = groupByIdea([cmd("a1", "i1", 10), cmd("o", null, 5), cmd("b1", "i2", 30), cmd("a2", "i1", 20), cmd("c1", "i3", 25)]);
    const sorted = ideasNewestFirst(groups);
    expect(sorted.map((g) => g.key)).toEqual(["i2", "i3", "i1", ""]);
    expect(sorted.map((g) => g.ordinal)).toEqual([2, 3, 1, 0]);
    // does not mutate the input
    expect(groups.map((g) => g.key)).toEqual(["i1", "", "i2", "i3"]);
  });
});
