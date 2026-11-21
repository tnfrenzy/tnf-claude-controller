import { describe, expect, it } from "vitest";
import { buildPaletteItems, filterPaletteItems, foldText } from "../ui/src/palette.js";
import { isPaletteKey } from "../ui/src/shortcuts.js";
import { fold } from "../src/core/app/util.js";
import { dicts } from "../ui/src/i18n.js";
import type { ProjectSummary } from "../ui/src/types.js";

const t = dicts.vi;

const proj = (name: string) => ({ name, project: name }) as unknown as ProjectSummary;

describe("foldText", () => {
  it("matches fold() of util", () => {
    for (const s of ["Đường Lịch Sử Thiết Kế", "đĐ ăâêôơư", "plain ABC"]) expect(foldText(s)).toBe(fold(s));
  });
});

describe("buildPaletteItems / filterPaletteItems", () => {
  const items = buildPaletteItems({ data: { projects: [proj("alpha")] }, t });

  it("orders pages then envs, with no run items", () => {
    expect(items.map((i) => i.id)).toEqual(["page:cmd", "page:history", "page:library", "page:settings", "env:alpha"]);
    expect(items.some((i) => (i.group as string) === "run")).toBe(false);
    expect(items.find((i) => i.id === "env:alpha")?.action).toEqual({ kind: "env", name: "alpha" });
  });
  it("filters accent-insensitively", () => {
    const r = filterPaletteItems(items, "lich su");
    expect(r.map((i) => i.id)).toContain("page:history");
    expect(r.find((i) => i.id === "page:history")?.label).toBe("Lịch sử");
    expect(filterPaletteItems(items, "  ")).toBe(items);
    expect(filterPaletteItems(items, "zzzz")).toEqual([]);
  });
  it("has no hints without shortcuts", () => {
    expect(items.every((i) => i.hint === undefined)).toBe(true);
  });
  it("adds Alt+<KEY> hints from shortcuts, skipping empty keys", () => {
    const out = buildPaletteItems({ data: { projects: [proj("alpha"), proj("beta")] }, t, shortcuts: { "page:cmd": "R", "page:history": "", "env:alpha": "A" } });
    expect(out.find((i) => i.id === "page:cmd")?.hint).toBe("Alt+R");
    expect(out.find((i) => i.id === "page:history")?.hint).toBeUndefined();
    expect(out.find((i) => i.id === "env:alpha")?.hint).toBe("Alt+A");
    expect(out.find((i) => i.id === "env:beta")?.hint).toBeUndefined();
  });
});

describe("isPaletteKey", () => {
  const base = { key: "k", ctrlKey: false, metaKey: false, altKey: false };
  it("accepts Ctrl+K and Meta+K", () => {
    expect(isPaletteKey({ ...base, ctrlKey: true })).toBe(true);
    expect(isPaletteKey({ ...base, metaKey: true, key: "K" })).toBe(true);
  });
  it("rejects others", () => {
    expect(isPaletteKey(base)).toBe(false);
    expect(isPaletteKey({ ...base, ctrlKey: true, altKey: true })).toBe(false);
    expect(isPaletteKey({ ...base, ctrlKey: true, shiftKey: true })).toBe(false);
    expect(isPaletteKey({ ...base, ctrlKey: true, isComposing: true })).toBe(false);
    expect(isPaletteKey({ ...base, ctrlKey: true, key: "j" })).toBe(false);
  });
});
