/** Read facts out of a GLB's JSON chunk without three.js: triangles, materials, part (node) names, size. */
export interface GlbInfo {
  triangles: number;
  materials: string[];
  /** Names of nodes (in order) that are meshes or have children — the "parts" list. */
  nodes: string[];
  bytes: number;
}

interface GltfJson {
  nodes?: { name?: string; mesh?: number; children?: number[] }[];
  meshes?: { primitives?: { mode?: number; indices?: number; attributes?: Record<string, number> }[] }[];
  accessors?: { count: number }[];
  materials?: { name?: string }[];
}

export function parseGlbInfo(buf: ArrayBuffer): GlbInfo | null {
  if (buf.byteLength < 20) return null;
  const dv = new DataView(buf);
  if (dv.getUint32(0, true) !== 0x46546c67) return null; // "glTF"
  const jsonLen = dv.getUint32(12, true);
  if (dv.getUint32(16, true) !== 0x4e4f534a || 20 + jsonLen > buf.byteLength) return null; // "JSON"
  let json: GltfJson;
  try {
    json = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 20, jsonLen))) as GltfJson;
  } catch {
    return null;
  }
  const acc = json.accessors ?? [];
  let triangles = 0;
  for (const mesh of json.meshes ?? []) {
    for (const p of mesh.primitives ?? []) {
      const mode = p.mode ?? 4;
      const idx = p.indices !== undefined ? acc[p.indices]?.count : undefined;
      const pos = p.attributes?.POSITION !== undefined ? acc[p.attributes.POSITION]?.count : undefined;
      const n = idx ?? pos ?? 0;
      if (mode === 4) triangles += Math.floor(n / 3);
      else if (mode === 5 || mode === 6) triangles += Math.max(0, n - 2);
    }
  }
  const nodes = (json.nodes ?? [])
    .filter((n) => n.name && (n.mesh !== undefined || (n.children?.length ?? 0) > 0))
    .map((n) => n.name as string);
  const materials = [...new Set((json.materials ?? []).map((m, i) => m.name ?? `material_${i}`))];
  return { triangles, materials, nodes, bytes: buf.byteLength };
}
