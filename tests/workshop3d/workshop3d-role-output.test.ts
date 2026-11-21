import { describe, expect, it } from "vitest";
import { parseArt, parseIntake, parseMaterials, parseModel, parseOptimize, parsePlan, parsePresent, parseRenderPlan, parseVerdict, parseW3DRole } from "../../src/core/workshop3d/role-output.js";

const j = (o: unknown) => "Trả lời.\n```json\n" + JSON.stringify(o) + "\n```\n";

describe("parseIntake", () => {
  it("accepts done with a brief", () => {
    const r = parseIntake(j({ done: true, questions: [], brief: { title: "Cabin", object: "cabin thang máy", params: { width: 1100 }, detail: "high" } }));
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.brief?.detail).toBe("high");
  });
  it("accepts brief.slots and rejects a bad slot", () => {
    const brief = { title: "Cabin", object: "cabin", params: {}, detail: "high", slots: [{ id: "handrail", name: "Tay vịn", type: "part" }, { id: "floor_stone", name: "Đá sàn", type: "material" }] };
    const r = parseIntake(j({ done: true, questions: [], brief }));
    expect(r.ok && r.value.brief?.slots?.map((s) => s.id)).toEqual(["handrail", "floor_stone"]);
    expect(parseIntake(j({ done: true, questions: [], brief: { ...brief, slots: [{ id: "Bad Id", name: "x" }] } })).ok).toBe(false);
    const none = parseIntake(j({ done: true, questions: [], brief: { ...brief, slots: [] } }));
    expect(none.ok && none.value.brief?.slots).toBeUndefined();
  });
  it("needs a brief when done", () => {
    expect(parseIntake(j({ done: true, questions: [] })).ok).toBe(false);
  });
  it("accepts not done with up to 5 questions, rejects 6", () => {
    expect(parseIntake(j({ done: false, questions: ["a", "b"] })).ok).toBe(true);
    expect(parseIntake(j({ done: false, questions: ["1", "2", "3", "4", "5", "6"] })).ok).toBe(false);
  });
});

describe("parsePlan", () => {
  const good = { bbox_mm: [1100, 1400, 2300], tolerance_mm: 2, parts: [{ id: "wall_back", name: "Vách sau", material: "inox_hairline" }] };
  it("accepts a plan", () => expect(parsePlan(j(good)).ok).toBe(true));
  it("rejects empty parts, bad bbox, duplicate ids, unsafe ids", () => {
    expect(parsePlan(j({ ...good, parts: [] })).ok).toBe(false);
    expect(parsePlan(j({ ...good, bbox_mm: [1, 2] })).ok).toBe(false);
    expect(parsePlan(j({ ...good, bbox_mm: [0, 1, 1] })).ok).toBe(false);
    expect(parsePlan(j({ ...good, parts: [good.parts[0], good.parts[0]] })).ok).toBe(false);
    expect(parsePlan(j({ ...good, parts: [{ id: "../x", name: "x", material: "m" }] })).ok).toBe(false);
  });
});

describe("parseModel", () => {
  it("takes the last python block", () => {
    const r = parseModel("```python\nprint(1)\n```\nsửa:\n```python\nprint(2)\n```");
    expect(r.ok && r.value.script).toBe("print(2)");
  });
  it("accepts the fence language in any case (```Python, ```PYTHON)", () => {
    const r = parseModel("```Python\nprint(3)\n```");
    expect(r.ok && r.value.script).toBe("print(3)");
    const u = parseModel("```PYTHON\nprint(4)\n```");
    expect(u.ok && u.value.script).toBe("print(4)");
  });
  it("rejects missing, empty and oversized scripts", () => {
    expect(parseModel("không có khối").ok).toBe(false);
    expect(parseModel("```python\n\n```").ok).toBe(false);
    expect(parseModel("```python\n" + "x".repeat(200_001) + "\n```").ok).toBe(false);
  });
});

describe("parseMaterials", () => {
  const m = { materials: { wall_back: { color: [0.8, 0.8, 0.82], metallic: 1, roughness: 0.35, texture: { kind: "hairline", scale: 40, angle: 90 } } } };
  it("accepts and rejects out-of-range values", () => {
    expect(parseMaterials(j(m)).ok).toBe(true);
    expect(parseMaterials(j({ materials: { a: { color: [2, 0, 0], metallic: 0, roughness: 0 } } })).ok).toBe(false);
    expect(parseMaterials(j({ materials: { a: { color: [0, 0, 0], metallic: 0, roughness: 0, texture: { kind: "velvet", scale: 1, angle: 0 } } } })).ok).toBe(false);
    expect(parseMaterials(j({ materials: {} })).ok).toBe(false);
  });
  it("accepts diamond_plate and stripes with an optional color2; a bad color2 fails", () => {
    const tp = parseMaterials(j({ materials: { san: { color: [0.7, 0.7, 0.72], metallic: 1, roughness: 0.4, texture: { kind: "diamond_plate", scale: 8, angle: 0 } } } }));
    expect(tp.ok).toBe(true);
    const st = parseMaterials(j({ materials: { bumper: { color: [0.95, 0.72, 0.04], metallic: 0, roughness: 0.5, texture: { kind: "stripes", scale: 10, angle: 0, color2: [0, 0, 0] } } } }));
    expect(st.ok && st.value.materials["bumper"]!.texture).toEqual({ kind: "stripes", scale: 10, angle: 0, color2: [0, 0, 0] });
    expect(parseMaterials(j({ materials: { b: { color: [1, 1, 0], metallic: 0, roughness: 0.5, texture: { kind: "stripes", scale: 10, angle: 0, color2: [2, 0, 0] } } } })).ok).toBe(false);
  });
  it("accepts the stone/wood/fabric kinds and a material library folder (no '..')", () => {
    for (const kind of ["granite", "marble", "wood", "fabric"]) {
      expect(parseMaterials(j({ materials: { a: { color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.4, texture: { kind, scale: 60, angle: 0 } } } })).ok, kind).toBe(true);
    }
    const lib = parseMaterials(j({ materials: { a: { color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.4, library: "granite/kim-sa" } } }));
    expect(lib.ok && lib.value.materials["a"]!.library).toBe("granite/kim-sa");
    expect(parseMaterials(j({ materials: { a: { color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.4, library: "../secret" } } })).ok).toBe(false);
    expect(parseMaterials(j({ materials: { a: { color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.4, library: "a\\..\\b" } } })).ok).toBe(false);
  });
});

describe("parseRenderPlan / parseVerdict / parseOptimize / parsePresent", () => {
  it("render plan", () => {
    expect(parseRenderPlan(j({ environment: "studio", exposure: 1, cameras: [{ name: "front", azimuth: 0, elevation: 10, distance: 3 }] })).ok).toBe(true);
    expect(parseRenderPlan(j({ environment: "moon", exposure: 1, cameras: [] })).ok).toBe(false);
  });
  it("verdict", () => {
    const good = { scores: { beauty: 7, detail: 6, proportion: 8 }, ok: false, issues: [{ target: "material", text: "inox phẳng" }] };
    expect(parseVerdict(j(good)).ok).toBe(true);
    expect(parseVerdict(j({ ...good, scores: { beauty: 11, detail: 1, proportion: 1 } })).ok).toBe(false);
    expect(parseVerdict(j({ ...good, issues: [{ target: "x", text: "y" }] })).ok).toBe(false);
  });
  it("optimize", () => {
    expect(parseOptimize(j({ max_triangles: 100000, texture_px: 2048, notes: "ok" })).ok).toBe(true);
    expect(parseOptimize(j({ max_triangles: -1, texture_px: 2048, notes: "" })).ok).toBe(false);
  });
  it("present is free text", () => {
    expect(parsePresent("  # Cabin\nMô tả.  ").ok).toBe(true);
    expect(parsePresent("   ").ok).toBe(false);
  });
  it("art and dispatcher", () => {
    expect(parseArt(j({ style: "sang trọng", palette: ["#c9a24a"], materials: ["inox gương"] })).ok).toBe(true);
    expect(parseW3DRole("art-director", j({ style: "s", palette: [], materials: [] })).ok).toBe(true);
    expect(parseW3DRole("nope" as never, "x").ok).toBe(false);
  });
});
