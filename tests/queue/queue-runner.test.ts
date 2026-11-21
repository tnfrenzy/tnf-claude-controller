import { describe, it, expect } from "vitest";
import { QUEUE_MAX_PARALLEL_CEILING } from "../../src/core/app/config.js";
import { QueueRunAll } from "../../src/core/queue/queue-runner.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";

function mk(id: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return {
    id, project: "p", batch: 1, position: 0, title: id, body: `body ${id}`, bodyOriginal: `body ${id}`,
    dependsOn: [], files: [`src/${id}.ts`], status: "đã duyệt", runId: null, branch: null,
    estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null, ...over,
  };
}

function setup(
  cmds: QueueCommand[],
  failStart: () => boolean = () => false,
  extra: { maxParallel?: () => number; codingRunningTotal?: () => number } = {},
) {
  const started: string[] = [];
  const r = new QueueRunAll({
    list: () => cmds,
    codingRunningTotal: extra.codingRunningTotal ?? (() => cmds.filter((c) => c.status === "đang chạy").length),
    ...(extra.maxParallel ? { maxParallel: extra.maxParallel } : {}),
    start: async (_p, id) => {
      if (failStart()) throw new Error("hết slot");
      await Promise.resolve();
      cmds.find((c) => c.id === id)!.status = "đang chạy";
      started.push(id);
    },
    retryMs: 0,
  });
  const set = (id: string, s: QueueCommand["status"]) => (cmds.find((c) => c.id === id)!.status = s);
  return { r, started, set, cmds };
}

describe("QueueRunAll", () => {
  it("3 independent commands: at most 2 at once, third after one finishes", async () => {
    const { r, started, set } = setup([mk("a", { position: 0 }), mk("b", { position: 1 }), mk("c", { position: 2 })]);
    await r.start("p");
    expect(started).toEqual(["a", "b"]);
    expect(r.isActive("p")).toBe(true);
    set("a", "đã commit");
    await r.tickAll();
    expect(started).toEqual(["a", "b", "c"]);
    set("b", "đã commit");
    set("c", "đã commit");
    await r.tickAll();
    expect(r.isActive("p")).toBe(false);
    expect(r.status("p").committed).toEqual(["a", "b", "c"]);
  });

  const three = () => [mk("a", { position: 0 }), mk("b", { position: 1 }), mk("c", { position: 2 })];
  it("maxParallel 3 starts three in one tick", async () => {
    const { r, started } = setup(three(), () => false, { maxParallel: () => 3 });
    await r.start("p");
    expect(started).toEqual(["a", "b", "c"]);
  });

  it("without maxParallel dep starts two", async () => {
    const { r, started } = setup(three());
    await r.start("p");
    expect(started).toHaveLength(2);
  });

  it("maxParallel 3 but global running total 2 starts one", async () => {
    const { r, started } = setup(three(), () => false, { maxParallel: () => 3, codingRunningTotal: () => QUEUE_MAX_PARALLEL_CEILING - 1 });
    await r.start("p");
    expect(started).toHaveLength(1);
  });

  it("chain A->B runs sequentially", async () => {
    const { r, started, set } = setup([mk("a", { position: 0 }), mk("b", { position: 1, dependsOn: ["a"] })]);
    await r.start("p");
    expect(started).toEqual(["a"]);
    set("a", "đã commit");
    await r.tickAll();
    expect(started).toEqual(["a", "b"]);
  });

  it("failed A blocks B and the run finishes with a summary", async () => {
    const { r, started, set } = setup([mk("a", { position: 0 }), mk("b", { position: 1, dependsOn: ["a"] })]);
    await r.start("p");
    set("a", "lỗi");
    await r.tickAll();
    expect(started).toEqual(["a"]);
    const s = r.status("p");
    expect(s.active).toBe(false);
    expect(s.failed).toEqual(["a"]);
    expect(s.blocked).toEqual(["b"]);
  });

  it("stop prevents new starts but keeps running ones", async () => {
    const { r, started, set } = setup([mk("a", { position: 0 }), mk("b", { position: 1, dependsOn: ["a"] })]);
    await r.start("p");
    r.stop("p");
    set("a", "đã commit");
    await r.tickAll();
    expect(started).toEqual(["a"]);
    expect(r.isActive("p")).toBe(false);
  });

  it("concurrent ticks never exceed 2", async () => {
    const { r, started } = setup([mk("a", { position: 0 }), mk("b", { position: 1 }), mk("c", { position: 2 }), mk("d", { position: 3 })]);
    const p = r.start("p");
    await Promise.all([r.tick("p"), r.tick("p"), r.tick("p"), p]);
    expect(started).toEqual(["a", "b"]);
  });

  it("start error is recorded and retried on the next tick; start rejects when nothing approved or already active", async () => {
    let fail = true;
    const { r, started } = setup([mk("a")], () => fail);
    await r.start("p");
    expect(started).toEqual([]);
    expect(r.isActive("p")).toBe(true);
    expect(r.status("p").lastError).toBe("hết slot");
    fail = false;
    await r.tickAll();
    expect(started).toEqual(["a"]);
    await expect(r.start("p")).rejects.toThrow();
    const empty = setup([mk("x", { status: "chờ duyệt" })]);
    await expect(empty.r.start("p")).rejects.toThrow();
  });
});

describe("QueueRunAll onFinish", () => {
  function withFinish(cmds: QueueCommand[], onFinish: (p: string, s: unknown) => unknown) {
    const r = new QueueRunAll({
      list: () => cmds,
      codingRunningTotal: () => cmds.filter((c) => c.status === "đang chạy").length,
      start: async (_p, id) => {
        cmds.find((c) => c.id === id)!.status = "đang chạy";
      },
      onFinish,
      retryMs: 0,
    });
    const set = (id: string, s: QueueCommand["status"]) => (cmds.find((c) => c.id === id)!.status = s);
    return { r, set };
  }

  it("fires once with summary after commands ran", async () => {
    const calls: unknown[] = [];
    const { r, set } = withFinish([mk("a"), mk("b", { position: 1, dependsOn: ["a"] })], (p, s) => calls.push([p, s]));
    await r.start("p");
    set("a", "lỗi");
    await r.tickAll();
    await r.tickAll();
    expect(calls).toEqual([["p", { committed: [], failed: ["a"], blocked: ["b"] }]]);
  });

  it("does not fire on manual stop", async () => {
    const calls: unknown[] = [];
    const { r, set } = withFinish([mk("a")], (p, s) => calls.push([p, s]));
    await r.start("p");
    r.stop("p");
    set("a", "đã commit");
    await r.tickAll();
    expect(calls).toEqual([]);
  });

  it("does not fire when nothing started in this pass", async () => {
    const calls: unknown[] = [];
    const cmds = [mk("a")];
    const r = new QueueRunAll({
      list: () => cmds,
      codingRunningTotal: () => 0,
      start: async () => {
        throw new Error("hết slot");
      },
      onFinish: (p, s) => calls.push([p, s]),
      retryMs: 0,
    });
    await r.start("p");
    cmds[0]!.status = "đã commit";
    await r.tickAll();
    expect(r.isActive("p")).toBe(false);
    expect(calls).toEqual([]);
  });

  it("onFinish throwing or rejecting does not break the queue", async () => {
    const { r, set } = withFinish([mk("a")], () => {
      throw new Error("boom");
    });
    await r.start("p");
    set("a", "đã commit");
    await expect(r.tickAll()).resolves.toBeUndefined();
    const rej = withFinish([mk("a")], () => Promise.reject(new Error("boom")));
    await rej.r.start("p");
    rej.set("a", "đã commit");
    await expect(rej.r.tickAll()).resolves.toBeUndefined();
    expect(rej.r.isActive("p")).toBe(false);
  });
});

describe("QueueRunAll idea scope", () => {
  function setupScoped(cmds: QueueCommand[]) {
    const calls: Array<[string, string | undefined]> = [];
    const r = new QueueRunAll({
      list: () => cmds,
      codingRunningTotal: () => cmds.filter((c) => c.status === "đang chạy").length,
      start: async (_p, id, ref) => {
        await Promise.resolve();
        cmds.find((c) => c.id === id)!.status = "đang chạy";
        calls.push([id, ref]);
      },
      retryMs: 0,
    });
    const set = (id: string, s: QueueCommand["status"]) => (cmds.find((c) => c.id === id)!.status = s);
    return { r, calls, set };
  }

  it("runs independent idea A commands in parallel, passing sourceRef, never idea B", async () => {
    const { r, calls, set } = setupScoped([
      mk("a1", { position: 0, sourceRef: "A" }),
      mk("a2", { position: 1, sourceRef: "A" }),
      mk("b1", { position: 2, sourceRef: "B" }),
    ]);
    await r.start("p", "A");
    expect(calls).toEqual([["a1", "A"], ["a2", "A"]]);
    expect(r.status("p").sourceRef).toBe("A");
    await r.tickAll();
    expect(calls).toHaveLength(2);
    set("a1", "đã commit");
    set("a2", "đã commit");
    await r.tickAll();
    expect(r.isActive("p")).toBe(false);
    expect(r.status("p").sourceRef).toBeNull();
    expect(calls.map((c) => c[0])).not.toContain("b1");
  });

  it("a dependent idea command waits for its dependency", async () => {
    const { r, calls, set } = setupScoped([
      mk("a1", { position: 0, sourceRef: "A" }),
      mk("a2", { position: 1, sourceRef: "A", dependsOn: ["a1"], files: ["src/other.ts"] }),
    ]);
    await r.start("p", "A");
    expect(calls).toEqual([["a1", "A"]]);
    set("a1", "đã commit");
    await r.tickAll();
    expect(calls).toEqual([["a1", "A"], ["a2", "A"]]);
  });

  it("stop clears the scope", async () => {
    const { r } = setupScoped([mk("a1", { sourceRef: "A" }), mk("a2", { position: 1, sourceRef: "A" })]);
    await r.start("p", "A");
    expect(r.status("p").sourceRef).toBe("A");
    r.stop("p");
    expect(r.status("p").sourceRef).toBeNull();
  });

  it("idea without approved commands throws conflict", async () => {
    const { r } = setupScoped([mk("a1", { sourceRef: "A", status: "chờ duyệt" }), mk("b1", { sourceRef: "B" })]);
    await expect(r.start("p", "A")).rejects.toMatchObject({ code: "conflict" });
    expect(r.isActive("p")).toBe(false);
  });

  it("unscoped start passes no sourceRef", async () => {
    const { r, calls } = setupScoped([mk("a1", { sourceRef: "A" })]);
    await r.start("p");
    expect(calls).toEqual([["a1", undefined]]);
    expect(r.status("p").sourceRef).toBeNull();
  });
});
