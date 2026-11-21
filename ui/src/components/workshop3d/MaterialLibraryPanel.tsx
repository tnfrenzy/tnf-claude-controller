import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import {
  BATCH_DICTS, batchSummary, categoryLabel, checkFiles, fill, parseSizeInputs, sizeLabel,
  type BatchStatus, type LibraryEntry, type LibraryList, type Mapping,
} from "./batch-logic";
import { materialsApi, slabViewerApi, type MaterialsApi } from "./materials-api";
import "./MaterialLibraryPanel.css";

const Workshop3DViewer = lazy(() => import("./Workshop3DViewer"));
const POLL_MS = 1500;

/** Preview image of an entry: fetched with the token header, shown from a blob URL. */
function Preview({ entry, api }: { entry: LibraryEntry; api: MaterialsApi }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let dead = false;
    let u: string | null = null;
    api.file(entry.id, "preview.png").then((b) => {
      if (dead) return;
      u = URL.createObjectURL(b);
      setUrl(u);
    }).catch(() => undefined);
    return () => { dead = true; if (u) URL.revokeObjectURL(u); };
  }, [api, entry.id, entry.tile_cm, entry.created]);
  return url ? <img className="mb-thumb" src={url} alt={entry.name} /> : <div className="mb-thumb mb-thumb-empty" />;
}

function Card(props: { entry: LibraryEntry; api: MaterialsApi; onView: () => void; onChanged: () => void; onError: (m: string) => void }) {
  const { lang } = useT();
  const d = BATCH_DICTS[lang];
  const e = props.entry;
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(e.name);
  const [tile, setTile] = useState(String(e.tile_cm));
  const [busy, setBusy] = useState(false);
  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await fn();
      props.onChanged();
    } catch (err) {
      props.onError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <li className="mb-card" data-mb-entry={e.id}>
      <button type="button" className="mb-thumb-btn" title={d.mb_view3d} onClick={props.onView}><Preview entry={e} api={props.api} /></button>
      {editing ? (
        <div className="mb-row">
          <input value={name} maxLength={80} aria-label={d.mb_rename} onChange={(ev) => setName(ev.target.value)} />
          <button type="button" className="primary" disabled={busy || !name.trim()} onClick={() => void act(async () => { await props.api.update(e.id, { name: name.trim() }); setEditing(false); })}>{d.mb_save}</button>
          <button type="button" disabled={busy} onClick={() => { setEditing(false); setName(e.name); }}>{d.mb_cancel}</button>
        </div>
      ) : (
        <div className="mb-name" title={e.name}>{e.name}</div>
      )}
      <div className="fine">{sizeLabel(e.size_mm)} · {e.mapping === "fit" ? d.mb_map_label_fit : fill(d.mb_map_label_tile, { cm: String(e.tile_cm) })}</div>
      <div className="fine mb-src" title={e.source}>{fill(d.mb_source, { name: e.source })}</div>
      {e.mapping === "tile" ? (
        <div className="mb-row">
          <label className="fine">{d.mb_tile} <input type="number" min={5} max={500} step={1} value={tile} onChange={(ev) => setTile(ev.target.value)} /></label>
          <button type="button" disabled={busy || Number(tile) === e.tile_cm} onClick={() => void act(() => props.api.update(e.id, { tile_cm: Number(tile) }))}>{d.mb_tile_apply}</button>
        </div>
      ) : null}
      <div className="mb-row mb-actions">
        <button type="button" className="primary" onClick={props.onView}>{d.mb_view3d}</button>
        <button type="button" disabled={busy} onClick={() => setEditing(true)}>{d.mb_rename}</button>
        <button type="button" disabled={busy} onClick={() => { if (window.confirm(fill(d.mb_delete_confirm, { name: e.name }))) void act(() => props.api.remove(e.id)); }}>{d.mb_delete}</button>
      </div>
    </li>
  );
}

function BatchProgress({ batch }: { batch: BatchStatus }) {
  const { lang } = useT();
  const d = BATCH_DICTS[lang];
  const s = batchSummary(batch);
  const stateLabel = { queued: d.mb_state_queued, running: d.mb_state_running, done: d.mb_state_done, failed: d.mb_state_failed };
  return (
    <div className="mb-batch" data-mb-batch={batch.id} data-done={batch.done}>
      <div><strong>{fill(d.mb_batch, { id: batch.id.slice(-5), done: String(s.done), total: String(s.total), failed: String(s.failed) })}</strong></div>
      <div className="fine">{fill(d.mb_batch_size, { size: sizeLabel(batch.size_mm), n: String(s.total) })}</div>
      <progress max={s.total} value={s.done + s.failed} />
      <ol className="mb-items">
        {batch.items.map((it) => (
          <li key={it.index} data-mb-state={it.state}>
            <span className="mb-badge" data-mb-state={it.state}>{stateLabel[it.state]}</span>
            <span className="mb-item-name" title={it.source}>{it.source}</span>
            {it.state === "done" && typeof it.ms === "number" ? <span className="fine"> {(it.ms / 1000).toFixed(0)} s</span> : null}
            {it.error ? <div className="error mb-item-err">{it.error}</div> : null}
          </li>
        ))}
      </ol>
    </div>
  );
}

/**
 * "Tạo hàng loạt" tab of the 3D workshop window: one shared size per batch, one item per photo (name = file name).
 * Floor stone / materials are built now by code (no AI, cost 0); the other types are listed as "sắp có".
 */
export function MaterialLibraryPanel(props: { api?: MaterialsApi }) {
  const { lang } = useT();
  const d = BATCH_DICTS[lang];
  const api = props.api ?? materialsApi;
  const [data, setData] = useState<LibraryList | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cat, setCat] = useState("stone");
  const [w, setW] = useState("600");
  const [dep, setDep] = useState("600");
  const [h, setH] = useState("20");
  const [tile, setTile] = useState("60");
  const [mapping, setMapping] = useState<Mapping>("auto");
  const [files, setFiles] = useState<File[]>([]);
  const [dir, setDir] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [batch, setBatch] = useState<BatchStatus | null>(null);
  const [viewing, setViewing] = useState<LibraryEntry | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const reload = useCallback(async () => {
    try {
      const l = await api.list();
      setData(l);
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, [api]);
  useEffect(() => { void reload(); }, [reload]);

  // poll the running batch; refresh the library whenever an item finishes
  const doneCount = batch ? batch.items.filter((i) => i.state === "done").length : 0;
  useEffect(() => { if (doneCount > 0) void reload(); }, [doneCount, reload]);
  useEffect(() => {
    if (!batch || batch.done) return;
    const id = setInterval(() => { api.batch(batch.id).then(setBatch).catch(() => undefined); }, POLL_MS);
    return () => clearInterval(id);
  }, [api, batch]);

  const pickCategory = (id: string) => {
    setCat(id);
    const c = data?.categories.find((x) => x.id === id);
    if (c) { setW(String(c.defaultSize.w)); setDep(String(c.defaultSize.d)); setH(String(c.defaultSize.h)); }
  };
  const size = parseSizeInputs(w, dep, h);
  const opts = () => ({ category: cat, size_mm: size!, tile_cm: Number(tile) || 60, mapping });
  const categoryReady = data?.categories.find((c) => c.id === cat)?.ready ?? cat === "stone";

  const startUpload = async () => {
    setErr(null);
    if (!size) return setErr(d.mb_err_size);
    const bad = checkFiles(files, data?.limits ?? { upload: 12, imageBytes: 10 * 1024 * 1024 });
    if (bad) return setErr(fill(d[bad.key], bad.vars));
    try {
      const ups: string[] = [];
      for (let i = 0; i < files.length; i++) {
        setBusy(fill(d.mb_uploading, { i: String(i + 1), n: String(files.length) }));
        ups.push((await api.upload(files[i]!)).upload);
      }
      setBatch(await api.startBatch(ups, opts()));
      setFiles([]);
      if (fileRef.current) fileRef.current.value = "";
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };
  const startDir = async () => {
    setErr(null);
    if (!size) return setErr(d.mb_err_size);
    try {
      setBusy(d.mb_dir_start);
      setBatch(await api.importDir(dir.trim(), opts()));
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  };

  const viewerApi = useMemo(() => (viewing ? slabViewerApi(viewing, api) : null), [viewing, api]);
  const items = data?.items ?? [];
  const running = !!batch && !batch.done;

  return (
    <div className="mb-panel">
      <p className="fine mb-intro">{d.mb_intro}</p>
      <div className="mb-form">
        <label className="mb-field">
          <span>{d.mb_category}</span>
          <select value={cat} onChange={(e) => pickCategory(e.target.value)} data-mb-category>
            {(data?.categories ?? [{ id: "stone", ready: true }]).map((c) => (
              <option key={c.id} value={c.id} disabled={!c.ready}>{categoryLabel(d, c.id)}{c.ready ? "" : ` (${d.mb_soon})`}</option>
            ))}
          </select>
        </label>
        <fieldset className="mb-size">
          <legend>{d.mb_size}</legend>
          <label>{d.mb_w}<input type="number" min={10} max={5000} value={w} onChange={(e) => setW(e.target.value)} data-mb-size="w" /></label>
          <span aria-hidden>×</span>
          <label>{d.mb_d}<input type="number" min={10} max={5000} value={dep} onChange={(e) => setDep(e.target.value)} data-mb-size="d" /></label>
          <span aria-hidden>×</span>
          <label>{d.mb_h}<input type="number" min={1} max={500} value={h} onChange={(e) => setH(e.target.value)} data-mb-size="h" /></label>
        </fieldset>
        <label className="mb-field" title={d.mb_tile_hint}>
          <span>{d.mb_tile}</span>
          <input type="number" min={5} max={500} value={tile} onChange={(e) => setTile(e.target.value)} />
        </label>
        <label className="mb-field">
          <span>{d.mb_mapping}</span>
          <select value={mapping} onChange={(e) => setMapping(e.target.value as Mapping)}>
            <option value="auto">{d.mb_map_auto}</option>
            <option value="tile">{d.mb_map_tile}</option>
            <option value="fit">{d.mb_map_fit}</option>
          </select>
        </label>
      </div>
      <div className="fine mb-cost" data-mb-cost="0">{d.mb_cost}</div>
      <div className="mb-sources">
        <div className="mb-source">
          <input ref={fileRef} type="file" multiple accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" aria-label={d.mb_pick}
            onChange={(e) => setFiles(Array.from(e.target.files ?? []))} />
          <span className="fine">{fill(d.mb_picked, { n: String(files.length) })} · {size ? sizeLabel(size) : "—"}</span>
          <button type="button" className="primary" disabled={!!busy || running || !categoryReady || files.length === 0} onClick={() => void startUpload()} data-mb-start>
            {fill(d.mb_start, { n: String(files.length) })}
          </button>
        </div>
        {data && !data.localDir ? <div className="fine">{d.mb_dir_remote}</div> : (
          <div className="mb-source">
            <label className="mb-field mb-grow"><span>{d.mb_dir}</span>
              <input value={dir} placeholder={d.mb_dir_ph} onChange={(e) => setDir(e.target.value)} data-mb-dir />
            </label>
            <button type="button" disabled={!!busy || running || !categoryReady || !dir.trim()} onClick={() => void startDir()} data-mb-dir-start>{d.mb_dir_start}</button>
          </div>
        )}
      </div>
      {busy ? <div className="fine" role="status">{busy}</div> : null}
      {err ? <div className="error" role="alert">{err}</div> : null}
      {batch ? <BatchProgress batch={batch} /> : null}
      {viewing && viewerApi ? (
        <section className="mb-viewer">
          <div className="mb-row"><strong>{viewing.name}</strong><button type="button" onClick={() => setViewing(null)}>{d.mb_close3d}</button></div>
          <Suspense fallback={<div className="fine">…</div>}><Workshop3DViewer key={`${viewing.id}:${viewing.tile_cm}`} slug={`material-${viewing.id}`} api={viewerApi} /></Suspense>
        </section>
      ) : null}
      <h4 className="mb-lib-title">{fill(d.mb_library, { n: String(items.length) })}</h4>
      {!data ? <div className="fine">{d.mb_loading}</div> : items.length === 0 ? <div className="fine">{d.mb_empty}</div> : (
        <ul className="mb-grid">
          {items.map((e) => (
            <Card key={`${e.id}:${e.tile_cm}:${e.name}`} entry={e} api={api} onView={() => setViewing(e)} onChanged={() => void reload()} onError={setErr} />
          ))}
        </ul>
      )}
    </div>
  );
}
