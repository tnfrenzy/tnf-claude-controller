import { describe, expect, it } from "vitest";
import { QueueRunAll } from "../../src/core/queue/queue-runner.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";
import { ideaCommitRunId, taskStatusLabel, type IdeaGroup } from "../../ui/src/queue/ideaGroups";

function cmd(id: string, status: QueueCommand["status"], extra: Partial<QueueCommand> = {}): QueueCommand {
  return { id, project: "p", batch: 1, position: 1, title: id, body: "b", bodyOriginal: "b", dependsOn: [], files: [], references: [], warnings: [], source: "manual", sourceRef: null, size: 1, verify: null, status, runId: null, branch: null, estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null, ...extra } as unknown as QueueCommand;
}

describe("run-all automatic retry", () => {
  it("requeues a failed command up to maxRetries, then leaves it failed", async () => {
    const list: QueueCommand[] = [cmd("a", "lỗi")];
    const requeued: string[] = [];
    const ra = new QueueRunAll({
      list: () => list,
      codingRunningTotal: () => 0,
      start: async () => { list[0]!.status = "lỗi"; },
      requeue: (_p, id) => { requeued.push(id); list[0]!.status = "đã duyệt"; },
      maxRetries: 2,
      retryMs: 0,
    });
    list[0]!.status = "đã duyệt";
    await ra.start("p");
    for (let i = 0; i < 6; i++) await ra.tick("p");
    expect(requeued).toEqual(["a", "a"]);
    expect(list[0]!.status).toBe("lỗi");
  });
});

describe("idea commit helpers", () => {
  it("shows done tasks as hoàn tất", () => {
    expect(taskStatusLabel("đã commit")).toBe("hoàn tất");
    expect(taskStatusLabel("lỗi")).toBe("lỗi");
  });
  it("picks the newest finished run of an idea", () => {
    const g = { key: "k", title: "t", project: "p", other: false, ordinal: 1, counts: {}, commands: [cmd("a", "đã commit", { position: 1, runId: "r1" } as never), cmd("b", "đã commit", { position: 2, runId: "r2" } as never), cmd("c", "đã duyệt", { position: 3 } as never)] } as unknown as IdeaGroup;
    expect(ideaCommitRunId(g)).toBe("r2");
  });
});
