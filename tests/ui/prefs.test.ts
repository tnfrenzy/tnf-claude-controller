import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { PREF_PROJECT, recall, remember } from "../../ui/src/lib/prefs.js";

// Preferences must outlive the app window: localStorage, never sessionStorage.
describe("prefs", () => {
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

  it("remembers and recalls the chosen project", () => {
    remember(PREF_PROJECT, "controller");
    expect(recall(PREF_PROJECT)).toBe("controller");
    expect(store.get("tnf.project")).toBe("controller");
  });
  it("empty value clears the key; missing key recalls empty string", () => {
    remember(PREF_PROJECT, "x");
    remember(PREF_PROJECT, "");
    expect(store.has(PREF_PROJECT)).toBe(false);
    expect(recall(PREF_PROJECT)).toBe("");
  });
  it("swallows storage errors", () => {
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: () => { throw new Error("blocked"); },
      setItem: () => { throw new Error("blocked"); },
      removeItem: () => { throw new Error("blocked"); },
    };
    expect(() => remember(PREF_PROJECT, "a")).not.toThrow();
    expect(recall(PREF_PROJECT)).toBe("");
  });
});
