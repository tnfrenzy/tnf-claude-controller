import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DISMISSED_KEY,
  MAX_IDS_PER_RUN,
  MAX_RUNS,
  filterDismissed,
  loadDismissed,
  markDismissed,
} from "../../ui/src/queue/scoutDismissed.js";
import { sourceRefFor } from "../../ui/src/queue/scoutRef.js";

const R = "20261030-131158-d8d73d";

describe("scoutDismissed", () => {
  const store = new Map<string, string>();
  let setCalls = 0;
  let getThrows = false;
  let setThrows = false;
  beforeEach(() => {
    store.clear();
    setCalls = 0;
    getThrows = false;
    setThrows = false;
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => {
        if (getThrows) throw new Error("denied");
        return store.get(k) ?? null;
      },
      setItem: (k: string, v: string) => {
        setCalls++;
        if (setThrows) throw new Error("quota");
        store.set(k, v);
      },
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  const put = (data: unknown) => store.set(DISMISSED_KEY, typeof data === "string" ? data : JSON.stringify(data));
  const saved = () => JSON.parse(store.get(DISMISSED_KEY) as string) as { v: number; runs: Record<string, string[]> };

  it("(a) load with nothing stored is empty", () => {
    expect(loadDismissed(R).size).toBe(0);
  });

  it("(b) mark then load; runs are independent", () => {
    markDismissed(R, "a1");
    markDismissed("other-run", "b1");
    expect([...loadDismissed(R)]).toEqual([sourceRefFor(R, "a1")]);
    expect([...loadDismissed("other-run")]).toEqual([sourceRefFor("other-run", "b1")]);
  });

  it("(c) duplicate mark does not duplicate", () => {
    markDismissed(R, "a1");
    markDismissed(R, "a1");
    expect(saved().runs[R]).toEqual([sourceRefFor(R, "a1")]);
  });

  it("(d) corrupt data yields a clean set without throwing", () => {
    for (const bad of [
      "{not json",
      { v: 2, runs: { [R]: [sourceRefFor(R, "a")] } },
      { v: 1, runs: [] },
      { v: 1, runs: { [R]: "nope" } },
      [1, 2],
      "null",
      { runs: {} },
    ]) {
      put(bad);
      expect(loadDismissed(R).size).toBe(0);
    }
    put({ v: 1, runs: { [R]: [5, null, "x", `${R}#BAD`, "other#a", sourceRefFor(R, "ok")] } });
    expect([...loadDismissed(R)]).toEqual([sourceRefFor(R, "ok")]);
  });

  it("(e) duplicate ids in stored data are deduplicated", () => {
    const ref = sourceRefFor(R, "a");
    put({ v: 1, runs: { [R]: [ref, ref, ref] } });
    expect(loadDismissed(R).size).toBe(1);
    markDismissed(R, "b");
    expect(saved().runs[R]).toEqual([ref, sourceRefFor(R, "b")]);
  });

  it("(f) storage errors are swallowed", () => {
    getThrows = true;
    expect(loadDismissed(R).size).toBe(0);
    getThrows = false;
    setThrows = true;
    const s = markDismissed(R, "a");
    expect(s.has(sourceRefFor(R, "a"))).toBe(true);
  });

  it("(g) more than 64 ids keeps the newest 64", () => {
    for (let i = 0; i < MAX_IDS_PER_RUN + 3; i++) markDismissed(R, `p${i}`);
    const ids = saved().runs[R];
    expect(ids).toHaveLength(MAX_IDS_PER_RUN);
    expect(ids[0]).toBe(sourceRefFor(R, "p3"));
    expect(ids[ids.length - 1]).toBe(sourceRefFor(R, `p${MAX_IDS_PER_RUN + 2}`));
  });

  it("(h) more than 20 runs drops the oldest", () => {
    for (let i = 0; i < MAX_RUNS + 1; i++) markDismissed(`run${i}`, "a");
    const keys = Object.keys(saved().runs);
    expect(keys).toHaveLength(MAX_RUNS);
    expect(keys).not.toContain("run0");
    expect(keys).toContain(`run${MAX_RUNS}`);
  });

  it("(i) marking an existing run at 20 runs evicts no one and makes it newest", () => {
    for (let i = 0; i < MAX_RUNS; i++) markDismissed(`run${i}`, "a");
    markDismissed("run0", "b");
    const keys = Object.keys(saved().runs);
    expect(keys).toHaveLength(MAX_RUNS);
    for (let i = 1; i < MAX_RUNS; i++) expect(keys).toContain(`run${i}`);
    expect(keys[keys.length - 1]).toBe("run0");
    expect(saved().runs.run0).toHaveLength(2);
  });

  it("(j) filterDismissed removes the right ones, keeps order, does not mutate", () => {
    const props = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const copy = [...props];
    const set = new Set([sourceRefFor(R, "b")]);
    expect(filterDismissed(props, set, R).map((p) => p.id)).toEqual(["a", "c"]);
    expect(props).toEqual(copy);
    const all = filterDismissed(props, new Set(), R);
    expect(all).toEqual(props);
    expect(all).not.toBe(props);
  });

  it("(k) invalid ids do not write and return the existing set", () => {
    markDismissed(R, "a");
    setCalls = 0;
    const ref = sourceRefFor(R, "a");
    expect([...markDismissed(R, "")]).toEqual([ref]);
    expect([...markDismissed(R, "UP")]).toEqual([ref]);
    expect([...markDismissed(R, "x".repeat(33))]).toEqual([ref]);
    expect(markDismissed("", "a").size).toBe(0);
    expect(markDismissed("a#b", "a").size).toBe(0);
    expect(markDismissed("r".repeat(65), "a").size).toBe(0);
    expect(setCalls).toBe(0);
  });

  it("(l) boundary-valid ids are written", () => {
    const id = "y".repeat(32);
    expect(markDismissed(R, id).has(sourceRefFor(R, id))).toBe(true);
    expect(saved().runs[R]).toContain(sourceRefFor(R, id));
  });

  it("__proto__ run id is just a key and pollutes nothing", () => {
    const s = markDismissed("__proto__", "a");
    expect(s.has(sourceRefFor("__proto__", "a"))).toBe(true);
    expect(loadDismissed("__proto__").size).toBe(1);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    put('{"v":1,"runs":{"__proto__":["__proto__#a"],"x":["x#a"]}}');
    expect(loadDismissed("x").size).toBe(1);
    expect(loadDismissed("__proto__").size).toBe(1);
    expect(Object.keys(Object.prototype)).toEqual([]);
  });

  it("works when localStorage is undefined", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(loadDismissed(R).size).toBe(0);
    expect(markDismissed(R, "a").has(sourceRefFor(R, "a"))).toBe(true);
  });

  it("skips oversized raw JSON without parsing", () => {
    put(JSON.stringify({ v: 1, runs: { [R]: [sourceRefFor(R, "a")] }, pad: "z".repeat(300 * 1024) }));
    expect(loadDismissed(R).size).toBe(0);
  });
});
