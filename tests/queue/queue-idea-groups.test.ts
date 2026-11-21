import { describe, it, expect } from "vitest";
import { activeCommands, groupByIdea, historyCommands, ideaActions, ideaHeading, isHistoryStatus } from "../../ui/src/queue/ideaGroups";
import type { QueueCommand, QueueRunAllState } from "../../ui/src/types";

function cmd(id: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return {
    id, project: "a", batch: 1, position: 1, title: id, body: "", bodyOriginal: "", dependsOn: [], files: [],
    references: [], warnings: [], source: "manual", sourceRef: "r1", ideaTitle: "", status: "chờ duyệt",
    runId: null, branch: null, estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null, ...over,
  };
}

describe("groupByIdea", () => {
  it("two ideas in the same environment keep order and commands", () => {
    const g = groupByIdea([
      cmd("1", { sourceRef: "r1", ideaTitle: "Nút X" }),
      cmd("2", { sourceRef: "r2", ideaTitle: "Nút Y" }),
      cmd("3", { sourceRef: "r1", ideaTitle: "Nút X" }),
    ]);
    expect(g.map((x) => x.title)).toEqual(["Nút X", "Nút Y"]);
    expect(g[0]!.commands.map((c) => c.id)).toEqual(["1", "3"]);
    expect(g[1]!.commands.map((c) => c.id)).toEqual(["2"]);
  });
  it("commands without sourceRef go to Khác", () => {
    const g = groupByIdea([cmd("1", { sourceRef: "" }), cmd("2", { sourceRef: "r2", ideaTitle: "Y" })]);
    expect(g[0]!.title).toBe("Khác");
    expect(g[1]!.title).toBe("Y");
    expect(ideaHeading(g[1]!, 1)).toBe("Ý tưởng 1 - a");
  });
  it("missing ideaTitle falls back to Ý tưởng N", () => {
    const g = groupByIdea([cmd("1", { ideaTitle: "A" }), cmd("2", { sourceRef: "r2", ideaTitle: undefined })]);
    expect(g[1]!.title).toBe("Ý tưởng 2");
  });
  it("environments never mix groups", () => {
    const g = groupByIdea([cmd("1", { project: "a" }), cmd("2", { project: "b" })]);
    expect(g).toHaveLength(2);
    expect(g.map((x) => x.project)).toEqual(["a", "b"]);
    expect(ideaHeading(g[1]!, 1)).toBe("Ý tưởng 2 - b");
  });
  it("counts by status", () => {
    const g = groupByIdea([cmd("1", { status: "đã duyệt" }), cmd("2", { status: "đã duyệt" }), cmd("3", { status: "lỗi" })]);
    expect(g[0]!.counts).toEqual({ "đã duyệt": 2, "lỗi": 1 });
  });
});

const ra = (over: Partial<QueueRunAllState> = {}): QueueRunAllState => ({
  active: false, running: [], committed: [], failed: [], blocked: [], lastError: null, sourceRef: null, ...over,
});

describe("activeCommands / historyCommands", () => {
  const g = groupByIdea([
    cmd("1", { status: "chờ duyệt" }),
    cmd("2", { status: "đã commit", runIds: ["r-2"] }),
    cmd("3", { status: "lỗi", runIds: ["r-3"] }),
    cmd("4", { status: "đã gộp" }),
    cmd("5", { status: "bỏ qua" }),
    cmd("6", { status: "đang chạy" }),
    cmd("7", { status: "lỗi" }),
  ])[0]!;
  it("activeCommands drops đã commit/đã gộp/bỏ qua and keeps lỗi", () => {
    expect(activeCommands(g).map((c) => c.id)).toEqual(["1", "3", "6", "7"]);
    expect(isHistoryStatus("đã gộp")).toBe(true);
    expect(isHistoryStatus("lỗi")).toBe(false);
  });
  it("historyCommands has finished commands plus any command that ran", () => {
    expect(historyCommands(g).map((c) => c.id)).toEqual(["2", "3", "4", "5"]);
  });
});

describe("ideaActions", () => {
  it("Khác group disables approve/run all", () => {
    const g = groupByIdea([cmd("1", { sourceRef: "", status: "đã duyệt" })])[0]!;
    const a = ideaActions(g, ra());
    expect(a.approveAll.disabled).toBe(true);
    expect(a.runAll.disabled).toBe(true);
  });
  it("only pending: approve enabled, run disabled", () => {
    const g = groupByIdea([cmd("1")])[0]!;
    const a = ideaActions(g);
    expect(a.approveAll.disabled).toBe(false);
    expect(a.runAll).toEqual({ mode: "run", disabled: true });
    expect(a.historyCount).toBe(0);
  });
  it("approved: run enabled, approve disabled", () => {
    const g = groupByIdea([cmd("1", { status: "đã duyệt" }), cmd("2", { status: "đã commit" })])[0]!;
    const a = ideaActions(g, ra());
    expect(a.approveAll.disabled).toBe(true);
    expect(a.runAll).toEqual({ mode: "run", disabled: false });
    expect(a.historyCount).toBe(1);
  });
  it("run-all active for this idea gives stop", () => {
    const g = groupByIdea([cmd("1", { status: "đang chạy" })])[0]!;
    expect(ideaActions(g, ra({ active: true, sourceRef: "r1" })).runAll).toEqual({ mode: "stop", disabled: false });
  });
  it("run-all active for another idea or whole project gives busy", () => {
    const g = groupByIdea([cmd("1", { status: "đã duyệt" })])[0]!;
    expect(ideaActions(g, ra({ active: true, sourceRef: "r2" })).runAll).toEqual({ mode: "busy", disabled: true });
    expect(ideaActions(g, ra({ active: true, sourceRef: null })).runAll).toEqual({ mode: "busy", disabled: true });
  });
});
