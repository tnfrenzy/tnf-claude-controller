// src/core/workshop3d/roles.ts
import fs from "node:fs";
import path from "node:path";
import { REPO_ROOT } from "../app/config.js";
import { assertReadOnlyTools } from "../run/permissions.js";
import { WORKSHOP3D_ROLES, type Workshop3DRole } from "./types.js";

export const W3D_ROLES_FILE = path.join(REPO_ROOT, "config", "roles-design3d.json");
export interface W3DRoleDef { description: string; prompt: string; tools: string[]; model: string }

/** Reads and validates the role file; throws a Vietnamese Error when the file is missing or a role is wrong. */
export function loadW3DRoles(file: string = W3D_ROLES_FILE): Record<Workshop3DRole, W3DRoleDef> {
  let raw: unknown;
  try {
    raw = JSON.parse(fs.readFileSync(file, "utf8"));
  } catch (e) {
    throw new Error(`Không đọc được tệp vai dựng 3D (${file}): ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new Error("Tệp vai dựng 3D phải là một đối tượng.");
  const out = {} as Record<Workshop3DRole, W3DRoleDef>;
  for (const id of WORKSHOP3D_ROLES) {
    const d = (raw as Record<string, unknown>)[id] as Partial<W3DRoleDef> | undefined;
    if (!d || typeof d.description !== "string" || typeof d.prompt !== "string" || typeof d.model !== "string" || !Array.isArray(d.tools)) {
      throw new Error(`Thiếu hoặc sai vai "${id}" trong tệp vai dựng 3D.`);
    }
    const tools = d.tools.map(String);
    assertReadOnlyTools(tools);
    out[id] = { description: d.description, prompt: d.prompt, tools, model: d.model };
  }
  return out;
}
