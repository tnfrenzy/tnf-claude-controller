import { describe, expect, it } from "vitest";
import {
  DEFAULT_PALETTE_KEY,
  duplicateKeys,
  isPaletteKey,
  matchShortcut,
  normalizeKey,
  parseShortcuts,
  resolveShortcuts,
} from "../ui/src/shortcuts";

const ev = (key: string, over: Record<string, boolean> = {}) => ({ key, ctrlKey: false, metaKey: false, altKey: false, ...over });

describe("normalizeKey", () => {
  it("uppercases the first letter or digit", () => {
    expect(normalizeKey("a")).toBe("A");
    expect(normalizeKey("  7x")).toBe("7");
    expect(normalizeKey("!?q")).toBe("Q");
  });
  it("returns empty when nothing usable", () => {
    expect(normalizeKey("")).toBe("");
    expect(normalizeKey("!?")).toBe("");
    expect(normalizeKey(undefined as never)).toBe("");
  });
});

describe("parseShortcuts", () => {
  it("defaults on empty or garbage", () => {
    for (const raw of ["", "{", "null", "42", "[]x"]) expect(parseShortcuts(raw)).toEqual({ palette: DEFAULT_PALETTE_KEY, keys: {} });
  });
  it("normalizes values, keeps cleared, drops unknown ids and non-strings", () => {
    const c = parseShortcuts(JSON.stringify({ palette: "p", keys: { "page:cmd": "x", "env:a": "", "bogus:z": "q", "page:history": 5 } }));
    expect(c).toEqual({ palette: "P", keys: { "page:cmd": "X", "env:a": "" } });
  });
  it("falls back to default palette key when invalid", () => {
    expect(parseShortcuts(JSON.stringify({ palette: "!" })).palette).toBe("K");
    expect(parseShortcuts(JSON.stringify({ palette: 3 })).palette).toBe("K");
  });
});

describe("resolveShortcuts", () => {
  const empty = { palette: "K", keys: {} };
  it("gives pages their defaults R/H/T/J", () => {
    expect(resolveShortcuts(empty, [])).toEqual({ "page:cmd": "R", "page:history": "H", "page:library": "T", "page:settings": "J" });
  });
  it("gives envs the first free letter of their name", () => {
    const m = resolveShortcuts(empty, ["rho", "alpha", "alpa"]);
    expect(m["env:rho"]).toBe("O"); // R and H are taken by pages
    expect(m["env:alpha"]).toBe("A");
    expect(m["env:alpa"]).toBe("L");
  });
  it("user override wins and leaves other defaults alone", () => {
    const m = resolveShortcuts({ palette: "K", keys: { "page:cmd": "Z", "env:rho": "R" } }, ["rho"]);
    expect(m["page:cmd"]).toBe("Z");
    expect(m["env:rho"]).toBe("R");
    expect(m["page:history"]).toBe("H");
  });
  it("a default already claimed by a user choice is dropped", () => {
    const m = resolveShortcuts({ palette: "K", keys: { "env:x": "R" } }, ["x"]);
    expect(m["env:x"]).toBe("R");
    expect(m["page:cmd"]).toBe("");
  });
  it("a cleared key stays empty", () => {
    const m = resolveShortcuts({ palette: "K", keys: { "page:cmd": "", "env:zzz": "" } }, ["zzz"]);
    expect(m["page:cmd"]).toBe("");
    expect(m["env:zzz"]).toBe("");
  });
  it("env without usable letters gets none", () => {
    expect(resolveShortcuts(empty, ["--"])["env:--"]).toBe("");
  });
});

describe("duplicateKeys", () => {
  it("lists keys used more than once, ignoring empty", () => {
    expect(duplicateKeys({ a: "R", b: "R", c: "H", d: "", e: "" })).toEqual(["R"]);
    expect(duplicateKeys({ a: "R", b: "H" })).toEqual([]);
  });
});

describe("matchShortcut", () => {
  const map = { "page:cmd": "R", "env:x": "X" };
  it("matches Alt+letter case-insensitively", () => {
    expect(matchShortcut(map, ev("r", { altKey: true }))).toBe("page:cmd");
    expect(matchShortcut(map, ev("X", { altKey: true }))).toBe("env:x");
  });
  it("ignores everything else", () => {
    expect(matchShortcut(map, ev("r"))).toBeNull();
    expect(matchShortcut(map, ev("r", { altKey: true, ctrlKey: true }))).toBeNull();
    expect(matchShortcut(map, ev("r", { altKey: true, metaKey: true }))).toBeNull();
    expect(matchShortcut(map, ev("r", { altKey: true, shiftKey: true }))).toBeNull();
    expect(matchShortcut(map, ev("r", { altKey: true, isComposing: true }))).toBeNull();
    expect(matchShortcut(map, ev("Enter", { altKey: true }))).toBeNull();
    expect(matchShortcut(map, ev("q", { altKey: true }))).toBeNull();
  });
});

describe("isPaletteKey", () => {
  it("Ctrl or Meta + default K", () => {
    expect(isPaletteKey(ev("k", { ctrlKey: true }))).toBe(true);
    expect(isPaletteKey(ev("K", { metaKey: true }))).toBe(true);
  });
  it("custom letter", () => {
    expect(isPaletteKey(ev("p", { ctrlKey: true }), "P")).toBe(true);
    expect(isPaletteKey(ev("k", { ctrlKey: true }), "P")).toBe(false);
  });
  it("rejects alt, shift, composing and no modifier", () => {
    expect(isPaletteKey(ev("k"))).toBe(false);
    expect(isPaletteKey(ev("k", { ctrlKey: true, altKey: true }))).toBe(false);
    expect(isPaletteKey(ev("k", { ctrlKey: true, shiftKey: true }))).toBe(false);
    expect(isPaletteKey(ev("k", { ctrlKey: true, isComposing: true }))).toBe(false);
  });
});
