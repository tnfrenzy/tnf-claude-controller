import fs from "node:fs";
import path from "node:path";
import type { ExtraAgentDef } from "../run/extras.js";
import { LibraryError, normalizeName, type LibraryRole, type RoleLibrary } from "./role-library.js";
import { fold } from "../app/util.js";
export { fold };

/** A ready-made role offered in "find new roles" (config/roles-catalog.json, shipped with the app). */
export interface CatalogRole extends ExtraAgentDef {
  id: string;
  name: string;
  tags: string[];
}

export function catalogFile(repoRoot: string): string {
  return path.join(repoRoot, "config", "roles-catalog.json");
}

/** Read the catalog; missing/invalid file → []. */
export function readCatalog(file: string): CatalogRole[] {
  try {
    const j = JSON.parse(fs.readFileSync(file, "utf8")) as unknown;
    if (!Array.isArray(j)) return [];
    return j.filter((r): r is CatalogRole => typeof r === "object" && r !== null && typeof (r as CatalogRole).id === "string");
  } catch {
    return [];
  }
}

/** Case- and accent-insensitive filter over id, name, description and tags; every word of `q` must match. Empty q = all. */
export function searchCatalog(catalog: CatalogRole[], q: string): CatalogRole[] {
  const words = fold(q).split(/\s+/).filter(Boolean);
  if (!words.length) return catalog;
  return catalog.filter((r) => {
    const hay = fold([r.id, r.name, r.description, ...(r.tags ?? [])].join(" "));
    return words.every((w) => hay.includes(w));
  });
}

/** Copy a catalog role into the library. Unknown id → 404; already in the library (or clashing with a built-in) → 409. */
export function addFromCatalog(catalog: CatalogRole[], id: string, library: RoleLibrary): LibraryRole {
  const found = catalog.find((r) => r.id === id);
  if (!found) throw new LibraryError("Không có vai này trong danh mục.", 404);
  const libId = normalizeName(found.id);
  if (library.getRole(libId)) throw new LibraryError(`Vai "${libId}" đã có trong thư viện.`, 409);
  if (library.list().builtinRoles.includes(libId)) throw new LibraryError(`Vai "${libId}" trùng với vai có sẵn.`, 409);
  const body: Record<string, unknown> = { id: libId, description: found.description, prompt: found.prompt, tools: found.tools };
  if (found.model) body["model"] = found.model;
  return library.createRole(body);
}
