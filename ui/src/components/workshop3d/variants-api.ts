import { ApiError, getToken } from "../../api";
import type { VConfig, VMaster, VOption, VOverview } from "./variants-logic";
import type { W3DApi, W3DDetail } from "./types";

const auth = (): Record<string, string> => ({ "x-controller-token": getToken() ?? "" });

async function ok(r: Response): Promise<Response> {
  if (r.ok) return r;
  const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
  throw new ApiError(j.message ?? r.statusText, r.status, j.error);
}

const base = (slug: string): string => `/api/workshop3d/${encodeURIComponent(slug)}/variants`;
async function jsonReq<T>(url: string, method: string, body?: unknown): Promise<T> {
  const r = await ok(await fetch(url, { method, headers: { ...auth(), "content-type": "application/json" }, ...(body !== undefined ? { body: JSON.stringify(body) } : {}) }));
  return (await r.json()) as T;
}

export interface AddOptionBody { slot?: string; command: string; upload?: string; materialId?: string }

/** Client of /api/workshop3d/<slug>/variants (token in the header; GLB comes back as a blob, never a token in a URL). */
export interface VariantsApi {
  masters(): Promise<VMaster[]>;
  overview(slug: string): Promise<VOverview>;
  putSlots(slug: string, slots: { id: string; name: string; type: "material" | "part" }[]): Promise<VOverview>;
  addOption(slug: string, body: AddOptionBody): Promise<VOption>;
  addPart(slug: string, slot: string, name: string, file: File): Promise<VOption>;
  removeOption(slug: string, id: string): Promise<void>;
  startBatch(slug: string, slots: Record<string, string[]>): Promise<VConfig[]>;
  removeConfig(slug: string, id: string): Promise<void>;
  configGlb(slug: string, id: string): Promise<Blob>;
}

export const variantsApi: VariantsApi = {
  async masters() {
    const j = await jsonReq<{ sessions: VMaster[] }>("/api/workshop3d", "GET");
    return j.sessions.map((s) => ({ slug: s.slug, title: s.title, state: s.state }));
  },
  overview: (slug) => jsonReq<VOverview>(base(slug), "GET"),
  putSlots: (slug, slots) => jsonReq<VOverview>(`${base(slug)}/slots`, "PUT", { slots }),
  addOption: (slug, body) => jsonReq<VOption>(`${base(slug)}/options`, "POST", body),
  async addPart(slug, slot, name, file) {
    const r = await ok(await fetch(`${base(slug)}/parts`, { method: "POST", headers: { ...auth(), "content-type": "application/octet-stream", "x-slot": encodeURIComponent(slot), "x-name": encodeURIComponent(name) }, body: file }));
    return (await r.json()) as VOption;
  },
  async removeOption(slug, id) {
    await jsonReq(`${base(slug)}/options/${encodeURIComponent(id)}`, "DELETE");
  },
  async startBatch(slug, slots) {
    return (await jsonReq<{ configs: VConfig[] }>(`${base(slug)}/batch`, "POST", { slots })).configs;
  },
  async removeConfig(slug, id) {
    await jsonReq(`${base(slug)}/configs/${encodeURIComponent(id)}`, "DELETE");
  },
  async configGlb(slug, id) {
    return (await ok(await fetch(`${base(slug)}/configs/${encodeURIComponent(id)}/model.glb`, { headers: auth() }))).blob();
  },
};

/** Lets the existing 3D desk (Workshop3DViewer) show one configuration: its model.glb as the model. */
export function configViewerApi(slug: string, cfg: VConfig, api: Pick<VariantsApi, "configGlb"> = variantsApi): W3DApi {
  const detail: W3DDetail = {
    brief: { title: cfg.name, object: cfg.name, params: {} },
    snapshot: { state: "done", round: 0, fixRounds: 0, costUsd: 0, note: null, error: null, questions: [], issues: [] },
    files: ["outputs/model.glb"],
    renders: [],
    report: null,
  };
  return {
    detail: async () => detail,
    file: (p) => {
      if (p !== "outputs/model.glb") return Promise.reject(new Error("Cấu hình chỉ có model.glb."));
      return api.configGlb(slug, cfg.id);
    },
    rebuild: async () => {
      throw new Error("Cấu hình không có tham số để dựng lại.");
    },
  };
}
