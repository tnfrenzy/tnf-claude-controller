import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { fmtQuotaRange } from "../../run/quotaFormat";
import { buildScoutPrompt, canScout, isScoutPrompt, scoutConfirmText, SCOUT_FOCUS_IDS, type ScoutFocus } from "../../queue/scoutAgent";
import { loadSkipped } from "../../queue/scoutSkipped";
import { hideScoutRun, loadScoutFocus, loadScoutHidden, saveScoutFocus } from "../../lib/prefs";
import type { ProjectSummary, RunRecord } from "../../types";
import { Modal } from "../common/Modal";
import { ScoutReview } from "./ScoutReview";

/**
 * Body of the "Agent đề xuất" popup of one environment: the four focus groups, the button that starts the proposal
 * agent, and this environment's proposals (review = pick and run them, delete = hide from the list).
 */
export function ScoutPopup(props: { project: ProjectSummary; onOpenRun: (runId: string) => void }) {
  const { t, lang } = useT();
  const { project, onOpenRun } = props;
  const [focus, setFocus] = useState<ScoutFocus[]>(() => loadScoutFocus());
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [hidden, setHidden] = useState<string[]>(() => loadScoutHidden());
  const [review, setReview] = useState<string | null>(null);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  const load = useCallback(() => {
    api.listRuns({ scout: true, project: project.name, limit: 50 }).then((r) => {
      if (alive.current) setRuns(r.runs.filter((x) => x.project === project.name && isScoutPrompt(x.prompt)));
    }).catch(() => {});
  }, [project.name]);
  useEffect(() => { load(); }, [load]);

  const toggleFocus = (id: ScoutFocus) => {
    const next = focus.includes(id) ? focus.filter((x) => x !== id) : [...focus, id];
    if (next.length === 0) return; // the last ticked group cannot be unticked
    const ordered = SCOUT_FOCUS_IDS.filter((x) => next.includes(x));
    setFocus(ordered);
    saveScoutFocus(ordered);
  };
  const ok = canScout({ hasRepo: project.repo_path != null, running: project.running, busy });
  const start = async () => {
    if (!ok || !window.confirm(scoutConfirmText(lang))) return;
    setBusy(true);
    setErr(null);
    try {
      const { run } = await api.startRun({ prompt: buildScoutPrompt(project.name, lang, { focus, skipped: loadSkipped(project.name) }), project: project.name, kind: "coding", scout: true });
      for (;;) {
        await new Promise((r) => setTimeout(r, 3000));
        if (!alive.current) return;
        const meta = await api.getRun(run.id);
        if (meta.run.status === "running") continue;
        load();
        if (meta.run.status === "done") setReview(run.id);
        else onOpenRun(run.id);
        break;
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      if (alive.current) setBusy(false);
    }
  };

  const visible = runs.filter((r) => !hidden.includes(r.id));
  return (
    <div className="scout-popup" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="fine">{ok ? t.env_scout_tip : t.env_scout_need_repo}</div>
      <fieldset className="scout-focus" style={{ display: "flex", flexWrap: "wrap", gap: "6px 16px", border: "1px solid var(--line, #243049)", borderRadius: 8, padding: "8px 12px" }}>
        <legend>{t.scoutFocus_title}</legend>
        {SCOUT_FOCUS_IDS.map((id) => {
          const on = focus.includes(id);
          return (
            <label key={id} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <input type="checkbox" checked={on} disabled={on && focus.length === 1} onChange={() => toggleFocus(id)} />
              {t[`scoutFocus_${id}`]}
            </label>
          );
        })}
      </fieldset>
      <div>
        <button type="button" className="primary" disabled={!ok} onClick={() => void start()}>{busy ? t.env_scout_busy : t.scout_run}</button>
      </div>
      {err ? <div className="error">{err}</div> : null}
      <div>
        <b>{t.scout_list_title}</b>
        {visible.length === 0 ? <p className="muted">{t.scout_tab_empty}</p> : null}
        {visible.map((r) => (
          <div key={r.id} className="row fine" style={{ marginBottom: 6 }}>
            <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
              <a href={"#/runs/" + r.id}>{r.id}</a> · {r.status} · {new Date(r.created_at).toLocaleString("vi-VN")} · {t.quota_5h}: {fmtQuotaRange(r.quota_start, r.quota_end, r.quota_pct)}
            </span>
            <button type="button" className="mini" disabled={r.status !== "done"} onClick={() => setReview(r.id)}>{t.scoutReview_reopen}</button>
            <button type="button" className="mini" onClick={() => { if (window.confirm(t.scout_delete_ask)) setHidden(hideScoutRun(r.id)); }}>{t.scout_delete}</button>
          </div>
        ))}
        <p className="muted">{t.scout_tab_note}</p>
      </div>
      {review ? (
        <Modal title={t.scoutReview_title} sub={project.name} size="large" onClose={() => setReview(null)}>
          <ScoutReview project={project.name} scoutRunId={review} lang={lang} onClose={() => setReview(null)} />
        </Modal>
      ) : null}
    </div>
  );
}
