import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { slotsFromRows, type W3DSlotRow } from "../../office/workshop3d-session";
import { SlotRows } from "./SlotRows";
import { fill } from "./batch-logic";
import { materialsApi, type MaterialsApi } from "./materials-api";
import { configViewerApi, variantsApi, type VariantsApi } from "./variants-api";
import {
  combos, comboCount, configsBusy, optionsBusy, pickMasters, sizeText, syncSelection,
  type Selection, type VConfig, type VMaster, type VOption, type VOverview, type VSlot,
} from "./variants-logic";
import "./VariantsPanel.css";

const Workshop3DViewer = lazy(() => import("./Workshop3DViewer"));
const POLL_MS = 1500;
const msg = (e: unknown): string => (e instanceof Error ? e.message : String(e));

function SlotCard(props: {
  slug: string;
  slot: VSlot;
  options: VOption[];
  selected: string[];
  onToggle: (id: string) => void;
  api: VariantsApi;
  mat: MaterialsApi;
  stones: { id: string; name: string }[];
  onChanged: () => void;
  onError: (m: string | null) => void;
}) {
  const { t } = useT();
  const { slot } = props;
  const [command, setCommand] = useState("");
  const [image, setImage] = useState<File | null>(null);
  const [part, setPart] = useState<File | null>(null);
  const [stone, setStone] = useState("");
  const [busy, setBusy] = useState(false);
  const imgRef = useRef<HTMLInputElement>(null);
  const partRef = useRef<HTMLInputElement>(null);
  const names = slot.matched.slice(0, 4).join(", ") + (slot.matched.length > 4 ? "…" : "");
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    props.onError(null);
    try {
      await fn();
      props.onChanged();
    } catch (e) {
      props.onError(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const addImage = () => {
    if (!image) return props.onError(t.wv_add_need_image);
    void run(async () => {
      const up = await props.mat.upload(image);
      await props.api.addOption(props.slug, { slot: slot.id, command: command.trim() || image.name.replace(/\.[^.]+$/, ""), upload: up.upload });
      setImage(null);
      setCommand("");
      if (imgRef.current) imgRef.current.value = "";
    });
  };
  const addPart = () => {
    if (!part || !command.trim()) return props.onError(t.wv_add_need_part);
    void run(async () => {
      await props.api.addPart(props.slug, slot.id, command.trim(), part);
      setPart(null);
      setCommand("");
      if (partRef.current) partRef.current.value = "";
    });
  };
  const badge = { building: t.wv_opt_building, ready: t.wv_opt_ready, failed: t.wv_opt_failed };
  return (
    <section className="vp-slot" data-vp-slot={slot.id}>
      <div className="vp-slot-head">
        <strong>{slot.name}</strong>
        <span className="fine">{slot.type === "part" ? t.wv_slot_part : t.wv_slot_material} · {sizeText(slot.size_mm)}</span>
      </div>
      {slot.matched.length > 0
        ? <div className="fine">{fill(t.wv_slot_matched, { n: String(slot.matched.length), names })}</div>
        : <div className="error" role="alert">{t.wv_slot_unmatched}</div>}
      {props.options.length === 0 ? <div className="fine">{t.wv_opt_empty}</div> : (
        <ul className="vp-options">
          {props.options.map((o) => (
            <li key={o.id} data-vp-option={o.id} data-state={o.state}>
              <label>
                <input type="checkbox" checked={props.selected.includes(o.id)} disabled={o.state !== "ready"} onChange={() => props.onToggle(o.id)} />
                <span className="vp-opt-name" title={o.command}>{o.name}</span>
              </label>
              <span className="vp-badge" data-state={o.state}>{badge[o.state]}</span>
              {o.error ? <span className="error vp-opt-err">{o.error}</span> : null}
              <button type="button" disabled={busy} aria-label={t.wv_opt_remove} onClick={() => { if (window.confirm(fill(t.wv_opt_remove_confirm, { name: o.name }))) void run(() => props.api.removeOption(props.slug, o.id)); }}>×</button>
            </li>
          ))}
        </ul>
      )}
      {slot.matched.length > 0 ? (
        <details className="vp-add">
          <summary>{t.wv_add_title}</summary>
          <label className="vp-field">{t.wv_add_command}
            <input type="text" maxLength={200} value={command} placeholder={t.wv_add_command_ph} onChange={(e) => setCommand(e.target.value)} data-vp-command />
          </label>
          <div className="vp-row">
            <input ref={imgRef} type="file" accept=".png,.jpg,.jpeg,.webp,image/png,image/jpeg,image/webp" aria-label={t.wv_add_image} onChange={(e) => setImage(e.target.files?.[0] ?? null)} />
            <button type="button" className="primary" disabled={busy} onClick={addImage} data-vp-add-image>{t.wv_add_with_image}</button>
          </div>
          {props.stones.length > 0 ? (
            <div className="vp-row">
              <select value={stone} aria-label={t.wv_add_from_lib} onChange={(e) => setStone(e.target.value)}>
                <option value="">{t.wv_add_from_lib}</option>
                {props.stones.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <button type="button" disabled={busy || !stone} onClick={() => void run(async () => { await props.api.addOption(props.slug, { slot: slot.id, command: command.trim() || (props.stones.find((s) => s.id === stone)?.name ?? ""), materialId: stone }); setStone(""); })}>{t.wv_add_use_lib}</button>
            </div>
          ) : null}
          {slot.type === "part" ? (
            <div className="vp-row">
              <input ref={partRef} type="file" accept=".glb,model/gltf-binary" aria-label={t.wv_add_part} onChange={(e) => setPart(e.target.files?.[0] ?? null)} />
              <button type="button" disabled={busy} onClick={addPart}>{t.wv_add_part_btn}</button>
            </div>
          ) : null}
        </details>
      ) : null}
    </section>
  );
}

/**
 * "Tạo hàng loạt" tab: variants of ONE master model. Slots (handrail, stone...) each get options (photo + command, a stone
 * library entry, a ready-made part); the matrix is the product of the ticked options; every configuration is a GLB merged
 * by code (docs/DESIGN-3D.md 6c) and opens in the same 3D desk as the master.
 */
export function VariantsPanel(props: { slug?: string | undefined; api?: VariantsApi; matApi?: MaterialsApi }) {
  const { t } = useT();
  const api = props.api ?? variantsApi;
  const mat = props.matApi ?? materialsApi;
  const [masters, setMasters] = useState<VMaster[] | null>(null);
  const [master, setMaster] = useState<string>("");
  const [ov, setOv] = useState<VOverview | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [sel, setSel] = useState<Selection>({});
  const [seen, setSeen] = useState<ReadonlySet<string>>(new Set());
  const [viewing, setViewing] = useState<VConfig | null>(null);
  const [busy, setBusy] = useState(false);
  const [rows, setRows] = useState<W3DSlotRow[]>([{ name: "", type: "material" }]);
  const [stones, setStones] = useState<{ id: string; name: string }[]>([]);

  useEffect(() => {
    let dead = false;
    api.masters().then((l) => {
      if (dead) return;
      const m = pickMasters(l, props.slug);
      setMasters(m);
      setMaster((cur) => cur || m[0]?.slug || "");
    }).catch((e) => !dead && setErr(msg(e)));
    return () => { dead = true; };
  }, [api, props.slug]);

  const reload = useCallback(async () => {
    if (!master) return;
    try {
      const o = await api.overview(master);
      setOv(o);
      setSel((s) => {
        const r = syncSelection(s, o.options, seen);
        setSeen(r.seen);
        return r.sel;
      });
    } catch (e) {
      setErr(msg(e));
    }
  }, [api, master, seen]);
  useEffect(() => { setOv(null); setSel({}); setSeen(new Set()); setViewing(null); }, [master]);
  useEffect(() => { void reload(); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [master]);
  useEffect(() => {
    mat.list().then((l) => setStones(l.items.filter((e) => e.kind === "material").map((e) => ({ id: e.id, name: e.name })))).catch(() => undefined);
  }, [mat, ov?.options.length]);
  const working = !!ov && (configsBusy(ov.configs) || optionsBusy(ov.options));
  useEffect(() => {
    if (!working) return;
    const id = setInterval(() => void reload(), POLL_MS);
    return () => clearInterval(id);
  }, [working, reload]);

  const slotIds = useMemo(() => (ov?.slots ?? []).map((s) => s.id), [ov]);
  const n = comboCount(sel, slotIds);
  const max = ov?.limits.maxConfigs ?? 24;
  const optName = (id: string): string => ov?.options.find((o) => o.id === id)?.name ?? "?";
  const rowsOfMatrix = useMemo(() => combos(sel, slotIds), [sel, slotIds]);
  const usedSlots = (ov?.slots ?? []).filter((s) => (sel[s.id] ?? []).length > 0);

  const toggle = (slot: string, id: string) =>
    setSel((s) => {
      const cur = s[slot] ?? [];
      return { ...s, [slot]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });

  const create = async () => {
    setBusy(true);
    setErr(null);
    try {
      await api.startBatch(master, Object.fromEntries(Object.entries(sel).filter(([, v]) => v.length > 0)));
      await reload();
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };
  const saveSlots = async () => {
    const slots = slotsFromRows(rows);
    if (!slots || slots.length === 0) return setErr(t.w3i_err_slots);
    setBusy(true);
    setErr(null);
    try {
      setOv(await api.putSlots(master, slots));
    } catch (e) {
      setErr(msg(e));
    } finally {
      setBusy(false);
    }
  };

  const viewerApi = useMemo(() => (viewing && master ? configViewerApi(master, viewing, api) : null), [viewing, master, api]);
  const stateLabel = { queued: t.wv_cfg_queued, running: t.wv_cfg_running, done: t.wv_cfg_done, failed: t.wv_cfg_failed };

  return (
    <div className="vp-panel" data-vp-panel>
      <p className="fine">{t.wv_intro}</p>
      {masters === null ? <div className="fine">{t.wv_loading}</div> : masters.length === 0 ? <div className="fine">{t.wv_master_none}</div> : (
        <label className="vp-field">{t.wv_master}
          <select value={master} onChange={(e) => setMaster(e.target.value)} data-vp-master>
            {masters.map((m) => <option key={m.slug} value={m.slug}>{m.title}</option>)}
          </select>
        </label>
      )}
      {err ? <div className="error" role="alert">{err}</div> : null}
      {ov && !ov.ready ? (
        <div className="vp-notice" data-vp-notice>
          <div>{ov.reason}</div>
          {ov.slots.length === 0 ? (
            <>
              <strong>{t.wv_define_title}</strong>
              <div className="fine">{t.wv_define_hint}</div>
              <SlotRows rows={rows} onChange={setRows} />
              <button type="button" className="primary" disabled={busy} onClick={() => void saveSlots()}>{t.wv_define_save}</button>
            </>
          ) : null}
        </div>
      ) : null}
      {ov && ov.slots.length > 0 ? (
        <div className="vp-slots">
          {ov.slots.map((s) => (
            <SlotCard key={s.id} slug={master} slot={s} api={api} mat={mat} stones={stones} options={ov.options.filter((o) => o.slot === s.id)}
              selected={sel[s.id] ?? []} onToggle={(id) => toggle(s.id, id)} onChanged={() => void reload()} onError={setErr} />
          ))}
        </div>
      ) : null}
      {ov && ov.ready ? (
        <section className="vp-matrix" data-vp-matrix>
          <h4>{t.wv_matrix_title}</h4>
          {n === 0 ? <div className="fine">{t.wv_matrix_empty}</div> : (
            <>
              <div className={n > max ? "error" : "fine"} data-vp-count={n}>{fill(t.wv_matrix_count, { n: String(n), max: String(max) })}{n > max ? ` ${fill(t.wv_matrix_over, { max: String(max) })}` : ""}</div>
              <div className="vp-table-wrap">
                <table className="vp-table">
                  <thead><tr><th>#</th>{usedSlots.map((s) => <th key={s.id}>{s.name}</th>)}</tr></thead>
                  <tbody>
                    {rowsOfMatrix.slice(0, 48).map((r, i) => (
                      <tr key={i}><td>{i + 1}</td>{usedSlots.map((s) => <td key={s.id}>{r[s.id] ? optName(r[s.id]!) : t.wv_matrix_keep}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
          <div className="fine vp-cost" data-vp-cost="0">{t.wv_cost}</div>
          <button type="button" className="primary" disabled={busy || n === 0 || n > max} onClick={() => void create()} data-vp-create>{fill(t.wv_create, { n: String(n) })}</button>
        </section>
      ) : null}
      {ov ? (
        <section className="vp-configs">
          <h4>{fill(t.wv_configs, { n: String(ov.configs.length) })}</h4>
          {ov.configs.length === 0 ? <div className="fine">{t.wv_cfg_empty}</div> : (
            <ul className="vp-grid">
              {ov.configs.map((c) => (
                <li key={c.id} className="vp-card" data-vp-config={c.id} data-state={c.state}>
                  <div className="vp-card-name" title={c.name}>{c.name}</div>
                  <div className="fine"><span className="vp-badge" data-state={c.state}>{stateLabel[c.state]}</span>{typeof c.bytes === "number" ? ` ${fill(t.wv_cfg_size, { mb: (c.bytes / 1024 / 1024).toFixed(1) })}` : ""}</div>
                  {c.error ? <div className="error vp-opt-err">{c.error}</div> : null}
                  <div className="vp-row">
                    <button type="button" className="primary" disabled={c.state !== "done"} onClick={() => setViewing(c)} data-vp-view>{t.wv_cfg_view}</button>
                    <button type="button" disabled={c.state === "queued" || c.state === "running"} onClick={() => { if (window.confirm(fill(t.wv_cfg_delete_confirm, { name: c.name }))) void api.removeConfig(master, c.id).then(() => { if (viewing?.id === c.id) setViewing(null); return reload(); }).catch((e) => setErr(msg(e))); }}>{t.wv_cfg_delete}</button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      ) : null}
      {viewing && viewerApi ? (
        <section className="vp-viewer">
          <div className="vp-row"><strong>{viewing.name}</strong><button type="button" onClick={() => setViewing(null)}>{t.wv_cfg_close}</button></div>
          <Suspense fallback={<div className="fine">{t.wv_loading}</div>}><Workshop3DViewer key={viewing.id} slug={`variant-${viewing.id}`} api={viewerApi} /></Suspense>
        </section>
      ) : null}
    </div>
  );
}
