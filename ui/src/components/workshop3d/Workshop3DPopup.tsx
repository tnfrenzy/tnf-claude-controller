import { Suspense, lazy, useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { mockWorkshop3DSession, W3D_DEMO_STATES } from "../../office/workshop3d-mock";
import { useWorkshop3D } from "../../office/useWorkshop3D";
import { w3dCanDelete, w3dControls, w3dDeleteConfirmText, w3dHqProgress, w3dNeedsCadHint } from "../../office/workshop3d-session";
import type { Workshop3DAction, Workshop3DSession } from "../../types";
import { Markdown } from "../common/Markdown";
import { VariantsPanel } from "./VariantsPanel";
import { BATCH_DICTS } from "./batch-logic";
import { Modal } from "../common/Modal";
import { Workshop3DEmpty, Workshop3DRoom } from "./Workshop3DRoom";
import { Workshop3DRenders } from "./Workshop3DRenders";
import { Workshop3DResults } from "./Workshop3DResults";

const Workshop3DViewer = lazy(() => import("./Workshop3DViewer"));

type Tab = "room" | "viewer" | "renders" | "files" | "report" | "batch";
const TABS: readonly Tab[] = ["room", "viewer", "renders", "files", "report", "batch"];
/** Without a session only the room (empty state) and the session-independent "Tạo hàng loạt" tab make sense. */
const NO_SESSION_TABS: readonly Tab[] = ["room", "batch"];

const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);

/** The room itself: questions, note and error are shown by the control strip above, not repeated in the room. */
function RoomFor({ session, title }: { session: Workshop3DSession; title: string }) {
  const s = session.snapshot;
  return <Workshop3DRoom state={s.state} title={title} round={s.round} issues={Array.isArray(s.issues) ? s.issues.length : 0} />;
}

/** Injectable session actions (tests); default is the real API. */
export interface Workshop3DActions {
  act: (slug: string, action: Workshop3DAction) => Promise<unknown>;
  answer: (slug: string, text: string) => Promise<unknown>;
  remove?: (slug: string) => Promise<unknown>;
  continueWith?: (slug: string, text: string) => Promise<unknown>;
}
const realActions: Workshop3DActions = {
  act: (slug, action) => api.workshop3dAction(slug, action),
  answer: (slug, text) => api.workshop3dAnswer(slug, text),
  remove: (slug) => api.workshop3dDelete(slug),
  continueWith: (slug, text) => api.workshop3dContinue(slug, text),
};

/**
 * Control strip of a session: state, estimated cost, Pause / Resume / Stop by state, the error / note banner (with
 * where to install the CAD python when the error is about it) and the answer box while the intake role asks.
 */
export function Workshop3DControls(props: { slug: string; session: Workshop3DSession; onChanged: () => void; actions?: Workshop3DActions; onDeleted?: () => void; title?: string }) {
  const { t } = useT();
  const dict = t as unknown as Record<string, string>;
  const actions = props.actions ?? realActions;
  const s = props.session.snapshot;
  const ctl = w3dControls(s.state);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [answer, setAnswer] = useState("");
  const [contOpen, setContOpen] = useState(false);
  const [contText, setContText] = useState("");
  const canContinue = !!actions.continueWith && (s.state === "done" || s.state === "stopped" || s.state === "failed");
  const run = async (fn: () => Promise<unknown>, after?: () => void) => {
    setBusy(true);
    setMsg(null);
    try {
      await fn();
      after?.();
    } catch (e) {
      setMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      props.onChanged();
    }
  };
  const questions = strList(s.questions).filter(Boolean).slice(0, 5);
  const cost = typeof s.costUsd === "number" && Number.isFinite(s.costUsd) ? s.costUsd : 0;
  const waitUntil = s.state === "waiting_quota" && typeof s.waitUntil === "number" ? new Date(s.waitUntil) : null;
  // Same wait state, two reasons: the subscription limit, or an automatic resume after a role was cut off.
  const retry = s.state === "waiting_quota" && s.waitReason === "retry";
  const hq = w3dHqProgress(s.state, props.session.hq);
  return (
    <div className="w3i-controls" data-state={s.state}>
      <div className="w3i-bar">
        <span className="w3i-state" data-w3i-state={s.state}>{retry ? t.w3i_state_retry : (dict[`w3v_state_${s.state}`] ?? s.state)}</span>
        <span className="fine w3i-cost">{t.w3i_cost.replace("{usd}", cost.toFixed(2))}</span>
        <span className="w3i-buttons">
          {ctl.pause ? <button type="button" disabled={busy} data-w3i-action="pause" onClick={() => void run(() => actions.act(props.slug, "pause"))}>{t.w3i_pause}</button> : null}
          {ctl.resume ? <button type="button" className="primary" disabled={busy} data-w3i-action="resume" onClick={() => void run(() => actions.act(props.slug, "resume"))}>{t.w3i_resume}</button> : null}
          {ctl.stop ? <button type="button" disabled={busy} data-w3i-action="stop" onClick={() => { if (window.confirm(t.w3i_stop_confirm)) void run(() => actions.act(props.slug, "stop")); }}>{t.w3i_stop}</button> : null}
          {canContinue ? <button type="button" disabled={busy} data-w3i-action="continue" onClick={() => setContOpen((v) => !v)}>{t.w3i_continue}</button> : null}
          {actions.remove && w3dCanDelete(s.state) ? (
            <button type="button" className="w3i-delete" disabled={busy} data-w3i-action="delete" onClick={() => {
              const text = w3dDeleteConfirmText(t.w3i_delete_confirm, props.title ?? (typeof props.session.brief?.title === "string" ? props.session.brief.title : props.slug), props.session.diskBytes);
              if (!window.confirm(text)) return;
              void run(() => actions.remove!(props.slug), () => props.onDeleted?.());
            }}>{t.w3i_delete}</button>
          ) : null}
        </span>
      </div>
      {s.error ? (
        <div className="error w3i-banner" role="alert">
          <div>{s.error}</div>
          {w3dNeedsCadHint(s.error) ? <div className="w3i-hint">{t.w3i_cad_hint}</div> : null}
          {ctl.resume ? <div className="fine">{t.w3i_failed_hint}</div> : null}
        </div>
      ) : null}
      {hq ? (
        <div className="fine w3i-note" data-w3i-hq role="status">
          {hq === "preparing" ? t.w3i_hq_preparing : t.w3i_hq_progress.replace("{i}", String(hq.i)).replace("{n}", String(hq.n))}
        </div>
      ) : null}
      {s.note ? <div className="fine w3i-note">{s.note}</div> : null}
      {waitUntil ? <div className="fine w3i-note">{(retry ? t.w3i_retry_until : t.w3i_quota_until).replace("{time}", waitUntil.toLocaleString())}</div> : null}
      {canContinue && contOpen ? (
        <div className="w3i-questions" data-w3i-continue>
          <div><strong>{t.w3i_continue_title}</strong></div>
          <div className="fine">{t.w3i_continue_hint}</div>
          <textarea rows={4} maxLength={4000} value={contText} aria-label={t.w3i_continue_title} placeholder={t.w3i_continue_ph} onChange={(e) => setContText(e.target.value)} />
          <button type="button" className="primary" disabled={busy || !contText.trim()} data-w3i-action="continue-go"
            onClick={() => void run(() => actions.continueWith!(props.slug, contText.trim()), () => { setContText(""); setContOpen(false); })}>{t.w3i_continue_go}</button>
        </div>
      ) : null}
      {s.state === "awaiting_user" ? (
        <div className="w3i-questions">
          <div><strong>{t.w3i_questions}</strong></div>
          {questions.length > 0 ? <ol>{questions.map((q, i) => <li key={i}>{q}</li>)}</ol> : null}
          <textarea rows={3} maxLength={4000} value={answer} aria-label={t.w3i_answer} placeholder={t.w3i_answer_ph} onChange={(e) => setAnswer(e.target.value)} />
          <button type="button" className="primary" disabled={busy || !answer.trim()} data-w3i-action="answer"
            onClick={() => void run(() => actions.answer(props.slug, answer.trim()), () => setAnswer(""))}>{t.w3i_send_answer}</button>
        </div>
      ) : null}
      {msg ? <div role="status" className="error w3i-msg">{msg}</div> : null}
    </div>
  );
}

/** "Tệp" tab: session outputs and renders, each downloaded with the token header (never a token in a URL). */
export function Workshop3DFiles(props: { slug: string; files: string[]; renders: string[]; download?: (slug: string, rel: string) => Promise<void> }) {
  const { t } = useT();
  const [msg, setMsg] = useState<string | null>(null);
  // Internal markers (outputs/.build-ok) are not files the user wants.
  const all = [...props.files, ...props.renders].filter((rel) => !(rel.split("/").pop() ?? "").startsWith("."));
  const download = props.download ?? ((slug: string, rel: string) => api.workshop3dDownload(slug, rel));
  if (all.length === 0) return <div className="fine">{t.w3i_no_files}</div>;
  return (
    <div className="w3i-files">
      <ul className="d3p-files">
        {all.map((rel) => (
          <li key={rel} data-w3i-file={rel}>
            <span className="w3i-file-name" title={rel}>{rel}</span>
            <button type="button" onClick={() => { setMsg(null); download(props.slug, rel).catch((e: unknown) => setMsg(e instanceof Error ? e.message : String(e))); }}>{t.w3i_download}</button>
          </li>
        ))}
      </ul>
      {msg ? <div role="status" className="error">{msg}</div> : null}
    </div>
  );
}

/** Demo / dev mode (#/w3d-demo, dev build only): pick any state and number of issues, or let the demo walk through all states. */
function Workshop3DDemo() {
  const { t } = useT();
  const [idx, setIdx] = useState(0);
  const [issues, setIssues] = useState(0);
  const [auto, setAuto] = useState(false);
  useEffect(() => {
    if (!auto) return;
    const id = setInterval(() => setIdx((i) => (i + 1) % W3D_DEMO_STATES.length), 9000);
    return () => clearInterval(id);
  }, [auto]);
  const state = W3D_DEMO_STATES[idx]!;
  const session = mockWorkshop3DSession(state, issues);
  const s = session.snapshot;
  return (
    <div className="w3r-demo">
      <div className="w3r-demo-bar">
        {W3D_DEMO_STATES.map((st, i) => (
          <button key={st} type="button" data-demo-state={st} className={i === idx ? "primary" : undefined} onClick={() => { setAuto(false); setIdx(i); }}>{st}</button>
        ))}
        <button type="button" data-demo-issues="1" onClick={() => setIssues((n) => (n + 1) % 10)}>{t.w3r_issues}: {issues}</button>
        <button type="button" onClick={() => setAuto((a) => !a)}>{auto ? "■ auto" : "▶ auto"}</button>
      </div>
      <Workshop3DRoom state={s.state} title={session.brief?.title ?? ""} round={s.round} issues={s.issues?.length ?? 0}
        note={s.note ?? undefined} error={s.error ?? undefined} questions={s.questions} />
    </div>
  );
}

/**
 * Popup of a 3D workshop session (a floor of the 3D tower): control strip, then tabs "Phòng" (the 2.5D room fed by
 * GET /api/workshop3d/:slug every ~3 s), "Bàn xem 3D" (Workshop3DViewer), "Tệp" and "Báo cáo" (REPORT.md).
 */
export function Workshop3DPopup(props: { slug?: string | undefined; demo?: boolean | undefined; title?: string | undefined; initialTab?: "batch" | undefined; onClose: () => void; onDeleted?: (() => void) | undefined }) {
  const { t, lang } = useT();
  const [tab, setTab] = useState<Tab>(props.initialTab ?? "room");
  const data = useWorkshop3D(props.slug, 3000, !props.demo);
  const { reload } = data;
  useEffect(() => { if (!props.demo) reload(); }, [tab, props.demo, reload]);
  const title = props.title ?? (data.title || t.w3r_title);
  if (props.demo) {
    return <Modal size="large" title={t.w3r_title} sub={t.w3i_demo} onClose={props.onClose}><Workshop3DDemo /></Modal>;
  }
  const session = data.session;
  const slug = data.slug;
  const tabLabel: Record<Tab, string> = { room: t.w3i_tab_room, viewer: t.w3i_tab_viewer, renders: t.w3i_tab_renders, files: t.w3i_tab_files, report: t.w3i_tab_report, batch: BATCH_DICTS[lang].mb_tab };
  const report = typeof session?.report === "string" ? session.report : "";
  return (
    <Modal size="large" title={title} sub={t.w3r_title} onClose={props.onClose}>
      {data.error && !session ? <div className="error w3i-banner" role="alert">{data.error}</div> : null}
      {session && slug ? <Workshop3DControls slug={slug} session={session} onChanged={reload} title={title} onDeleted={() => { props.onDeleted?.(); props.onClose(); }} /> : null}
      {session && slug ? <Workshop3DResults slug={slug} paths={session.paths} done={session.snapshot.state === "done"} onChanged={reload} /> : null}
      {(session && slug) || !data.loading || tab === "batch" ? (
        <div className="w3r-tabs" role="tablist">
          {(session && slug ? TABS : NO_SESSION_TABS).map((k) => (
            <button key={k} type="button" role="tab" data-w3i-tab={k} aria-selected={tab === k} className={tab === k ? "primary" : undefined} onClick={() => setTab(k)}>{tabLabel[k]}</button>
          ))}
        </div>
      ) : null}
      {tab === "batch" ? (
        <VariantsPanel slug={slug ?? undefined} />
      ) : !session ? (
        data.loading ? <div className="fine">{t.w3r_loading}</div> : <Workshop3DEmpty />
      ) : tab === "viewer" && slug ? (
        <Suspense fallback={<div className="fine">{t.w3r_loading}</div>}><Workshop3DViewer slug={slug} onRebuilt={reload} /></Suspense>
      ) : tab === "renders" && slug ? (
        <Workshop3DRenders slug={slug} session={session} onChanged={reload} />
      ) : tab === "files" && slug ? (
        <Workshop3DFiles slug={slug} files={strList(session.files)} renders={strList(session.renders)} />
      ) : tab === "report" ? (
        report ? <div className="w3i-report"><Markdown source={report} /></div> : <div className="fine">{t.w3i_no_report}</div>
      ) : (
        <RoomFor session={session} title={title} />
      )}
    </Modal>
  );
}
