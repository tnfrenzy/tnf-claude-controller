import { describe, expect, it } from "vitest";
import fs from "node:fs";

const read = (p: string) => fs.readFileSync(p, "utf8");

describe("queue runs live in the history popup", () => {
  it("history requests queue=only/exclude and shows the queue list in the queue tab", () => {
    const src = read("ui/src/pages/HistoryPage.tsx");
    expect(src).toContain('queue: tab === "queue" ? "only" : "exclude"');
    expect(src).toContain("<TaskListModal project={qProject}");
  });
  it("env row has no queue-list button; the queue tab lives in history", () => {
    const src = read("ui/src/components/LeftPanel.tsx");
    expect(src).not.toContain("queue_history_btn");
    expect(src).not.toContain("setTaskListOpen");
  });
  it("server filters runs by queue membership", () => {
    const src = read("src/server/http.ts");
    expect(src).toContain('queueMode === "only" || queueMode === "exclude"');
    expect(src).toContain("function queueRunIdSet");
  });
});
