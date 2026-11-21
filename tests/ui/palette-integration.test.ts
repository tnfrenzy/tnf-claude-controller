import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildPaletteItems } from "../../ui/src/palette";
import { runPaletteAction } from "../../ui/src/paletteActions";
import { isPopupId } from "../../ui/src/lib/popup";
import { dicts } from "../../ui/src/i18n";

const root = path.resolve(__dirname, "..", "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");

const KEYS = [
  "palette_title",
  "palette_placeholder",
  "palette_empty",
  "palette_loading",
  "palette_group_runs",
  "palette_group_envs",
  "palette_group_pages",
  "palette_open_hint",
];

describe("palette integration", () => {
  it("App.tsx wires CommandPalette, shortcuts and dispatcher", () => {
    const src = read("ui/src/App.tsx");
    expect(src).toMatch(/import \{ CommandPalette \}/);
    expect(src).toContain("isPaletteKey");
    expect(src).toContain("matchShortcut");
    expect(src).toMatch(/import \{ runPaletteAction \}/);
    expect(src).toMatch(/isPaletteKey\(e, [^)]*\)\) \{\s*e\.preventDefault\(\)/);
    expect(src).toContain("<CommandPalette");
  });

  it("Settings has the Shortcuts section", () => {
    expect(read("ui/src/pages/SettingsPanel.tsx")).toContain("ShortcutsSection");
  });

  it("page items open valid popup ids", () => {
    const items = buildPaletteItems({ data: { projects: [] }, t: dicts.vi });
    const pages = items.filter((i) => i.id.startsWith("page:"));
    expect(pages.length).toBeGreaterThanOrEqual(4);
    for (const p of pages) {
      if (p.action.kind === "open") expect(isPopupId(p.action.id), p.id).toBe(true);
    }
  });

  it("env action reaches pickEnv only", () => {
    const h = { navigate: vi.fn(), pickEnv: vi.fn(), onOpen: vi.fn() };
    runPaletteAction({ kind: "env", name: "default" }, h);
    expect(h.pickEnv).toHaveBeenCalledTimes(1);
    expect(h.pickEnv).toHaveBeenCalledWith("default");
    expect(h.navigate).not.toHaveBeenCalled();
    expect(h.onOpen).not.toHaveBeenCalled();
    expect(read("ui/src/App.tsx")).toMatch(/runPaletteAction\([^)]*pickEnv/);
  });

  it("palette i18n keys exist in vi and en, non-empty", () => {
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const k of KEYS) {
        expect(typeof d[k], `${lang}.${k}`).toBe("string");
        expect(d[k].length, `${lang}.${k}`).toBeGreaterThan(0);
      }
    }
    const used = new Set<string>();
    for (const f of ["ui/src/components/CommandPalette.tsx", "ui/src/palette.ts", "ui/src/components/settings/ShortcutsSection.tsx"]) {
      for (const m of read(f).matchAll(/\bpalette_[a-z_]+/g)) used.add(m[0]);
    }
    for (const k of used) {
      const both = k in dicts.vi && k in dicts.en;
      expect(KEYS.includes(k) || both, k).toBe(true);
    }
  });
});
