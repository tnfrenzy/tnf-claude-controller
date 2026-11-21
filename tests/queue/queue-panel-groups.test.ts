import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { ideaOpen } from "../../ui/src/components/queue/QueuePanel.js";
import { groupByIdea } from "../../ui/src/queue/ideaGroups.js";
import type { QueueCommand } from "../../ui/src/types.js";

const panel = readFileSync("ui/src/components/queue/QueuePanel.tsx", "utf8");
const css = readFileSync("ui/src/styles.css", "utf8");

function cmd(id: string, status: string, sourceRef = "run1"): QueueCommand {
  return { id, project: "controller", status, sourceRef, batch: 1, title: id } as unknown as QueueCommand;
}

describe("ideaOpen (default open state of an idea group)", () => {
  it("a manual choice always wins", () => {
    expect(ideaOpen(true, { counts: {} }, 5)).toBe(true);
    expect(ideaOpen(false, { counts: { "đang chạy": 3 } }, 1)).toBe(false);
  });
  it("the only idea is open; with several, only ones that are running or waiting to merge", () => {
    expect(ideaOpen(undefined, { counts: { "chờ duyệt": 4 } }, 1)).toBe(true);
    expect(ideaOpen(undefined, { counts: { "chờ duyệt": 4 } }, 3)).toBe(false);
    expect(ideaOpen(undefined, { counts: { "đang chạy": 1 } }, 3)).toBe(true);
    expect(ideaOpen(undefined, { counts: { "đã commit": 1 } }, 3)).toBe(true);
  });
});

describe("QueuePanel groups commands by idea and runs everything from the same popup", () => {
  it("groups by idea, then by batch inside each idea", () => {
    const g = groupByIdea([cmd("a", "chờ duyệt", "r1"), cmd("b", "đã gộp", "r1"), cmd("c", "chờ duyệt", "r2")]);
    expect(g.map((x) => x.commands.map((c) => c.id))).toEqual([["a", "b"], ["c"]]);
    expect(panel).toContain("groupByIdea(view.commands)");
    expect(panel).toContain("groupByBatch(active)");
    expect(panel).not.toContain("groupByBatch(ig.commands)");
  });
  it("each idea has approve-all, run-all/stop and history buttons that do not toggle the group", () => {
    expect(panel).toContain("activeCommands(");
    expect(panel).toContain("ideaActions(");
    expect(panel).toContain("api.queueApproveAll");
    expect(panel).toContain("api.queueRunAll(project, ig.key)");
    expect(panel).toContain("IdeaHistoryModal");
    expect(panel).toContain("stopPropagation");
    expect(panel).toContain("t.idea_noActive");
  });
  it("has the run-all and stop buttons wired to the server run-all endpoints", () => {
    expect(panel).toContain('data-testid="queue-runall"');
    expect(panel).toContain("api.queueRunAll(project)");
    expect(panel).toContain("api.queueRunAllStop(project)");
    expect(panel).toContain("runAllButtonState(runAllActive, ideaGroups.length)");
  });
  it("each idea is a collapsible group with its heading and status counts", () => {
    expect(panel).toContain('className="queue-idea-group"');
    expect(panel).toContain("ideaHeading(ig, gi)");
    expect(css).toContain(".queue-idea-group > summary");
    expect(css).toContain(".queue-runall");
  });
});
