// Material inheritance (tools/workshop3d/w3d_matinherit.py): one rule for assemble_glb.py, export_usdz.py and Blender.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";

const python = findCadPython();
const tools = path.resolve("tools/workshop3d");

type Out = { resolved: Record<string, Record<string, unknown>>; inherited: Record<string, { from: string; how: string }>; unresolved: string[]; warnings: string[] };
function resolve(materials: Record<string, unknown>, ids: string[]): Out {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-inh-"));
  const f = path.join(d, "materials.json");
  fs.writeFileSync(f, JSON.stringify({ materials }));
  return JSON.parse(execFileSync(python!, [path.join(tools, "w3d_matinherit.py"), f, ...ids], { encoding: "utf8" }).trim());
}

const yellow = { color: [0.9, 0.68, 0.05], metallic: 0, roughness: 0.5 };
const steel = { color: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.3, texture: { kind: "hairline", scale: 40, angle: 0 } };
const led = { color: [0.02, 0.02, 0.02], metallic: 0, roughness: 0.3, emissive: [0.6, 0.02, 0.02] };

describe.skipIf(!python)("w3d_matinherit.py", () => {
  it("E30 regression: CAD-added parts take the parent's material (bumper_*_soc, cop_man_led_nen)", () => {
    const r = resolve({ bumper_trai_thap: yellow, cop_man_led: led, vach_trai_1: steel }, ["bumper_trai_thap", "bumper_trai_thap_soc", "cop_man_led_nen"]);
    expect(r.unresolved).toEqual([]);
    expect(r.inherited["bumper_trai_thap_soc"]).toEqual({ from: "bumper_trai_thap", how: "parent" });
    expect(r.resolved["bumper_trai_thap_soc"]!["color"]).toEqual(yellow.color);
    // a screen's back panel inherits the screen's colour but never glows
    expect(r.inherited["cop_man_led_nen"]!.from).toBe("cop_man_led");
    expect(r.resolved["cop_man_led_nen"]).not.toHaveProperty("emissive");
    expect(r.resolved["bumper_trai_thap"]).toEqual(yellow);
    expect(r.warnings.join(" ")).toMatch(/Kế thừa vật liệu cho 2 chi tiết/);
  });
  it("drops trailing segments one by one, then siblings under the prefix", () => {
    const r = resolve({ bumper: yellow, vach_trai_1: steel, vach_trai_2: steel, vach_trai_3: { ...steel, roughness: 0.2 } }, ["bumper_left_soc", "vach_trai_4"]);
    expect(r.inherited["bumper_left_soc"]).toEqual({ from: "bumper", how: "parent" });
    expect(r.inherited["vach_trai_4"]!.how).toBe("sibling");
    expect(r.resolved["vach_trai_4"]!["roughness"]).toBe(0.3); // most common sibling spec
  });
  it("drops leading segments (exact key only)", () => {
    const r = resolve({ cop_than: steel }, ["nen_cop_than"]);
    expect(r.inherited["nen_cop_than"]).toEqual({ from: "cop_than", how: "trimmed" });
  });
  it("falls back on the keyword category: a key of the same category, else a preset", () => {
    const r = resolve({ wall_back: steel }, ["vach_moi", "tay_vin_sau", "san_phu", "zzz_123"]);
    expect(r.inherited["vach_moi"]).toEqual({ from: "wall_back", how: "category" });
    expect(r.inherited["tay_vin_sau"]).toEqual({ from: "preset:handrail", how: "preset" });
    expect(r.inherited["san_phu"]!.from).toBe("preset:floor");
    expect(r.unresolved).toEqual(["zzz_123"]);
    expect(r.warnings.join(" ")).toMatch(/CẢNH BÁO: còn 1 chi tiết không có vật liệu sau khi suy/);
  });
  it("a lamp found by keyword keeps its glow", () => {
    const lamp = { color: [1, 1, 1], metallic: 0, roughness: 0.4, emissive: [1, 0.95, 0.85] };
    const r = resolve({ den_am_tran_01: lamp }, ["light_extra"]);
    expect(r.resolved["light_extra"]!["emissive"]).toEqual(lamp.emissive);
  });
});

describe.skipIf(!python)("assemble_glb.py uses the inheritance", () => {
  it("parts missing from materials.json inherit and are reported", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-inh-asm-"));
    const gen = [
      "import sys, trimesh",
      "d = sys.argv[1]",
      "trimesh.creation.box((1.0, 0.1, 0.1)).export(d + '/bumper_left.stl')",
      "b = trimesh.creation.box((0.2, 0.11, 0.11)); b.apply_translation((0, 0, 0.3)); b.export(d + '/bumper_left_soc.stl')",
      "c = trimesh.creation.box((0.2, 0.2, 0.2)); c.apply_translation((0, 0, 0.8)); c.export(d + '/zzz_odd.stl')",
    ].join("\n");
    execFileSync(python!, ["-c", gen, d]);
    const m = path.join(d, "m.json");
    fs.writeFileSync(m, JSON.stringify({ materials: { bumper_left: yellow } }));
    const out = execFileSync(python!, [path.join(tools, "assemble_glb.py"), d, m, path.join(d, "o.glb")], { encoding: "utf8" });
    const r = JSON.parse(out.trim().split("\n").pop()!);
    expect(r.ok).toBe(true);
    expect(r.inherited_materials).toEqual({ bumper_left_soc: { from: "bumper_left", how: "parent" } });
    expect(r.missing_materials).toEqual(["zzz_odd"]);
    expect((r.warnings as string[]).join(" ")).toMatch(/CẢNH BÁO: còn 1 chi tiết/);
    // the GLB material of the inherited part carries the parent's yellow
    const buf = fs.readFileSync(path.join(d, "o.glb"));
    const doc = JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8"));
    const mat = (doc.materials as { name: string; pbrMetallicRoughness: { baseColorFactor: number[] } }[]).find((x) => x.name === "bumper_left_soc")!;
    expect(mat.pbrMetallicRoughness.baseColorFactor[0]).toBeCloseTo(0.9, 2);
  });
});

describe("Blender scripts share the same rule", () => {
  it("render_view.py and export_glb.py expand materials.json through w3d_matinherit before assigning", () => {
    const bs = fs.readFileSync(path.join(tools, "blender", "w3d_bscene.py"), "utf8");
    expect(bs).toMatch(/import w3d_matinherit as mi/);
    for (const f of ["render_view.py", "export_glb.py"]) {
      expect(fs.readFileSync(path.join(tools, "blender", f), "utf8")).toMatch(/spec = S\.inherit_materials\(objs, spec\)/);
    }
  });
});

describe("material-artist sees the parts the CAD script added", () => {
  const brief = { title: "Cabin", object: "cabin", params: {}, detail: "standard" as const, attachments: [] };
  const plan = { bbox_mm: [1, 1, 1] as [number, number, number], tolerance_mm: 2, parts: [{ id: "bumper_left", name: "Bumper", material: "nhua" }] };
  it("lists modelParts as data and tells the role they inherit when left out", async () => {
    const { buildPrompt, MODEL_PARTS_TEXT } = await import("../../src/core/workshop3d/prompts.js");
    const p = buildPrompt("material-artist", { brief, plan, round: 0, modelParts: ["bumper_left_soc"] });
    expect(p).toContain("Chi tiết bước CAD tự thêm");
    expect(p).toContain("- bumper_left_soc");
    expect(p).toContain(MODEL_PARTS_TEXT);
    expect(buildPrompt("material-artist", { brief, plan, round: 0 })).not.toContain(MODEL_PARTS_TEXT);
  });
  it("crossCheckMaterials keeps entries of model parts and still drops unknown ids", async () => {
    const { crossCheckMaterials } = await import("../../src/core/workshop3d/runner-helpers.js");
    const m = { color: [0, 0, 0] as [number, number, number], metallic: 0, roughness: 0.5 };
    const r = crossCheckMaterials(plan, { bumper_left: m, bumper_left_soc: m, ghost: m }, ["bumper_left_soc"]);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(Object.keys(r.value.materials).sort()).toEqual(["bumper_left", "bumper_left_soc"]);
    expect(r.value.note).toMatch(/ghost/);
  });
  it("modelPartsOutsidePlan reads outputs/parts/*.stl minus the plan ids", async () => {
    const { modelPartsOutsidePlan } = await import("../../src/core/workshop3d/runner-steps.js");
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-mp-"));
    expect(modelPartsOutsidePlan(d, plan)).toEqual([]);
    fs.mkdirSync(path.join(d, "outputs", "parts"), { recursive: true });
    for (const n of ["bumper_left.stl", "bumper_left_soc.stl", "notes.txt", "Bad Name.stl"]) fs.writeFileSync(path.join(d, "outputs", "parts", n), "x");
    expect(modelPartsOutsidePlan(d, plan)).toEqual(["bumper_left_soc"]);
  });
});
