// Tiny hand-made GLBs for the variant tests: a library "slab" (textured PBR material) and a ready-made part.
import zlib from "node:zlib";
import { writeGlb, type Glb } from "../../../src/core/workshop3d/glb.js";

export function png1(): Buffer {
  const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
  const crc = (b: Buffer) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff]! ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
  const chunk = (t: string, d: Buffer) => { const l = Buffer.alloc(4); l.writeUInt32BE(d.length); const td = Buffer.concat([Buffer.from(t), d]); const c = Buffer.alloc(4); c.writeUInt32BE(crc(td)); return Buffer.concat([l, td, c]); };
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(1, 0); ihdr.writeUInt32BE(1, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), chunk("IHDR", ihdr), chunk("IDAT", zlib.deflateSync(Buffer.from([0, 200, 120, 40, 255]))), chunk("IEND", Buffer.alloc(0))]);
}

/** A tiny "library slab": one triangle with one textured PBR material. */
export function slabGlb(): Buffer {
  const png = png1();
  const g: Glb = {
    json: {
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "slab" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [0, 0, 0], max: [1, 1, 0] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }, { buffer: 0, byteOffset: 36, byteLength: png.length }],
      materials: [{ name: "stone", pbrMetallicRoughness: { baseColorTexture: { index: 0 }, metallicRoughnessTexture: { index: 1 } }, normalTexture: { index: 2 } }],
      textures: [{ source: 0 }, { source: 0 }, { source: 0 }], images: [{ bufferView: 1, mimeType: "image/png" }],
    },
    bin: Buffer.concat([Buffer.alloc(36), png]),
  };
  return writeGlb(g);
}

/** A tiny "ready-made part" far from the origin. */
export function partGlb(): Buffer {
  const pos = new Float32Array([5, 5, 5, 5.2, 5, 5, 5, 5.2, 5.2]);
  const g: Glb = {
    json: {
      asset: { version: "2.0" }, scene: 0, scenes: [{ nodes: [0] }], nodes: [{ mesh: 0, name: "gold_bar" }],
      meshes: [{ primitives: [{ attributes: { POSITION: 0 }, material: 0 }] }],
      accessors: [{ bufferView: 0, componentType: 5126, count: 3, type: "VEC3", min: [5, 5, 5], max: [5.2, 5.2, 5.2] }],
      bufferViews: [{ buffer: 0, byteOffset: 0, byteLength: 36 }], materials: [{ name: "gold" }],
    },
    bin: Buffer.from(pos.buffer),
  };
  return writeGlb(g);
}

