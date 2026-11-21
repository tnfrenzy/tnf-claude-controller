import { useCallback, useEffect, useRef, useState } from "react";
import { api, ApiError, type PreviewConfigView, type PreviewShotView, type PreviewStateView } from "../../api";
import { useT } from "../../i18n";
import { canStart, configToForm, formToConfig, groupShots, hasShellMeta, runBlocksPreview, shotCacheKey, type PreviewForm } from "../../run/preview";

const EMPTY_STATE: PreviewStateView = { status: "idle", step: null, result: null };

function Shot({ runId, shot, stamp, onOpen, t }: { runId: string; shot: PreviewShotView; stamp: number | null; onOpen: (src: string, alt: string) => void; t: ReturnType<typeof useT>["t"] }) {
  const [src, setSrc] = useState<string | null>(null);
  const cacheKey = shotCacheKey(runId, shot.file, stamp);
  useEffect(() => {
    setSrc(null);
    if (!shot.ok) return;
    let url: string | null = null;
    let dead = false;
    api.previewImageBlob(runId, shot.file).then((u) => { if (dead) URL.revokeObjectURL(u); else { url = u; setSrc(u); } }).catch(() => {});
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cacheKey, shot.ok]);
  const cap = shot.width > 0 ? `${shot.width} px` : t.preview_window;
  const alt = `${shot.label} ${cap}`;
  return (
    <figure className="preview-shot">
      {shot.ok && src ? <button type="button" className="preview-shot-btn" onClick={() => onOpen(src, alt)}><img src={src} alt={alt} /></button>
        : <div className="preview-shot-fail muted">{shot.ok ? "…" : t.preview_shot_failed}</div>}
      <figcaption className="muted">{cap}</figcaption>
    </figure>
  );
}

export function PreviewTab({ runId, project, runStatus }: { runId: string; project: string; runStatus?: string }) {
  const { t } = useT();
  const [state, setState] = useState<PreviewStateView>(EMPTY_STATE);
  const [form, setForm] = useState<PreviewForm>(configToForm({ kind: "none" }));
  const [hasConfig, setHasConfig] = useState(false);
  const [grantOn, setGrantOn] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [big, setBig] = useState<{ src: string; alt: string } | null>(null);
  const [grantBusy, setGrantBusy] = useState(false);
  const [pollErr, setPollErr] = useState(false);
  const closeRef = useRef<HTMLButtonElement | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const applyConfig = useCallback((c: PreviewConfigView) => { setForm(configToForm(c)); setHasConfig(c.kind !== "none"); }, []);

  useEffect(() => {
    let dead = false;
    api.previewGet(runId).then((v) => { if (!dead) { setState(v.state); applyConfig(v.config); } }).catch((e: unknown) => { if (!dead) setErr(e instanceof Error ? e.message : String(e)); });
    api.grantsGet(project).then((g) => { if (!dead) setGrantOn(g.grants.preview === true); }).catch(() => { if (!dead) setErr(t.preview_grant_load_failed); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runId, project, applyConfig]);

  useEffect(() => {
    if (state.status !== "running") return;
    let dead = false;
    const id = setInterval(() => {
      api.previewGet(runId).then((v) => { if (!dead) { setState(v.state); setPollErr(false); } }).catch(() => { if (!dead) setPollErr(true); });
    }, 2000);
    return () => { dead = true; clearInterval(id); };
  }, [runId, state.status]);

  const open = big !== null;
  useEffect(() => {
    if (!open) return;
    returnFocus.current = (document.activeElement as HTMLElement | null) ?? null;
    closeRef.current?.focus();
    // Capture phase + stopImmediatePropagation so Esc closes only the lightbox, not the surrounding Modal.
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopImmediatePropagation();
      e.preventDefault();
      setBig(null);
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      returnFocus.current?.focus?.();
    };
  }, [open]);

  const msg = (e: unknown): string => (e instanceof ApiError || e instanceof Error ? e.message : String(e));

  const toggleGrant = async (on: boolean): Promise<void> => {
    setErr(null); setGrantBusy(true);
    try {
      const cur = await api.grantsGet(project);
      const r = await api.grantsPut(project, { ...cur.grants, preview: on });
      setGrantOn(r.grants.preview === true);
    } catch (e) { setErr(msg(e)); } finally { setGrantBusy(false); }
  };

  const save = async (): Promise<void> => {
    setBusy(true); setErr(null); setNote(null);
    try {
      const r = await api.previewConfigPut(project, formToConfig(form));
      applyConfig(r.preview);
      setNote(t.preview_saved);
    } catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };

  const start = async (): Promise<void> => {
    setBusy(true); setErr(null); setNote(null);
    try { const r = await api.previewStart(runId); setState(r.state); }
    catch (e) { setErr(msg(e)); } finally { setBusy(false); }
  };

  const set = (patch: Partial<PreviewForm>): void => setForm((f) => ({ ...f, ...patch }));
  const result = state.result;
  const groups = result ? groupShots(result.shots) : [];
  const runBlocked = runBlocksPreview(runStatus, form.kind);
  const canCapture = hasConfig && canStart(state, grantOn, runBlocked) && !busy;

  return (
    <div className="preview-tab">
      <div className="preview-cols">
        <div className="preview-side">
          <label className="preview-check">
            <input type="checkbox" checked={grantOn} disabled={grantBusy} onChange={(e) => void toggleGrant(e.target.checked)} />
            <span>{t.preview_grant}</span>
          </label>
          <p className="muted preview-small">{t.preview_grant_hint}</p>

          <details className="preview-config" open={!hasConfig}>
            <summary>{t.preview_config}</summary>
            <label className="preview-field">{t.preview_kind}
              <select value={form.kind} onChange={(e) => set({ kind: e.target.value as PreviewForm["kind"] })}>
                <option value="none">{t.preview_kind_none}</option>
                <option value="web">{t.preview_kind_web}</option>
                <option value="desktop">{t.preview_kind_desktop}</option>
              </select>
            </label>
            {form.kind === "web" && (
              <>
                <label className="preview-field">{t.preview_start_command}
                  <input value={form.startCommand} onChange={(e) => set({ startCommand: e.target.value })} placeholder="npm run dev" />
                </label>
                <p className={`preview-small ${hasShellMeta(form.startCommand) ? "preview-warn" : "muted"}`}>{t.preview_start_hint}</p>
                <p className="muted preview-small">{t.preview_start_launch_hint}</p>
                <label className="preview-field">{t.preview_url}
                  <input value={form.url} onChange={(e) => set({ url: e.target.value })} placeholder="http://localhost:5173" />
                </label>
                <p className="muted preview-small">{t.preview_url_hint}</p>
                <label className="preview-field">{t.preview_pages}
                  <textarea rows={3} value={form.pagesText} onChange={(e) => set({ pagesText: e.target.value })} placeholder={"/\n/login"} />
                </label>
                <label className="preview-field">{t.preview_ready_timeout}
                  <input inputMode="numeric" value={form.readyTimeoutSec} onChange={(e) => set({ readyTimeoutSec: e.target.value })} />
                </label>
              </>
            )}
            {form.kind === "desktop" && (
              <>
                <label className="preview-field">{t.preview_exe}
                  <input value={form.exePath} onChange={(e) => set({ exePath: e.target.value })} />
                </label>
                <label className="preview-field">{t.preview_args}
                  <textarea rows={2} value={form.argsText} onChange={(e) => set({ argsText: e.target.value })} />
                </label>
                <label className="preview-field">{t.preview_window_title}
                  <input value={form.windowTitle} onChange={(e) => set({ windowTitle: e.target.value })} />
                </label>
                <p className="muted preview-small">{t.preview_window_title_hint}</p>
                <label className="preview-field">{t.preview_settle}
                  <input inputMode="numeric" value={form.settleSec} onChange={(e) => set({ settleSec: e.target.value })} />
                </label>
              </>
            )}
            <button type="button" className="primary" disabled={busy} onClick={() => void save()}>{t.preview_save}</button>
          </details>

          <div className="preview-actions">
            <button type="button" className="primary" disabled={!canCapture} onClick={() => void start()}>
              {state.status === "running" ? t.preview_running : t.preview_capture}
            </button>
            {result && <button type="button" onClick={() => void api.openOutput(runId).catch((e: unknown) => setErr(msg(e)))}>{t.preview_open_folder}</button>}
          </div>
          {hasConfig && !grantOn && <p className="preview-small preview-warn">{t.preview_need_grant}</p>}
          {hasConfig && runBlocked && <p className="preview-small preview-warn">{t.preview_run_busy}</p>}
          {state.status === "running" && state.step && <p className="muted preview-small">{state.step}</p>}
          {pollErr && state.status === "running" && <p className="preview-small preview-warn" role="alert">{t.preview_poll_failed}</p>}
          {note && <p className="preview-small preview-ok">{note}</p>}
          {err && <p className="preview-small preview-warn" role="alert">{err}</p>}
          <p className="muted preview-small">{t.preview_privacy}</p>
        </div>

        <div className="preview-main">
          {result?.error && (
            <div className="preview-errbox">
              <strong>{t.preview_error}:</strong> {result.error}
            </div>
          )}
          {result && result.log_tail.length > 0 && (
            <details className="preview-log" open={result.status === "error"}>
              <summary>{t.preview_log}</summary>
              <pre>{result.log_tail.join("\n")}</pre>
            </details>
          )}
          {groups.length === 0 && state.status !== "running" && <p className="muted">{t.preview_no_shots}</p>}
          {groups.map((g) => (
            <section key={g.label} className="preview-group">
              <h4>{g.label}</h4>
              <div className="preview-grid">
                {g.items.map((s) => <Shot key={shotCacheKey(runId, s.file, result?.finished_at)} runId={runId} shot={s} stamp={result?.finished_at ?? null} onOpen={(src, alt) => setBig({ src, alt })} t={t} />)}
              </div>
            </section>
          ))}
        </div>
      </div>
      {big && (
        <div className="preview-overlay" role="dialog" aria-modal="true" aria-label={t.preview_large} onClick={() => setBig(null)}>
          <button type="button" ref={closeRef} className="preview-overlay-close" onClick={() => setBig(null)}>{t.preview_close}</button>
          <img src={big.src} alt={big.alt} onClick={(e) => e.stopPropagation()} />
        </div>
      )}
    </div>
  );
}
