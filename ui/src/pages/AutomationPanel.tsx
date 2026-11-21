import { useCallback, useEffect, useState } from "react";
import { api, type AutopilotView, type DupCheckResult, type PeriodSummary } from "../api";
import { useT, type Dict } from "../i18n";
import { buildSchedule, parseScheduleForm, type ScheduleForm } from "../settings/scheduleBuilder";

const DEFAULT_FORM: ScheduleForm = { mode: "weekly", days: [1], dayOfMonth: 1, time: "08:30", quiet: "" };
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 0];

/** Automation panel: autopilot switch, schedule, webhooks, period summary and duplicate-idea check. */
export function AutomationPanel(props: { project?: string }) {
  const { t } = useT();
  const [view, setView] = useState<AutopilotView | null>(null);
  const [form, setForm] = useState<ScheduleForm>(DEFAULT_FORM);
  const [hooks, setHooks] = useState("");
  const [summary, setSummary] = useState<PeriodSummary | null>(null);
  const [dupTitle, setDupTitle] = useState("");
  const [dup, setDup] = useState<DupCheckResult | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [projects, setProjects] = useState<string[]>([]);
  const [project, setProject] = useState(props.project ?? "");

  const apply = useCallback((v: AutopilotView) => {
    setView(v);
    setForm(parseScheduleForm(v.schedule) ?? DEFAULT_FORM);
    setHooks(v.webhooks.join("\n"));
  }, []);
  const run = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn();
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => { void run(async () => apply(await api.autopilotStatus())); }, [run, apply]);
  useEffect(() => {
    api.projects().then((r) => {
      const names = r.projects.filter((p) => p.repo_path).map((p) => p.name);
      setProjects(names);
      setProject((cur) => cur || names[0] || "");
    }).catch(() => {});
  }, []);

  return (
    <div className="card automation-panel">
      <h4>{t.auto_title}</h4>
      {err && <div className="fine" style={{ color: "var(--err)" }}>{err}</div>}
      {!view ? (
        <div className="fine">{t.auto_loading}</div>
      ) : (
        <>
          <label className="row fine">
            <input type="checkbox" checked={view.enabled} onChange={() => void run(async () => apply(view.enabled ? await api.autopilotDisable() : await api.autopilotEnable()))} />
            <span>{view.enabled ? t.auto_on : t.auto_off}</span>
          </label>
          <fieldset className="fine" style={{ border: "none", padding: 0, margin: "6px 0" }}>
            <legend>{t.auto_schedule}</legend>
            <div className="fine">{t.auto_current}: {view.schedule ?? t.auto_none}</div>
            {view.schedule && !parseScheduleForm(view.schedule) && <div className="fine">{t.auto_legacy}: <code>{view.schedule}</code></div>}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <label><input type="radio" name="auto-mode" checked={form.mode === "weekly"} onChange={() => setForm({ ...form, mode: "weekly" })} /> {t.auto_mode_weekly}</label>
              <label><input type="radio" name="auto-mode" checked={form.mode === "monthly"} onChange={() => setForm({ ...form, mode: "monthly" })} /> {t.auto_mode_monthly}</label>
            </div>
            {form.mode === "weekly" ? (
              <div className="row" role="group" aria-label={t.auto_days} style={{ flexWrap: "wrap" }}>
                {WEEKDAYS.map((d) => {
                  const on = form.days.includes(d);
                  return (
                    <button key={d} type="button" className="mini chip" aria-pressed={on}
                      style={on ? { background: "var(--accent)", color: "#fff" } : undefined}
                      onClick={() => setForm({ ...form, days: on ? form.days.filter((x) => x !== d) : [...form.days, d] })}>
                      {t[`auto_wd_${d}` as keyof Dict]}
                    </button>
                  );
                })}
              </div>
            ) : (
              <label className="fine">{t.auto_day_of_month}{" "}
                <input type="number" min={1} max={31} value={form.dayOfMonth} onChange={(e) => setForm({ ...form, dayOfMonth: Number(e.target.value) })} />
              </label>
            )}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <label className="fine">{t.auto_time}{" "}
                <input type="time" value={form.time} onChange={(e) => setForm({ ...form, time: e.target.value })} />
              </label>
              <label className="fine">{t.auto_quiet}{" "}
                <input value={form.quiet} placeholder="22:00-06:00" onChange={(e) => setForm({ ...form, quiet: e.target.value })} />
              </label>
            </div>
            <div className="row">
              <button type="button" className="mini" onClick={() => {
                const r = buildSchedule(form);
                if (!r.ok) { setErr(r.error); return; }
                void run(async () => apply(await api.autopilotSetSchedule(r.text)));
              }}>{t.auto_save}</button>
              <button type="button" className="mini" disabled={!view.schedule} onClick={() => void run(async () => apply(await api.autopilotSetSchedule(null)))}>{t.auto_clear}</button>
            </div>
          </fieldset>
          <div className="row" style={{ alignItems: "flex-start" }}>
            <label className="fine" style={{ flex: 1 }}>{t.auto_webhooks}
              <textarea rows={3} style={{ width: "100%" }} value={hooks} onChange={(e) => setHooks(e.target.value)} />
            </label>
            <button type="button" className="mini" onClick={() => void run(async () => apply(await api.autopilotSetWebhooks(hooks.split("\n").map((s) => s.trim()).filter(Boolean))))}>{t.auto_save}</button>
          </div>
          <div className="fine">{t.auto_retry_note}</div>
        </>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <button type="button" className="mini" onClick={() => void run(async () => setSummary(await api.autopilotSummary()))}>{t.auto_summary}</button>
      </div>
      {summary && (
        <div className="fine">
          <div>{t.auto_summary_counts}: {summary.counts.done}/{summary.counts.error}/{summary.counts.other} · ~${summary.costUsd.toFixed(2)} ({t.auto_estimate})</div>
          {summary.blocked.length > 0 && <div>{t.auto_blocked}: {summary.blocked.join(", ")}</div>}
          <pre style={{ whiteSpace: "pre-wrap" }}>{summary.text}{summary.truncated ? "…" : ""}</pre>
        </div>
      )}
      <div className="row" style={{ marginTop: 8 }}>
        <select aria-label={t.auto_dup_check} value={project} onChange={(e) => setProject(e.target.value)}>
          {projects.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
        <input value={dupTitle} placeholder={t.auto_dup_ph} onChange={(e) => setDupTitle(e.target.value)} />
        <button type="button" className="mini" disabled={!dupTitle.trim() || !project} onClick={() => void run(async () => setDup(await api.autopilotCheckDuplicate({ project, title: dupTitle.trim() })))}>{t.auto_dup_check}</button>
      </div>
      {dup && (
        <div className="fine">
          {dup.duplicates.length === 0 ? t.auto_dup_none : (
            <>
              <div style={dup.hasHigh ? { color: "var(--err)" } : undefined}>{dup.hasHigh ? t.auto_dup_high : t.auto_dup_some}</div>
              {dup.duplicates.map((d) => <div key={d.id}>{d.id} · {d.title} · {Math.round(d.score * 100)}% ({d.level})</div>)}
            </>
          )}
        </div>
      )}
      <div style={{ marginTop: 12 }}>
        <h5>{t.auto_ideas_title}</h5>
        <ul className="fine">
          <li>{t.auto_idea_1}</li>
          <li>{t.auto_idea_2}</li>
          <li>{t.auto_idea_3}</li>
          <li>{t.auto_idea_4}</li>
          <li>{t.auto_idea_5}</li>
        </ul>
      </div>
    </div>
  );
}
