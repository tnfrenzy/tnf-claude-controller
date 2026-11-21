// Variants of a master model (docs/DESIGN-3D.md 6c): slot validation, slot -> node mapping, config product, GLB merge.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { describe, expect, it } from "vitest";
import { bboxOfNodes, mergeGlb, parseGlb, writeGlb } from "../../src/core/workshop3d/glb.js";
import { partGlb, slabGlb } from "../fixtures/workshop3d/glb-parts.js";
import {
  applyConfig, configProduct, mapSlots, matchPattern, normalizeSlots, optionNameFromCommand, pickSlotFromCommand, slabSizeForSlot, VariantError, type ResolvedOption,
} from "../../src/core/workshop3d/variants.js";
import type { W3DSlot } from "../../src/core/workshop3d/types.js";

const MASTER = fs.readFileSync(path.join(import.meta.dirname, "..", "..", "fixtures", "workshop3d-viewer", "model.glb"));
const SLOTS: W3DSlot[] = [
  { id: "handrail", name: "Tay vịn", type: "part" },
  { id: "wall", name: "Vách", type: "material", nodes: ["wall_left", "wall_right", "wall_back"] },
  { id: "floor", name: "Sàn đá", type: "material" },
];

describe("normalizeSlots", () => {
  it("accepts a valid list and defaults the type", () => {
    const r = normalizeSlots([{ id: "handrail", name: "Tay vịn", type: "part", nodes: ["handrail_*"] }, { id: "stone", name: "Đá" }]);
    expect(r.ok && r.value.map((s) => s.type)).toEqual(["part", "material"]);
  });
  it("rejects bad ids, duplicates, too many, bad types", () => {
    expect(normalizeSlots([{ id: "Bad Id", name: "x" }]).ok).toBe(false);
    expect(normalizeSlots([{ id: "a", name: "x" }, { id: "a", name: "y" }]).ok).toBe(false);
    expect(normalizeSlots(Array.from({ length: 9 }, (_, i) => ({ id: `s${i}`, name: "x" }))).ok).toBe(false);
    expect(normalizeSlots([{ id: "a", name: "x", type: "wild" }]).ok).toBe(false);
    expect(normalizeSlots([{ id: "a", name: "" }]).ok).toBe(false);
    expect(normalizeSlots("x").ok).toBe(false);
  });
  it("treats missing slots as none", () => {
    expect(normalizeSlots(undefined)).toEqual({ ok: true, value: [] });
  });
});

describe("mapping", () => {
  it("matches exact names, prefixes, and the id / id_ default", () => {
    expect(matchPattern("Wall_Left", "wall_left")).toBe(true);
    expect(matchPattern("handrail_back", "handrail_*")).toBe(true);
    expect(matchPattern("handrail_back", "handrail")).toBe(false);
    const m = mapSlots(parseGlb(MASTER), [{ id: "handrail", name: "Tay vịn", type: "part" }, { id: "wall", name: "Vách", type: "material", nodes: ["wall_left", "wall_right"] }, { id: "ghost", name: "Không có", type: "material" }]);
    expect(m[0]!.names).toEqual(["handrail_back", "handrail_bracket_1", "handrail_bracket_2"]);
    expect(m[1]!.names).toEqual(["wall_left", "wall_right"]);
    expect(m[2]!.nodes).toEqual([]);
    expect(m[1]!.size_mm).not.toBeNull();
  });
  it("sizes a library slab from the slot box", () => {
    expect(slabSizeForSlot({ w: 1100, d: 20, h: 2300 })).toEqual({ w: 2300, d: 1100, h: 20 });
    expect(slabSizeForSlot(null)).toEqual({ w: 600, d: 600, h: 20 });
  });
});

describe("commands", () => {
  it("picks the slot named in the command, ignoring accents; ambiguous or unknown gives null", () => {
    expect(pickSlotFromCommand("đá sàn màu kem vân mây", SLOTS)).toBe("floor");
    expect(pickSlotFromCommand("Tay vin inox xước", SLOTS)).toBe("handrail");
    expect(pickSlotFromCommand("tay vịn và đá sàn", SLOTS)).toBeNull();
    expect(pickSlotFromCommand("tay vịn vàng gương", SLOTS)).toBe("handrail");
    expect(pickSlotFromCommand("làm cho đẹp", SLOTS)).toBeNull();
  });
  it("names the option from the first line", () => {
    expect(optionNameFromCommand("\n  Vàng gương  \nghi chú", "x")).toBe("Vàng gương");
    expect(optionNameFromCommand("   ", "Phương án 3")).toBe("Phương án 3");
  });
});

describe("configProduct", () => {
  it("multiplies the options of every slot with options", () => {
    const c = configProduct({ handrail: ["h1", "h2", "h3"], floor: ["f1", "f2", "f3", "f4"], wall: [] }, ["handrail", "wall", "floor"]);
    expect(c).toHaveLength(12);
    expect(c[0]).toEqual({ handrail: "h1", floor: "f1" });
    expect(new Set(c.map((x) => JSON.stringify(x))).size).toBe(12);
  });
  it("rejects over the cap and empty selections", () => {
    expect(() => configProduct({ a: ["1", "2", "3", "4", "5"], b: ["1", "2", "3", "4", "5"] }, ["a", "b"])).toThrow(VariantError);
    expect(() => configProduct({}, ["a"])).toThrow(VariantError);
  });
});

describe("applyConfig", () => {
  const resolve = (id: string): ResolvedOption => id === "gold" ? { kind: "part", glb: partGlb() } : { kind: "material", slab: slabGlb(), mapping: id === "fit" ? "fit" : "tile", tileCm: 50 };

  it("swaps the material of slot nodes only, with generated UVs and embedded textures", () => {
    const g = parseGlb(applyConfig(MASTER, SLOTS, { wall: "tile" }, resolve));
    const before = parseGlb(MASTER);
    const map = mapSlots(g, SLOTS);
    const wallNodes = new Set(map[1]!.nodes);
    expect(g.json.materials.length).toBe(before.json.materials.length + 1);
    expect(g.json.images).toHaveLength(1);
    for (const [i, n] of g.json.nodes.entries()) {
      if (n.mesh === undefined) continue;
      const prims = g.json.meshes[n.mesh].primitives;
      if (wallNodes.has(i)) {
        for (const p of prims) {
          expect(p.material).toBe(g.json.materials.length - 1);
          expect(p.attributes.TEXCOORD_0).toBeTypeOf("number");
        }
      } else {
        expect(prims.every((p: { attributes: Record<string, number> }) => p.attributes.TEXCOORD_0 === undefined)).toBe(true);
      }
    }
    // the master file is untouched (meshes were cloned, not edited)
    expect(JSON.stringify(parseGlb(MASTER).json.meshes)).toBe(JSON.stringify(before.json.meshes));
    // tile UV are metres * (100 / 50 cm): a wall face spans more than half a tile
    const wallPrim = g.json.meshes[g.json.nodes[map[1]!.nodes[0]!].mesh].primitives[0];
    const acc = g.json.accessors[wallPrim.attributes.TEXCOORD_0];
    const bv = g.json.bufferViews[acc.bufferView];
    const us = Array.from({ length: acc.count }, (_, i) => g.bin.readFloatLE(bv.byteOffset + i * 8));
    expect(Math.max(...us) - Math.min(...us)).toBeGreaterThan(0.5);
  });

  it("fit mapping covers each face once (0..1)", () => {
    const g = parseGlb(applyConfig(MASTER, SLOTS, { wall: "fit" }, resolve));
    const n = mapSlots(g, SLOTS)[1]!.nodes[0]!;
    const acc = g.json.accessors[g.json.meshes[g.json.nodes[n].mesh].primitives[0].attributes.TEXCOORD_0];
    const bv = g.json.bufferViews[acc.bufferView];
    for (let i = 0; i < acc.count * 2; i++) {
      const v = g.bin.readFloatLE(bv.byteOffset + i * 4);
      expect(v).toBeGreaterThanOrEqual(-1e-5);
      expect(v).toBeLessThanOrEqual(1 + 1e-5);
    }
  });

  it("replaces slot nodes by a ready-made part centred on the old box", () => {
    const before = parseGlb(MASTER);
    const slotNodes = mapSlots(before, SLOTS)[0]!.nodes;
    const oldBox = bboxOfNodes(before, slotNodes)!;
    const g = parseGlb(applyConfig(MASTER, SLOTS, { handrail: "gold" }, resolve));
    const names: string[] = g.json.nodes.map((n: { name?: string }) => n.name ?? "");
    expect(names).toContain("handrail_variant");
    const wrapper = names.indexOf("handrail_variant");
    const box = bboxOfNodes(g, [wrapper])!;
    for (let k = 0; k < 3; k++) {
      expect((box.min[k]! + box.max[k]!) / 2).toBeCloseTo((oldBox.min[k]! + oldBox.max[k]!) / 2, 4);
    }
    const inScene = new Set<number>();
    const walk = (i: number): void => { inScene.add(i); (g.json.nodes[i].children ?? []).forEach(walk); };
    g.json.scenes[0].nodes.forEach(walk);
    for (const i of slotNodes) expect(inScene.has(i)).toBe(false);
    expect(inScene.has(wrapper)).toBe(true);
    expect(() => parseGlb(writeGlb(g))).not.toThrow();
  });

  it("combines slots and keeps unchosen slots as the master", () => {
    const g = parseGlb(applyConfig(MASTER, SLOTS, { wall: "tile", handrail: "gold", floor: null }, resolve));
    const floorNode = g.json.nodes.findIndex((n: { name?: string }) => n.name === "floor");
    expect(g.json.meshes[g.json.nodes[floorNode].mesh].primitives[0].material).toBe(0);
  });

  it("explains unmatched slots and wrong option kinds in Vietnamese", () => {
    expect(() => applyConfig(MASTER, [{ id: "ghost", name: "Không có", type: "material" }], { ghost: "tile" }, resolve)).toThrow(/chưa khớp/);
    expect(() => applyConfig(MASTER, SLOTS, { wall: "gold" }, resolve)).toThrow(/chỉ nhận phương án vật liệu/);
    expect(() => applyConfig(Buffer.from("nope"), SLOTS, { wall: "tile" }, resolve)).toThrow(VariantError);
  });

  it("mergeGlb re-indexes materials and textures", () => {
    const g = parseGlb(MASTER);
    const nBv = g.json.bufferViews.length;
    const r = mergeGlb(g, parseGlb(slabGlb()), { materialsOnly: true });
    const m = g.json.materials[r.materialMap.get(0)!];
    expect(m.pbrMetallicRoughness.baseColorTexture.index).toBe(0);
    expect(m.normalTexture.index).toBe(2);
    expect(g.json.images[0].bufferView).toBeGreaterThanOrEqual(nBv);
  });
});
