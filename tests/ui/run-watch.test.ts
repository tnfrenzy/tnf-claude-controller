import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { buildTitle, classifyFinish, diffFinished } from "../../ui/src/run/runWatch.js";
import { PREF_NOTIFY, getNotify, setNotify } from "../../ui/src/lib/prefs.js";

describe("classifyFinish", () => {
  it("covers every branch", () => {
    expect(classifyFinish({ kind: "coding", status: "running" })).toBeNull();
    expect(classifyFinish({ kind: "coding", status: "cancelled" })).toBeNull();
    expect(classifyFinish({ kind: "research", status: "done" })).toBe("done");
    expect(classifyFinish({ kind: "coding", status: "done", merged: true })).toBe("done");
    expect(classifyFinish({ kind: "coding", status: "done", merged: false })).toBe("needs_commit");
    expect(classifyFinish({ kind: "coding", status: "error", error: "result_error: x" })).toBe("error");
    expect(classifyFinish({ kind: "coding", status: "error", error: null })).toBe("error");
    expect(classifyFinish({ kind: "coding", status: "error", error: "subagent_interrupted: y" })).toBe("interrupted");
  });
});

describe("diffFinished", () => {
  it("handles empty sets and vanished ids", () => {
    expect(diffFinished([], [])).toEqual([]);
    expect(diffFinished([], ["a"])).toEqual([]);
    expect(diffFinished(["a", "b"], ["b", "c"])).toEqual(["a"]);
    expect(diffFinished(["a"], [])).toEqual(["a"]);
  });
});

describe("buildTitle", () => {
  it("builds each prefix", () => {
    expect(buildTitle("done", "p")).toBe("Xong: p");
    expect(buildTitle("error", "p")).toBe("Lỗi: p");
    expect(buildTitle("interrupted", "p")).toBe("Bị cắt: p");
    expect(buildTitle("needs_commit", "p")).toBe("Cần commit: p");
  });
});

describe("notify pref", () => {
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
  it("defaults off, persists on, turns off again", () => {
    expect(getNotify()).toBe(false);
    setNotify(true);
    expect(getNotify()).toBe(true);
    expect(store.has(PREF_NOTIFY)).toBe(true);
    setNotify(false);
    expect(getNotify()).toBe(false);
  });
});
