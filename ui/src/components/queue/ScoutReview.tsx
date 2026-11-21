import { useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { parseScoutProposals } from "../../../../src/core/ideas/scout-proposals";
import { addSkipped } from "../../queue/scoutSkipped";
import { filterDismissed, loadDismissed, markDismissed } from "../../queue/scoutDismissed";
import {
  approvedItems, canSplit, editFields, estimateTotal, initReview, removeItem, removeSettled, runSplitSequence, setStatus,
  SCOUT_SPLIT_BUDGET_USD, type ReviewItem, type SplitItemResult,
} from "../../queue/scoutReview";

type Lang = "vi" | "en";
type Progress = Record<string, "starting" | "running" | SplitItemResult["state"]>;

const fill = (tpl: string, vars: Record<string, string | number>) =>
  tpl.replace(/\{(\w+)\}/g, (_m, k: string) => String(vars[k] ?? ""));

export interface ScoutReviewProps {
  project: string;
  scoutRunId: string;
  lang: Lang;
  onClose: () => void;
}

/** Review screen for scout proposals. All content is untrusted text, rendered as plain text only. */
export function ScoutReview({ project, scoutRunId, onClose }: ScoutReviewProps) {
  const { t } = useT();
  const [report, setReport] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [parseErrors, setParseErrors] = useState<string[]>([]);
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [editing, setEditing] = useState<{ id: string; title: string; goal: string; scope: string } | null>(null);
  const [editErrors, setEditErrors] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress>({});
  const [results, setResults] = useState<SplitItemResult[] | null>(null);
  const [pendingInQueue, setPendingInQueue] = useState(0);
  const cancelled = useRef(false);

  useEffect(() => {
    let live = true;
    cancelled.current = false;
    api.report(scoutRunId).then(
      (text) => {
        if (!live) return;
        setReport(text);
        const parsed = parseScoutProposals(text);
        if (parsed.ok) setItems(initReview(filterDismissed(parsed.proposals, loadDismissed(scoutRunId), scoutRunId)));
        else setParseErrors(parsed.errors);
      },
      (e: unknown) => { if (live) setLoadError(e instanceof Error ? e.message : String(e)); },
    );
    api.queue(project).then(
      (q) => { if (live) setPendingInQueue(q.commands.filter((c) => c.status === "chờ duyệt").length); },
      () => {},
    );
    return () => { live = false; cancelled.current = true; };
  }, [project, scoutRunId]);

  const approved = approvedItems(items);
  const total = estimateTotal(approved.length);
  const allowed = canSplit(items, { busy, pendingInQueue });

  const saveEdit = () => {
    if (!editing) return;
    const r = editFields(items, editing.id, { title: editing.title, goal: editing.goal, scope: editing.scope });
    if (r.ok) { setItems(r.items); setEditing(null); setEditErrors([]); }
    else setEditErrors(r.errors);
  };

  const start = async () => {
    setConfirming(false);
    setBusy(true);
    setProgress({});
    setResults(null);
    cancelled.current = false;
    const res = await runSplitSequence(items, api, {
      project, scoutRunId,
      isCancelled: () => cancelled.current,
      onProgress: (id, state) => setProgress((p) => ({ ...p, [id]: state })),
    });
    setResults(res);
    setItems((cur) => removeSettled(cur, res));
    setBusy(false);
    api.queue(project).then((q) => setPendingInQueue(q.commands.filter((c) => c.status === "chờ duyệt").length), () => {});
  };

  const statusLabel = (s: ReviewItem["status"]) =>
    s === "approved" ? t.scoutReview_status_approved : s === "skipped" ? t.scoutReview_status_skipped : t.scoutReview_status_pending;
  const diffLabel = (d: string) =>
    d === "low" ? t.scoutReview_difficulty_low : d === "high" ? t.scoutReview_difficulty_high : t.scoutReview_difficulty_medium;
  const progressText = (id: string) => {
    const r = results?.find((x) => x.id === id);
    if (r) {
      if (r.state === "done") return fill(t.scoutReview_progress_done, { n: r.commands, cost: r.costUsd.toFixed(2) });
      if (r.state === "error") return fill(t.scoutReview_itemError, { error: r.error ?? "" });
      return t.scoutReview_progress_cancelled;
    }
    const s = progress[id];
    if (s === "starting") return t.scoutReview_progress_starting;
    if (s === "running") return t.scoutReview_progress_running;
    return null;
  };

  return (
    <section className="scout-review" aria-label={t.scoutReview_title}>
      <header className="scout-review-head">
        <h3>{t.scoutReview_title}</h3>
        <button type="button" onClick={onClose}>{t.scoutReview_close}</button>
      </header>
      {loadError !== null && <p className="scout-review-error" role="alert">{t.scoutReview_loadError}: {loadError}</p>}
      {report === null && loadError === null && <p>{t.scoutReview_loading}</p>}
      {parseErrors.length > 0 && (
        <div className="scout-review-error" role="alert">
          <p>{t.scoutReview_parseError}</p>
          <ul>{parseErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>
        </div>
      )}
      {report !== null && parseErrors.length === 0 && items.length === 0 && <p className="scout-note" role="status">{t.scoutReview_empty}</p>}
      {items.length > 0 && (
        <>
          <ul className="scout-review-list">
            {items.map((it) => {
              const p = it.proposal;
              const isEditing = editing?.id === p.id;
              const note = progressText(p.id);
              return (
                <li key={p.id} className={`scout-card scout-${it.status}`}>
                  <div className="scout-card-head">
                    <strong>{p.title}</strong>
                    <span className="scout-badge">{statusLabel(it.status)}</span>
                    {it.edited && <span className="scout-badge">{t.scoutReview_edited}</span>}
                  </div>
                  <dl className="scout-fields">
                    <dt>{t.scoutReview_field_goal}</dt><dd>{p.goal}</dd>
                    <dt>{t.scoutReview_field_reason}</dt><dd>{p.reason}</dd>
                    <dt>{t.scoutReview_field_scope}</dt><dd>{p.scope}</dd>
                    <dt>{t.scoutReview_field_risk}</dt><dd>{p.risk}</dd>
                    <dt>{t.scoutReview_field_difficulty}</dt><dd>{diffLabel(p.difficulty)}</dd>
                  </dl>
                  <div className="scout-tags">
                    {p.agent && <span className="scout-tag"><b>{t.scoutReview_agentAi}</b> {p.agent}</span>}
                    {p.feature && <span className="scout-tag"><b>{t.scoutReview_feature}</b> {p.feature}</span>}
                    {p.security && <span className="scout-tag"><b>{t.scoutReview_security}</b> {p.security}</span>}
                  </div>
                  {p.sources && p.sources.length > 0 && (
                    <div className="scout-sources">
                      <div className="scout-sources-title">{t.scoutReview_sources}</div>
                      <ul>
                        {p.sources.slice(0, 10).filter((src) => /^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(src.url)).map((src) => (
                          <li key={src.url}>
                            <a href={src.url} target="_blank" rel="noopener noreferrer">{src.title}</a> <span className="muted">{fill(t.scoutReview_stars, { n: String(src.stars) })}</span>
                            {src.note && <span className="scout-source-note"> {src.note}</span>}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}
                  <p className="scout-note">{t.scoutReview_costEach}</p>
                  {note !== null && <p className="scout-progress" role="status">{note}</p>}
                  {isEditing && editing ? (
                    <div className="scout-edit">
                      <label>{t.scoutReview_field_title}
                        <input value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                      </label>
                      <label>{t.scoutReview_field_goal}
                        <textarea rows={3} value={editing.goal} onChange={(e) => setEditing({ ...editing, goal: e.target.value })} />
                      </label>
                      <label>{t.scoutReview_field_scope}
                        <textarea rows={3} value={editing.scope} onChange={(e) => setEditing({ ...editing, scope: e.target.value })} />
                      </label>
                      {editErrors.length > 0 && <ul className="scout-review-error" role="alert">{editErrors.map((e, i) => <li key={i}>{e}</li>)}</ul>}
                      <div className="scout-actions">
                        <button type="button" onClick={saveEdit}>{t.scoutReview_save}</button>
                        <button type="button" onClick={() => { setEditing(null); setEditErrors([]); }}>{t.scoutReview_cancel}</button>
                      </div>
                    </div>
                  ) : (
                    <div className="scout-actions">
                      <button type="button" disabled={busy || it.status === "approved"} onClick={() => setItems(setStatus(items, p.id, "approved"))}>{t.scoutReview_approve}</button>
                      <button type="button" disabled={busy || it.status === "skipped"} onClick={() => { markDismissed(scoutRunId, p.id); addSkipped(project, { title: p.title, feature: p.feature ?? "" }); setItems(removeItem(items, p.id)); }}>{t.scoutReview_skip}</button>
                      <button type="button" disabled={busy} onClick={() => { setEditErrors([]); setEditing({ id: p.id, title: p.title, goal: p.goal, scope: p.scope }); }}>{t.scoutReview_edit}</button>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
          <footer className="scout-review-foot">
            <p className="scout-note">{fill(t.scoutReview_costTotal, { n: approved.length, cost: total.toFixed(2) })}</p>
            {approved.length === 0 && <p className="scout-note">{t.scoutReview_noneApproved}</p>}
            {approved.length > 0 && !busy && pendingInQueue + approved.length > 50 && <p className="scout-note">{t.scoutReview_queueFull}</p>}
            {confirming ? (
              <div className="scout-confirm">
                <p>{fill(t.scoutReview_confirm, { n: approved.length, cost: (approved.length * SCOUT_SPLIT_BUDGET_USD).toFixed(2) })}</p>
                <div className="scout-actions">
                  <button type="button" disabled={!allowed} onClick={() => { void start(); }}>{t.scoutReview_split}</button>
                  <button type="button" onClick={() => setConfirming(false)}>{t.scoutReview_cancel}</button>
                </div>
              </div>
            ) : (
              <button type="button" className="scout-split" disabled={!allowed} onClick={() => setConfirming(true)}>{t.scoutReview_split}</button>
            )}
            {results !== null && <p className="scout-note" role="status">{t.scoutReview_finished}</p>}
          </footer>
        </>
      )}
      {report !== null && (
        <details className="scout-report" open={items.length === 0}>
          <summary>{t.scoutReview_report}</summary>
          <pre>{report}</pre>
        </details>
      )}
    </section>
  );
}

export default ScoutReview;
