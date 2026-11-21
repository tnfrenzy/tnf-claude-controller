import { useState } from "react";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";
import {
  W3D_IMAGE_ACCEPT, W3D_IMAGE_LIMITS, W3D_LIMITS, addReferenceImages, buildWorkshop3DBrief, safeImageName,
  type W3DDetail, type W3DParamRow, type W3DSlotRow,
} from "../../office/workshop3d-session";
import type { Design3DKit, Workshop3DBriefInput } from "../../types";

export type Design3DMode = "product" | "space";
/** Marker the intake and planning roles read: the request is a whole space (room / scene of many objects), not one product. */
export const SPACE_PREFIX = "[DỰNG KHÔNG GIAN: phòng hoặc cảnh gồm nhiều vật thể, bố trí tổng thể] ";
import { Modal } from "../common/Modal";
import { SlotRows } from "./SlotRows";

export interface Design3DParams {
  width: number | string;
  depth: number | string;
  height: number | string;
  material: string;
}

function toDim(v: number | string): number | null {
  if (typeof v === "string" && v.trim() === "") return null;
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.min(20000, Math.max(1, Math.round(n)));
}

/** Fill the {{width}} {{depth}} {{height}} {{material}} placeholders. Returns null when a dimension is invalid. */
export function fillDesign3DPrompt(template: string, p: Design3DParams): string | null {
  const w = toDim(p.width);
  const d = toDim(p.depth);
  const h = toDim(p.height);
  if (w === null || d === null || h === null) return null;
  const material = String(p.material ?? "").trim().slice(0, 40);
  return template
    .replace(/\{\{width\}\}/g, () => String(w))
    .replace(/\{\{depth\}\}/g, () => String(d))
    .replace(/\{\{height\}\}/g, () => String(h))
    .replace(/\{\{material\}\}/g, () => material);
}

/** Add each role to the Library one by one; skip known ones and 409 (already there). Returns the number added. */
export async function addKitToLibrary(
  roleIds: string[],
  inLibrary: string[],
  add: (id: string) => Promise<unknown> = (id) => api.addFromCatalog(id),
): Promise<number> {
  let added = 0;
  for (const id of roleIds) {
    if (inLibrary.includes(id)) continue;
    try {
      await add(id);
      added++;
    } catch (e) {
      if (e instanceof ApiError && e.status === 409) continue;
      throw e;
    }
  }
  return added;
}

/** Upload the reference images to one inbox stage (names made inbox-safe) and create the session with that stage. */
export async function createWithImages(
  brief: Workshop3DBriefInput,
  images: readonly File[],
  deps: {
    stage: (file: File, stageId: string | null) => Promise<{ stage_id: string }>;
    create: (brief: Workshop3DBriefInput, stageId: string | null) => Promise<{ slug: string }>;
  } = { stage: (f, s) => api.stageInbox(f, s), create: (b, s) => api.workshop3dCreate(b, s) },
): Promise<{ slug: string }> {
  let stageId: string | null = null;
  const taken = new Set<string>();
  for (const img of images) {
    const name = safeImageName(img.name, taken);
    taken.add(name.toLowerCase());
    const file = name === img.name ? img : new File([img], name, { type: img.type });
    stageId = (await deps.stage(file, stageId)).stage_id;
  }
  return deps.create(brief, stageId);
}

const fmtKb = (n: number): string => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

const DETAILS: readonly W3DDetail[] = ["standard", "high", "ultra"];
const EMPTY_ROWS: W3DParamRow[] = [{ key: "", value: "" }];

/**
 * "Tạo mẫu" request sheet of the 3D workshop (spec section 10, A + B): free name, description, parameter rows,
 * material, purpose and detail level; an elevator template of the kit pre-fills it. Submitting creates a session.
 */
export function Design3DPanel(props: {
  kit: Design3DKit | null;
  onCreated: (slug: string) => void;
  onClose: () => void;
  /** Injected in tests; defaults to POST /api/inbox for each image, then POST /api/workshop3d. */
  create?: (brief: Workshop3DBriefInput, images: readonly File[]) => Promise<{ slug: string }>;
}) {
  const { t } = useT();
  const [mode, setMode] = useState<Design3DMode>("product");
  const [title, setTitle] = useState("");
  const [object, setObject] = useState("");
  const [rows, setRows] = useState<W3DParamRow[]>(EMPTY_ROWS);
  const [material, setMaterial] = useState("");
  const [purpose, setPurpose] = useState("");
  const [detail, setDetail] = useState<W3DDetail>("high");
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [images, setImages] = useState<File[]>([]);
  const [slotRows, setSlotRows] = useState<W3DSlotRow[]>([]);

  const pickImages = (list: FileList | null) => {
    if (!list || list.length === 0) return;
    const r = addReferenceImages(images, Array.from(list));
    setImages(r.images);
    setMsg(r.error ? t[`w3i_err_${r.error}` as const] : null);
  };

  const setRow = (i: number, patch: Partial<W3DParamRow>) => setRows((rs) => rs.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  const submit = async () => {
    const r = buildWorkshop3DBrief({ title, object: mode === "space" && object.trim() ? SPACE_PREFIX + object.trim() : object, rows, material, purpose, detail, slots: mode === "space" ? [] : slotRows });
    if ("error" in r) {
      setMsg(t[`w3i_err_${r.error}` as const]);
      return;
    }
    setMsg(null);
    setBusy(true);
    try {
      const { slug } = await (props.create ?? ((b, imgs) => createWithImages(b, imgs)))(r.brief, images);
      props.onCreated(slug);
    } catch (e) {
      // 400 / 503 answers carry an actionable Vietnamese message (e.g. the CAD python is missing): show it as-is.
      setMsg(e instanceof Error && e.message ? e.message : t.w3i_err_create);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal title={t.w3i_sheet_title} sub={t.w3i_sheet_desc} onClose={props.onClose}>
      <div className="d3p-form w3i-sheet">
        <div className="w3i-wide w3i-modes" role="group" aria-label={t.w3i_mode}>
          <button type="button" data-w3i-mode="product" aria-pressed={mode === "product"} onClick={() => setMode("product")}>{t.w3i_mode_product}</button>{" "}
          <button type="button" data-w3i-mode="space" aria-pressed={mode === "space"} onClick={() => setMode("space")}>{t.w3i_mode_space}</button>
        </div>
        <label>{t.w3i_name}<input type="text" required maxLength={W3D_LIMITS.title} value={title} onChange={(e) => setTitle(e.target.value)} placeholder={mode === "space" ? t.w3i_name_ph_space : t.w3i_name_ph} /></label>
        <label className="w3i-wide">{t.w3i_object}<textarea required rows={3} maxLength={W3D_LIMITS.object} value={object} onChange={(e) => setObject(e.target.value)} placeholder={mode === "space" ? t.w3i_object_ph_space : t.w3i_object_ph} /></label>
        <fieldset className="w3i-params w3i-wide">
          <legend>{t.w3i_params}</legend>
          {rows.map((r, i) => (
            <div key={i} className="w3i-param-row" data-param-row={i}>
              <input type="text" aria-label={t.w3i_param_key} placeholder={t.w3i_param_key} maxLength={W3D_LIMITS.key} value={r.key} onChange={(e) => setRow(i, { key: e.target.value })} />
              <input type="text" aria-label={t.w3i_param_value} placeholder={t.w3i_param_value} maxLength={W3D_LIMITS.value} value={r.value} onChange={(e) => setRow(i, { value: e.target.value })} />
              <button type="button" aria-label={t.w3i_param_remove} onClick={() => setRows((rs) => (rs.length > 1 ? rs.filter((_, j) => j !== i) : EMPTY_ROWS))}>×</button>
            </div>
          ))}
          <button type="button" disabled={rows.length >= W3D_LIMITS.params} onClick={() => setRows((rs) => [...rs, { key: "", value: "" }])}>{t.w3i_param_add}</button>
          <div className="fine">{t.w3i_params_hint}</div>
        </fieldset>
        <fieldset className="w3i-images w3i-wide">
          <legend>{t.w3i_images}</legend>
          <input
            type="file"
            accept={W3D_IMAGE_ACCEPT}
            multiple
            aria-label={t.w3i_images}
            disabled={images.length >= W3D_IMAGE_LIMITS.files}
            onChange={(e) => {
              pickImages(e.target.files);
              e.target.value = "";
            }}
          />
          {images.length > 0 ? (
            <ul className="w3i-image-list">
              {images.map((f, i) => (
                <li key={`${f.name}-${i}`} data-image-row={i}>
                  <span>{f.name} ({fmtKb(f.size)})</span>
                  <button type="button" aria-label={`${t.w3i_image_remove} ${f.name}`} onClick={() => setImages((xs) => xs.filter((_, j) => j !== i))}>×</button>
                </li>
              ))}
            </ul>
          ) : null}
          <div className="fine">{t.w3i_images_hint}</div>
        </fieldset>
        {mode === "product" ? (
          <fieldset className="w3i-params w3i-wide">
            <legend>{t.w3i_slots}</legend>
            <SlotRows rows={slotRows} onChange={setSlotRows} />
            <div className="fine">{t.w3i_slots_hint}</div>
          </fieldset>
        ) : null}
        <label>{t.w3i_material}<input type="text" maxLength={W3D_LIMITS.material} value={material} onChange={(e) => setMaterial(e.target.value)} /></label>
        <label>{t.w3i_purpose}<input type="text" maxLength={W3D_LIMITS.purpose} value={purpose} onChange={(e) => setPurpose(e.target.value)} placeholder={t.w3i_purpose_ph} /></label>
        <label>
          {t.w3i_detail}
          <select value={detail} onChange={(e) => setDetail(e.target.value as W3DDetail)}>
            {DETAILS.map((d) => <option key={d} value={d}>{t[`w3i_detail_${d}` as const]}</option>)}
          </select>
        </label>
        <button type="button" className="primary" disabled={busy} onClick={() => void submit()}>{busy ? t.w3i_creating : t.d3p_create}</button>
      </div>
      <div className="fine">{t.w3i_sheet_note}</div>
      {msg ? <div role="status" className="error w3i-msg">{msg}</div> : null}
    </Modal>
  );
}
