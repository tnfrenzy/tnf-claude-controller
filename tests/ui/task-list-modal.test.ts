import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { runAllButtonState } from "../../ui/src/queue/queue";

describe("runAllButtonState", () => {
  it("shows stop while active", () => {
    expect(runAllButtonState(true, 0)).toEqual({ mode: "stop", disabled: false });
  });
  it("disables run when there are no groups", () => {
    expect(runAllButtonState(false, 0)).toEqual({ mode: "run", disabled: true });
  });
  it("enables run when groups exist", () => {
    expect(runAllButtonState(false, 2)).toEqual({ mode: "run", disabled: false });
  });
});

describe("TaskListModal", () => {
  const s = readFileSync(new URL("../../ui/src/components/run/TaskListModal.tsx", import.meta.url), "utf8");
  it("uses details, runAllButtonState and per-command actions", () => {
    for (const k of ["<details", "runAllButtonState", "api.queueApproveRun", "api.queueSkip", "recoveryActions"]) expect(s).toContain(k);
  });
  it("has per-idea approve-all, run-all/stop and history buttons and hides finished tasks", () => {
    for (const k of ["activeCommands(", "ideaActions(", "api.queueApproveAll", "api.queueRunAll(project, g.key)", "IdeaHistoryModal", "stopPropagation", "t.idea_noActive"]) expect(s).toContain(k);
    expect(s).not.toContain("g.commands.map(");
  });
  it("shows compact merge precheck badge next to confirmMerged, with confirm prompt", () => {
    for (const k of ["MergePrecheckBadge", "compact", "shouldShowQueueMergePrecheck(c)", "window.confirm(t.queue_confirmMergedAsk)"]) expect(s).toContain(k);
    expect(s).not.toContain('a !== "confirmMerged"');
  });
});
