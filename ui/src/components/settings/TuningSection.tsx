import { useEffect, useState } from "react";
import { api } from "../../api";
import { roleLabel, useT } from "../../i18n";
import type { CliAccountPublic, CliModelChoice, RoleAccountMap, TuningResponse, TuningValues, W3DModelSettings } from "../../types";

const VS_ROLES = ["video-director", "video-editor"] as const;

type Draft = Record<keyof TuningValues, string | boolean>;

function toDraft(v: TuningValues): Draft {
  const d: Record<string, string | boolean> = {};
  for (const [k, val] of Object.entries(v)) d[k] = typeof val === "boolean" ? val : val === null ? "" : String(val);
  return d as Draft;
}

/** Settings tab "Điều chỉnh": every adjustable cost ceiling, default model and idea-agent setting in one form. */
export function TuningSection() {
  const { t, lang } = useT();
  const [info, setInfo] = useState<TuningResponse | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  // 3D workshop models: own endpoint; null = not loaded (older server), the card is then hidden.
  const [w3d, setW3d] = useState<W3DModelSettings | null>(null);
  // Video Studio default CLI account & model (synced with /api/cli/role-accounts)
  const [cliAccounts, setCliAccounts] = useState<CliAccountPublic[]>([]);
  const [modelsByAcc, setModelsByAcc] = useState<Record<string, CliModelChoice[]>>({});
  const [roleAccounts, setRoleAccounts] = useState<RoleAccountMap | null>(null);
  const [vsDirty, setVsDirty] = useState(false);

  useEffect(() => {
    api.tuning().then((r) => { setInfo(r); setDraft(toDraft(r.values)); }).catch((e: Error) => setError(e.message));
    api.w3dModels().then((r) => setW3d(r.models)).catch(() => setW3d(null));
    api
      .cliAccounts()
      .then((r) => {
        setCliAccounts(r.accounts.filter((a) => a.enabled));
        setModelsByAcc(r.models_by_account ?? {});
        setRoleAccounts(r.role_accounts ?? {});
      })
      .catch(() => {});
  }, []);

  if (!info || !draft) return error ? <div className="error">{error}</div> : null;
  const set = (k: keyof TuningValues, v: string | boolean) => { setSaved(false); setDraft({ ...draft, [k]: v }); };

  const num = (k: keyof TuningValues, label: string, opts: { step?: number; min?: number; max?: number; nullable?: boolean; hint?: string } = {}) => (
    <label className="row tuning-row" key={k}>
      <span>{label}{opts.hint ? <span className="muted"> · {opts.hint}</span> : null}</span>
      <input type="number" aria-label={label} step={opts.step ?? 1} min={opts.min ?? 0} {...(opts.max !== undefined ? { max: opts.max } : {})} value={String(draft[k])} placeholder={opts.nullable ? "—" : ""} onChange={(e) => set(k, e.target.value)} style={{ width: 110 }} />
    </label>
  );
  const renderModelOptions = (models: TuningResponse["models"], currentVal?: string) => {
    const claude = models.filter((m) => !m.provider || m.provider === "claude");
    const agy = models.filter((m) => m.provider === "antigravity");
    const codex = models.filter((m) => m.provider === "codex");
    const hasGroups = agy.length > 0 || codex.length > 0;
    const extra = currentVal && !models.some((m) => m.id === currentVal) ? <option value={currentVal}>{currentVal}</option> : null;
    if (!hasGroups) {
      return (
        <>
          {models.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
          {extra}
        </>
      );
    }
    return (
      <>
        {claude.length > 0 ? <optgroup label="Claude Code">{claude.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup> : null}
        {agy.length > 0 ? <optgroup label="Antigravity CLI (AGY)">{agy.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup> : null}
        {codex.length > 0 ? <optgroup label="OpenAI Codex CLI (ChatGPT)">{codex.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}</optgroup> : null}
        {extra}
      </>
    );
  };

  const model = (k: keyof TuningValues, label: string) => (
    <label className="row tuning-row" key={k}>
      <span>{label}</span>
      <select aria-label={label} value={String(draft[k])} onChange={(e) => set(k, e.target.value)}>
        {renderModelOptions(info.models, String(draft[k]))}
      </select>
    </label>
  );
  const check = (k: keyof TuningValues, label: string) => (
    <label className="row tuning-row" key={k}>
      <span>{label}</span>
      <input type="checkbox" aria-label={label} checked={draft[k] === true} onChange={(e) => set(k, e.target.checked)} />
    </label>
  );

  const save = () => {
    setError(null);
    const body: Record<string, number | string | boolean | null> = {};
    for (const [k, v] of Object.entries(draft)) {
      if (typeof v === "boolean" || k.endsWith("Model")) body[k] = v as string | boolean;
      else if (v === "" && (k === "dailyCostWarnUsd" || k === "queueMaxBudgetUsd")) body[k] = null;
      else body[k] = Number(v);
    }
    api.setTuning(body as Partial<TuningValues>)
      .then(async (r) => {
        setDraft(toDraft(r.values));
        if (w3d) setW3d((await api.setW3DModels({ main: w3d.main ?? "", light: w3d.light ?? "" })).models);
        if (vsDirty && roleAccounts) {
          const savedRoles = await api.saveRoleAccounts(roleAccounts);
          setRoleAccounts(savedRoles.role_accounts);
          setVsDirty(false);
        }
        setSaved(true);
      })
      .catch((e: Error) => setError(e.message));
  };
  const w3dModel = (k: keyof W3DModelSettings, label: string) => (
    <label className="row tuning-row" key={`w3d-${k}`}>
      <span>{label}</span>
      <select aria-label={label} style={{ maxWidth: 260, minWidth: 0 }} value={w3d?.[k] ?? ""} onChange={(e) => { setSaved(false); setW3d({ ...w3d, [k]: e.target.value }); }}>
        <option value="">{t.w3m_default}</option>
        {renderModelOptions(info.models, w3d?.[k] ?? "")}
      </select>
    </label>
  );

  const ceil = Number(draft.maxBudgetUsdCeiling) || info.limits.budgetCeilingMax;
  return (
    <div className="tuning" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="muted">{t.tn_note}</div>
      <div className="card">
        <h4>{t.tn_g_cost}</h4>
        {num("dailyCostWarnUsd", t.tn_daily, { step: 0.5, min: 0.01, nullable: true })}
        {num("queueMaxBudgetUsd", t.tn_queue, { step: 1, min: 0.01, nullable: true })}
        {num("maxBudgetUsdCeiling", t.tn_ceiling, { step: 1, min: 1, max: info.limits.budgetCeilingMax })}
        {num("maxTurnsCeiling", t.tn_turns_ceiling, { min: 10, max: info.limits.turnsCeilingMax })}
      </div>
      <div className="card">
        <h4>{t.tn_g_run}</h4>
        {model("defaultModel", t.tn_model)}
        {num("defaultMaxBudgetUsd", t.tn_budget, { step: 0.5, min: 0.05, max: ceil })}
        {num("defaultMaxTurns", t.tn_turns, { min: 1, max: Number(draft.maxTurnsCeiling) || info.limits.turnsCeilingMax })}
        {num("codingMaxRoleCalls", t.tn_rolecalls, { min: 12, max: info.roleCallsCeiling })}
      </div>
      <div className="card">
        <h4>{t.tn_g_scout}</h4>
        {model("scoutModel", t.tn_scout_model)}
        {num("scoutBudgetUsd", t.tn_scout_budget, { step: 0.5, min: 0.05, max: ceil, hint: t.tn_hint_budget })}
      </div>
      <div className="card">
        <h4>{t.tn_g_idea}</h4>
        {model("splitterModel", t.tn_idea_model)}
        <div className="muted">{t.tn_idea_model_note}</div>
        {num("splitterBudgetUsd", t.tn_idea_budget, { step: 0.5, min: 0.05, max: ceil, hint: t.tn_hint_budget })}
        {check("splitterWebSearch", t.tn_idea_web)}
        {num("splitterMaxWebCalls", t.tn_idea_webcalls, { min: 0, max: info.limits.webCallsMax })}
        {check("replanEnabled", t.tn_replan)}
        {num("replanBudgetUsd", t.tn_replan_budget, { step: 0.5, min: 0.05, max: ceil })}
      </div>
      <div className="card">
        <h4>{t.tn_g_idea_quality}</h4>
        {check("splitterInterview", t.tn_interview_on)}
        {model("interviewModel", t.tn_interview_model)}
        {num("interviewBudgetUsd", t.tn_interview_budget, { step: 0.5, min: 0.05, max: ceil })}
        {check("splitterCritic", t.tn_critic_on)}
        {model("criticModel", t.tn_critic_model)}
        {num("criticBudgetUsd", t.tn_critic_budget, { step: 0.5, min: 0.05, max: ceil })}
        {check("splitterAutoIntegrate", t.tn_auto_integrate)}
        {check("queueLessons", t.tn_lessons)}
      </div>
      <div className="card">
        <h4>{t.tn_g_scope}</h4>
        <div className="muted">{t.tn_scope_note}</div>
        {check("scopeGuardEnabled", t.tn_scope_on)}
        {model("scopeModel", t.tn_scope_model)}
        {num("scopeBudgetUsd", t.tn_scope_budget, { step: 0.1, min: 0.05, max: ceil })}
      </div>
      {w3d ? (
        <div className="card">
          <h4>{t.w3m_title}</h4>
          <div className="muted">{t.w3m_note}</div>
          {w3dModel("main", t.w3m_main)}
          {w3dModel("light", t.w3m_light)}
        </div>
      ) : null}
      {roleAccounts && cliAccounts.length > 0 ? (
        <div className="card">
          <h4>{t.vs_ai_title}</h4>
          <div className="muted" style={{ marginBottom: 8 }}>{t.vs_ai_hint}</div>
          <table className="role-model-table">
            <thead>
              <tr>
                <th style={{ width: "30%" }}>{t.cli_acc_col_role}</th>
                <th style={{ width: "35%" }}>{t.cli_acc_col_account}</th>
                <th style={{ width: "35%" }}>{t.cli_acc_col_model}</th>
              </tr>
            </thead>
            <tbody>
              {VS_ROLES.map((r) => {
                const assigned = roleAccounts[r];
                const defaultAccId = cliAccounts.find((a) => a.isDefault)?.id ?? cliAccounts[0]?.id;
                const accKey = assigned?.accountId || defaultAccId;
                const availModels = (accKey && modelsByAcc[accKey]) ? modelsByAcc[accKey]! : [];
                const curModel = assigned?.model ?? "";
                return (
                  <tr key={r}>
                    <td>
                      <b>{roleLabel(r, lang)}</b>
                      <div className="muted mono" style={{ fontSize: 11 }}>{r}</div>
                    </td>
                    <td>
                      <select
                        aria-label={`${roleLabel(r, lang)} ${t.cli_acc_col_account}`}
                        value={assigned?.accountId ?? ""}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSaved(false);
                          setVsDirty(true);
                          setRoleAccounts((prev) => {
                            const next = { ...(prev ?? {}) };
                            if (!val) delete next[r];
                            else next[r] = { accountId: val };
                            return next;
                          });
                        }}
                      >
                        <option value="">{t.cli_acc_pick_default}</option>
                        {cliAccounts.map((a) => (
                          <option key={a.id} value={a.id}>{a.label} ({a.provider})</option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        aria-label={`${roleLabel(r, lang)} ${t.cli_acc_col_model}`}
                        value={curModel}
                        onChange={(e) => {
                          const val = e.target.value;
                          setSaved(false);
                          setVsDirty(true);
                          setRoleAccounts((prev) => {
                            const next = { ...(prev ?? {}) };
                            const prevAcc = prev?.[r]?.accountId;
                            if (!val && !prevAcc) delete next[r];
                            else if (!val) next[r] = { ...(prevAcc ? { accountId: prevAcc } : {}) };
                            else next[r] = { ...(prevAcc ? { accountId: prevAcc } : {}), model: val };
                            return next;
                          });
                        }}
                      >
                        <option value="">{t.cli_acc_model_auto}</option>
                        {availModels.map((m) => (
                          <option key={m.id} value={m.id}>{m.label}</option>
                        ))}
                        {curModel && !availModels.some((m) => m.id === curModel) ? (
                          <option value={curModel}>{curModel}</option>
                        ) : null}
                      </select>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
      <div className="row">
        <button type="button" onClick={save}>{t.tn_save}</button>
        {saved ? <span className="pill ok">{t.tn_saved}</span> : null}
      </div>
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}
