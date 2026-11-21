import { ApiError, getToken } from "../../api";
import type { BatchStatus, LibraryEntry, LibraryList, Mapping, SizeMm } from "./batch-logic";
import type { W3DApi, W3DDetail } from "./types";

const BASE = "/api/workshop3d/materials";
const auth = (): Record<string, string> => ({ "x-controller-token": getToken() ?? "" });

async function ok(r: Response): Promise<Response> {
  if (r.ok) return r;
  const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
  throw new ApiError(j.message ?? r.statusText, r.status, j.error);
}
const jsonReq = async <T>(path: string, method: string, body?: unknown): Promise<T> =>
  (await ok(await fetch(`${BASE}${path}`, { method, headers: { ...auth(), "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }))).json() as Promise<T>;

export interface BatchOptions { category: string; size_mm: SizeMm; tile_cm: number; mapping: Mapping }

/** Client of /api/workshop3d/materials (token in the header; files come back as blobs, never a token in a URL). */
export interface MaterialsApi {
  list(): Promise<LibraryList>;
  upload(file: File): Promise<{ upload: string; fileName: string }>;
  startBatch(uploads: string[], o: BatchOptions): Promise<BatchStatus>;
  importDir(dir: string, o: BatchOptions): Promise<BatchStatus>;
  batch(id: string): Promise<BatchStatus>;
  update(id: string, patch: { name?: string; tile_cm?: number }): Promise<LibraryEntry>;
  remove(id: string): Promise<void>;
  file(id: string, name: string): Promise<Blob>;
}

export const materialsApi: MaterialsApi = {
  list: () => jsonReq<LibraryList>("", "GET"),
  async upload(file) {
    const r = await ok(await fetch(`${BASE}/upload`, { method: "POST", headers: { ...auth(), "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) }, body: file }));
    return (await r.json()) as { upload: string; fileName: string };
  },
  startBatch: (uploads, o) => jsonReq<BatchStatus>("/batch", "POST", { ...o, items: uploads.map((upload) => ({ upload })) }),
  importDir: (dir, o) => jsonReq<BatchStatus>("/import-dir", "POST", { ...o, dir }),
  batch: (id) => jsonReq<BatchStatus>(`/batch/${encodeURIComponent(id)}`, "GET"),
  update: (id, patch) => jsonReq<LibraryEntry>(`/${encodeURIComponent(id)}`, "PUT", patch),
  async remove(id) {
    await jsonReq(`/${encodeURIComponent(id)}`, "DELETE");
  },
  async file(id, name) {
    return (await ok(await fetch(`${BASE}/${encodeURIComponent(id)}/file/${encodeURIComponent(name)}`, { headers: auth() }))).blob();
  },
};

/** Lets the existing 3D desk (Workshop3DViewer) show a library slab: slab.glb as the model, preview.png as the render. */
export function slabViewerApi(entry: LibraryEntry, api: Pick<MaterialsApi, "file"> = materialsApi): W3DApi {
  const detail: W3DDetail = {
    brief: { title: entry.name, object: entry.source, params: {} },
    snapshot: { state: "done", round: 0, fixRounds: 0, costUsd: 0, note: null, error: null, questions: [], issues: [] },
    files: ["outputs/model.glb"],
    renders: entry.files.includes("preview.png") ? ["renders/preview.png"] : [],
    report: null,
  };
  return {
    detail: async () => detail,
    file: (p) => api.file(entry.id, p === "outputs/model.glb" ? "slab.glb" : p === "renders/preview.png" ? "preview.png" : p),
    rebuild: async () => {
      throw new Error("Tấm mẫu thư viện không có tham số để dựng lại.");
    },
  };
}
