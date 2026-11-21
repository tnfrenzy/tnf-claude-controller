// src/core/workshop3d/glb.ts — small, dependency-free GLB editor used to build configuration variants of a master model:
// parse/write, node lookup + world bounding boxes, material import, planar UV generation, part (node) replacement.
// Pure code on Buffers: no Python, no AI. Only what the variant builder needs (no skins, animations or sparse accessors).

export interface Glb {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  json: any;
  bin: Buffer;
}

export class GlbError extends Error {}

export type Mat4 = number[];
export interface Box { min: [number, number, number]; max: [number, number, number] }

const MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;
const FLOAT = 5126;
const pad4 = (n: number): number => (n + 3) & ~3;

export function parseGlb(buf: Buffer): Glb {
  if (buf.length < 20 || buf.readUInt32LE(0) !== MAGIC) throw new GlbError("Không phải tệp GLB.");
  if (buf.readUInt32LE(4) !== 2) throw new GlbError("Chỉ hỗ trợ GLB phiên bản 2.");
  let off = 12;
  let json: unknown = null;
  let bin: Buffer = Buffer.alloc(0);
  while (off + 8 <= buf.length) {
    const len = buf.readUInt32LE(off);
    const type = buf.readUInt32LE(off + 4);
    const body = buf.subarray(off + 8, off + 8 + len);
    if (off + 8 + len > buf.length) throw new GlbError("GLB bị cắt cụt.");
    if (type === CHUNK_JSON) json = JSON.parse(body.toString("utf8"));
    else if (type === CHUNK_BIN && bin.length === 0) bin = Buffer.from(body);
    off += 8 + pad4(len);
  }
  if (!json || typeof json !== "object") throw new GlbError("GLB thiếu khối JSON.");
  return { json, bin };
}

export function writeGlb(g: Glb): Buffer {
  const j = g.json;
  j.buffers = [{ byteLength: g.bin.length }];
  if (g.bin.length === 0) delete j.buffers;
  // glTF forbids empty top-level arrays (the validator reports EMPTY_ENTITY): drop the ones the merge created empty.
  for (const k of ["samplers", "images", "textures", "materials", "accessors", "bufferViews", "meshes", "nodes"]) {
    if (Array.isArray(j[k]) && j[k].length === 0) delete j[k];
  }
  const jb = Buffer.from(JSON.stringify(j), "utf8");
  const jpad = Buffer.alloc(pad4(jb.length) - jb.length, 0x20);
  const bpad = Buffer.alloc(pad4(g.bin.length) - g.bin.length, 0);
  const hasBin = g.bin.length > 0;
  const total = 12 + 8 + jb.length + jpad.length + (hasBin ? 8 + g.bin.length + bpad.length : 0);
  const head = Buffer.alloc(20);
  head.writeUInt32LE(MAGIC, 0);
  head.writeUInt32LE(2, 4);
  head.writeUInt32LE(total, 8);
  head.writeUInt32LE(jb.length + jpad.length, 12);
  head.writeUInt32LE(CHUNK_JSON, 16);
  const parts: Buffer[] = [head, jb, jpad];
  if (hasBin) {
    const bh = Buffer.alloc(8);
    bh.writeUInt32LE(g.bin.length + bpad.length, 0);
    bh.writeUInt32LE(CHUNK_BIN, 4);
    parts.push(bh, g.bin, bpad);
  }
  return Buffer.concat(parts);
}

// ---------- matrices (column-major, as glTF) ----------
export const IDENT: Mat4 = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];

export function mul(a: Mat4, b: Mat4): Mat4 {
  const o = new Array<number>(16).fill(0);
  for (let c = 0; c < 4; c++) for (let r = 0; r < 4; r++) {
    let s = 0;
    for (let k = 0; k < 4; k++) s += a[k * 4 + r]! * b[c * 4 + k]!;
    o[c * 4 + r] = s;
  }
  return o;
}

export function translation(x: number, y: number, z: number): Mat4 {
  return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, x, y, z, 1];
}

export function invert(m: Mat4): Mat4 {
  const inv = new Array<number>(16);
  const a = m;
  inv[0] = a[5]! * a[10]! * a[15]! - a[5]! * a[11]! * a[14]! - a[9]! * a[6]! * a[15]! + a[9]! * a[7]! * a[14]! + a[13]! * a[6]! * a[11]! - a[13]! * a[7]! * a[10]!;
  inv[4] = -a[4]! * a[10]! * a[15]! + a[4]! * a[11]! * a[14]! + a[8]! * a[6]! * a[15]! - a[8]! * a[7]! * a[14]! - a[12]! * a[6]! * a[11]! + a[12]! * a[7]! * a[10]!;
  inv[8] = a[4]! * a[9]! * a[15]! - a[4]! * a[11]! * a[13]! - a[8]! * a[5]! * a[15]! + a[8]! * a[7]! * a[13]! + a[12]! * a[5]! * a[11]! - a[12]! * a[7]! * a[9]!;
  inv[12] = -a[4]! * a[9]! * a[14]! + a[4]! * a[10]! * a[13]! + a[8]! * a[5]! * a[14]! - a[8]! * a[6]! * a[13]! - a[12]! * a[5]! * a[10]! + a[12]! * a[6]! * a[9]!;
  inv[1] = -a[1]! * a[10]! * a[15]! + a[1]! * a[11]! * a[14]! + a[9]! * a[2]! * a[15]! - a[9]! * a[3]! * a[14]! - a[13]! * a[2]! * a[11]! + a[13]! * a[3]! * a[10]!;
  inv[5] = a[0]! * a[10]! * a[15]! - a[0]! * a[11]! * a[14]! - a[8]! * a[2]! * a[15]! + a[8]! * a[3]! * a[14]! + a[12]! * a[2]! * a[11]! - a[12]! * a[3]! * a[10]!;
  inv[9] = -a[0]! * a[9]! * a[15]! + a[0]! * a[11]! * a[13]! + a[8]! * a[1]! * a[15]! - a[8]! * a[3]! * a[13]! - a[12]! * a[1]! * a[11]! + a[12]! * a[3]! * a[9]!;
  inv[13] = a[0]! * a[9]! * a[14]! - a[0]! * a[10]! * a[13]! - a[8]! * a[1]! * a[14]! + a[8]! * a[2]! * a[13]! + a[12]! * a[1]! * a[10]! - a[12]! * a[2]! * a[9]!;
  inv[2] = a[1]! * a[6]! * a[15]! - a[1]! * a[7]! * a[14]! - a[5]! * a[2]! * a[15]! + a[5]! * a[3]! * a[14]! + a[13]! * a[2]! * a[7]! - a[13]! * a[3]! * a[6]!;
  inv[6] = -a[0]! * a[6]! * a[15]! + a[0]! * a[7]! * a[14]! + a[4]! * a[2]! * a[15]! - a[4]! * a[3]! * a[14]! - a[12]! * a[2]! * a[7]! + a[12]! * a[3]! * a[6]!;
  inv[10] = a[0]! * a[5]! * a[15]! - a[0]! * a[7]! * a[13]! - a[4]! * a[1]! * a[15]! + a[4]! * a[3]! * a[13]! + a[12]! * a[1]! * a[7]! - a[12]! * a[3]! * a[5]!;
  inv[14] = -a[0]! * a[5]! * a[14]! + a[0]! * a[6]! * a[13]! + a[4]! * a[1]! * a[14]! - a[4]! * a[2]! * a[13]! - a[12]! * a[1]! * a[6]! + a[12]! * a[2]! * a[5]!;
  inv[3] = -a[1]! * a[6]! * a[11]! + a[1]! * a[7]! * a[10]! + a[5]! * a[2]! * a[11]! - a[5]! * a[3]! * a[10]! - a[9]! * a[2]! * a[7]! + a[9]! * a[3]! * a[6]!;
  inv[7] = a[0]! * a[6]! * a[11]! - a[0]! * a[7]! * a[10]! - a[4]! * a[2]! * a[11]! + a[4]! * a[3]! * a[10]! + a[8]! * a[2]! * a[7]! - a[8]! * a[3]! * a[6]!;
  inv[11] = -a[0]! * a[5]! * a[11]! + a[0]! * a[7]! * a[9]! + a[4]! * a[1]! * a[11]! - a[4]! * a[3]! * a[9]! - a[8]! * a[1]! * a[7]! + a[8]! * a[3]! * a[5]!;
  inv[15] = a[0]! * a[5]! * a[10]! - a[0]! * a[6]! * a[9]! - a[4]! * a[1]! * a[10]! + a[4]! * a[2]! * a[9]! + a[8]! * a[1]! * a[6]! - a[8]! * a[2]! * a[5]!;
  const det = a[0]! * inv[0]! + a[1]! * inv[4]! + a[2]! * inv[8]! + a[3]! * inv[12]!;
  if (Math.abs(det) < 1e-12) throw new GlbError("Ma trận node không khả nghịch.");
  return inv.map((v) => v / det);
}

export interface GlbNodeLike {
  matrix?: number[];
  translation?: number[];
  rotation?: number[];
  scale?: number[];
}

export function nodeMatrix(n: GlbNodeLike): Mat4 {
  if (Array.isArray(n.matrix) && n.matrix.length === 16) return n.matrix as Mat4;
  const t: number[] = n.translation ?? [0, 0, 0];
  const [x, y, z, w]: number[] = n.rotation ?? [0, 0, 0, 1];
  const s: number[] = n.scale ?? [1, 1, 1];
  const xx = x! * x!, yy = y! * y!, zz = z! * z!, xy = x! * y!, xz = x! * z!, yz = y! * z!, wx = w! * x!, wy = w! * y!, wz = w! * z!;
  return [
    (1 - 2 * (yy + zz)) * s[0]!, 2 * (xy + wz) * s[0]!, 2 * (xz - wy) * s[0]!, 0,
    2 * (xy - wz) * s[1]!, (1 - 2 * (xx + zz)) * s[1]!, 2 * (yz + wx) * s[1]!, 0,
    2 * (xz + wy) * s[2]!, 2 * (yz - wx) * s[2]!, (1 - 2 * (xx + yy)) * s[2]!, 0,
    t[0]!, t[1]!, t[2]!, 1,
  ];
}

// ---------- graph helpers ----------
export function parentMap(g: Glb): Map<number, number> {
  const m = new Map<number, number>();
  ((g.json.nodes ?? []) as { children?: number[] }[]).forEach((n, i) => (n.children ?? []).forEach((c) => m.set(c, i)));
  return m;
}

export function worldMatrix(g: Glb, idx: number, parents = parentMap(g)): Mat4 {
  let m = nodeMatrix(g.json.nodes[idx]);
  let p = parents.get(idx);
  let guard = 0;
  while (p !== undefined && guard++ < 1000) {
    m = mul(nodeMatrix(g.json.nodes[p]), m);
    p = parents.get(p);
  }
  return m;
}

export function nodeNames(g: Glb): string[] {
  return ((g.json.nodes ?? []) as { name?: string }[]).map((n) => n.name ?? "");
}

/** The node and all its descendants. */
export function subtree(g: Glb, roots: number[]): number[] {
  const out: number[] = [];
  const seen = new Set<number>();
  const walk = (i: number): void => {
    if (seen.has(i)) return;
    seen.add(i);
    out.push(i);
    for (const c of (g.json.nodes[i].children ?? []) as number[]) walk(c);
  };
  roots.forEach(walk);
  return out;
}

/** World-space bounding box (metres) of the meshes of the given nodes and their descendants; null when none has geometry. */
export function bboxOfNodes(g: Glb, roots: number[]): Box | null {
  const parents = parentMap(g);
  const min: [number, number, number] = [Infinity, Infinity, Infinity];
  const max: [number, number, number] = [-Infinity, -Infinity, -Infinity];
  let any = false;
  for (const i of subtree(g, roots)) {
    const node = g.json.nodes[i];
    if (node.mesh === undefined) continue;
    const w = worldMatrix(g, i, parents);
    for (const prim of g.json.meshes[node.mesh].primitives ?? []) {
      const acc = g.json.accessors?.[prim.attributes?.POSITION];
      if (!acc?.min || !acc?.max) continue;
      for (let c = 0; c < 8; c++) {
        const p = [c & 1 ? acc.max[0] : acc.min[0], c & 2 ? acc.max[1] : acc.min[1], c & 4 ? acc.max[2] : acc.min[2]] as number[];
        for (let k = 0; k < 3; k++) {
          const v = w[k]! * p[0]! + w[4 + k]! * p[1]! + w[8 + k]! * p[2]! + w[12 + k]!;
          if (v < min[k]!) min[k] = v;
          if (v > max[k]!) max[k] = v;
        }
        any = true;
      }
    }
  }
  return any ? { min, max } : null;
}

// ---------- binary appends ----------
export function addBufferView(g: Glb, data: Buffer, target?: number): number {
  const off = pad4(g.bin.length);
  g.bin = Buffer.concat([g.bin, Buffer.alloc(off - g.bin.length), data]);
  (g.json.bufferViews ??= []).push({ buffer: 0, byteOffset: off, byteLength: data.length, ...(target ? { target } : {}) });
  return g.json.bufferViews.length - 1;
}

function readFloats(g: Glb, accIdx: number, comps: number): Float32Array {
  const acc = g.json.accessors?.[accIdx];
  if (!acc || acc.componentType !== FLOAT || acc.sparse) throw new GlbError("Accessor không phải float32 thường.");
  const bv = g.json.bufferViews[acc.bufferView];
  const stride: number = bv.byteStride ?? comps * 4;
  const base: number = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
  const out = new Float32Array(acc.count * comps);
  for (let i = 0; i < acc.count; i++) for (let k = 0; k < comps; k++) out[i * comps + k] = g.bin.readFloatLE(base + i * stride + k * 4);
  return out;
}

/** Appends a TEXCOORD_0 accessor made by planar projection. tile: UV in metres * perM; fit: 0..1 over the primitive's extent. */
function planarUv(g: Glb, prim: { attributes: Record<string, number> }, mode: "tile" | "fit", perM: number): void {
  const pos = readFloats(g, prim.attributes["POSITION"]!, 3);
  const nrm = prim.attributes["NORMAL"] !== undefined ? readFloats(g, prim.attributes["NORMAL"], 3) : null;
  const n = pos.length / 3;
  const lo = [Infinity, Infinity, Infinity];
  const hi = [-Infinity, -Infinity, -Infinity];
  for (let i = 0; i < n; i++) for (let k = 0; k < 3; k++) { lo[k] = Math.min(lo[k]!, pos[i * 3 + k]!); hi[k] = Math.max(hi[k]!, pos[i * 3 + k]!); }
  const ext = [0, 1, 2].map((k) => hi[k]! - lo[k]!);
  const flat = ext.indexOf(Math.min(...ext)); // normal-less fallback: drop the thinnest axis
  const uv = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    let a = flat;
    if (nrm) {
      const ax = Math.abs(nrm[i * 3]!), ay = Math.abs(nrm[i * 3 + 1]!), az = Math.abs(nrm[i * 3 + 2]!);
      a = ax >= ay && ax >= az ? 0 : ay >= az ? 1 : 2;
    }
    const [u, v] = a === 0 ? [1, 2] : a === 1 ? [0, 2] : [0, 1];
    const pu = pos[i * 3 + u!]!, pv = pos[i * 3 + v!]!;
    if (mode === "tile") {
      uv[i * 2] = pu * perM;
      uv[i * 2 + 1] = -pv * perM;
    } else {
      uv[i * 2] = (pu - lo[u!]!) / Math.max(1e-6, ext[u!]!);
      uv[i * 2 + 1] = 1 - (pv - lo[v!]!) / Math.max(1e-6, ext[v!]!);
    }
  }
  const bv = addBufferView(g, Buffer.from(uv.buffer, uv.byteOffset, uv.byteLength), 34962);
  (g.json.accessors ??= []).push({ bufferView: bv, componentType: FLOAT, count: n, type: "VEC2" });
  prim.attributes["TEXCOORD_0"] = g.json.accessors.length - 1;
}

// ---------- merge ----------
export interface MergeResult {
  nodeMap: Map<number, number>;
  materialMap: Map<number, number>;
  /** Root nodes of the merged file's default scene, as indices in the target. */
  roots: number[];
}

function shiftTextureIndexes(v: unknown, off: number): void {
  if (Array.isArray(v)) return v.forEach((x) => shiftTextureIndexes(x, off));
  if (!v || typeof v !== "object") return;
  const o = v as Record<string, unknown>;
  if (typeof o["index"] === "number") o["index"] = o["index"] + off;
  for (const k of Object.keys(o)) if (k !== "index") shiftTextureIndexes(o[k], off);
}

/** Copies the other file's buffer, images, textures, materials (and, unless materialsOnly, meshes + nodes) into g. */
export function mergeGlb(g: Glb, o: Glb, opts: { materialsOnly?: boolean } = {}): MergeResult {
  const j = g.json;
  const oj = structuredClone(o.json);
  const binOff = pad4(g.bin.length);
  g.bin = Buffer.concat([g.bin, Buffer.alloc(binOff - g.bin.length), o.bin]);
  const bvOff = (j.bufferViews ??= []).length;
  for (const bv of oj.bufferViews ?? []) j.bufferViews.push({ ...bv, buffer: 0, byteOffset: (bv.byteOffset ?? 0) + binOff });
  const sOff = (j.samplers ??= []).length;
  j.samplers.push(...(oj.samplers ?? []));
  const iOff = (j.images ??= []).length;
  for (const im of oj.images ?? []) j.images.push(im.bufferView !== undefined ? { ...im, bufferView: im.bufferView + bvOff } : im);
  const tOff = (j.textures ??= []).length;
  for (const t of oj.textures ?? []) j.textures.push({ ...t, ...(t.sampler !== undefined ? { sampler: t.sampler + sOff } : {}), ...(t.source !== undefined ? { source: t.source + iOff } : {}) });
  const mOff = (j.materials ??= []).length;
  const materialMap = new Map<number, number>();
  (oj.materials ?? []).forEach((m: unknown, i: number) => {
    shiftTextureIndexes(m, tOff);
    j.materials.push(m);
    materialMap.set(i, mOff + i);
  });
  const nodeMap = new Map<number, number>();
  if (opts.materialsOnly) return { nodeMap, materialMap, roots: [] };
  const aOff = (j.accessors ??= []).length;
  for (const a of oj.accessors ?? []) {
    if (a.sparse) throw new GlbError("Bộ phận có accessor sparse, chưa hỗ trợ.");
    j.accessors.push(a.bufferView !== undefined ? { ...a, bufferView: a.bufferView + bvOff } : a);
  }
  const meshOff = (j.meshes ??= []).length;
  for (const m of oj.meshes ?? []) {
    for (const p of m.primitives ?? []) {
      for (const k of Object.keys(p.attributes ?? {})) p.attributes[k] += aOff;
      if (p.indices !== undefined) p.indices += aOff;
      if (p.material !== undefined) p.material += mOff;
      for (const t of p.targets ?? []) for (const k of Object.keys(t)) t[k] += aOff;
    }
    j.meshes.push(m);
  }
  const nOff = (j.nodes ??= []).length;
  for (const n of oj.nodes ?? []) {
    const c = { ...n };
    delete c.skin;
    delete c.camera;
    if (c.mesh !== undefined) c.mesh += meshOff;
    if (c.children) c.children = c.children.map((x: number) => x + nOff);
    j.nodes.push(c);
  }
  (oj.nodes ?? []).forEach((_: unknown, i: number) => nodeMap.set(i, nOff + i));
  const scene = oj.scenes?.[oj.scene ?? 0];
  const roots: number[] = ((scene?.nodes ?? []) as number[]).map((x) => x + nOff);
  return { nodeMap, materialMap, roots };
}

// ---------- slot operations ----------
export interface MaterialPlacement { mode: "tile" | "fit"; tileCm: number }

/** Gives every mesh of the nodes (and descendants) the material, with planar UV. Meshes are cloned: shared meshes stay as they were. */
export function setNodesMaterial(g: Glb, roots: number[], materialIndex: number, place: MaterialPlacement): number {
  let primitives = 0;
  const perM = 100 / Math.max(1, place.tileCm);
  for (const i of subtree(g, roots)) {
    const node = g.json.nodes[i];
    if (node.mesh === undefined) continue;
    const clone = structuredClone(g.json.meshes[node.mesh]);
    for (const p of clone.primitives ?? []) {
      p.material = materialIndex;
      planarUv(g, p, place.mode, perM);
      primitives++;
    }
    g.json.meshes.push(clone);
    node.mesh = g.json.meshes.length - 1;
  }
  return primitives;
}

/** Imports material `src` of a (small) GLB such as a library slab.glb; returns its index in g. */
export function importMaterial(g: Glb, source: Glb, src = 0): number {
  if (!source.json.materials?.[src]) throw new GlbError("Tấm vật liệu không có material.");
  const r = mergeGlb(g, source, { materialsOnly: true });
  return r.materialMap.get(src)!;
}

/** Removes the slot nodes from the scene and puts the part GLB at the centre of their old bounding box. */
export function replaceNodesWithPart(g: Glb, slotNodes: number[], part: Glb, wrapperName: string): void {
  if (slotNodes.length === 0) throw new GlbError("Slot chưa khớp node nào.");
  const parents = parentMap(g);
  const slotBox = bboxOfNodes(g, slotNodes);
  const parent = parents.get(slotNodes[0]!);
  const merged = mergeGlb(g, part);
  if (merged.roots.length === 0) throw new GlbError("Bộ phận không có cảnh (scene) nào.");
  const partBox = bboxOfNodes(g, merged.roots);
  if (!partBox) throw new GlbError("Bộ phận không có hình học.");
  const sBox = slotBox ?? partBox;
  const centre = (b: Box): number[] => [0, 1, 2].map((k) => (b.min[k]! + b.max[k]!) / 2);
  const sc = centre(sBox), pc = centre(partBox);
  const parentWorld = parent === undefined ? IDENT : worldMatrix(g, parent, parents);
  const local = mul(invert(parentWorld), translation(sc[0]! - pc[0]!, sc[1]! - pc[1]!, sc[2]! - pc[2]!));
  g.json.nodes.push({ name: wrapperName, matrix: local, children: merged.roots });
  const wrapper = g.json.nodes.length - 1;
  const drop = new Set(slotNodes);
  const prune = (list: number[]): number[] => list.filter((x) => !drop.has(x));
  for (const n of g.json.nodes) if (n.children) n.children = prune(n.children);
  if (parent === undefined) {
    const sc0 = g.json.scenes[g.json.scene ?? 0];
    sc0.nodes = [...prune(sc0.nodes ?? []), wrapper];
  } else {
    g.json.nodes[parent].children = [...(g.json.nodes[parent].children ?? []), wrapper];
  }
}
