import { useEffect, useMemo, useRef, useState } from "react";
import { Modal } from "./common/Modal";
import { ScoutPopup } from "./queue/ScoutPopup";
import { api, openSocket, type WsMessage } from "../api";
import { nextConfirmStep, type ConfirmAction, type ConfirmState } from "../lib/confirm";
import { useT } from "../i18n";
import { quotaNoticeText } from "../run/costEstimate";
import { showQueue } from "../office/floors";
import { initialChips,reduceChips, type ChipsState } from "../office/role-chips";
import { canScout } from "../queue/scoutAgent";
import type { PopupId, PopupPayload } from "../lib/popup";
import type { ViewMode } from "../lib/view-mode";
import type { ProjectSummary, RunRecord, StatusResponse } from "../types";

/** At most this many running runs get a live WebSocket for role chips. */
const MAX_LIVE_RUNS = 2;

function useProjectsAndRuns(reloadKey: number, intervalMs = 5000): { projects: ProjectSummary[]; running: RunRecord[] } {
  const [state, setState] = useState<{ projects: ProjectSummary[]; running: RunRecord[] }>({ projects: [], running: [] });
  useEffect(() => {
    let dead = false;
    const load = async () => {
      try {
        const { projects } = await api.projects();
        const running = projects.some((p) => p.running > 0) ? (await api.listRuns({ status: "running" })).runs : [];
        if (!dead) setState({ projects, running });
      } catch {
        /* keep previous state */
      }
    };
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
    return () => {
      dead = true;
      clearInterval(id);
    };
  }, [intervalMs, reloadKey]);
  return state;
}

function useRunChips(runId: string | null, roles: string[]): ChipsState {
  const rolesKey = roles.join("|");
  const [state, setState] = useState<ChipsState>(() => initialChips(roles));
  useEffect(() => {
    setState(initialChips(rolesKey ? rolesKey.split("|") : []));
    if (!runId) return;
    let closed = false;
    let ws: WebSocket | null = null;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const connect = () => {
      ws = openSocket(
        `/ws/runs/${encodeURIComponent(runId)}?after=0`,
        (m: WsMessage) => {
          if (m.type === "event") setState((s) => reduceChips(s, m.stored.event));
        },
        () => {
          if (!closed) timer = setTimeout(connect, 2000);
        },
      );
    };
    connect();
    return () => {
      closed = true;
      if (timer) clearTimeout(timer);
      ws?.close();
    };
  }, [runId, rolesKey]);
  return state;
}

function EnvRow(props: { project: ProjectSummary; floorNo: number; selected: boolean; onSelect: () => void; runId: string | null; roles: string[]; onDeleted: (name: string) => void; onOpen: (id: PopupId, payload?: PopupPayload) => void }) {
  const { project, floorNo, selected, onSelect, runId, roles, onDeleted, onOpen } = props;
  const { t } = useT();
  const [scoutOpen, setScoutOpen] = useState(false);
  const scoutOk = canScout({ hasRepo: project.repo_path != null, running: project.running, busy: false });
  const { chips } = useRunChips(runId, roles);
  const busy = project.running > 0;
  const [step, setStep] = useState<ConfirmState>("idle");
  const [err, setErr] = useState<string | null>(null);
  const advance = (action: ConfirmAction) => {
    const next = nextConfirmStep(step, action);
    setStep(next);
    if (next !== "execute") return;
    setErr(null);
    api.deleteProject(project.name).then(
      () => { setStep(nextConfirmStep("execute", "done")); onDeleted(project.name); },
      (e: unknown) => { setStep("idle"); setErr(e instanceof Error ? e.message : String(e)); },
    );
  };
  return (
    <div className={`run-row env-row${selected ? " selected" : ""}`} onClick={onSelect} role="radio" aria-checked={selected}>
      <div className="env-main" style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, width: "100%" }}>
        <span className={`dot${busy ? "" : " idle"}`} />
        <div className="env-name" style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", maxWidth: "40%", flex: "0 1 auto" }}>{project.name}</div>
        <div className="steps" style={{ margin: 0, flex: "1 1 auto", minWidth: 0 }}>
          {chips.map((c) => (
            <span key={c.role} className={`step ${c.state === "working" ? "doing" : c.state === "done" ? "done" : c.state === "error" ? "bad" : ""}`}>{c.role}</span>
          ))}
        </div>
      </div>
      <div className="env-actions env-icons" style={{ display: "flex", gap: 6 }} onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn" title={t.env_run_tip} aria-label={t.env_run_tip} onClick={() => onOpen("cmd", { projectName: project.name })}>▶</button>
        {showQueue(project.name, project.repo_path) && (
          <button type="button" className="icon-btn" title={t.queue_title} aria-label={t.queue_title} onClick={() => onOpen("floor", { projectName: project.name, floorNo })}>☰</button>
        )}
        <button type="button" className="icon-btn" title={scoutOk ? t.env_scout_tip : t.env_scout_need_repo} aria-label={t.env_scout} onClick={() => setScoutOpen(true)}>💡</button>
        {project.name !== "default" && step === "idle" && (
          <button type="button" className="icon-btn" title={t.floor_delete} aria-label={t.floor_delete} onClick={() => advance("ask")}>🗑</button>
        )}
      </div>
      <div style={{ minWidth: 0, width: "100%" }}>
        {step === "confirm" && (
          <div className="fine" onClick={(e) => e.stopPropagation()}>
            <span className="warn">{t.floor_delete_confirm1}</span>{" "}
            <button type="button" className="mini" onClick={() => advance("confirm")}>{t.floor_delete_confirm2}</button>{" "}
            <button type="button" className="mini" onClick={() => advance("cancel")}>{t.cleanup_no}</button>
          </div>
        )}
        {err && <div className="fine" style={{ color: "var(--err)" }}>{err}</div>}
        {scoutOpen && (
          <div onClick={(e) => e.stopPropagation()}>
            <Modal title={t.env_scout} sub={project.name} size="large" onClose={() => setScoutOpen(false)}>
              <ScoutPopup project={project} onOpenRun={(id) => { setScoutOpen(false); onOpen("run", { runId: id }); }} />
            </Modal>
          </div>
        )}
      </div>
    </div>
  );
}

export function LeftPanel(props: { apiFloors?: { id: string; name: string; text: string }[]; status: StatusResponse | null; statusErr: string | null; towerName: string; env: string; pickEnv: (name: string) => void; onOpen: (id: PopupId, payload?: PopupPayload) => void; view: ViewMode; onToggleView: () => void }) {
  const { t } = useT();
  const { apiFloors = [], status, statusErr, towerName, onOpen, env, pickEnv, view, onToggleView } = props;
  const [draft, setDraft] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const { projects, running } = useProjectsAndRuns(reloadKey);
  const onDeleted = (name: string) => {
    // The chosen floor was deleted: fall back to the first remaining floor, else default.
    if ((env || "default") === name) {
      const next = projects.find((p) => p.name !== name && p.name !== "default");
      pickEnv(next ? next.name : "default");
    }
    setReloadKey((k) => k + 1);
  };
  const roles = useMemo(() => Object.keys(status?.role_models_coding ?? {}), [status]);
  const liveRunByProject = useMemo(() => {
    const m = new Map<string, string>();
    for (const r of [...running].sort((a, b) => b.created_at - a.created_at)) {
      if (m.size >= MAX_LIVE_RUNS) break;
      if (!m.has(r.project)) m.set(r.project, r.id);
    }
    return m;
  }, [running]);

  const notices: { key: string; text: string; err: boolean }[] = [];
  if (statusErr) notices.push({ key: "se", text: statusErr, err: true });
  if (status?.auth_error) notices.push({ key: "ae", text: status.auth_error, err: true });
  if (status?.claude_error) notices.push({ key: "ce", text: status.claude_error, err: true });
  if (status?.git_error) notices.push({ key: "ge", text: status.git_error, err: true });
  const rl = status?.rate_limit;
  if (rl) {
    const hot = (rl.five_hour_pct ?? 0) >= 90 || (rl.seven_day_pct ?? 0) >= 90;
    notices.push({ key: "rl", text: quotaNoticeText(rl, running, t), err: hot });
  }

  const viewLabel = view === "city" ? t.view_to_office : t.view_to_city;
  // Quick command always targets the default environment (research), whatever floor is selected.
  const submit = () => onOpen("cmd", { projectName: "default", ...(draft.trim() ? { prompt: draft.trim() } : {}) });
  const pickRoles = () => onOpen("cmd", { projectName: "default", rolesOpen: true, ...(draft.trim() ? { prompt: draft.trim() } : {}) });
  return (
    <aside className="side">
      <div className="side-head">
        <img className="logo" src="/logo.png" alt="" width={36} height={36} />
        <div className="brand">{t.app}<small>{towerName}</small></div>
      </div>
      <div className="work">
        <div className="quick-cmd">
          <h4>{t.ss_work}</h4>
          <div className="cmd">
            <input value={draft} placeholder={t.ss_cmd_placeholder} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") submit(); }} />
            <button type="button" className="btn" onClick={submit}>{t.ss_send}</button>
          </div>
          <div className="env-current"><button type="button" className="mini" onClick={pickRoles}>{t.ss_pick_roles}</button></div>
        </div>
        <div className="card">
          <h4>{towerName} · {t.ss_envs}<button type="button" className="mini" onClick={() => onOpen("addFloor")}>＋ {t.ss_add_floor}</button></h4>
          {projects.length === 0 ? <div className="fine">{t.ss_no_envs}</div> : null}
          {projects.map((p, i) => (
            <EnvRow key={p.name} project={p} floorNo={i + 1} selected={(env || "default") === p.name} onSelect={() => pickEnv(p.name)} runId={liveRunByProject.get(p.name) ?? null} roles={roles} onDeleted={onDeleted} onOpen={onOpen} />
          ))}
        </div>
        <div className="card">
          <h4>{t.tower_api}<button type="button" className="mini" onClick={() => onOpen("addApiFloor")}>＋ {t.api_add_short}</button></h4>
          {apiFloors.length === 0 ? <div className="fine">{t.api_none}</div> : null}
          {apiFloors.map((f) => (
            <button type="button" key={f.id} className="mini" style={{ display: "block", width: "100%", textAlign: "left", marginBottom: 4 }} onClick={() => onOpen("apiFloor", { connectionId: f.id })}>
              <b>{f.name}</b> <span className="fine">{f.text}</span>
            </button>
          ))}
        </div>
        <div className="card">
          <h4>{t.ss_notices}</h4>
          <div className="fine" style={{ display: "flex", flexDirection: "column", gap: 3 }}>
            {notices.length === 0 ? <span>{t.ss_no_notices}</span> : notices.map((n) => <span key={n.key} style={n.err ? { color: "var(--err)" } : undefined}>{n.text}</span>)}
          </div>
        </div>
      </div>
      <nav className="nav">
        <button type="button" title={t.nav_history} aria-label={t.nav_history} onClick={() => onOpen("history")}>🕘</button>
        <button type="button" className="view-toggle" title={viewLabel} aria-label={viewLabel} onClick={onToggleView}>{view === "city" ? "🏢" : "🏙"}</button>
        <button type="button" title={t.ss_settings} aria-label={t.ss_settings} onClick={() => onOpen("settings")}>⚙</button>
      </nav>
      <div className="note">{t.cost_note}</div>
    </aside>
  );
}
