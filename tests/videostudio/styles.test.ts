import { describe, it, expect, afterEach } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  loadBuiltinStyles,
  validateStyle,
  createStyleStore,
} from "../../src/core/videostudio/styles.js";
import { VsError } from "../../src/core/videostudio/plan.js";

function allFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...allFiles(p));
    else out.push(p);
  }
  return out;
}

const tmps: string[] = [];
function tmp(): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-vs-"));
  tmps.push(d);
  return d;
}
afterEach(() => {
  while (tmps.length) fs.rmSync(tmps.pop()!, { recursive: true, force: true });
});

const base = {
  name: "Mẫu thử",
  transition: "fade",
  transitionSec: 1,
  shotSec: 3,
  font: "Arial",
  textColor: "#ffffff",
  textBox: false,
  visualPrompt: "test",
};

describe("builtin styles", () => {
  it("loads valid builtin styles with unique ids", () => {
    const list = loadBuiltinStyles();
    expect(list.length).toBe(9);
    const ids = new Set<string>();
    for (const s of list) {
      expect(s.builtin).toBe(true);
      expect(s.id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
      expect(validateStyle(s).ok).toBe(true);
      ids.add(s.id);
    }
    expect(ids.size).toBe(list.length);
  });

  it("returns [] for missing or corrupt file", () => {
    const d = tmp();
    expect(loadBuiltinStyles(path.join(d, "nope.json"))).toEqual([]);
    const bad = path.join(d, "bad.json");
    fs.writeFileSync(bad, "{{{");
    expect(loadBuiltinStyles(bad)).toEqual([]);
  });
});

describe("style store", () => {
  it("lists only builtins when empty", () => {
    const s = createStyleStore(tmp());
    expect(s.list().length).toBe(9);
  });

  it("generates id without diacritics and forces builtin false", () => {
    const store = createStyleStore(tmp());
    const saved = store.save({ ...base, name: "Đẹp lắm Việt", builtin: true });
    expect(saved.builtin).toBe(false);
    expect(saved.id).toBe("dep-lam-viet");
    expect(store.list().length).toBe(10);
  });

  it("rejects builtin id with VsError 400", () => {
    const store = createStyleStore(tmp());
    try {
      store.save({ ...base, id: "news" });
      expect.unreachable();
    } catch (e) {
      expect(e).toBeInstanceOf(VsError);
      expect((e as VsError).status).toBe(400);
    }
  });

  it("saving same name twice gives distinct ids", () => {
    const store = createStyleStore(tmp());
    const a = store.save(base);
    const b = store.save(base);
    expect(a.id).not.toBe(b.id);
    expect(b.id).toBe(`${a.id}-2`);
  });

  it("overwrite same id does not grow count", () => {
    const store = createStyleStore(tmp());
    store.save({ ...base, id: "mine" });
    store.save({ ...base, id: "mine", name: "Khác" });
    expect(store.list().length).toBe(10);
    expect(store.list().find((s) => s.id === "mine")!.name).toBe("Khác");
  });

  it("rejects the 51st user style", () => {
    const store = createStyleStore(tmp());
    for (let i = 0; i < 50; i++) store.save({ ...base, id: `s-${i}` });
    expect(() => store.save({ ...base, id: "extra" })).toThrow(VsError);
    store.save({ ...base, id: "s-1", name: "ghi đè" });
  });

  it("remove builtin throws, user removal works", () => {
    const store = createStyleStore(tmp());
    expect(() => store.remove("news")).toThrow(VsError);
    expect(store.list().some((s) => s.id === "news")).toBe(true);
    store.save({ ...base, id: "mine" });
    expect(store.remove("mine")).toBe(true);
    expect(store.remove("mine")).toBe(false);
    expect(store.list().some((s) => s.id === "mine")).toBe(false);
  });

  it("corrupt styles.json yields builtins and leaves no tmp files", () => {
    const d = tmp();
    fs.mkdirSync(path.join(d, "videostudio"));
    fs.writeFileSync(path.join(d, "videostudio", "styles.json"), "{{{");
    const store = createStyleStore(d);
    expect(store.list().length).toBe(9);
    store.save(base);
    expect(store.list().length).toBe(10);
    expect(allFiles(d).filter((f) => f.endsWith(".tmp"))).toEqual([]);
  });
});

describe("validateStyle", () => {
  it("accepts boundary values", () => {
    expect(validateStyle({ ...base, name: "a".repeat(40) }).ok).toBe(true);
    expect(validateStyle({ ...base, shotSec: 0.5 }).ok).toBe(true);
    expect(validateStyle({ ...base, shotSec: 20 }).ok).toBe(true);
    expect(validateStyle({ ...base, transitionSec: 0 }).ok).toBe(true);
    expect(validateStyle({ ...base, transitionSec: 2 }).ok).toBe(true);
  });

  const bad: Array<[string, unknown]> = [
    ["empty name", { ...base, name: "" }],
    ["long name", { ...base, name: "a".repeat(41) }],
    ["transition", { ...base, transition: "wipe" }],
    ["transitionSec", { ...base, transitionSec: 2.1 }],
    ["shotSec low", { ...base, shotSec: 0.4 }],
    ["shotSec high", { ...base, shotSec: 21 }],
    ["textColor", { ...base, textColor: "red" }],
    ["brightness", { ...base, brightness: 1.5 }],
    ["contrast", { ...base, contrast: 3.1 }],
    ["saturation", { ...base, saturation: -0.1 }],
    ["visualPrompt", { ...base, visualPrompt: "x".repeat(401) }],
    ["font", { ...base, font: "x".repeat(61) }],
    ["not object", "abc"],
    ["null", null],
  ];
  for (const [label, raw] of bad) {
    it(`rejects ${label}`, () => {
      const v = validateStyle(raw);
      expect(v.ok).toBe(false);
    });
  }
});
