import { describe, expect, it } from "vitest";
import { buildRunTree, parentOf, threadIsLive, threadIsOpen, pruneOpenState } from "../../ui/src/run/runTree";

type R = { id: string; created_at: number; status: string; parent_run_id: string | null; forked_from_run_id?: string | null; cost_usd_est: number };
const r = (id: string, at: number, parent: string | null = null, extra: Partial<R> = {}): R => ({ id, created_at: at, status: "done", parent_run_id: parent, cost_usd_est: 0, ...extra });

describe("buildRunTree", () => {
  it("groups follow-ups under their root, replies oldest first, threads in input order", () => {
    // input newest first, like the API
    const runs = [r("c", 40, "b"), r("x", 35), r("b", 30, "a"), r("a", 10)];
    const t = buildRunTree(runs);
    expect(t.map((th) => th.root.id)).toEqual(["a", "x"]);
    expect(t[0]!.replies.map((x) => x.id)).toEqual(["b", "c"]);
    expect(t[1]!.replies).toEqual([]);
  });

  it("a follow-up whose parent is missing shows as its own root, keeping its own replies", () => {
    const t = buildRunTree([r("c", 40, "b"), r("b", 30, "gone")]);
    expect(t).toHaveLength(1);
    expect(t[0]!.root.id).toBe("b");
    expect(t[0]!.replies.map((x) => x.id)).toEqual(["c"]);
  });

  it("survives a parent cycle without looping and keeps every run exactly once", () => {
    const runs = [r("a", 10, "b"), r("b", 20, "a"), r("c", 30, "b")];
    const t = buildRunTree(runs);
    const ids = t.flatMap((th) => [th.root.id, ...th.replies.map((x) => x.id)]).sort();
    expect(ids).toEqual(["a", "b", "c"]);
    expect(t).toHaveLength(1);
    expect(t[0]!.root.id).toBe("a"); // oldest member of the cycle becomes the root
  });

  it("a self-parented run is a root", () => {
    const t = buildRunTree([r("a", 10, "a")]);
    expect(t.map((th) => th.root.id)).toEqual(["a"]);
    expect(t[0]!.replies).toEqual([]);
  });

  it("ignores duplicate ids (keeps the first)", () => {
    const t = buildRunTree([r("a", 10), r("a", 10, null, { status: "error" })]);
    expect(t).toHaveLength(1);
    expect(t[0]!.root.status).toBe("done");
  });

  it("'continue from commit' (forked_from_run_id) also nests, parent_run_id wins when both are set", () => {
    expect(parentOf(r("b", 2, null, { forked_from_run_id: "a" }))).toBe("a");
    expect(parentOf(r("b", 2, "p", { forked_from_run_id: "a" }))).toBe("p");
    const t = buildRunTree([r("b", 20, null, { forked_from_run_id: "a" }), r("a", 10)]);
    expect(t).toHaveLength(1);
    expect(t[0]!.replies[0]!.id).toBe("b");
  });

  it("sums the estimated cost of the whole thread", () => {
    const t = buildRunTree([r("b", 20, "a", { cost_usd_est: 0.25 }), r("a", 10, null, { cost_usd_est: 0.5 })]);
    expect(t[0]!.totalCost).toBeCloseTo(0.75);
  });
});

describe("i18n", () => {
  it("every tree_* key exists in vi and en", async () => {
    const { dicts } = await import("../../ui/src/i18n");
    for (const k of ["tree_expand", "tree_collapse", "tree_replies", "tree_reply", "tree_resume", "tree_total"] as const) {
      expect(dicts.vi[k]).toBeTruthy();
      expect(dicts.en[k]).toBeTruthy();
    }
    expect(dicts.vi.tree_reply.replace("{n}", "2")).toBe("Phản hồi 2");
  });
});

describe("open state", () => {
  const thread = (statuses: string[]) => buildRunTree(statuses.map((s, i) => r(`r${i}`, i, i === 0 ? null : "r0", { status: s })))[0]!;
  it("live when any member is running or queued", () => {
    expect(threadIsLive(thread(["done", "running"]))).toBe(true);
    expect(threadIsLive(thread(["queued"]))).toBe(true);
    expect(threadIsLive(thread(["done", "error"]))).toBe(false);
  });
  it("collapsed by default, auto-open while a reply runs, the user's choice wins", () => {
    expect(threadIsOpen(thread(["done", "done"]), {})).toBe(false);
    expect(threadIsOpen(thread(["done", "running"]), {})).toBe(true);
    expect(threadIsOpen(thread(["done", "running"]), { r0: false })).toBe(false);
    expect(threadIsOpen(thread(["done", "done"]), { r0: true })).toBe(true);
  });
  it("prune keeps only booleans and the newest N entries", () => {
    const raw: Record<string, unknown> = { a: true, b: "x", c: false };
    expect(pruneOpenState(raw, 10)).toEqual({ a: true, c: false });
    const many: Record<string, boolean> = {};
    for (let i = 0; i < 5; i++) many[`k${i}`] = true;
    expect(Object.keys(pruneOpenState(many, 2))).toEqual(["k3", "k4"]);
    expect(pruneOpenState(null, 5)).toEqual({});
    expect(pruneOpenState([1, 2], 5)).toEqual({});
  });
});
