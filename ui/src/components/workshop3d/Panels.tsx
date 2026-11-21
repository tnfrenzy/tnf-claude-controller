import { useEffect, useMemo, useState } from "react";
import { useT } from "../../i18n";
import type { GlbInfo } from "./glb-info";
import { baseName, canRebuild, changedParams, formatBytes, formatDimsMm, isBusy, parseParamInput, renderLabel, type Vec3 } from "./logic";
import type { W3DApi, W3DParams, W3DSnapshotView } from "./types";

export function InfoPanel({ info, size, bytes }: { info: GlbInfo | null; size: Vec3 | null; bytes: number | null }) {
  const { t } = useT();
  return (
    <dl className="w3v-info" data-panel="info">
      <dt>{t.w3v_info_faces}</dt>
      <dd>{info ? info.triangles.toLocaleString("vi-VN") : "—"}</dd>
      <dt>{t.w3v_info_size}</dt>
      <dd>{bytes !== null ? formatBytes(bytes) : "—"}</dd>
      <dt>{t.w3v_info_box}</dt>
      <dd>{size ? formatDimsMm(size) : "—"}</dd>
      <dt>{t.w3v_info_materials}</dt>
      <dd>
        {info && info.materials.length > 0 ? (
          <ul className="w3v-mat-list" style={{ maxHeight: 200, overflowY: "auto", margin: 0, paddingLeft: 18, overflowWrap: "anywhere" }}>{info.materials.map((m) => <li key={m}>{m}</li>)}</ul>
        ) : "—"}
      </dd>
    </dl>
  );
}

export function PartsPanel({ nodes, hidden, onToggle, onAll }: {
  nodes: string[];
  hidden: ReadonlySet<string>;
  onToggle: (name: string) => void;
  onAll: (visible: boolean) => void;
}) {
  const { t } = useT();
  if (nodes.length === 0) return <div className="fine" data-panel="parts">{t.w3v_parts_none}</div>;
  return (
    <div data-panel="parts">
      <div className="w3v-row">
        <button type="button" onClick={() => onAll(true)}>{t.w3v_parts_show_all}</button>
        <button type="button" onClick={() => onAll(false)}>{t.w3v_parts_hide_all}</button>
      </div>
      <ul className="w3v-parts">
        {nodes.map((n) => (
          <li key={n}>
            <label>
              <input type="checkbox" checked={!hidden.has(n)} onChange={() => onToggle(n)} /> {n}
            </label>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Render images need the token header: fetch each through the API and show it from an object URL. */
export function RenderGallery({ api, renders, rev }: { api: W3DApi; renders: string[]; rev: number }) {
  const { t } = useT();
  const [urls, setUrls] = useState<Record<string, string>>({});
  const [open, setOpen] = useState<string | null>(null);
  const key = renders.join("|");
  useEffect(() => {
    let dead = false;
    const made: string[] = [];
    setUrls({});
    for (const p of renders) {
      api.file(p).then((b) => {
        const u = URL.createObjectURL(b);
        if (dead) { URL.revokeObjectURL(u); return; }
        made.push(u);
        setUrls((prev) => ({ ...prev, [p]: u }));
      }).catch(() => undefined);
    }
    return () => { dead = true; made.forEach((u) => URL.revokeObjectURL(u)); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api, key, rev]);
  if (renders.length === 0) return <div className="fine" data-panel="renders">{t.w3v_renders_none}</div>;
  return (
    <div data-panel="renders">
      <div className="w3v-gallery">
        {renders.map((p) => (
          <figure key={p}>
            {urls[p] ? (
              <button type="button" className="w3v-thumb" onClick={() => setOpen(p)} aria-label={renderLabel(p)}>
                <img src={urls[p]} alt={renderLabel(p)} />
              </button>
            ) : <div className="w3v-thumb w3v-thumb-wait fine">{t.w3v_loading}</div>}
            <figcaption className="fine">{renderLabel(p)}</figcaption>
          </figure>
        ))}
      </div>
      {open && urls[open] && (
        <div className="w3v-lightbox" role="dialog" onClick={() => setOpen(null)}>
          <img src={urls[open]} alt={renderLabel(open)} />
          <button type="button" onClick={() => setOpen(null)}>{t.w3v_close}</button>
        </div>
      )}
    </div>
  );
}

export function ParamsPanel({ params, snapshot, onRebuild, error }: {
  params: W3DParams;
  snapshot: W3DSnapshotView;
  onRebuild: (changed: W3DParams) => void;
  error: string | null;
}) {
  const { t } = useT();
  const [text, setText] = useState<Record<string, string>>({});
  const sig = JSON.stringify(params);
  useEffect(() => { setText({}); }, [sig]);
  const parsed = useMemo(() => {
    const next: W3DParams = {};
    const bad: string[] = [];
    for (const [k, orig] of Object.entries(params)) {
      const raw = text[k] ?? String(orig);
      const v = parseParamInput(orig, raw);
      if (v === null) bad.push(k); else next[k] = v;
    }
    return { next, bad };
  }, [params, text]);
  const changed = changedParams(params, parsed.next);
  const nChanged = Object.keys(changed).length;
  const busy = isBusy(snapshot.state);
  const can = canRebuild(snapshot.state) && parsed.bad.length === 0 && nChanged > 0;
  const entries = Object.entries(params);
  return (
    <div data-panel="params">
      <div className={`w3v-state${busy ? " w3v-busy" : ""}`} data-state={snapshot.state} role="status">
        {busy && <span className="w3v-spin" aria-hidden="true" />}
        {(t as Record<string, string>)[`w3v_state_${snapshot.state}`] ?? snapshot.state}
        {snapshot.note ? ` — ${snapshot.note}` : ""}
      </div>
      {snapshot.error && <div className="w3v-err">{snapshot.error}</div>}
      {entries.length === 0 ? <div className="fine">{t.w3v_params_none}</div> : (
        <div className="w3v-params">
          {entries.map(([k, orig]) => {
            const invalid = parsed.bad.includes(k);
            return (
              <label key={k} className={invalid ? "w3v-invalid" : undefined}>
                <span>{k}{typeof orig === "number" ? " (mm)" : ""}</span>
                <input
                  value={text[k] ?? String(orig)}
                  inputMode={typeof orig === "number" ? "decimal" : "text"}
                  disabled={busy}
                  onChange={(e) => setText((p) => ({ ...p, [k]: e.target.value }))}
                />
              </label>
            );
          })}
        </div>
      )}
      <div className="w3v-row">
        <button type="button" className="primary" disabled={!can} onClick={() => onRebuild(changed)}>{t.w3v_rebuild}</button>
        {nChanged > 0 && <span className="fine">{t.w3v_params_changed.replace("{n}", String(nChanged))}</span>}
      </div>
      {error && <div className="w3v-err">{error}</div>}
      <div className="fine">{t.w3v_rebuild_hint}</div>
    </div>
  );
}

export { baseName };
