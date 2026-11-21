import { useEffect, useState } from "react";
import { api, ApiError } from "../../api";
import { roleLabel, useT } from "../../i18n";
import type {
  CliAccountPublic,
  CliAccountRuntimeStatus,
  CliAccountsSettings,
  CliModelChoice,
  CliProviderId,
  RoleAccountMap,
} from "../../types";

interface RoleGroup {
  key: "coding" | "ideas" | "video" | "3d";
  roles: readonly string[];
}

const ROLE_GROUPS: readonly RoleGroup[] = [
  { key: "coding", roles: ["analyst", "planner", "critic", "implementer", "qa", "debug"] },
  { key: "ideas", roles: ["idea-interviewer", "idea-splitter", "idea-critic"] },
  { key: "video", roles: ["video-director", "video-editor"] },
  { key: "3d", roles: ["cad-modeler", "visual-reviewer"] },
];

function providerBadge(p: CliProviderId): string {
  if (p === "antigravity") return "Antigravity CLI";
  if (p === "codex") return "OpenAI Codex CLI";
  return "Claude Code";
}

function fmtTime(ms: number): string {
  try {
    return new Date(ms).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

export function CliAccountsSection() {
  const { t, lang } = useT();
  const [accounts, setAccounts] = useState<CliAccountPublic[]>([]);
  const [settings, setSettings] = useState<Required<CliAccountsSettings>>({ autoFailover: false, crossProviderFailover: false });
  const [modelsByAccount, setModelsByAccount] = useState<Record<string, CliModelChoice[]>>({});
  const [cooldowns, setCooldowns] = useState<Record<string, number>>({});
  const [roleAccounts, setRoleAccounts] = useState<RoleAccountMap>({});
  const [statuses, setStatuses] = useState<Record<string, CliAccountRuntimeStatus>>({});
  const [checkingId, setCheckingId] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [provider, setProvider] = useState<CliProviderId>("claude");
  const [isolated, setIsolated] = useState(true);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = async () => {
    try {
      const r = await api.cliAccounts();
      setAccounts(r.accounts);
      setSettings(r.settings);
      setModelsByAccount(r.models_by_account ?? {});
      setCooldowns(r.cooldowns ?? {});
      setRoleAccounts(r.role_accounts ?? {});
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const enabledAccounts = accounts.filter((a) => a.enabled);
  const defaultAccount = accounts.find((a) => a.isDefault && a.enabled) ?? enabledAccounts[0] ?? accounts[0] ?? null;

  const modelsForRoleAccount = (accountId: string | null | undefined): CliModelChoice[] => {
    const targetId = accountId || defaultAccount?.id;
    return (targetId && modelsByAccount[targetId]) ? modelsByAccount[targetId]! : [];
  };

  const addAccount = async () => {
    if (!label.trim()) return;
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      await api.addCliAccount({
        label: label.trim(),
        provider,
        isolated: provider === "claude" || provider === "codex" ? isolated : false,
      });
      setLabel("");
      await load();
      setNotice(t.cli_acc_saved);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const checkAccount = async (id: string) => {
    setCheckingId(id);
    setErr(null);
    try {
      const r = await api.checkCliAccount(id);
      setStatuses((prev) => ({ ...prev, [id]: r.status }));
      if (r.status.models?.length) {
        setModelsByAccount((prev) => ({ ...prev, [id]: r.status.models }));
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setCheckingId(null);
    }
  };

  const loginAccount = async (id: string) => {
    setErr(null);
    setNotice(null);
    try {
      await api.loginCliAccount(id);
      setNotice(t.cli_acc_login_opened);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const setDefault = async (id: string) => {
    setErr(null);
    try {
      await api.updateCliAccount(id, { isDefault: true, enabled: true });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const setAccountDefaultModel = async (id: string, modelId: string) => {
    setErr(null);
    try {
      await api.updateCliAccount(id, { defaultModel: modelId || null });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const clearCooldown = async (id: string) => {
    setErr(null);
    try {
      const r = await api.clearCliAccountCooldown(id);
      setCooldowns(r.cooldowns ?? {});
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const toggleEnabled = async (acc: CliAccountPublic) => {
    setErr(null);
    try {
      await api.updateCliAccount(acc.id, { enabled: !acc.enabled });
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const removeAccount = async (id: string) => {
    setErr(null);
    try {
      await api.deleteCliAccount(id);
      await load();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const updateSettings = async (patch: CliAccountsSettings) => {
    setErr(null);
    try {
      const r = await api.saveCliAccountsSettings(patch);
      setSettings(r.settings);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    }
  };

  const applyAccountToGroup = (roles: readonly string[], accountId: string) => {
    setRoleAccounts((prev) => {
      const next: RoleAccountMap = { ...prev };
      for (const r of roles) {
        if (!accountId) delete next[r];
        else next[r] = { accountId };
      }
      return next;
    });
  };

  const saveRoles = async () => {
    setBusy(true);
    setErr(null);
    setNotice(null);
    try {
      const r = await api.saveRoleAccounts(roleAccounts);
      setRoleAccounts(r.role_accounts);
      setNotice(t.cli_acc_saved);
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const groupTitle = (k: RoleGroup["key"]): string => {
    if (k === "coding") return t.cli_acc_group_coding;
    if (k === "ideas") return t.cli_acc_group_ideas;
    if (k === "video") return t.cli_acc_group_video;
    return t.cli_acc_group_3d;
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
      <div>
        <b>{t.cli_acc_title}</b>
        <div className="muted">{t.cli_acc_policy}</div>
      </div>

      {err ? <div className="error">{err}</div> : null}
      {notice ? <div className="pill ok">{notice}</div> : null}

      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        {accounts.map((acc) => {
          const st = statuses[acc.id];
          const accModels = modelsByAccount[acc.id] ?? [];
          const cdUntil = cooldowns[acc.id];
          const isCooling = typeof cdUntil === "number" && cdUntil > Date.now();
          return (
            <div key={acc.id} className="card cli-acc-card">
              <div className="cli-acc-meta">
                <b>{acc.label}</b>
                <span className="pill">{providerBadge(acc.provider)}</span>
                {acc.isDefault ? <span className="pill ok">{t.cli_acc_default}</span> : null}
                <span className={`pill ${acc.enabled ? "ok" : "err"}`}>{acc.enabled ? t.cli_acc_enabled : t.cli_acc_disabled}</span>
                {isCooling ? (
                  <span className="pill err">
                    {t.cli_acc_cooldown_until} {fmtTime(cdUntil)}
                  </span>
                ) : null}
                {st ? (
                  <span className={`pill ${st.loggedIn ? "ok" : "err"}`}>
                    {st.loggedIn ? t.cli_acc_logged_in : t.cli_acc_not_logged_in}
                    {st.email ? ` · ${st.email}` : ""}
                    {st.version ? ` · v${st.version}` : ""}
                  </span>
                ) : null}
              </div>
              {acc.configDir ? <div className="muted mono" style={{ fontSize: 12 }}>{acc.configDir}</div> : null}
              {st?.error ? <div className="error" style={{ fontSize: 12 }}>{st.error}</div> : null}
              <div className="row" style={{ flexWrap: "wrap", gap: 8, alignItems: "center" }}>
                {accModels.length > 0 ? (
                  <label className="row" style={{ gap: 6, marginRight: 6 }}>
                    <span className="muted" style={{ fontSize: 12 }}>{t.cli_acc_model_default}:</span>
                    <select
                      aria-label={`${acc.label} ${t.cli_acc_model_default}`}
                      value={acc.defaultModel ?? ""}
                      onChange={(e) => void setAccountDefaultModel(acc.id, e.target.value)}
                      style={{ maxWidth: 230 }}
                    >
                      <option value="">{t.cli_acc_model_auto}</option>
                      {accModels.map((m) => (
                        <option key={m.id} value={m.id}>{m.label}</option>
                      ))}
                    </select>
                  </label>
                ) : null}
                <button type="button" disabled={checkingId === acc.id} onClick={() => void checkAccount(acc.id)}>
                  {t.cli_acc_check}
                </button>
                <button type="button" onClick={() => void loginAccount(acc.id)}>
                  {t.cli_acc_login}
                </button>
                {!acc.isDefault ? (
                  <button type="button" onClick={() => void setDefault(acc.id)}>
                    {t.cli_acc_set_default}
                  </button>
                ) : null}
                {isCooling ? (
                  <button type="button" onClick={() => void clearCooldown(acc.id)}>
                    {t.cli_acc_clear_cooldown}
                  </button>
                ) : null}
                <button type="button" onClick={() => void toggleEnabled(acc)}>
                  {acc.enabled ? t.cli_acc_disabled : t.cli_acc_enabled}
                </button>
                {accounts.length > 1 ? (
                  <button type="button" onClick={() => void removeAccount(acc.id)}>
                    {t.cli_acc_delete}
                  </button>
                ) : null}
              </div>
            </div>
          );
        })}
      </div>

      <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
        <b>{t.cli_acc_add_title}</b>
        <div className="row" style={{ flexWrap: "wrap", gap: 8 }}>
          <select aria-label={t.cli_acc_provider} value={provider} onChange={(e) => setProvider(e.target.value as CliProviderId)}>
            <option value="claude">Claude Code CLI</option>
            <option value="antigravity">Antigravity CLI (agy)</option>
            <option value="codex">OpenAI Codex CLI (ChatGPT)</option>
          </select>
          <input
            type="text"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
            placeholder={t.cli_acc_label}
            style={{ flex: "1 1 180px" }}
          />
          <button type="button" className="primary" disabled={busy || !label.trim()} onClick={() => void addAccount()}>
            {t.cli_acc_add_btn}
          </button>
        </div>
        {provider === "claude" || provider === "codex" ? (
          <label className="row" style={{ gap: 6 }}>
            <input type="checkbox" checked={isolated} onChange={(e) => setIsolated(e.target.checked)} />
            <span>{t.cli_acc_isolated}</span>
          </label>
        ) : null}
      </div>

      <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 6 }}>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={settings.autoFailover}
            onChange={(e) => void updateSettings({ autoFailover: e.target.checked })}
          />
          <span>{t.cli_acc_failover}</span>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <input
            type="checkbox"
            checked={settings.crossProviderFailover}
            disabled={!settings.autoFailover}
            onChange={(e) => void updateSettings({ crossProviderFailover: e.target.checked })}
          />
          <span>{t.cli_acc_cross_failover}</span>
        </label>
      </div>

      <div className="card" style={{ padding: 12, display: "flex", flexDirection: "column", gap: 12 }}>
        <div className="row" style={{ justifyContent: "space-between", flexWrap: "wrap", gap: 8 }}>
          <div>
            <b>{t.cli_acc_roles_title}</b>
            <div className="muted">{t.cli_acc_roles_hint}</div>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button type="button" disabled={busy} onClick={() => setRoleAccounts({})}>
              {t.cli_acc_reset_roles}
            </button>
            <button type="button" className="primary" disabled={busy} onClick={() => void saveRoles()}>
              {t.cli_acc_roles_save}
            </button>
          </div>
        </div>

        {ROLE_GROUPS.map((group) => (
          <div key={group.key} className="role-group-block">
            <div className="role-group-head">
              <b>{groupTitle(group.key)}</b>
              <select
                aria-label={`${groupTitle(group.key)} ${t.cli_acc_apply_group}`}
                value=""
                onChange={(e) => {
                  const v = e.target.value;
                  if (v === "__reset__") applyAccountToGroup(group.roles, "");
                  else if (v) applyAccountToGroup(group.roles, v);
                }}
                style={{ fontSize: 12, padding: "4px 8px" }}
              >
                <option value="">{t.cli_acc_apply_group}</option>
                <option value="__reset__">{t.cli_acc_pick_default}</option>
                {enabledAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.label} ({providerBadge(a.provider)})
                  </option>
                ))}
              </select>
            </div>
            <table className="role-model-table">
              <thead>
                <tr>
                  <th style={{ width: "30%" }}>{t.cli_acc_col_role}</th>
                  <th style={{ width: "35%" }}>{t.cli_acc_col_account}</th>
                  <th style={{ width: "35%" }}>{t.cli_acc_col_model}</th>
                </tr>
              </thead>
              <tbody>
                {group.roles.map((r) => {
                  const assigned = roleAccounts[r];
                  const availModels = modelsForRoleAccount(assigned?.accountId);
                  const currentModel = assigned?.model ?? "";
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
                            setRoleAccounts((prev) => {
                              const next = { ...prev };
                              if (!val && !prev[r]?.model) delete next[r];
                              else if (!val) next[r] = { ...(prev[r]?.model ? { model: prev[r]!.model } : {}) };
                              else next[r] = { accountId: val };
                              return next;
                            });
                          }}
                        >
                          <option value="">{t.cli_acc_pick_default}</option>
                          {enabledAccounts.map((a) => (
                            <option key={a.id} value={a.id}>
                              {a.label} ({providerBadge(a.provider)})
                            </option>
                          ))}
                        </select>
                      </td>
                      <td>
                        <select
                          aria-label={`${roleLabel(r, lang)} ${t.cli_acc_col_model}`}
                          value={currentModel}
                          onChange={(e) => {
                            const val = e.target.value;
                            setRoleAccounts((prev) => {
                              const next = { ...prev };
                              const prevAcc = prev[r]?.accountId;
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
                          {currentModel && !availModels.some((m) => m.id === currentModel) ? (
                            <option value={currentModel}>{currentModel}</option>
                          ) : null}
                        </select>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </div>
  );
}
