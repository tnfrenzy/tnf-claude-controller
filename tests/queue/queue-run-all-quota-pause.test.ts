import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { QueueRunAll } from "../../src/core/queue/queue-runner.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";

function cmd(id: string, status: QueueCommand["status"], position: number): QueueCommand {
  return { id, project: "p", batch: 1, position, title: id, body: "b", bodyOriginal: "b", dependsOn: [], files: [], references: [], warnings: [], source: "manual", sourceRef: null, size: 1, verify: null, status, runId: null, branch: null, estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null } as unknown as QueueCommand;
}

/** Two approved commands; the fake start marks the command running and never finishes it. */
function setup() {
  const list: QueueCommand[] = [cmd("a", "đã duyệt", 1), cmd("b", "đã duyệt", 2)];
  const started: string[] = [];
  const requeued: string[] = [];
  const clock = { t: 1000 };
  const ra = new QueueRunAll({
    list: (p) => (p === "p" ? list : []),
    codingRunningTotal: () => 0,
    maxParallel: () => 1,
    start: async (_p, id) => {
      started.push(id);
      list.find((c) => c.id === id)!.status = "đang chạy";
    },
    requeue: (_p, id) => { requeued.push(id); list.find((c) => c.id === id)!.status = "đã duyệt"; },
    now: () => clock.t,
    retryMs: 0,
  });
  return { ra, list, started, requeued, clock };
}

describe("run-all quota pause", () => {
  it("source file has no NUL bytes", () => {
    const buf = fs.readFileSync(path.resolve(__dirname, "..", "..", "src", "core", "queue", "queue-runner.ts"));
    expect(buf.includes(0)).toBe(false);
  });

  it("pauseUntil returns false when the project is not active", () => {
    const { ra } = setup();
    expect(ra.pauseUntil("p", 5000, "quota", "r1")).toBe(false);
    expect(ra.status("p").pausedUntil).toBeNull();
  });

  it("does not start, requeue or retry while paused", async () => {
    const { ra, list, started, requeued } = setup();
    await ra.start("p");
    expect(started).toEqual(["a"]);
    expect(ra.pauseUntil("p", 5000, "quota", "r1")).toBe(true);
    list[0]!.status = "lỗi";
    await ra.tick("p");
    await ra.tick("p");
    expect(started).toEqual(["a"]);
    expect(requeued).toEqual([]);
    expect(list[0]!.status).toBe("lỗi");
    expect(ra.status("p").active).toBe(true);
  });

  it("reports pause fields in status()", async () => {
    const { ra } = setup();
    await ra.start("p");
    ra.pauseUntil("p", 5000, "quota", "r1");
    const s = ra.status("p");
    expect(s.pausedUntil).toBe(5000);
    expect(s.pauseReason).toBe("quota");
    expect(s.pauseRunId).toBe("r1");
    expect(s.active).toBe(true);
  });

  it("resumes normally once now passes until and clears the pause", async () => {
    const { ra, list, started, clock } = setup();
    await ra.start("p");
    ra.pauseUntil("p", 5000, "quota", "r1");
    list[0]!.status = "đã commit";
    await ra.tick("p");
    expect(started).toEqual(["a"]);
    clock.t = 5000;
    await ra.tick("p");
    expect(started).toEqual(["a", "b"]);
    const s = ra.status("p");
    expect(s.pausedUntil).toBeNull();
    expect(s.pauseReason).toBeNull();
    expect(s.pauseRunId).toBeNull();
  });

  it("stop() clears the pause", async () => {
    const { ra } = setup();
    await ra.start("p");
    ra.pauseUntil("p", 5000, "quota", "r1");
    ra.stop("p");
    expect(ra.status("p").pausedUntil).toBeNull();
    expect(ra.clearPause("p")).toBe(false);
  });

  it("clearPause returns true and the next tick starts commands", async () => {
    const { ra, list, started } = setup();
    await ra.start("p");
    ra.pauseUntil("p", 5000, "quota", "r1");
    list[0]!.status = "đã commit";
    await ra.tick("p");
    expect(started).toEqual(["a"]);
    expect(ra.clearPause("p")).toBe(true);
    await ra.tick("p");
    expect(started).toEqual(["a", "b"]);
  });
});
