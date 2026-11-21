import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const FILES = [
  "../../ui/src/components/workshop3d/Workshop3DViewer.tsx",
  "../../ui/src/components/workshop3d/Panels.tsx",
  "../../ui/src/components/workshop3d/ModelStage.tsx",
];
const STATES = [
  "intake", "awaiting_user", "art", "planning", "modeling", "building", "materials", "rendering",
  "reviewing", "optimizing", "presenting", "done", "paused", "stopped", "failed", "waiting_quota",
];
const langs = ["vi", "en"] as const;
const get = (lang: "vi" | "en", k: string) => (dicts[lang] as Record<string, string>)[k];

describe("workshop3d viewer i18n (w3v_)", () => {
  const used = new Set<string>();
  for (const f of FILES) {
    const src = readFileSync(new URL(f, import.meta.url), "utf8");
    for (const m of src.matchAll(/\bt\.(w3v_[a-z0-9_]+)/g)) used.add(m[1]!);
  }
  for (const s of STATES) used.add(`w3v_state_${s}`);
  for (const k of ["info", "parts", "renders", "params"]) used.add(`w3v_tab_${k}`);

  it("finds the keys used by the components", () => {
    expect(used.size).toBeGreaterThan(30);
  });
  it("every used key is non-empty in vi and en", () => {
    for (const lang of langs) for (const k of used) expect((get(lang, k) ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("vi and en define exactly the same w3v_ keys", () => {
    const keys = (l: "vi" | "en") => Object.keys(dicts[l]).filter((k) => k.startsWith("w3v_")).sort();
    expect(keys("vi")).toEqual(keys("en"));
  });
  it("placeholders match between languages", () => {
    for (const k of Object.keys(dicts.vi).filter((x) => x.startsWith("w3v_"))) {
      const ph = (l: "vi" | "en") => (get(l, k).match(/\{[a-z]+\}/g) ?? []).sort().join(",");
      expect(ph("vi"), k).toBe(ph("en"));
    }
  });
});
