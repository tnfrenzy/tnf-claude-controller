import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MAX_ITEMS_PER_PROJECT, SKIPPED_KEY, addSkipped, loadSkipped } from "../../ui/src/queue/scoutSkipped.js";

describe("scoutSkipped", () => {
  const store = new Map<string, string>();
  beforeEach(() => {
    store.clear();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
  });
  afterEach(() => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });

  it("adds then reads back, with versioned key", () => {
    addSkipped("p1", { title: "Dark mode", feature: "toggle theme" });
    expect(loadSkipped("p1")).toEqual([{ title: "Dark mode", feature: "toggle theme" }]);
    expect(JSON.parse(store.get(SKIPPED_KEY) as string).v).toBe(1);
  });
  it("same title (case-insensitive) is one entry", () => {
    addSkipped("p1", { title: "Dark mode", feature: "a" });
    addSkipped("p1", { title: "DARK MODE", feature: "b" });
    const items = loadSkipped("p1");
    expect(items).toHaveLength(1);
    expect(items[0].feature).toBe("b");
  });
  it("keeps the newest 30", () => {
    for (let i = 0; i < 35; i++) addSkipped("p1", { title: `t${i}`, feature: "f" });
    const items = loadSkipped("p1");
    expect(items).toHaveLength(MAX_ITEMS_PER_PROJECT);
    expect(items[0].title).toBe("t5");
    expect(items[29].title).toBe("t34");
  });
  it("truncates title and feature", () => {
    addSkipped("p1", { title: "x".repeat(300), feature: "y".repeat(500) });
    const [it0] = loadSkipped("p1");
    expect(it0.title).toHaveLength(120);
    expect(it0.feature).toHaveLength(200);
  });
  it("corrupt JSON gives empty", () => {
    store.set(SKIPPED_KEY, "{not json");
    expect(loadSkipped("p1")).toEqual([]);
    store.set(SKIPPED_KEY, JSON.stringify({ v: 2, projects: { p1: [{ title: "a", feature: "b" }] } }));
    expect(loadSkipped("p1")).toEqual([]);
  });
  it("projects are separate, and __proto__ is just a key", () => {
    addSkipped("a", { title: "one", feature: "" });
    addSkipped("b", { title: "two", feature: "" });
    addSkipped("__proto__", { title: "three", feature: "" });
    expect(loadSkipped("a").map((i) => i.title)).toEqual(["one"]);
    expect(loadSkipped("b").map((i) => i.title)).toEqual(["two"]);
    expect(loadSkipped("__proto__").map((i) => i.title)).toEqual(["three"]);
    expect(({} as { title?: string }).title).toBeUndefined();
  });
  it("does not throw without localStorage", () => {
    delete (globalThis as { localStorage?: unknown }).localStorage;
    expect(() => addSkipped("p1", { title: "a", feature: "b" })).not.toThrow();
    expect(loadSkipped("p1")).toEqual([]);
  });
});
