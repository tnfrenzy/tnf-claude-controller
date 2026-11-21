import { useEffect, useMemo, useState } from "react";
import { PREF_PROJECT, recall, remember } from "../lib/prefs";
import { api, ApiError } from "../api";
import { navigate } from "../App";
import { AttachBox } from "../components/common/AttachBox";
import { roleLabel, useT } from "../i18n";
import type { CliModelChoice, InboxFile, ProjectSummary, RunKind, StatusResponse } from "../types";
import { ClaudeGuide, needsGuide } from "../components/skills/ClaudeGuide";
import { extractSlots } from "../skills/library";
import { dailyWarning, formatEstimate, liveQuotaLabel, localDayKey, type CostStats } from "../run/costEstimate";
import { effectiveKind as pickEffectiveKind } from "../run/runKind";

const ROLE_ORDER = ["analyst", "planner", "critic", "implementer", "qa", "debug", "searcher", "analyzer", "synthesizer"];
const NEW = "__new__";

type RepoCheck = { ok: boolean; head_sha: string | null; dirty: boolean; branches: string[]; error: string | null };

export function CommandPage({
  status,
  onRecheck,
  initialPrompt,
  initialProject,
  initialRolesOpen,
}: {
  status: StatusResponse | null;
  onRecheck?: () => void;
  initialPrompt?: string;
  initialProject?: string;
  initialRolesOpen?: boolean;
}) {
  const { t, lang } = useT();
  const [prompt, setPrompt] = useState(initialPrompt ?? "");
  const [maxTurns, setMaxTurns] = useState(40);
  const [budget, setBudget] = useState(3);
  const [model, setModel] = useState("");
  const [accountId, setAccountId] = useState("");
  const [cliModelsByAccount, setCliModelsByAccount] = useState<Record<string, CliModelChoice[]>>({});
  const [project, setProject] = useState(() =>
    initialProject !== undefined ? (initialProject === "default" ? "" : initialProject) : recall(PREF_PROJECT),
  );
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  // Only stores explicit per-role model overrides; empty string means "Auto by CLI account / role".
  const [roleModels, setRoleModels] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  // Attachments staged before the run exists: POST /api/inbox -> stage id -> POST /api/runs {inbox_stage}
  const [stage, setStage] = useState<string | null>(null);
  const [inbox, setInbox] = useState<InboxFile[]>([]);
  const uploadStaged = async (f: File) => {
    const r = await api.stageInbox(f, stage);
    setStage(r.stage_id);
    setInbox(r.files);
    return r.files;
  };
  // "new project" form
  const [np, setNp] = useState({ name: "", repo_path: "", base_branch: "main" });
  const [npCheck, setNpCheck] = useState<RepoCheck | null>(null);
  const [npBusy, setNpBusy] = useState(false);

  const loadProjects = () => api.projects().then((r) => setProjects(r.projects)).catch(() => {});
  useEffect(() => {
    void loadProjects();
    api
      .cliAccounts()
      .then((r) => setCliModelsByAccount(r.models_by_account))
      .catch(() => {});
  }, []);
  const [costStats, setCostStats] = useState<CostStats | null>(null);
  const [todayCost, setTodayCost] = useState(0);
  useEffect(() => {
    api.codingCostStats().then(setCostStats).catch(() => {});
    api
      .costsByDay()
      .then((r) => setTodayCost(r.days.find((d) => d.day === localDayKey(new Date()))?.cost_usd_est ?? 0))
      .catch(() => {});
  }, []);

  const current = projects.find((p) => p.name === project) ?? null;
  const hasRepo = !!current?.repo_path;
  // No run-type choice: a project with a repo always runs coding (the server decides the same way).
  const effectiveKind: RunKind = pickEffectiveKind(hasRepo);
  const defaultRoleModels = useMemo(
    () => (effectiveKind === "coding" ? status?.role_models_coding ?? {} : status?.role_models ?? {}),
    [status, effectiveKind],
  );

  useEffect(() => {
    if (status) {
      setMaxTurns(status.defaults.maxTurns);
      setBudget(status.defaults.maxBudgetUsd);
      setModel((m) => m || status.defaults.model);
    }
  }, [status]);

  // Clear per-role overrides when switching between coding/research or CLI account so stale Claude aliases never appear under AGY/Codex.
  useEffect(() => {
    setRoleModels({});
  }, [effectiveKind, accountId]);

  const cliAccounts = (status?.cli_accounts ?? []).filter((a) => a.enabled);
  const defaultAccount = cliAccounts.find((a) => a.isDefault) ?? cliAccounts[0] ?? null;
  const activeAccountId = accountId || defaultAccount?.id || "";
  const models: CliModelChoice[] =
    (activeAccountId && cliModelsByAccount[activeAccountId]?.length
      ? cliModelsByAccount[activeAccountId]!
      : status?.models) ?? [];

  const modelOptions = (cur: string, includeAuto = false) => {
    const list = models.some((m) => m.id === cur) || !cur ? models : [...models, { id: cur, label: cur }];
    return (
      <>
        {includeAuto ? <option value="">{t.cli_acc_model_auto}</option> : null}
        {list.map((m) => (
          <option key={m.id} value={m.id}>
            {m.label}
          </option>
        ))}
      </>
    );
  };

  const pickProject = (v: string) => {
    setProject(v);
    setNpCheck(null);
    if (v !== NEW) remember(PREF_PROJECT, v);
  };

  const validateNew = async () => {
    setNpBusy(true);
    try {
      setNpCheck(await api.validateProject({ repo_path: np.repo_path.trim(), base_branch: np.base_branch.trim() || "main" }));
    } catch (e) {
      setNpCheck({ ok: false, head_sha: null, dirty: false, branches: [], error: e instanceof ApiError ? e.message : String(e) });
    } finally {
      setNpBusy(false);
    }
  };
  const createNew = async () => {
    setNpBusy(true);
    setErr(null);
    try {
      const body: { name: string; repo_path?: string; base_branch?: string } = { name: np.name.trim() };
      if (np.repo_path.trim()) {
        body.repo_path = np.repo_path.trim();
        body.base_branch = np.base_branch.trim() || "main";
      }
      const { project: created } = await api.addProject(body);
      await loadProjects();
      pickProject(created.name);
      setNp({ name: "", repo_path: "", base_branch: "main" });
      setNpCheck(null);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setNpBusy(false);
    }
  };

  const submit = async () => {
    setErr(null);
    const unfilled = extractSlots(prompt);
    if (unfilled.length) {
      setErr(`${t.err_unfilled_slots}: ${unfilled.map((n) => `{{${n}}}`).join(", ")}`);
      return;
    }
    setBusy(true);
    try {
      const body: Parameters<typeof api.startRun>[0] = { prompt, max_turns: maxTurns, budget_usd: budget, roles: true };
      if (model) body.model = model;
      if (accountId) body.account_id = accountId;
      body.project = project && project !== NEW ? project : "default";
      remember(PREF_PROJECT, body.project === "default" ? "" : body.project);
      if (stage && inbox.length) body.inbox_stage = stage;
      const overrides: Record<string, string> = {};
      for (const [role, m] of Object.entries(roleModels)) {
        if (m) overrides[role] = m;
      }
      if (Object.keys(overrides).length) body.role_models = overrides;
      const { run } = await api.startRun(body);
      navigate(`/runs/${encodeURIComponent(run.id)}`);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const roleNames = ROLE_ORDER.filter((r) => r in defaultRoleModels).concat(
    Object.keys(defaultRoleModels).filter((r) => !ROLE_ORDER.includes(r)),
  );
  const overrideCount = Object.values(roleModels).filter(Boolean).length;

  return (
    <div className="card">
      {needsGuide(status) && status && <ClaudeGuide status={status} onRecheck={onRecheck ?? (() => location.reload())} />}
      <div className="field">
        <label>{t.prompt_label}</label>
        <textarea
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder={effectiveKind === "coding" ? t.prompt_placeholder_coding : t.prompt_placeholder}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) void submit();
          }}
        />
      </div>
      <div className="field" style={{ marginTop: 10 }}>
        <label>{t.attach}</label>
        <AttachBox files={inbox} onUpload={uploadStaged} disabled={busy} />
      </div>
      {effectiveKind === "coding" && costStats && <p className="muted" style={{ marginBottom: 0 }}>{formatEstimate(costStats)}</p>}
      {liveQuotaLabel(status?.rate_limit, []).pct && (
        <p className="muted" style={{ margin: 0, fontSize: 12 }}>
          {t.quota_account} · {t.cmd_rate_limit}: {liveQuotaLabel(status?.rate_limit, []).pct}
        </p>
      )}
      {dailyWarning(todayCost, status?.ui?.dailyCostWarnUsd) && (
        <p style={{ marginBottom: 0, padding: 8, background: "#fff3cd", color: "#664d03", border: "1px solid #ffecb5", borderRadius: 6 }}>
          {dailyWarning(todayCost, status?.ui?.dailyCostWarnUsd)} {t.cmd_daily_warn_note}
        </p>
      )}
      <div className="row cmd-row" style={{ marginTop: 12 }}>
        <div className="field">
          <label>{t.project}</label>
          <select value={project} onChange={(e) => pickProject(e.target.value)} aria-label={t.project}>
            <option value="">
              {t.project_default} ({t.kind_research})
            </option>
            {projects
              .filter((p) => p.name !== "default")
              .map((p) => (
                <option key={p.name} value={p.name}>
                  {p.repo_path ? `${p.name} — ${p.repo_path}` : p.name}
                </option>
              ))}
            <option value={NEW}>＋ {t.project_new}</option>
          </select>
        </div>
        {cliAccounts.length > 0 && (
          <div className="field">
            <label>{t.cli_acc_pick}</label>
            <select
              aria-label={t.cli_acc_pick}
              value={accountId}
              onChange={(e) => {
                const nextId = e.target.value;
                setAccountId(nextId);
                const effId = nextId || defaultAccount?.id || "";
                const nextModels = (effId && cliModelsByAccount[effId]?.length ? cliModelsByAccount[effId] : status?.models) ?? [];
                if (nextModels.length && !nextModels.some((m) => m.id === model)) {
                  setModel(nextModels[0]!.id);
                }
              }}
            >
              <option value="">{t.cli_acc_pick_default}</option>
              {cliAccounts.map((a) => (
                <option key={a.id} value={a.id}>
                  {a.label} ({a.provider})
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="field">
          <label>{t.model_main}</label>
          <select value={model} onChange={(e) => setModel(e.target.value)}>
            {modelOptions(model, false)}
          </select>
        </div>
        <div className="field">
          <label>{t.max_turns}</label>
          <input
            type="number"
            min={1}
            max={status?.limits.maxTurnsCeiling ?? 100}
            value={maxTurns}
            onChange={(e) => setMaxTurns(Number(e.target.value))}
            style={{ width: 110 }}
          />
        </div>
        <div className="field">
          <label>{t.budget}</label>
          <input
            type="number"
            min={0.05}
            step={0.5}
            max={status?.limits.maxBudgetUsdCeiling ?? 10}
            value={budget}
            onChange={(e) => setBudget(Number(e.target.value))}
            style={{ width: 110 }}
          />
        </div>
        <span className="spacer" style={{ flex: 1 }} />
        <button className="primary" disabled={busy || !prompt.trim() || project === NEW} onClick={() => void submit()}>
          {busy ? t.running : t.run}
        </button>
      </div>
      {current?.repo_path && (
        <p className="muted mono" style={{ marginTop: 8, marginBottom: 0, wordBreak: "break-all" }}>
          {t.env_repo}: {current.repo_path} · {t.env_base_branch}: {current.base_branch ?? "main"}
          {current.allowed_commands.length ? ` · ${t.allowed_commands}: ${current.allowed_commands.join(", ")}` : ""}
        </p>
      )}
      {project === NEW && (
        <div className="card" style={{ marginTop: 12, marginBottom: 0, background: "var(--bg)" }}>
          <b>{t.project_new}</b>
          <p className="muted" style={{ margin: "4px 0 8px" }}>
            {t.project_new_hint}
          </p>
          <div className="row">
            <div className="field">
              <label>{t.project_name}</label>
              <input value={np.name} onChange={(e) => setNp({ ...np, name: e.target.value })} placeholder="my-app" style={{ width: 160 }} />
            </div>
            <div className="field" style={{ flex: 1, minWidth: 220 }}>
              <label>{t.env_repo}</label>
              <input
                value={np.repo_path}
                onChange={(e) => {
                  setNp({ ...np, repo_path: e.target.value });
                  setNpCheck(null);
                }}
                placeholder="D:\path\to\repo"
                className="mono"
              />
            </div>
            <div className="field">
              <label>{t.env_base_branch}</label>
              <input
                value={np.base_branch}
                onChange={(e) => {
                  setNp({ ...np, base_branch: e.target.value });
                  setNpCheck(null);
                }}
                style={{ width: 120 }}
                list="tnf-branches"
              />
              <datalist id="tnf-branches">
                {(npCheck?.branches ?? []).map((b) => (
                  <option key={b} value={b} />
                ))}
              </datalist>
            </div>
            <button disabled={npBusy || !np.repo_path.trim()} onClick={() => void validateNew()}>
              {t.project_validate}
            </button>
            <button
              className="primary"
              disabled={npBusy || !np.name.trim() || (!!np.repo_path.trim() && !npCheck?.ok)}
              onClick={() => void createNew()}
            >
              {t.project_create}
            </button>
          </div>
          {npCheck &&
            (npCheck.ok ? (
              <p className="muted" style={{ marginBottom: 0 }}>
                ✓ {t.project_valid} · HEAD {npCheck.head_sha?.slice(0, 7)}
                {npCheck.dirty ? ` · ${t.project_dirty}` : ""}
              </p>
            ) : (
              <p className="error" style={{ marginBottom: 0 }}>
                {npCheck.error}
              </p>
            ))}
        </div>
      )}
      {roleNames.length > 0 && (
        <details style={{ marginTop: 12 }} {...(initialRolesOpen ? { open: true } : {})}>
          <summary className="muted" style={{ cursor: "pointer" }}>
            {t.advanced}: {t.model_roles} ({effectiveKind === "coding" ? t.kind_coding : t.kind_research})
            {overrideCount > 0 ? ` · ${overrideCount}` : ""}
          </summary>
          <div className="role-group-block" style={{ marginTop: 8 }}>
            <div className="role-group-head">
              <span className="muted" style={{ fontSize: 12 }}>{t.model_hint}</span>
              {overrideCount > 0 && (
                <button type="button" style={{ fontSize: 12, padding: "3px 8px" }} onClick={() => setRoleModels({})}>
                  {t.cli_acc_reset_roles}
                </button>
              )}
            </div>
            <table className="role-model-table">
              <thead>
                <tr>
                  <th style={{ width: "40%" }}>{t.cli_acc_col_role}</th>
                  <th style={{ width: "60%" }}>{t.cli_acc_col_model}</th>
                </tr>
              </thead>
              <tbody>
                {roleNames.map((role) => (
                  <tr key={role}>
                    <td>
                      <b>{roleLabel(role, lang === "en" ? "en" : "vi")}</b>
                      <div className="muted mono" style={{ fontSize: 11 }}>{role}</div>
                    </td>
                    <td>
                      <select
                        aria-label={roleLabel(role, lang === "en" ? "en" : "vi")}
                        value={roleModels[role] ?? ""}
                        onChange={(e) => setRoleModels((rm) => ({ ...rm, [role]: e.target.value }))}
                      >
                        {modelOptions(roleModels[role] ?? "", true)}
                      </select>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      )}
      {err && (
        <p className="error" style={{ marginTop: 12 }}>
          {t.err_prefix}: {err}
        </p>
      )}
      <p className="muted" style={{ marginTop: 12 }}>
        {t.cost_note} Ctrl+Enter = {t.run}.
      </p>
    </div>
  );
}
