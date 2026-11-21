import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useT } from "../../i18n";
import { createWorkshop3DApi } from "./api";
import { parseGlbInfo, type GlbInfo } from "./glb-info";
import {
  arIssue, arModes, baseName, detectPlatform, formatMm, isBusy, pickSources, type Vec3,
} from "./logic";
import { InfoPanel, ParamsPanel, PartsPanel, RenderGallery } from "./Panels";
import type { Lighting, MeasureResult } from "./ModelStage";
import { PANO_PATH } from "./Pano";
import type { W3DApi, W3DDetail, W3DParams } from "./types";

const ModelStage = lazy(() => import("./ModelStage"));
const Model3DViewer = lazy(() => import("./Model3DViewer"));
const Workshop3DPano = lazy(() => import("./Pano"));

type Tab = "info" | "parts" | "renders" | "params";
const POLL_MS = 3000;

interface Props {
  slug: string;
  /** Injected in tests / the dev page; defaults to the real `/api/workshop3d/:slug` client. */
  api?: W3DApi;
  /** Platform override (tests, dev page); default is detected from the browser. */
  platform?: ReturnType<typeof detectPlatform>;
  /** Called after a rebuild was accepted (the room popup wakes its own polling). */
  onRebuilt?: () => void;
}

export default function Workshop3DViewer({ slug, api: apiProp, platform: platformProp, onRebuilt }: Props) {
  const { t } = useT();
  const api = useMemo(() => apiProp ?? createWorkshop3DApi(slug), [apiProp, slug]);
  const platform = useMemo(
    () => platformProp ?? (typeof navigator === "undefined" ? "desktop" : detectPlatform(navigator.userAgent, navigator.maxTouchPoints)),
    [platformProp],
  );

  const [detail, setDetail] = useState<W3DDetail | null>(null);
  const [loadErr, setLoadErr] = useState<string | null>(null);
  const [rev, setRev] = useState(0);
  const prevBusy = useRef(false);

  const refresh = useCallback(async () => {
    try {
      const d = await api.detail();
      setDetail(d);
      setLoadErr(null);
      const busy = isBusy(d.snapshot.state);
      if (prevBusy.current && !busy) setRev((r) => r + 1); // a rebuild just finished: reload model + renders
      prevBusy.current = busy;
    } catch (e) {
      setLoadErr(e instanceof Error ? e.message : String(e));
    }
  }, [api]);

  useEffect(() => { void refresh(); }, [refresh]);
  const busyNow = detail ? isBusy(detail.snapshot.state) : false;
  useEffect(() => {
    if (!busyNow) return;
    const id = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(id);
  }, [busyNow, refresh]);

  const files = detail?.files ?? [];
  const sources = useMemo(() => pickSources(files, platform), [detail?.files, platform]); // eslint-disable-line react-hooks/exhaustive-deps

  // GLB + USDZ → object URLs (the token header cannot ride on a <model-viewer src>).
  const [glbUrl, setGlbUrl] = useState<string | null>(null);
  const [usdzUrl, setUsdzUrl] = useState<string | null>(null);
  const [info, setInfo] = useState<GlbInfo | null>(null);
  const [modelErr, setModelErr] = useState(false);
  // Object URLs per file, kept while the viewer is open: switching doors / versions back and forth is instant.
  const cache = useRef(new Map<string, { url: string; info: GlbInfo | null }>());
  useEffect(() => {
    const c = cache.current;
    return () => { c.forEach((v) => URL.revokeObjectURL(v.url)); c.clear(); };
  }, []);
  useEffect(() => {
    cache.current.forEach((v) => URL.revokeObjectURL(v.url));
    cache.current.clear();
  }, [rev]);
  useEffect(() => {
    if (!sources.glb) { setGlbUrl(null); setInfo(null); return; }
    const key = `${sources.glb}#${rev}`;
    const hit = cache.current.get(key);
    if (hit) { setInfo(hit.info); setGlbUrl(hit.url); return; }
    let dead = false;
    setModelErr(false);
    api.file(sources.glb).then(async (b) => {
      const buf = await b.arrayBuffer();
      if (dead) return;
      const url = URL.createObjectURL(new Blob([buf], { type: "model/gltf-binary" }));
      const inf = parseGlbInfo(buf);
      cache.current.set(key, { url, info: inf });
      setInfo(inf);
      setGlbUrl(url);
    }).catch(() => { if (!dead) setModelErr(true); });
    return () => { dead = true; };
  }, [api, sources.glb, rev]);
  useEffect(() => {
    if (!sources.usdz || platform !== "ios") { setUsdzUrl(null); return; }
    let dead = false;
    let url: string | null = null;
    api.file(sources.usdz).then((b) => {
      if (dead) return;
      url = URL.createObjectURL(new Blob([b], { type: "model/vnd.usdz+zip" }));
      setUsdzUrl(url);
    }).catch(() => undefined);
    return () => { dead = true; if (url) URL.revokeObjectURL(url); };
  }, [api, sources.usdz, platform, rev]);

  // Viewer tools
  const [tab, setTab] = useState<Tab>("info");
  const [lighting, setLighting] = useState<Lighting>("studio");
  const [grid, setGrid] = useState(false);
  const autoRotate = false; // auto-rotate and the distance tool were removed from the toolbar
  const [resetKey, setResetKey] = useState(0);
  const measuring = false;
  const [measure, setMeasure] = useState<{ r: MeasureResult | null; n: number }>({ r: null, n: 0 });
  const [size, setSize] = useState<Vec3 | null>(null);
  const [stage, setStage] = useState<"model" | "pano">("model");
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set());
  const [arCan, setArCan] = useState<boolean | null>(null);
  // Sizes are not edited here: not every object has meaningful dimensions, so AR uses the model as built.
  const scale = null;
  const [stlPath, setStlPath] = useState<string | null>(null);
  const [rebuildErr, setRebuildErr] = useState<string | null>(null);

  useEffect(() => { setHidden(new Set()); }, [rev]);

  const toggleNode = (n: string) => setHidden((h) => { const s = new Set(h); if (s.has(n)) s.delete(n); else s.add(n); return s; });
  const allNodes = (visible: boolean) => setHidden(visible ? new Set() : new Set(info?.nodes ?? []));

  const onRebuild = async (changed: W3DParams) => {
    setRebuildErr(null);
    try {
      await api.rebuild(changed);
      onRebuilt?.();
      prevBusy.current = true;
      await refresh();
    } catch (e) {
      setRebuildErr(e instanceof Error ? e.message : String(e));
    }
  };

  if (!detail) {
    return <div className="fine" data-w3v="loading">{loadErr ?? t.w3v_loading}</div>;
  }

  const snap = detail.snapshot;
  const stlFile = stlPath ?? sources.stl[0] ?? null;
  const hasViewer = sources.glb !== null;
  const modes = arModes(platform);
  const arProblem = arIssue(platform, typeof window === "undefined" ? true : window.isSecureContext, arCan);
  return (
    <div className="w3v" data-w3v="root" data-platform={platform}>
      <header className="w3v-head">
        <strong>{detail.brief.title}</strong>
        <span className={`w3v-badge${isBusy(snap.state) ? " w3v-busy" : ""}`} data-state={snap.state}>
          {(t as Record<string, string>)[`w3v_state_${snap.state}`] ?? snap.state}
        </span>
        <span className="fine">{t.w3v_cost.replace("{usd}", snap.costUsd.toFixed(2))}</span>
      </header>
      {loadErr && <div className="w3v-err">{loadErr}</div>}

      <div className="w3v-body">
        <section className="w3v-main">
          {detail.renders.includes(PANO_PATH) ? (
            <div className="w3v-toolbar" role="group" aria-label={t.w3v_stage}>
              <button type="button" data-w3v-stage="model" aria-pressed={stage === "model"} onClick={() => setStage("model")}>{t.w3v_stage_model}</button>
              <button type="button" data-w3v-stage="pano" aria-pressed={stage === "pano"} onClick={() => setStage("pano")}>{t.w3v_stage_pano}</button>
            </div>
          ) : null}
          {stage === "pano" && detail.renders.includes(PANO_PATH) ? (
            <Suspense fallback={<div className="fine">{t.w3v_loading}</div>}>
              <Workshop3DPano api={api} rev={rev} failText={t.w3v_pano_fail} waitText={t.w3v_loading} />
              <div className="fine">{t.w3v_pano_hint}</div>
            </Suspense>
          ) : hasViewer ? (
            <>
              <div className="w3v-toolbar" role="toolbar" aria-label={t.w3v_tools}>
                <button type="button" onClick={() => setResetKey((k) => k + 1)}>{t.w3v_reset_camera}</button>
                <button type="button" aria-pressed={lighting === "studio"} onClick={() => setLighting("studio")}>{t.w3v_light_studio}</button>
                <button type="button" aria-pressed={lighting === "outdoor"} onClick={() => setLighting("outdoor")}>{t.w3v_light_outdoor}</button>
                <button type="button" aria-pressed={grid} onClick={() => setGrid((v) => !v)}>{t.w3v_grid}</button>
              </div>
              <div className={`w3v-stage w3v-${lighting}${measuring ? " w3v-measuring" : ""}`} data-viewer="glb">
                {glbUrl ? (
                  <Suspense fallback={<div className="fine">{t.w3v_loading}</div>}>
                    <ModelStage
                      src={glbUrl}
                      iosSrc={scale ? undefined : usdzUrl ?? undefined}
                      scale={scale}
                      onArSupport={setArCan}
                      arModes={modes}
                      arLabel={t.w3v_ar}
                      lighting={lighting}
                      keepCamera
                      grid={grid}
                      autoRotate={autoRotate}
                      resetKey={resetKey}
                      measuring={measuring}
                      hidden={hidden}
                      onLoad={(d) => setSize((old) => (old && scale ? old : d))}
                      onMeasure={(r, n) => setMeasure({ r, n })}
                      onError={() => setModelErr(true)}
                    />
                  </Suspense>
                ) : <div className="fine">{modelErr ? t.w3v_model_error : t.w3v_loading}</div>}
              </div>
              {arProblem && <div className="fine" data-w3v="ar-issue">{t[`w3v_ar_issue_${arProblem}` as const]}</div>}
              {modelErr && glbUrl && <div className="w3v-err">{t.w3v_model_error}</div>}
              <div className="w3v-readout fine" aria-live="polite">
                {measuring
                  ? measure.r
                    ? t.w3v_measure_result.replace("{mm}", formatMm(measure.r.mm))
                    : t.w3v_measure_pick.replace("{n}", String(measure.n + 1))
                  : grid
                    ? t.w3v_grid_note
                    : t.w3v_hint}
              </div>
            </>
          ) : (
            <div className="fine" data-w3v="no-model">{t.w3v_no_model}</div>
          )}

          {sources.stl.length > 0 && (
            <details className="w3v-stl">
              <summary>{t.w3v_stl_parts.replace("{n}", String(sources.stl.length))}</summary>
              <select value={stlFile ?? ""} onChange={(e) => setStlPath(e.target.value)} aria-label={t.w3v_stl_pick}>
                {sources.stl.map((p) => <option key={p} value={p}>{baseName(p)}</option>)}
              </select>
              {stlFile && (
                <Suspense fallback={<div className="fine">{t.w3v_loading}</div>}>
                  <Model3DViewer key={`${stlFile}:${rev}`} runId={slug} relPath={stlFile} fetchBlob={(p) => api.file(p)} onOpenFile={() => undefined} />
                </Suspense>
              )}
            </details>
          )}
        </section>

        <aside className="w3v-side">
          <div className="w3v-tabs" role="tablist">
            {(["info", "parts", "renders", "params"] as const).map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
                {t[`w3v_tab_${k}` as const]}
              </button>
            ))}
          </div>
          <div className="w3v-panel">
            {tab === "info" && <InfoPanel info={info} size={size} bytes={info?.bytes ?? null} />}
            {tab === "parts" && <PartsPanel nodes={info?.nodes ?? []} hidden={hidden} onToggle={toggleNode} onAll={allNodes} />}
            {tab === "renders" && <RenderGallery api={api} renders={detail.renders} rev={rev} />}
            {tab === "params" && <ParamsPanel params={detail.brief.params} snapshot={snap} onRebuild={onRebuild} error={rebuildErr} />}
          </div>
        </aside>
      </div>
    </div>
  );
}
