// src/core/workshop3d/role-output.ts
// Validate what each workshop role returns. Pure, never throws, Vietnamese error messages.
import { parseBlock } from "../skill-workshop/round-steps.js";
import type { Parsed } from "../skill-workshop/round-steps.js";
import { normalizeSlots } from "./variants.js";
import { W3D_BRIEF_LIMITS, WORKSHOP3D_ROLES, type W3DBrief, type W3DIssue, type Workshop3DRole } from "./types.js";

const MAX_SCRIPT = 200_000;
const SAFE_ID = /^[a-z0-9][a-z0-9_]{0,63}$/;
const fail = <T>(error: string): Parsed<T> => ({ ok: false, error });
const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const num = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const inRange = (v: unknown, lo: number, hi: number): v is number => num(v) && v >= lo && v <= hi;
const str = (v: unknown, max = 500): v is string => typeof v === "string" && v.trim().length > 0 && v.length <= max;

function guard<T>(fn: () => Parsed<T>): Parsed<T> {
  try {
    return fn();
  } catch {
    return fail("Không đọc được phản hồi của vai (lỗi bất ngờ khi kiểm lược đồ).");
  }
}

function strings(v: unknown, key: string, max: number): Parsed<string[]> {
  if (!Array.isArray(v) || v.length > max || v.some((s) => typeof s !== "string")) return fail(`Khóa ${key} phải là mảng chuỗi (tối đa ${max} mục).`);
  return { ok: true, value: (v as string[]).map((s) => s.slice(0, 500)) };
}

export function parseIntake(text: string): Parsed<{ done: boolean; questions: string[]; brief?: W3DBrief }> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    if (typeof r.value.done !== "boolean") return fail("Khóa done phải là true hoặc false.");
    const q = strings(r.value.questions ?? [], "questions", 5);
    if (!q.ok) return q;
    if (!r.value.done) return { ok: true, value: { done: false, questions: q.value } };
    const b = r.value.brief;
    if (!isObj(b)) return fail("Khi done=true phải có khóa brief là đối tượng.");
    if (!str(b["title"], W3D_BRIEF_LIMITS.title) || !str(b["object"], W3D_BRIEF_LIMITS.object)) {
      return fail(`brief cần title (tối đa ${W3D_BRIEF_LIMITS.title} ký tự) và object (tối đa ${W3D_BRIEF_LIMITS.object} ký tự) là chuỗi không rỗng.`);
    }
    const detail = b["detail"];
    if (detail !== "standard" && detail !== "high" && detail !== "ultra") return fail('brief.detail phải là "standard", "high" hoặc "ultra".');
    const params: Record<string, string | number> = {};
    if (b["params"] !== undefined) {
      if (!isObj(b["params"])) return fail("brief.params phải là đối tượng.");
      for (const [k, v] of Object.entries(b["params"])) {
        if (typeof v !== "string" && !num(v)) return fail(`brief.params.${k} phải là chuỗi hoặc số.`);
        params[k.slice(0, 60)] = typeof v === "string" ? v.slice(0, 200) : v;
      }
    }
    const brief: W3DBrief = { title: b["title"].trim(), object: b["object"].trim(), params, detail, attachments: [] };
    if (typeof b["material"] === "string") brief.material = b["material"].slice(0, W3D_BRIEF_LIMITS.material);
    if (typeof b["purpose"] === "string") brief.purpose = b["purpose"].slice(0, W3D_BRIEF_LIMITS.purpose);
    const slots = normalizeSlots(b["slots"]);
    if (!slots.ok) return fail(slots.error);
    if (slots.value.length > 0) brief.slots = slots.value;
    return { ok: true, value: { done: true, questions: [], brief } };
  });
}

export function parseArt(text: string): Parsed<{ style: string; palette: string[]; materials: string[] }> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    if (!str(r.value.style, 1000)) return fail("Khóa style phải là chuỗi không rỗng.");
    const p = strings(r.value.palette, "palette", 12);
    if (!p.ok) return p;
    const m = strings(r.value.materials, "materials", 20);
    if (!m.ok) return m;
    return { ok: true, value: { style: r.value.style, palette: p.value, materials: m.value } };
  });
}

export interface W3DPlanPart { id: string; name: string; material: string; dims?: string }
export interface W3DPlan { bbox_mm: [number, number, number]; tolerance_mm: number; parts: W3DPlanPart[] }

export function parsePlan(text: string): Parsed<W3DPlan> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    const bb = r.value.bbox_mm;
    if (!Array.isArray(bb) || bb.length !== 3 || !bb.every((n) => inRange(n, 1, 100_000))) return fail("Khóa bbox_mm phải gồm 3 số dương (mm).");
    const tol = r.value.tolerance_mm ?? 2;
    if (!inRange(tol, 0.01, 1000)) return fail("Khóa tolerance_mm phải là số dương.");
    const parts = r.value.parts;
    if (!Array.isArray(parts) || parts.length === 0 || parts.length > 200) return fail("Khóa parts phải là mảng 1 đến 200 bộ phận.");
    const seen = new Set<string>();
    const out: W3DPlanPart[] = [];
    for (const p of parts) {
      if (!isObj(p) || typeof p["id"] !== "string" || !SAFE_ID.test(p["id"])) return fail("Mỗi bộ phận cần id gồm a-z, 0-9, gạch dưới (tối đa 64 ký tự).");
      if (seen.has(p["id"])) return fail(`Trùng id bộ phận: ${p["id"]}.`);
      seen.add(p["id"]);
      if (!str(p["name"], 200) || !str(p["material"], 100)) return fail(`Bộ phận ${p["id"]} cần name và material là chuỗi không rỗng.`);
      out.push({ id: p["id"], name: p["name"], material: p["material"], ...(typeof p["dims"] === "string" ? { dims: p["dims"].slice(0, 200) } : {}) });
    }
    return { ok: true, value: { bbox_mm: [bb[0], bb[1], bb[2]] as [number, number, number], tolerance_mm: tol, parts: out } };
  });
}

export function parseModel(text: string): Parsed<{ script: string }> {
  return guard(() => {
    const re = /```python[^\S\n]*\n([\s\S]*?)```/gi;
    let last: string | null = null;
    for (let m = re.exec(text); m; m = re.exec(text)) last = m[1] ?? "";
    if (last === null) return fail("Không tìm thấy khối ```python trong phản hồi.");
    const script = last.replace(/\s+$/, "");
    if (script.trim().length === 0) return fail("Khối python rỗng.");
    if (script.length > MAX_SCRIPT) return fail("Script quá dài (trên 200000 ký tự).");
    return { ok: true, value: { script } };
  });
}

export interface W3DMaterial {
  color: [number, number, number];
  metallic: number;
  roughness: number;
  /** color2: second band colour of "stripes" (default black). */
  texture?: { kind: W3DTextureKind; scale: number; angle: number; color2?: [number, number, number] };
  /** Material library folder (albedo.png [normal.png roughness.png meta.json]) used instead of the procedural texture. */
  library?: string;
  emissive?: [number, number, number];
  opacity?: number;
}
export const TEXTURE_KINDS = ["hairline", "brushed", "noise", "granite", "marble", "wood", "fabric", "diamond_plate", "stripes", "none"] as const;
export type W3DTextureKind = (typeof TEXTURE_KINDS)[number];
const LIBRARY_RE = /^[^<>|"?*\u0000-\u001f]{1,300}$/;
const rgb = (v: unknown): v is [number, number, number] => Array.isArray(v) && v.length === 3 && v.every((n) => inRange(n, 0, 1));

export function parseMaterials(text: string): Parsed<{ materials: Record<string, W3DMaterial> }> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    const ms = r.value.materials;
    if (!isObj(ms) || Object.keys(ms).length === 0) return fail("Khóa materials phải là đối tượng không rỗng (id bộ phận → vật liệu).");
    const out: Record<string, W3DMaterial> = {};
    for (const [id, m] of Object.entries(ms)) {
      if (!SAFE_ID.test(id) || !isObj(m)) return fail(`Vật liệu của "${id}" không hợp lệ.`);
      if (!rgb(m["color"])) return fail(`${id}.color phải gồm 3 số từ 0 đến 1.`);
      if (!inRange(m["metallic"], 0, 1) || !inRange(m["roughness"], 0, 1)) return fail(`${id}.metallic và roughness phải từ 0 đến 1.`);
      const mat: W3DMaterial = { color: m["color"], metallic: m["metallic"], roughness: m["roughness"] };
      const t = m["texture"];
      if (t !== undefined) {
        if (!isObj(t) || !(TEXTURE_KINDS as readonly string[]).includes(String(t["kind"])) || !inRange(t["scale"], 0.01, 1000) || !inRange(t["angle"], -360, 360)) {
          return fail(`${id}.texture cần kind (${TEXTURE_KINDS.join("/")}), scale và angle hợp lệ.`);
        }
        mat.texture = { kind: t["kind"] as NonNullable<W3DMaterial["texture"]>["kind"], scale: t["scale"] as number, angle: t["angle"] as number };
        if (t["color2"] !== undefined) {
          if (!rgb(t["color2"])) return fail(`${id}.texture.color2 phải gồm 3 số từ 0 đến 1.`);
          mat.texture.color2 = t["color2"];
        }
      }
      if (m["library"] !== undefined) {
        if (typeof m["library"] !== "string" || !LIBRARY_RE.test(m["library"]) || m["library"].split(/[\\/]/).includes("..")) return fail(`${id}.library phải là tên/đường dẫn thư mục thư viện vật liệu (không có "..").`);
        mat.library = m["library"];
      }
      if (m["emissive"] !== undefined) {
        if (!rgb(m["emissive"])) return fail(`${id}.emissive phải gồm 3 số từ 0 đến 1.`);
        mat.emissive = m["emissive"];
      }
      if (m["opacity"] !== undefined) {
        if (!inRange(m["opacity"], 0, 1)) return fail(`${id}.opacity phải từ 0 đến 1.`);
        mat.opacity = m["opacity"];
      }
      out[id] = mat;
    }
    return { ok: true, value: { materials: out } };
  });
}

/** target = optional part id the camera looks at (default: the model centre); distance is measured from it. */
export interface W3DCamera { name: string; azimuth: number; elevation: number; distance: number; target?: string }
export type RenderPlan = { environment: "studio" | "outdoor"; exposure: number; cameras: W3DCamera[] };

export function parseRenderPlan(text: string): Parsed<RenderPlan> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    const env = r.value.environment;
    if (env !== "studio" && env !== "outdoor") return fail('Khóa environment phải là "studio" hoặc "outdoor".');
    if (!inRange(r.value.exposure, 0.1, 5)) return fail("Khóa exposure phải từ 0,1 đến 5.");
    const cams = r.value.cameras;
    if (!Array.isArray(cams) || cams.length > 6) return fail("Khóa cameras phải là mảng tối đa 6 góc.");
    const out: W3DCamera[] = [];
    for (const c of cams) {
      if (!isObj(c) || !str(c["name"], 40) || !inRange(c["azimuth"], -360, 360) || !inRange(c["elevation"], -89, 89) || !inRange(c["distance"], 0.1, 100)) {
        return fail("Mỗi camera cần name, azimuth, elevation (-89..89), distance (0,1..100).");
      }
      if (c["target"] !== undefined && (typeof c["target"] !== "string" || !SAFE_ID.test(c["target"]))) return fail("camera.target phải là id bộ phận (a-z, 0-9, _).");
      out.push({ name: c["name"], azimuth: c["azimuth"], elevation: c["elevation"], distance: c["distance"], ...(typeof c["target"] === "string" ? { target: c["target"] } : {}) });
    }
    return { ok: true, value: { environment: env, exposure: r.value.exposure, cameras: out } };
  });
}

/** likeness: how close the renders are to the user's reference images (only when there are reference images). */
export interface W3DVerdict { scores: { beauty: number; detail: number; proportion: number; likeness?: number }; ok: boolean; issues: W3DIssue[] }
export function parseVerdict(text: string): Parsed<W3DVerdict> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    const s = r.value.scores;
    if (!isObj(s) || !inRange(s["beauty"], 0, 10) || !inRange(s["detail"], 0, 10) || !inRange(s["proportion"], 0, 10)) return fail("Khóa scores cần beauty, detail, proportion từ 0 đến 10.");
    if (typeof r.value.ok !== "boolean") return fail("Khóa ok phải là true hoặc false.");
    const issues = r.value.issues ?? [];
    if (!Array.isArray(issues) || issues.length > 30) return fail("Khóa issues phải là mảng tối đa 30 mục.");
    const out: W3DIssue[] = [];
    for (const i of issues) {
      if (!isObj(i) || !["geometry", "material", "render"].includes(String(i["target"])) || !str(i["text"], 600)) return fail("Mỗi issue cần target (geometry/material/render) và text.");
      const issue: W3DIssue = { target: i["target"] as W3DIssue["target"], text: i["text"] as string };
      // Final review: the high-quality views showing the defect (only those are rendered again); bad names are dropped.
      const views = Array.isArray(i["views"]) ? (i["views"] as unknown[]).filter((v): v is string => typeof v === "string" && /^[a-z0-9_-]{1,44}$/.test(v)).slice(0, 10) : [];
      if (views.length > 0) issue.views = [...new Set(views)];
      out.push(issue);
    }
    const likeness = s["likeness"];
    if (likeness !== undefined && likeness !== null && !inRange(likeness, 0, 10)) return fail("scores.likeness (nếu có) phải từ 0 đến 10.");
    const scores: W3DVerdict["scores"] = { beauty: s["beauty"], detail: s["detail"], proportion: s["proportion"], ...(inRange(likeness, 0, 10) ? { likeness } : {}) };
    return { ok: true, value: { scores, ok: r.value.ok, issues: out } };
  });
}

export function parseOptimize(text: string): Parsed<{ max_triangles: number; texture_px: number; notes: string }> {
  return guard(() => {
    const r = parseBlock(text);
    if (!r.ok) return r;
    if (!inRange(r.value.max_triangles, 1000, 5_000_000) || !Number.isInteger(r.value.max_triangles)) return fail("Khóa max_triangles phải là số nguyên từ 1000 đến 5000000.");
    if (![512, 1024, 2048, 4096].includes(r.value.texture_px as number)) return fail("Khóa texture_px phải là 512, 1024, 2048 hoặc 4096.");
    return { ok: true, value: { max_triangles: r.value.max_triangles, texture_px: r.value.texture_px as number, notes: typeof r.value.notes === "string" ? r.value.notes.slice(0, 2000) : "" } };
  });
}

export function parsePresent(text: string): Parsed<{ summary: string }> {
  const s = text.trim();
  return s.length === 0 ? fail("Phản hồi rỗng.") : { ok: true, value: { summary: s.slice(0, 20_000) } };
}

export function parseW3DRole(role: Workshop3DRole, text: string): Parsed<unknown> {
  switch (role) {
    case "tiep-nhan-3d": return parseIntake(text);
    case "art-director": return parseArt(text);
    case "detail-planner": return parsePlan(text);
    case "cad-modeler": return parseModel(text);
    case "material-artist": return parseMaterials(text);
    case "render-director": return parseRenderPlan(text);
    case "visual-reviewer": return parseVerdict(text);
    case "ar-optimizer": return parseOptimize(text);
    case "render-presenter": return parsePresent(text);
    default: return fail(`Vai không được hỗ trợ: ${String(role).slice(0, 40)}.`);
  }
}
export { WORKSHOP3D_ROLES };
