import { useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";

/** Settings block: most coding runs that run at once in the app; extra runs wait and start in order. */
export function MaxRunsSection() {
  const { t } = useT();
  const [info, setInfo] = useState<{ maxRuns: number; ceiling: number; running: number; waiting: number; held: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = () => {
    api.maxRuns().then((r) => setInfo({ maxRuns: r.maxRuns, ceiling: r.ceiling, running: r.running, waiting: r.waiting.length, held: r.waiting.flatMap((w) => (w.reason ? [`${w.id}: ${w.reason}`] : [])) })).catch((e: Error) => setError(e.message));
  };
  useEffect(load, []);

  const change = (v: number) => {
    setError(null);
    api.setMaxRuns(v).then(load).catch((e: Error) => setError(e.message));
  };

  if (!info) return error ? <div className="error">{error}</div> : null;
  return (
    <div className="card">
      <h4>{t.maxruns_title}</h4>
      <label className="row">
        {t.maxruns_label}
        <select value={info.maxRuns} onChange={(e) => change(Number(e.target.value))} aria-label={t.maxruns_label}>
          {Array.from({ length: info.ceiling }, (_, i) => i + 1).map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      <div className="muted">{t.maxruns_note}</div>
      <div className="fine">{t.maxruns_state.replace("{running}", String(info.running)).replace("{waiting}", String(info.waiting))}</div>
      {info.held.map((h) => <div className="fine" key={h}>{h}</div>)}
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
