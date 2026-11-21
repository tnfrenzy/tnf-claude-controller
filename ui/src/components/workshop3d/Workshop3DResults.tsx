import { useState } from "react";
import { ApiError, getToken } from "../../api";
import { useT } from "../../i18n";

interface Paths {
  session: string;
  outputs: string;
  presentation: string | null;
  delivery: string | null;
}

function asPaths(v: unknown): Paths | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  return typeof o["outputs"] === "string" && typeof o["session"] === "string" ? { session: o["session"], outputs: o["outputs"], presentation: typeof o["presentation"] === "string" ? o["presentation"] : null, delivery: typeof o["delivery"] === "string" ? o["delivery"] : null } : null;
}

async function post(slug: string, action: string, body: unknown): Promise<void> {
  const r = await fetch(`/api/workshop3d/${encodeURIComponent(slug)}/${action}`, {
    method: "POST",
    headers: { "x-controller-token": getToken() ?? "", "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(j.message ?? r.statusText, r.status, j.error);
  }
}

/** "Kết quả nằm ở đây": the output folder path, and the offline presentation page (build / open). */
export function Workshop3DResults(props: { slug: string; paths: unknown; done: boolean; onChanged: () => void }) {
  const { t } = useT();
  const d = t as unknown as Record<string, string>;
  const paths = asPaths(props.paths);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  if (!paths) return null;
  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    setErr(null);
    try {
      await fn();
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="w3i-results fine" data-w3i-results style={{ margin: "8px 0", padding: "8px 10px", border: "1px solid var(--line, #ddd)", borderRadius: 8 }}>
      <div><b>{d["w3i_res_title"]}:</b> <code style={{ wordBreak: "break-all" }}>{paths.delivery ?? paths.outputs}</code></div>
      {paths.delivery ? <div className="muted" style={{ marginTop: 2 }}>{d["w3i_res_work"]}: <code style={{ wordBreak: "break-all" }}>{paths.session}</code></div> : null}
      <div className="row" style={{ marginTop: 6, gap: 6, flexWrap: "wrap" }}>
        <button type="button" className="mini" disabled={busy} onClick={() => void run(() => post(props.slug, "open", { what: "outputs" }))}>{d["w3i_res_open_out"]}</button>
        {paths.presentation ? <button type="button" className="mini primary" disabled={busy} onClick={() => void run(() => post(props.slug, "open", { what: "index" }))}>{d["w3i_res_open_page"]}</button> : null}
        {props.done || paths.presentation ? (
          <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => { await post(props.slug, "presentation", {}); props.onChanged(); })}>
            {busy ? d["w3i_res_building"] : paths.presentation ? d["w3i_res_rebuild_page"] : d["w3i_res_build_page"]}
          </button>
        ) : null}
      </div>
      <div className="muted" style={{ marginTop: 4 }}>{d["w3i_res_page_hint"]}</div>
      {err ? <div className="error" role="alert">{err}</div> : null}
    </div>
  );
}
