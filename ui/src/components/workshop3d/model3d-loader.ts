export type ModelLoaderKind = "stl" | "glb" | "gltf" | "unsupported";

/** Pick a three.js loader from the file extension (case-insensitive, / or \ paths). */
export function pickModelLoader(relPath: string): ModelLoaderKind {
  const name = relPath.split(/[\\/]/).pop() ?? "";
  const dot = name.lastIndexOf(".");
  if (dot < 0) return "unsupported";
  const ext = name.slice(dot + 1).toLowerCase();
  if (ext === "stl") return "stl";
  if (ext === "glb") return "glb";
  if (ext === "gltf") return "gltf";
  return "unsupported";
}

export function isViewable(kind: ModelLoaderKind): boolean {
  return kind !== "unsupported";
}
