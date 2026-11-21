import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const KEYS = [
  "d3_building_name", "d3_new_model",
  "d3_tpl_cabin_passenger", "d3_tpl_landing_door", "d3_tpl_cop_panel", "d3_tpl_cabin_ceiling", "d3_tpl_handrail",
  "d3_status_building", "d3_status_done", "d3_status_error", "d3_status_queued", "d3_status_cancelled",
  "d3_add_agents", "d3_view_model", "d3_no_model", "d3_python_warning",
];
const langs = ["vi", "en"] as const;
const get = (lang: "vi" | "en", k: string) => (dicts[lang] as Record<string, string>)[k];

describe("design3d i18n keys", () => {
  it("all d3 keys exist and are non-empty in vi and en", () => {
    for (const lang of langs) for (const k of KEYS) expect((get(lang, k) ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("building name", () => {
    expect(dicts.vi.d3_building_name).toBe("Xưởng mẫu 3D");
    expect(dicts.en.d3_building_name).toBe("3D Studio");
  });
  it("python warning mentions CadQuery and build123d", () => {
    for (const lang of langs) {
      expect(get(lang, "d3_python_warning")).toContain("CadQuery");
      expect(get(lang, "d3_python_warning")).toContain("build123d");
    }
  });
  it("reuses city_ground_floor, no d3_ground_floor", () => {
    for (const lang of langs) {
      expect((get(lang, "city_ground_floor") ?? "").length).toBeGreaterThan(0);
      expect(get(lang, "d3_ground_floor")).toBeUndefined();
    }
  });
  it("d3_tpl_* keys match the kit template ids", () => {
    const kit = JSON.parse(readFileSync(new URL("../../config/design3d-kit.json", import.meta.url), "utf8")) as { templates: { id: string }[] };
    const expected = kit.templates.map((tp) => `d3_tpl_${tp.id.replace(/-/g, "_")}`).sort();
    expect(expected.length).toBe(5);
    for (const lang of langs) {
      const have = Object.keys(dicts[lang]).filter((k) => k.startsWith("d3_tpl_")).sort();
      expect(have).toEqual(expected);
    }
  });
});
