import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { W3D_ROLE_IDS } from "../../ui/src/office/workshop3d.js";
import { w3dLabelsFrom } from "../../ui/src/office/workshop3d-scene.js";

const PHASES = ["idle", "intake", "ask", "art", "plan", "model", "build", "material", "render", "review", "optimize", "present", "done", "rest", "failed"];
const keys = (lang: "vi" | "en") => Object.keys(dicts[lang]).filter((k) => k.startsWith("w3r_")).sort();

describe("w3r_ i18n keys", () => {
  it("vi and en have exactly the same non-empty keys", () => {
    expect(keys("vi")).toEqual(keys("en"));
    expect(keys("vi").length).toBeGreaterThan(40);
    for (const lang of ["vi", "en"] as const) for (const k of keys(lang)) expect(((dicts[lang] as Record<string, string>)[k] ?? "").trim().length, `${lang}.${k}`).toBeGreaterThan(0);
  });
  it("every phase, role and speech line exists", () => {
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const p of PHASES) expect(d[`w3r_phase_${p}`], `${lang} phase ${p}`).toBeTruthy();
      for (const r of W3D_ROLE_IDS) {
        expect(d[`w3r_role_${r}`], `${lang} role ${r}`).toBeTruthy();
        expect(d[`w3r_say_${r}`], `${lang} say ${r}`).toBeTruthy();
      }
    }
  });
  it("speech labels are built from the dictionary", () => {
    const L = w3dLabelsFrom(dicts.vi as unknown as Record<string, string>);
    expect(L.drink).toBeTruthy();
    expect(L.chat.length).toBeGreaterThan(1);
    expect(L.cheer.length).toBeGreaterThan(1);
    expect(Object.keys(L.say)).toHaveLength(9);
  });
});
