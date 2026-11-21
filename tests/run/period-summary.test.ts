import { describe, expect, it } from "vitest";
import { summarizePeriod } from "../../src/core/usage/period-summary.js";
import { ESTIMATE_NOTE } from "../../src/core/queue/queue-budget.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";

type R = { id: string; status: any; created_at: number; cost_usd_est: number };
const run = (id: string, status: string, created_at: number, cost: number): R => ({
  id,
  status,
  created_at,
  cost_usd_est: cost,
});

function cmd(id: string, status: QueueCommand["status"], dependsOn: string[] = []): QueueCommand {
  return {
    id,
    project: "p",
    batch: 1,
    position: 0,
    title: id,
    body: "",
    bodyOriginal: "",
    dependsOn,
    files: [],
    references: [],
    warnings: [],
    source: "manual",
    sourceRef: "",
    ideaTitle: "",
    status,
    runId: null,
    branch: null,
    estCostUsd: 0,
    createdAt: 0,
    updatedAt: 0,
    approvedAt: null,
  };
}

describe("summarizePeriod", () => {
  it("counts done/error/other", () => {
    const s = summarizePeriod({
      from: 0,
      runs: [run("a", "done", 1, 0), run("b", "error", 2, 0), run("c", "running", 3, 0), run("d", "cancelled", 4, 0)],
      queueCommands: [],
    });
    expect(s.counts).toEqual({ done: 1, error: 1, other: 2, total: 4 });
  });

  it("excludes runs outside range, bounds inclusive", () => {
    const s = summarizePeriod({
      from: 10,
      to: 20,
      runs: [run("a", "done", 9, 1), run("b", "done", 10, 1), run("c", "done", 20, 1), run("d", "done", 21, 1)],
      queueCommands: [],
    });
    expect(s.counts.total).toBe(2);
  });

  it("sums cost only in range, ignoring invalid values", () => {
    const s = summarizePeriod({
      from: 10,
      to: 20,
      runs: [
        run("a", "done", 5, 100),
        run("b", "done", 11, 0.1),
        run("c", "done", 12, 0.2),
        run("d", "done", 13, Number.NaN),
        run("e", "done", 14, -3),
        { id: "f", status: "done", created_at: 15, cost_usd_est: null as any },
      ],
      queueCommands: [],
    });
    expect(s.costUsd).toBe(0.3);
  });

  it("lists commands blocked by a failed dependency", () => {
    const withFail = summarizePeriod({
      from: 0,
      runs: [],
      queueCommands: [cmd("x", "lỗi"), cmd("y", "đã duyệt", ["x"]), cmd("z", "đã duyệt")],
    });
    expect(withFail.blocked).toEqual(["y"]);
    const none = summarizePeriod({ from: 0, runs: [], queueCommands: [cmd("z", "đã duyệt")] });
    expect(none.blocked).toEqual([]);
  });

  it("text contains key phrases", () => {
    const s = summarizePeriod({
      from: 0,
      runs: [run("a", "done", 1, 1.5)],
      queueCommands: [cmd("x", "lỗi"), cmd("y-blocked", "đã duyệt", ["x"])],
    });
    expect(s.text).toContain("Xong: 1");
    expect(s.text).toContain("lỗi: 0");
    expect(s.text).toContain("bị chặn");
    expect(s.text).toContain("y-blocked");
    expect(s.text).toContain("$1,50");
    expect(s.text).toContain(ESTIMATE_NOTE);
  });

  it("handles empty input", () => {
    const s = summarizePeriod({ from: 0, runs: [], queueCommands: [] });
    expect(s.counts.total).toBe(0);
    expect(s.costUsd).toBe(0);
    expect(s.text).toContain("Không có lệnh nào bị chặn");
    expect(s.text).toContain(ESTIMATE_NOTE);
  });
});
