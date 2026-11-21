import { describe, it, expect } from "vitest";
import { clampMaxParallel, isUnlocked, canRunParallel, pickRunnable } from "../../src/core/queue/queue-engine.js";
import type { QueueCommand } from "../../src/core/queue/queue-store.js";

function mk(id: string, over: Partial<QueueCommand> = {}): QueueCommand {
  return {
    id, project: "p", batch: 1, position: 0, title: id, body: `body ${id}`, bodyOriginal: `body ${id}`,
    dependsOn: [], files: [`src/${id}.ts`], status: "đã duyệt", runId: null, branch: null,
    estCostUsd: 0, createdAt: 0, updatedAt: 0, approvedAt: null, ...over,
  };
}

describe("clampMaxParallel", () => {
  it("clamps to 1..10, NaN -> 2", () => {
    expect([0, -5, 1, 2, 3, 7, 99].map(clampMaxParallel)).toEqual([1, 1, 1, 2, 3, 7, 10]);
    expect(clampMaxParallel(NaN)).toBe(2);
    expect(clampMaxParallel(Infinity)).toBe(10);
    expect(clampMaxParallel(-Infinity)).toBe(1);
  });
});

describe("isUnlocked", () => {
  it("committed but not merged: unlocked, not runnable", () => {
    const a = mk("a", { status: "đã commit" });
    const b = mk("b", { dependsOn: ["a"] });
    const r = isUnlocked(b, [a, b]);
    expect(r.unlocked).toBe(true);
    expect(r.runnable).toBe(false);
    expect(r.reasons.join(" ")).toContain("a");
    expect(canRunParallel(b, [], 3, 0, [a, b]).ok).toBe(false);
  });
  it("merged: runnable", () => {
    const a = mk("a", { status: "đã gộp" });
    const b = mk("b", { dependsOn: ["a"] });
    expect(isUnlocked(b, [a, b])).toEqual({ unlocked: true, runnable: true, reasons: [] });
    expect(canRunParallel(b, [], 3, 0, [a, b]).ok).toBe(true);
  });
  it("skipped / failed / missing deps never unlock", () => {
    const s = mk("s", { status: "bỏ qua" });
    const f = mk("f", { status: "lỗi" });
    const bs = mk("bs", { dependsOn: ["s"] });
    const bf = mk("bf", { dependsOn: ["f"] });
    const bm = mk("bm", { dependsOn: ["zzz"] });
    const all = [s, f, bs, bf, bm];
    const rs = isUnlocked(bs, all);
    const rf = isUnlocked(bf, all);
    expect(rs.unlocked).toBe(false);
    expect(rf.unlocked).toBe(false);
    expect(rs.reasons[0]).not.toBe(rf.reasons[0]);
    expect(isUnlocked(bm, all).unlocked).toBe(false);
  });
  it("deps still running or approved do not unlock", () => {
    const a = mk("a", { status: "đang chạy" });
    const c = mk("c", { status: "đã duyệt" });
    const b = mk("b", { dependsOn: ["a", "c"] });
    const r = isUnlocked(b, [a, b, c]);
    expect(r.unlocked).toBe(false);
    expect(r.reasons).toHaveLength(2);
  });
  it("no deps", () => {
    expect(isUnlocked(mk("a"), [])).toEqual({ unlocked: true, runnable: true, reasons: [] });
  });
});

describe("canRunParallel capacity", () => {
  const c = mk("c");
  it("maxParallel 1, 2, 3 with growing running count", () => {
    for (const mp of [1, 2, 3]) {
      for (let n = 0; n <= 3; n++) {
        const r = canRunParallel(c, [], mp, n, [c]);
        if (n < mp) expect(r).toEqual({ ok: true, waiting: false, reasons: [] });
        else {
          expect(r.ok).toBe(false);
          expect(r.waiting).toBe(true);
          expect(r.reasons[0]).toContain("chờ chỗ");
        }
      }
    }
  });
  it("out of range maxParallel is clamped", () => {
    expect(canRunParallel(c, [], 99, 9, [c]).ok).toBe(true);
    expect(canRunParallel(c, [], 99, 10, [c]).waiting).toBe(true);
    expect(canRunParallel(c, [], 0, 0, [c]).ok).toBe(true);
    expect(canRunParallel(c, [], 0, 1, [c]).waiting).toBe(true);
  });
  it("runs outside the queue take slots", () => {
    const r = canRunParallel(c, [], 2, 2, [c]);
    expect(r.waiting).toBe(true);
    expect(r.ok).toBe(false);
  });
  it("overlapping files with a running command: hard reject", () => {
    const run = mk("r", { status: "đang chạy", files: ["src/c.ts"] });
    const r = canRunParallel(c, [run], 3, 1, [c, run]);
    expect(r.ok).toBe(false);
    expect(r.waiting).toBe(false);
    expect(r.reasons.length).toBeGreaterThan(0);
  });
  it("shared hotspot: reject", () => {
    const x = mk("x", { files: ["package.json"] });
    const run = mk("r", { status: "đang chạy", files: ["package.json"] });
    const r = canRunParallel(x, [run], 3, 1, [x, run]);
    expect(r.ok).toBe(false);
    expect(r.waiting).toBe(false);
    const run2 = mk("r2", { status: "đang chạy", files: ["ui/src/i18n.ts"] });
    const y = mk("y", { files: ["ui/src/i18n.ts"] });
    expect(canRunParallel(y, [run2], 3, 1, [y, run2]).ok).toBe(false);
  });
  it("unapproved command", () => {
    const w = mk("w", { status: "chờ duyệt" });
    const r = canRunParallel(w, [], 3, 0, [w]);
    expect(r.ok).toBe(false);
    expect(r.reasons).toContain("chưa được duyệt");
  });
});

describe("pickRunnable", () => {
  it("orders by batch then position and respects maxParallel", () => {
    const a = mk("a", { batch: 2, position: 0 });
    const b = mk("b", { batch: 1, position: 1 });
    const c = mk("c", { batch: 1, position: 0 });
    const all = [a, b, c];
    const copy = JSON.stringify(all);
    expect(pickRunnable(all, 0, 2).map((x) => x.id)).toEqual(["c", "b"]);
    expect(pickRunnable(all, 0, 3).map((x) => x.id)).toEqual(["c", "b", "a"]);
    expect(pickRunnable(all, 0, 1).map((x) => x.id)).toEqual(["c"]);
    expect(JSON.stringify(all)).toBe(copy);
  });
  it("subtracts slots used by outside runs and running queue commands", () => {
    const a = mk("a");
    const b = mk("b", { position: 1 });
    expect(pickRunnable([a, b], 1, 2).map((x) => x.id)).toEqual(["a"]);
    expect(pickRunnable([a, b], 2, 2)).toEqual([]);
    const run = mk("r", { status: "đang chạy" });
    expect(pickRunnable([run, a, b], 1, 2).map((x) => x.id)).toEqual(["a"]);
  });
  it("skips file conflicts with already picked commands", () => {
    const a = mk("a", { files: ["src/shared.ts"] });
    const b = mk("b", { position: 1, files: ["src/shared.ts"] });
    const c = mk("c", { position: 2 });
    expect(pickRunnable([a, b, c], 0, 3).map((x) => x.id)).toEqual(["a", "c"]);
  });
  it("skips conflicts with a running command", () => {
    const run = mk("r", { status: "đang chạy", files: ["src/a.ts"] });
    const a = mk("a");
    expect(pickRunnable([run, a], 1, 3)).toEqual([]);
  });
  it("does not pick commands whose deps are not merged", () => {
    const d = mk("d", { status: "đã commit" });
    const a = mk("a", { dependsOn: ["d"] });
    const m = mk("m", { status: "đã gộp" });
    const b = mk("b", { dependsOn: ["m"], position: 1 });
    const w = mk("w", { status: "chờ duyệt", position: 2 });
    expect(pickRunnable([d, a, m, b, w], 0, 3).map((x) => x.id)).toEqual(["b"]);
  });
});
