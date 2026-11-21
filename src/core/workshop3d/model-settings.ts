// src/core/workshop3d/model-settings.ts — user choice of model for the 3D workshop roles (Settings > Điều chỉnh).
// Saved in <dataDir>/app-settings.json under `workshop3d.models`; empty = the model written in roles-design3d.json.

/** `main` = every role whose file model is not "haiku"; `light` = the roles the file gives "haiku". */
export interface W3DModelSettings {
  main?: string;
  light?: string;
}

export type W3DModelGroup = "main" | "light";

/** File model that marks a role as light (the cheap, quick roles of roles-design3d.json). */
export const W3D_LIGHT_FILE_MODEL = "haiku";

export function w3dModelGroup(fileModel: string | undefined): W3DModelGroup {
  return fileModel === W3D_LIGHT_FILE_MODEL ? "light" : "main";
}

/** Keep only non-empty string fields (the file may be hand-edited). */
export function sanitizeW3DModels(raw: unknown): W3DModelSettings {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const r = raw as Record<string, unknown>;
  const out: W3DModelSettings = {};
  for (const k of ["main", "light"] as const) {
    const v = r[k];
    if (typeof v === "string" && v.trim()) out[k] = v.trim();
  }
  return out;
}

export type W3DModelsCheck = { ok: true; models: W3DModelSettings } | { ok: false; message: string };

/**
 * Validate a PUT body `{main?, light?}`: each field is a model id of controller.json `models`,
 * or "" / null to go back to the role file. Messages are Vietnamese (shown to the user as-is).
 */
export function validateW3DModels(body: unknown, modelIds: readonly string[]): W3DModelsCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, message: "Dữ liệu model của xưởng 3D không hợp lệ." };
  const raw = body as Record<string, unknown>;
  for (const k of Object.keys(raw)) if (k !== "main" && k !== "light") return { ok: false, message: `Khóa lạ trong cài đặt model xưởng 3D: ${k}.` };
  const out: W3DModelSettings = {};
  for (const k of ["main", "light"] as const) {
    const v = raw[k];
    if (v === undefined || v === null || v === "") continue;
    if (typeof v !== "string" || !modelIds.includes(v.trim())) {
      const label = k === "main" ? "vai chính" : "vai nhẹ";
      return { ok: false, message: `Model cho ${label} của xưởng 3D không có trong danh sách model của app (${modelIds.join(", ")}): ${String(v)}.` };
    }
    out[k] = v.trim();
  }
  return { ok: true, models: out };
}

/**
 * Model for one role call: the saved setting of its group when it is a known id, otherwise the role file's model.
 * An unknown saved id (hand-edited file, model removed from controller.json) is ignored, never passed to `claude`.
 */
export function pickW3DModel(fileModel: string | undefined, settings: W3DModelSettings | undefined, modelIds?: readonly string[]): string | undefined {
  const chosen = settings?.[w3dModelGroup(fileModel)];
  if (chosen && (!modelIds || modelIds.includes(chosen))) return chosen;
  return fileModel;
}
