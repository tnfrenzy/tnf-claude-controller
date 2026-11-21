import { ApiError, getToken } from "../../api";
import type { W3DApi, W3DDetail, W3DParams } from "./types";

function headers(): Record<string, string> {
  return { "x-controller-token": getToken() ?? "" };
}

async function fail(r: Response): Promise<never> {
  const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
  throw new ApiError(j.message ?? r.statusText, r.status, j.error);
}

/** Real client for the part-1 engine API. Files need the token header, so callers turn blobs into object URLs. */
export function createWorkshop3DApi(slug: string): W3DApi {
  const base = `/api/workshop3d/${encodeURIComponent(slug)}`;
  return {
    async detail(): Promise<W3DDetail> {
      const r = await fetch(base, { headers: headers() });
      if (!r.ok) return fail(r);
      return (await r.json()) as W3DDetail;
    },
    async file(path: string): Promise<Blob> {
      const r = await fetch(`${base}/file?path=${encodeURIComponent(path)}`, { headers: headers() });
      if (!r.ok) return fail(r);
      return r.blob();
    },
    async rebuild(params?: W3DParams): Promise<void> {
      const r = await fetch(`${base}/rebuild`, {
        method: "POST",
        headers: { ...headers(), "content-type": "application/json" },
        body: JSON.stringify(params ? { params } : {}),
      });
      if (!r.ok) return fail(r);
    },
  };
}
