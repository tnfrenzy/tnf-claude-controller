import { execFileSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findCadPython } from "../../src/core/design3d/cad-tools.js";

const python = findCadPython();
const tools = path.resolve("tools/workshop3d");
const parts = path.resolve("tests/fixtures/workshop3d/cabin-parts");
const mats = path.resolve("tests/fixtures/workshop3d/cabin-materials.json");

// Quadric decimation needs the optional fast-simplification package; skip that test when it is absent.
const canDecimate = python ? spawnSync(python, ["-c", "import fast_simplification"]).status === 0 : false;

function run(script: string, ...args: string[]): Record<string, unknown> {
  const out = execFileSync(python!, [path.join(tools, script), ...args], { encoding: "utf8", timeout: 300_000 });
  return JSON.parse(out.trim().split("\n").pop()!);
}

/** Runs a script that is expected to fail: returns exit code and the stdout lines. */
function runFail(script: string, ...args: string[]): { code: number | null; lines: string[]; json: Record<string, unknown> } {
  const r = spawnSync(python!, [path.join(tools, script), ...args], { encoding: "utf8", timeout: 300_000 });
  const lines = (r.stdout ?? "").trim().split("\n").filter(Boolean);
  return { code: r.status, lines, json: JSON.parse(lines[lines.length - 1] ?? "{}") };
}

function partsDirWith(files: Record<string, Buffer | string>): string {
  const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-parts-"));
  for (const [n, c] of Object.entries(files)) fs.writeFileSync(path.join(d, n), c);
  return d;
}

type GltfMaterial = { name?: string; normalTexture?: unknown; pbrMetallicRoughness: { baseColorTexture?: unknown; metallicRoughnessTexture?: unknown } };
function glbJson(file: string): Record<string, unknown> {
  const buf = fs.readFileSync(file);
  return JSON.parse(buf.subarray(20, 20 + buf.readUInt32LE(12)).toString("utf8"));
}
/** Local file headers of a zip, in order: name, compression method and the offset of the file data. */
function zipEntries(buf: Buffer): { name: string; method: number; dataOffset: number }[] {
  const out: { name: string; method: number; dataOffset: number }[] = [];
  let o = 0;
  while (o + 30 <= buf.length && buf.readUInt32LE(o) === 0x04034b50) {
    const method = buf.readUInt16LE(o + 8);
    const size = buf.readUInt32LE(o + 18);
    const nameLen = buf.readUInt16LE(o + 26);
    const extraLen = buf.readUInt16LE(o + 28);
    const name = buf.subarray(o + 30, o + 30 + nameLen).toString("utf8");
    const dataOffset = o + 30 + nameLen + extraLen;
    out.push({ name, method, dataOffset });
    o = dataOffset + size;
  }
  return out;
}

describe.skipIf(!python)("assemble_glb.py and export_usdz.py on the cabin fixture", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-asm-"));
  it("writes a metre-scale GLB with one node per part", () => {
    const glb = path.join(dir, "m.glb");
    const r = run("assemble_glb.py", parts, mats, glb);
    expect(r["ok"]).toBe(true);
    expect(r["parts"]).toBe(14);
    expect(r["missing_materials"]).toEqual([]);
    // stats for build.json / ar-optimizer: texture size used and number of distinct textures
    expect(r["texture_px"]).toBe(1024);
    expect(typeof r["textures"]).toBe("number");
    const bbox = r["bbox_m"] as number[];
    // cabin is ~1.15 x 1.45 x 2.4 m (sill sticks out): any axis order, all in metres
    expect(Math.max(...bbox)).toBeGreaterThan(2);
    expect(Math.max(...bbox)).toBeLessThan(3);
    expect(fs.statSync(glb).size).toBeGreaterThan(10_000);
  });
  it("reports parts without a material (inherited by name, w3d_matinherit.py)", () => {
    const partial = path.join(dir, "partial.json");
    fs.writeFileSync(partial, JSON.stringify({ materials: { floor: { color: [0.5, 0.5, 0.5], metallic: 0, roughness: 0.5 } } }));
    const r = run("assemble_glb.py", parts, partial, path.join(dir, "p.glb"));
    // every cabin part name has a keyword category (wall, door, ceiling, handrail...): nothing is left grey
    expect(r["missing_materials"]).toEqual([]);
    expect(Object.keys(r["inherited_materials"] as object).length).toBe(13);
  });
  it.skipIf(!canDecimate)("respects --max-triangles by decimating in passes (needs fast-simplification)", () => {
    // 14 parts keep at least 12 faces each (168): a 500 budget is reachable, so the result must be within 5 %.
    const r = run("assemble_glb.py", parts, mats, path.join(dir, "small.glb"), "--max-triangles", "500");
    expect(r["ok"]).toBe(true);
    expect(r["decimation"]).toBe("applied");
    expect(r["triangles"] as number).toBeLessThanOrEqual(500 * 1.05);
  });
  it.skipIf(!canDecimate)("an unreachable budget stops at the per-part floor and says so", () => {
    const r = run("assemble_glb.py", parts, mats, path.join(dir, "tiny.glb"), "--max-triangles", "100");
    expect(r["ok"]).toBe(true);
    expect(r["triangles"] as number).toBeLessThanOrEqual(14 * 12 * 1.5);
    expect((r["warnings"] as string[]).join(" ")).toMatch(/tối thiểu/);
  });
  it.skipIf(!canDecimate)("lands near the budget, not far below it, when quadric decimation refuses some parts", () => {
    // E30 regression: multi-body bumpers (quadric refuses them) went to vertex clustering with a coarse first cell and
    // a flat subdivided panel collapsed far under its target: 388 540 -> 7 190 triangles for a 60 000 budget.
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-dec-"));
    const gen = [
      "import sys, trimesh",
      "d = sys.argv[1]",
      "b = trimesh.creation.box((1.0, 0.02, 2.0))",
      "for _ in range(5): b = b.subdivide()",
      "b.export(d + '/panel_a.stl')",
      "for name in ('bumper_a', 'bumper_b'):",
      "    segs = []",
      "    for i in range(20):",
      "        c = trimesh.creation.cylinder(radius=0.03, height=0.12, sections=160)",
      "        c.apply_transform(trimesh.transformations.rotation_matrix(1.5708, (0, 1, 0)))",
      "        c.apply_translation((i * 0.125, 0, 0))",
      "        segs.append(c)",
      "    trimesh.util.concatenate(segs).export(d + '/' + name + '.stl')",
    ].join("\n");
    execFileSync(python!, ["-c", gen, d], { encoding: "utf8", timeout: 120_000 });
    const empty = path.join(d, "m.json");
    fs.writeFileSync(empty, JSON.stringify({ materials: {} }));
    const r = run("assemble_glb.py", d, empty, path.join(d, "o.glb"), "--max-triangles", "6000");
    expect(r["decimation"]).toBe("applied");
    expect(r["triangles"] as number).toBeLessThanOrEqual(6000);
    expect(r["triangles"] as number).toBeGreaterThanOrEqual(6000 * 0.6);
  });
  it("accepts --max-triangles without crashing even when decimation is unavailable", () => {
    const r = run("assemble_glb.py", parts, mats, path.join(dir, "small2.glb"), "--max-triangles", "500");
    expect(r["ok"]).toBe(true);
    expect(typeof r["triangles"]).toBe("number");
  });
  it("writes a USDZ with its textures inside (stored, 64-byte aligned, layer first)", () => {
    const usdz = path.join(dir, "m.usdz");
    const r = run("export_usdz.py", parts, mats, usdz);
    expect(r["ok"]).toBe(true);
    expect(fs.statSync(usdz).size).toBeGreaterThan(5_000);
    expect(r["textures"] as number).toBeGreaterThan(0);
    const entries = zipEntries(fs.readFileSync(usdz));
    expect(entries[0]!.name).toMatch(/\.usd[ac]?$/);
    for (const e of entries) {
      expect(e.method, e.name).toBe(0);
      expect(e.dataOffset % 64, e.name).toBe(0);
    }
    const images = entries.filter((e) => /\.(png|jpg)$/.test(e.name));
    expect(images.length).toBeGreaterThanOrEqual(3); // hairline + brushed + noise albedo at least
    expect(entries.some((e) => /normal/.test(e.name))).toBe(true);
  });
  it("fails with ONE JSON line and exit 1 on an empty STL, naming the file", () => {
    const bad = partsDirWith({ "floor.stl": "" });
    for (const script of ["assemble_glb.py", "export_usdz.py"]) {
      const r = runFail(script, bad, mats, path.join(dir, `bad.${script === "assemble_glb.py" ? "glb" : "usdz"}`));
      expect(r.code, script).toBe(1);
      expect(r.lines.length, script).toBe(1);
      expect(r.json["ok"]).toBe(false);
      expect(String(r.json["error"])).toContain("floor.stl");
    }
  });
  it("rejects a stem with uppercase or space, and does not strip any prefix", () => {
    const stl = fs.readFileSync(path.join(parts, "floor.stl"));
    const bad = partsDirWith({ "Floor Plate.stl": stl });
    const r = runFail("assemble_glb.py", bad, mats, path.join(dir, "bad2.glb"));
    expect(r.code).toBe(1);
    expect(r.json["ok"]).toBe(false);
    expect(String(r.json["error"])).toContain("Floor Plate.stl");
    const ok = partsDirWith({ "elevator_cabin_floor.stl": stl, "floor.stl": stl });
    const r2 = run("assemble_glb.py", ok, mats, path.join(dir, "two.glb"));
    expect(r2["parts"]).toBe(2);
  });
  it("defaults missing metallic/roughness and reports warnings", () => {
    const p = path.join(dir, "norough.json");
    fs.writeFileSync(p, JSON.stringify({ materials: { floor: { color: [0.5, 0.5, 0.5], metallic: 0.3 }, ceiling: { color: [1, 1, 1], roughness: 0.2 } } }));
    for (const [script, out] of [["assemble_glb.py", "w.glb"], ["export_usdz.py", "w.usdz"]] as const) {
      const r = run(script, parts, p, path.join(dir, out));
      expect(r["ok"], script).toBe(true);
      expect((r["warnings"] as string[]).join(" ")).toContain("floor");
      expect((r["warnings"] as string[]).join(" ")).toContain("ceiling");
    }
  });
  it("embeds procedural albedo, normal and metallic-roughness textures once each, and the GLB validates", async () => {
    const glb = path.join(dir, "tex.glb");
    const r = run("assemble_glb.py", parts, mats, glb);
    expect(r["texture_kinds"]).toEqual(["brushed", "hairline", "noise"]);
    const doc = glbJson(glb);
    const wall = (doc.materials as GltfMaterial[]).find((m) => m.name === "wall_left")!;
    expect(wall.pbrMetallicRoughness.baseColorTexture).toBeDefined();
    expect(wall.pbrMetallicRoughness.metallicRoughnessTexture).toBeDefined();
    expect(wall.normalTexture).toBeDefined();
    // 3 texture sets (hairline, brushed, noise) x 3 maps; trimesh alone would write one copy per material
    expect((doc.images as unknown[]).length).toBe(9);
    expect(r["images"]).toBe(9);
    const v = await import("gltf-validator");
    const report = await v.validateBytes(new Uint8Array(fs.readFileSync(glb)));
    expect(report.issues.numErrors, JSON.stringify(report.issues.messages.slice(0, 3))).toBe(0);
  });
  it("makes granite, marble, wood and fabric textures and reads a material library folder", () => {
    const lib = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-lib-"));
    fs.copyFileSync(path.resolve("ui/public/favicon-tn-64.png"), path.join(lib, "albedo.png"));
    fs.writeFileSync(path.join(lib, "meta.json"), JSON.stringify({ tile_cm: 60 }));
    const m = JSON.parse(fs.readFileSync(mats, "utf8"));
    const t = (kind: string) => ({ color: [0.7, 0.68, 0.64], metallic: 0, roughness: 0.4, texture: { kind, scale: 50, angle: 0 } });
    m.materials.floor = t("granite");
    m.materials.ceiling = t("marble");
    m.materials.wall_left = t("wood");
    m.materials.wall_right = t("fabric");
    m.materials.wall_back = { ...t("noise"), library: lib };
    m.materials.door_sill = { ...t("noise"), library: "no-such-folder" };
    const p = path.join(dir, "kinds.json");
    fs.writeFileSync(p, JSON.stringify(m));
    const r = run("assemble_glb.py", parts, p, path.join(dir, "kinds.glb"), "--texture-px", "256");
    expect(r["ok"]).toBe(true);
    for (const k of ["granite", "marble", "wood", "fabric", "library"]) expect(r["texture_kinds"]).toContain(k);
    expect((r["warnings"] as string[]).join(" ")).toContain("no-such-folder");
  });
  it("makes the goods-lift tread plate (diamond_plate) and yellow/black bumper (stripes) textures", async () => {
    const m = JSON.parse(fs.readFileSync(mats, "utf8"));
    m.materials.floor = { color: [0.7, 0.7, 0.72], metallic: 1, roughness: 0.4, texture: { kind: "diamond_plate", scale: 8, angle: 0 } };
    m.materials.handrail_back = { color: [0.95, 0.72, 0.04], metallic: 0, roughness: 0.5, texture: { kind: "stripes", scale: 10, angle: 0, color2: [0.02, 0.02, 0.02] } };
    m.materials.wall_back = { color: [0.95, 0.72, 0.04], metallic: 0, roughness: 0.5, texture: { kind: "stripes", scale: 10, angle: 0 } };
    const p = path.join(dir, "goods.json");
    fs.writeFileSync(p, JSON.stringify(m));
    const glb = path.join(dir, "goods.glb");
    const r = run("assemble_glb.py", parts, p, glb, "--texture-px", "256");
    expect(r["ok"]).toBe(true);
    expect(r["texture_kinds"]).toEqual(expect.arrayContaining(["diamond_plate", "stripes"]));
    const doc = glbJson(glb) as { materials: GltfMaterial[] };
    const floor = doc.materials.find((x) => x.name === "floor")!;
    expect(floor.normalTexture).toBeDefined();
    expect(floor.pbrMetallicRoughness.baseColorTexture).toBeDefined();
    const idx = (n: string) => (doc.materials.find((x) => x.name === n)!.pbrMetallicRoughness.baseColorTexture as { index: number }).index;
    expect(idx("handrail_back")).not.toBe(idx("floor"));
    const { validateBytes } = await import("gltf-validator");
    const rep = await validateBytes(new Uint8Array(fs.readFileSync(glb)));
    expect(rep.issues.numErrors).toBe(0);
  });
  it("names GLB materials after the part id", () => {
    const glb = path.join(dir, "named.glb");
    run("assemble_glb.py", parts, mats, glb);
    const buf = fs.readFileSync(glb);
    const jsonLen = buf.readUInt32LE(12);
    const doc = JSON.parse(buf.subarray(20, 20 + jsonLen).toString("utf8"));
    const names = (doc.materials as { name?: string }[]).map((m) => m.name);
    expect(names).toContain("floor");
    expect(names).toContain("handrail_back");
  });
}, 600_000);
