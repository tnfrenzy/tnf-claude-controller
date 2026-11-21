import { describe, expect, it } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";

const db = (s: RunStore) => (s as unknown as { db: { prepare(sql: string): { run(...a: unknown[]): unknown } } }).db;

function seed() {
  const store = new RunStore(":memory:");
  let t = 1000;
  const mk = (id: string, parent: string | null = null, extra: Record<string, unknown> = {}) => {
    store.createRun({ id, status: "done", prompt: `lenh ${id}`, mode: "m", model: null, session_id: null, parent_run_id: parent, project: "p", claude_version: null, run_dir: "D:/x", ...extra } as never);
    db(store).prepare("UPDATE runs SET created_at = ? WHERE id = ?").run(t++, id);
  };
  mk("a"); // thread a: a, a1, a2 (a2 is the newest run of all)
  mk("b");
  mk("a1", "a");
  mk("c", null, { forked_from_run_id: "b" }); // continue-from-commit nests under b
  mk("orphan", "missing");
  mk("a2", "a1");
  return store;
}

describe("listRunThreads", () => {
  it("pages by thread, newest activity first, and returns every member of each thread", () => {
    const s = seed();
    const p1 = s.listRunThreads({ limit: 1 });
    expect(p1.total).toBe(3); // a, b, orphan
    expect(p1.runs.map((r) => r.id)).toEqual(["a2", "a1", "a"]);
    const p2 = s.listRunThreads({ limit: 1, offset: 1 });
    expect(p2.runs.map((r) => r.id)).toEqual(["orphan"]);
    const p3 = s.listRunThreads({ limit: 5, offset: 2 });
    expect(p3.runs.map((r) => r.id)).toEqual(["c", "b"]);
    s.close();
  });

  it("a filter that matches only a reply still brings its whole thread", () => {
    const s = seed();
    s.updateRun("a2", { status: "error" });
    const r = s.listRunThreads({ status: "error" });
    expect(r.total).toBe(1);
    expect(r.runs.map((x) => x.id).sort()).toEqual(["a", "a1", "a2"]);
    s.close();
  });

  it("does not loop on a parent cycle", () => {
    const s = seed();
    db(s).prepare("UPDATE runs SET parent_run_id = 'b' WHERE id = 'a'").run();
    db(s).prepare("UPDATE runs SET parent_run_id = 'a' WHERE id = 'b'").run();
    const r = s.listRunThreads({ limit: 50 });
    expect(r.runs.map((x) => x.id).sort()).toEqual(["a", "a1", "a2", "b", "c", "orphan"]);
    s.close();
  });

  it("plain listRuns is unchanged (flat)", () => {
    const s = seed();
    expect(s.listRuns({}).map((r) => r.id)).toEqual(["a2", "orphan", "c", "a1", "b", "a"]);
    expect(s.countRuns({})).toBe(6);
    s.close();
  });
});
