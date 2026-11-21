import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { fmtQuota } from "../components/run/AgentTree";
import { Modal } from "../components/common/Modal";
import { TaskListModal } from "../components/run/TaskListModal";
import { UsageBlocksPanel } from "../components/settings/UsageBlocksPanel";
import { useT } from "../i18n";
import { HISTORY_PAGE_SIZE, clampPage, pageCount, pageOffset } from "../lib/pagination";
import type { RunRecord, Workshop3DListItem } from "../types";
import { RunTable } from "./RunsPage";

export function HistoryPage({ queueProject, onOpenWorkshop3d }: { queueProject?: string; onOpenWorkshop3d?: (slug: string) => void } = {}) {
  const { t } = useT();
  // Queue runs are kept out of the normal history; they show only under the "Hàng đợi" tab.
  const [tab, setTab] = useState<"all" | "queue" | "w3d">(queueProject ? "queue" : "all");
  const [repoProjects, setRepoProjects] = useState<string[]>([]);
  const [qProject, setQProject] = useState(queueProject ?? "");
  useEffect(() => {
    api.projects().then((r) => {
      const names = r.projects.filter((p) => p.repo_path).map((p) => p.name);
      setRepoProjects(names);
      setQProject((cur) => cur || names[0] || "");
    }).catch(() => {});
  }, []);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [days, setDays] = useState<{ day: string; cost_usd_est: number; quota_pct: number; runs: number }[]>([]);
  const [err, setErr] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Workshop3DListItem[]>([]);
  const [reportOpen, setReportOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pages = pageCount(total, HISTORY_PAGE_SIZE);

  // Changing any filter returns to the first page.
  useEffect(() => { setPage(1); }, [q, status, from, to, tab]);

  const load = useCallback(() => {
    // threads: a page holds HISTORY_PAGE_SIZE threads (root run + all its follow-ups), so replies never split across pages.
    const p: Parameters<typeof api.listRuns>[0] = { limit: HISTORY_PAGE_SIZE, offset: pageOffset(page, HISTORY_PAGE_SIZE), queue: tab === "queue" ? "only" : "exclude", threads: true };
    if (tab === "queue" && qProject) p.project = qProject;
    if (q) p.q = q;
    if (status) p.status = status;
    if (from) p.from = new Date(from).getTime();
    if (to) p.to = new Date(to).getTime() + 86_400_000 - 1;
    api.listRuns(p).then((r) => {
      setRuns(r.runs);
      const n = r.total ?? r.runs.length;
      setTotal(n);
      const last = clampPage(page, n, HISTORY_PAGE_SIZE);
      if (last !== page) setPage(last);
    }).catch((e: Error) => setErr(e.message));
    // 3D workshop sessions: their own list, independent of the run filters.
    if (tab === "w3d") api.workshop3dList().then((r) => setSessions(Array.isArray(r.sessions) ? r.sessions : [])).catch(() => {});
  }, [q, status, from, to, page, tab, qProject]);

  // Daily cost report: loaded only when the report modal opens.
  useEffect(() => {
    if (reportOpen) api.costsByDay().then((r) => setDays(r.days)).catch(() => {});
  }, [reportOpen]);

  useEffect(() => {
    const id = setTimeout(load, 200);
    return () => clearTimeout(id);
  }, [load]);

  return (
    <div>
      <div className="row" style={{ marginBottom: 8 }}>
        <button type="button" className={`mini${tab === "all" ? " active" : ""}`} aria-pressed={tab === "all"} onClick={() => setTab("all")}>{t.nav_history}</button>
        <button type="button" className={`mini${tab === "queue" ? " active" : ""}`} aria-pressed={tab === "queue"} onClick={() => setTab("queue")}>{t.queue_history_btn}</button>
        <button type="button" className={`mini${tab === "w3d" ? " active" : ""}`} aria-pressed={tab === "w3d"} onClick={() => setTab("w3d")}>{t.hist_w3d_tab}</button>
      </div>
      {tab === "w3d" && (
        <div className="card">
          {sessions.length === 0 ? <p className="muted">{t.hist_w3d_empty}</p> : null}
          {sessions.map((s) => (
            <div key={s.slug} className="row fine" style={{ marginBottom: 6 }}>
              <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", minWidth: 0, flex: 1 }}>
                {s.title} · {s.state}{typeof s.costUsd === "number" ? ` · $${s.costUsd.toFixed(2)}` : ""}{s.updatedAt ? ` · ${new Date(s.updatedAt).toLocaleString("vi-VN")}` : ""}
              </span>
              <button type="button" className="mini" disabled={!onOpenWorkshop3d} onClick={() => onOpenWorkshop3d?.(s.slug)}>{t.hist_w3d_open}</button>
            </div>
          ))}
        </div>
      )}
      {tab === "queue" && qProject && (
        <div className="card">
          {repoProjects.length > 1 && (
            <select aria-label={t.queue_history_btn} value={qProject} onChange={(e) => setQProject(e.target.value)} style={{ marginBottom: 8 }}>
              {repoProjects.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          )}
          <TaskListModal project={qProject} key={qProject} />
        </div>
      )}
      {tab !== "w3d" && (<>
      <div className="card">
        <div className="row">
          <input placeholder={t.search} value={q} onChange={(e) => setQ(e.target.value)} style={{ minWidth: 260 }} />
          <select value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">{t.all_status}</option>
            <option value="running">{t.status_running}</option>
            <option value="done">{t.status_done}</option>
            <option value="error">{t.status_error}</option>
            <option value="cancelled">{t.status_cancelled}</option>
          </select>
          <label className="muted">{t.from} <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="muted">{t.to} <input type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button onClick={load}>{t.reload}</button>
          <button type="button" className="icon-btn" title={t.history_report} aria-label={t.history_report} onClick={() => setReportOpen(true)} style={{ marginLeft: "auto" }}>📊</button>
        </div>
      </div>
        <div className="card" style={{ width: "100%" }}>
          {err && <p className="error">{err}</p>}
          {runs.length === 0 ? <p className="muted">{t.no_runs}</p> : <RunTable runs={runs} />}
          <div className="row fine" style={{ marginTop: 8, justifyContent: "center" }}>
            <button type="button" className="mini" disabled={page <= 1} onClick={() => setPage(page - 1)}>{t.history_prev}</button>
            <span>{t.history_page} {page}/{pages}</span>
            <button type="button" className="mini" disabled={page >= pages} onClick={() => setPage(page + 1)}>{t.history_next}</button>
          </div>
        </div>
      </>)}
      {reportOpen && (
        <Modal title={t.history_report_title} sub={t.cost_by_day} onClose={() => setReportOpen(false)}>
          <UsageBlocksPanel />
          <table>
            <thead><tr><th>{t.history_report_day}</th><th>{t.nav_runs}</th><th>{t.quota_used}</th></tr></thead>
            <tbody>
              {days.map((d) => (
                <tr key={d.day}><td>{d.day}</td><td>{d.runs}</td><td>{fmtQuota(d.quota_pct)}</td></tr>
              ))}
            </tbody>
          </table>
          <p className="muted">{t.cost_note}</p>
        </Modal>
      )}
    </div>
  );
}
