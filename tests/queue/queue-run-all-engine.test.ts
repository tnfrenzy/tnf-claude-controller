import { describe, it, expect } from "vitest";
import { pickRunAll, blockedByFailure, isUnlockedForRunAll, pickIdeaNext } from "../../src/core/queue/queue-engine.js";
import { QUEUE_MAX_PARALLEL_CEILING } from "../../src/core/app/config.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";
import { QueueRunAll } from "../../src/core/queue/queue-runner.js";

describe("pickIdeaNext", () => {
  const A = "idea-A";
  const B = "idea-B";
  it("picks the smallest (batch, position) approved command of the idea", () => {
    const a2 = mk("a2", { sourceRef: A, batch: 2, position: 0 });
    const a1 = mk("a1", { sourceRef: A, batch: 1, position: 1 });
    const a0 = mk("a0", { sourceRef: A, batch: 1, position: 0, status: "chờ duyệt" });
    expect(pickIdeaNext([a2, a1, a0], A, 0)?.id).toBe("a1");
  });
  it("ignores commands of other ideas", () => {
    const b = mk("b", { sourceRef: B, position: 0 });
    const a = mk("a", { sourceRef: A, position: 5 });
    expect(pickIdeaNext([b, a], A, 0)?.id).toBe("a");
    expect(pickIdeaNext([b], A, 0)).toBeNull();
  });
  it("returns null while a command of the idea is running", () => {
    const r = mk("r", { sourceRef: A, status: "đang chạy" });
    const a = mk("a", { sourceRef: A, position: 1 });
    expect(pickIdeaNext([r, a], A, 1)).toBeNull();
    const other = mk("o", { sourceRef: B, status: "đang chạy" });
    expect(pickIdeaNext([other, a], A, 1)?.id).toBe("a");
  });
  it("skips commands with uncommitted dependencies and picks the next", () => {
    const dep = mk("dep", { sourceRef: B, status: "đã duyệt" });
    const a1 = mk("a1", { sourceRef: A, position: 0, dependsOn: ["dep"] });
    const a2 = mk("a2", { sourceRef: A, position: 1 });
    expect(pickIdeaNext([dep, a1, a2], A, 0)?.id).toBe("a2");
    const done = { ...dep, status: "đã commit" as const };
    expect(pickIdeaNext([done, a1, a2], A, 0)?.id).toBe("a1");
  });
  it("returns null at the global coding ceiling", () => {
    const a = mk("a", { sourceRef: A });
    expect(pickIdeaNext([a], A, QUEUE_MAX_PARALLEL_CEILING)).toBeNull();
    expect(pickIdeaNext([a], A, QUEUE_MAX_PARALLEL_CEILING - 1)?.id).toBe("a");
  });
  it("returns null for an empty sourceRef", () => {
    const a = mk("a", { sourceRef: "" });
    expect(pickIdeaNext([a], "", 0)).toBeNull();
  });
});

function mk(id: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return {
    id, project: "p", batch: 1, position: 0, title: id, body: `body ${id}`, bodyOriginal: `body ${id}`,
    dependsOn: [], files: [`src/${id}.ts`], status: "đã duyệt", runId: null, branch: null,
    estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null, ...over,
  };
}
const ids = (l: QueueCommand[]) => l.map((c) => c.id);

describe("pickRunAll", () => {
  it("chain A->B->C picks only A, then B after A committed", () => {
    const a = mk("a", { position: 0 });
    const b = mk("b", { position: 1, dependsOn: ["a"] });
    const c = mk("c", { position: 2, dependsOn: ["b"] });
    expect(ids(pickRunAll([a, b, c], 0, 0))).toEqual(["a"]);
    const a2 = { ...a, status: "đã commit" as const };
    expect(ids(pickRunAll([a2, b, c], 0, 0))).toEqual(["b"]);
  });
  it("two independent plus one dependent picks exactly two", () => {
    const a = mk("a", { position: 0 });
    const b = mk("b", { position: 1 });
    const c = mk("c", { position: 2, dependsOn: ["a"] });
    expect(ids(pickRunAll([a, b, c], 0, 0))).toEqual(["a", "b"]);
    const d = mk("d", { position: 3 });
    expect(pickRunAll([a, b, d], 0, 0)).toHaveLength(2);
  });
  it("runningInProject=1 picks one", () => {
    const run = mk("r", { status: "đang chạy" });
    const a = mk("a", { position: 0 });
    const b = mk("b", { position: 1 });
    expect(ids(pickRunAll([run, a, b], 1, 1))).toEqual(["a"]);
  });
  it("controller-wide ceiling limits picks", () => {
    const a = mk("a");
    const b = mk("b", { position: 1 });
    expect(pickRunAll([a, b], QUEUE_MAX_PARALLEL_CEILING, 0)).toEqual([]);
    expect(ids(pickRunAll([a, b], QUEUE_MAX_PARALLEL_CEILING - 1, 0))).toEqual(["a"]);
  });
  it("commands touching the same file do not run together", () => {
    const a = mk("a", { files: ["src/x.ts"] });
    const b = mk("b", { position: 1, files: ["src/x.ts"] });
    expect(ids(pickRunAll([a, b], 0, 0))).toEqual(["a"]);
  });
  it("failed A blocks B,C; independent D still picked", () => {
    const a = mk("a", { status: "lỗi" });
    const b = mk("b", { dependsOn: ["a"] });
    const c = mk("c", { dependsOn: ["b"] });
    const d = mk("d", { position: 3 });
    const all = [a, b, c, d];
    expect(blockedByFailure(all).sort()).toEqual(["b", "c"]);
    expect(ids(pickRunAll(all, 0, 0))).toEqual(["d"]);
  });
  it("is independent of project maxParallel (still 2)", () => {
    expect(pickRunAll([mk("a"), mk("b", { position: 1 })], 0, 0)).toHaveLength(2);
  });
  const three = () => [mk("a"), mk("b", { position: 1 }), mk("c", { position: 2 })];
  it("maxParallel=3 picks three independent commands", () => {
    expect(ids(pickRunAll(three(), 0, 0, 3))).toEqual(["a", "b", "c"]);
  });
  it("maxParallel=2 picks two of the same data", () => {
    expect(pickRunAll(three(), 0, 0, 2)).toHaveLength(2);
  });
  it("maxParallel=3 with one running in project picks at most two", () => {
    const run = mk("r", { status: "đang chạy", files: ["src/r.ts"] });
    expect(pickRunAll([run, ...three()], 1, 1, 3)).toHaveLength(2);
  });
  it("maxParallel=3 still limited by global ceiling", () => {
    expect(pickRunAll(three(), QUEUE_MAX_PARALLEL_CEILING - 1, 0, 3)).toHaveLength(1);
  });
  it("maxParallel=3 does not pick conflicting commands together", () => {
    const a = mk("a", { files: ["src/x.ts"] });
    const b = mk("b", { position: 1, files: ["src/x.ts"] });
    const c = mk("c", { position: 2 });
    expect(ids(pickRunAll([a, b, c], 0, 0, 3))).toEqual(["a", "c"]);
  });
  it("maxParallel=1 picks one", () => {
    expect(pickRunAll(three(), 0, 0, 1)).toHaveLength(1);
  });
});

describe("isUnlockedForRunAll / blockedByFailure", () => {
  it("committed or merged unlock; failed, skipped, missing block", () => {
    const mkDep = (s: QueueCommand["status"]) => [mk("a", { status: s }), mk("b", { dependsOn: ["a"] })];
    expect(isUnlockedForRunAll(mkDep("đã commit")[1], mkDep("đã commit"))).toBe(true);
    expect(isUnlockedForRunAll(mkDep("đã gộp")[1], mkDep("đã gộp"))).toBe(true);
    expect(isUnlockedForRunAll(mkDep("lỗi")[1], mkDep("lỗi"))).toBe(false);
    expect(isUnlockedForRunAll(mkDep("bỏ qua")[1], mkDep("bỏ qua"))).toBe(false);
    const orphan = mk("o", { dependsOn: ["zzz"] });
    expect(isUnlockedForRunAll(orphan, [orphan])).toBe(false);
    expect(blockedByFailure([orphan])).toEqual(["o"]);
  });
  it("nothing blocked when deps are merely pending", () => {
    const a = mk("a");
    const b = mk("b", { dependsOn: ["a"] });
    expect(blockedByFailure([a, b])).toEqual([]);
  });
});

describe("pickRunAll scoped to one idea", () => {
  const A = "idea-A";
  const B = "idea-B";
  it("runs independent tasks of the same idea in parallel and ignores other ideas", () => {
    const a1 = mk("a1", { sourceRef: A, position: 0 });
    const a2 = mk("a2", { sourceRef: A, position: 1 });
    const b1 = mk("b1", { sourceRef: B, position: 0 });
    expect(ids(pickRunAll([a1, a2, b1], 0, 0, 3, undefined, A))).toEqual(["a1", "a2"]);
  });
  it("keeps dependent tasks of the idea waiting and respects file conflicts", () => {
    const a1 = mk("a1", { sourceRef: A, position: 0 });
    const a2 = mk("a2", { sourceRef: A, position: 1, dependsOn: ["a1"] });
    const a3 = mk("a3", { sourceRef: A, position: 2, files: a1.files });
    expect(ids(pickRunAll([a1, a2, a3], 0, 0, 3, undefined, A))).toEqual(["a1"]);
  });
});

describe("QueueRunAll launch failures", () => {
  it("stops after 3 failed launches and keeps the error", async () => {
    let calls = 0;
    const ra = new QueueRunAll({
      list: () => [mk("a")],
      codingRunningTotal: () => 0,
      start: async () => { calls++; throw new Error("boom"); },
      retryMs: 0,
    });
    await ra.start("p");
    expect(ra.isActive("p")).toBe(true);
    await ra.tick("p");
    expect(ra.isActive("p")).toBe(true);
    await ra.tick("p");
    expect(calls).toBe(3);
    expect(ra.isActive("p")).toBe(false);
    expect(ra.status("p").lastError).toBe("boom");
    await ra.tick("p");
    expect(calls).toBe(3);
  });

  it("keeps going when launch fails twice then succeeds", async () => {
    let calls = 0;
    const ra = new QueueRunAll({
      list: () => [mk("a")],
      codingRunningTotal: () => 0,
      start: async () => { calls++; if (calls <= 2) throw new Error("boom"); },
      retryMs: 0,
    });
    await ra.start("p");
    await ra.tick("p");
    await ra.tick("p");
    expect(calls).toBe(3);
    expect(ra.isActive("p")).toBe(true);
    expect(ra.status("p").lastError).toBeNull();
  });

  it("resets the failure counter when a new run-all starts", async () => {
    let calls = 0;
    const ra = new QueueRunAll({
      list: () => [mk("a")],
      codingRunningTotal: () => 0,
      start: async () => { calls++; throw new Error("boom"); },
      retryMs: 0,
    });
    await ra.start("p");
    await ra.tick("p");
    await ra.tick("p");
    expect(ra.isActive("p")).toBe(false);
    await ra.start("p");
    expect(ra.isActive("p")).toBe(true);
    await ra.tick("p");
    await ra.tick("p");
    expect(calls).toBe(6);
    expect(ra.isActive("p")).toBe(false);
  });
});
