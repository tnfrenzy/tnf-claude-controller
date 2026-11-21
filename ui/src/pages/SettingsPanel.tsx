import { useState } from "react";
import { setNotify } from "../lib/prefs";
import { useT, roleLabel } from "../i18n";
import { getAvatarMap, saveAvatarMap, setAvatar, getAvatarStyle, type AvatarMap, type AvatarStyle } from "../skills/avatars";
import { AvatarPicker } from "../components/settings/AvatarPicker";
import { useLibrary } from "../skills/useLibrary";
import { roleChoices } from "../skills/library";
import { DEFAULT_ROLES } from "../office/iso/scene";
import type { Lang } from "../i18n";
import type { StatusResponse } from "../types";
import { AutomationPanel } from "./AutomationPanel";
import { ReleaseConfigSection } from "../components/settings/ReleaseConfigSection";
import { CadToolsSection } from "../components/settings/CadToolsSection";
import { CleanupSection } from "../components/settings/CleanupSection";
import { MaxRunsSection } from "../components/settings/MaxRunsSection";
import { TuningSection } from "../components/settings/TuningSection";
import { PhoneSection } from "../components/settings/PhoneSection";
import { McpSection } from "../components/settings/McpSection";
import { GrantsSection } from "../components/settings/GrantsSection";
import { OutputDirSection } from "../components/settings/OutputDirSection";
import { ShortcutsSection } from "../components/settings/ShortcutsSection";
import { CliAccountsSection } from "../components/settings/CliAccountsSection";

export function SettingsPanel(props: { status: StatusResponse | null; statusErr: string | null; theme: string; setTheme: (t: string) => void; notifyOn: boolean; onNotifyChange: (on: boolean) => void; onOpen?: (name: "library") => void }) {
  const { t, lang, setLang } = useT();
  const { status, statusErr, theme, setTheme, notifyOn, onNotifyChange, onOpen } = props;
  const [denied, setDenied] = useState(false);
  const [avatars, setAvatars] = useState<AvatarMap>(() => getAvatarMap());
  const [style] = useState<AvatarStyle>(getAvatarStyle);
  const [openRole, setOpenRole] = useState<string | null>(null);
  const coding = Object.keys(status?.role_models_coding ?? {});
  const baseRoles = coding.length ? coding : DEFAULT_ROLES;
  const { lib } = useLibrary();
  const avatarRoles = roleChoices([...baseRoles, ...(lib?.builtinRoles ?? [])], lib?.roles ?? []).map((c) => c.id);
  const auth = status?.auth ?? null;
  const authOk = !!auth?.loggedIn && !status?.auth_error;
  const [tab, setTab] = useState<"accounts" | "people" | "keys" | "tuning" | "phone" | "auto" | "release" | "mcp" | "grants">("accounts");
  const tabs: Array<["accounts" | "people" | "keys" | "tuning" | "phone" | "auto" | "release" | "mcp" | "grants", string]> = [
    ["accounts", t.ss_tab_accounts],
    ["people", t.ss_tab_people],
    ["keys", t.ss_tab_keys],
    ["tuning", t.ss_tab_tuning],
    ["phone", t.ss_tab_phone],
    ["auto", t.ss_tab_auto],
    ["release", t.ss_tab_release],
    ["mcp", t.ss_tab_mcp],
    ["grants", t.ss_tab_grants],
  ];
  return (
    <div className="settings-panel" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="settings-quick-bar">
        <label className="row" style={{ gap: 6 }}>
          <span>{t.lang}</span>
          <select aria-label={t.lang} value={lang} onChange={(e) => setLang(e.target.value as Lang)}>
            <option value="vi">Tiếng Việt</option>
            <option value="en">English</option>
          </select>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span>{t.theme}</span>
          <button type="button" aria-label={t.theme} onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>{theme === "dark" ? "☀" : "☾"}</button>
        </label>
        <label className="row" style={{ gap: 6 }}>
          <span>{t.notify_label}</span>
          <input
            type="checkbox"
            aria-label={t.notify_label}
            checked={notifyOn}
            onChange={(e) => {
              const want = e.target.checked;
              if (!want) {
                setNotify(false);
                onNotifyChange(false);
                setDenied(false);
                return;
              }
              if (typeof Notification === "undefined") {
                setNotify(true);
                onNotifyChange(true);
                return;
              }
              void Notification.requestPermission().then((p) => {
                const ok = p === "granted";
                setNotify(ok);
                onNotifyChange(ok);
                setDenied(!ok);
              });
            }}
          />
        </label>
        <div className="row" style={{ gap: 6, marginLeft: "auto" }}>
          <span className="muted" style={{ fontSize: 12 }}>{t.auth_mode}: <b>{status?.defaults.authMode === "api" ? t.api : t.subscription}</b></span>
          {auth ? (
            <span className={`pill ${authOk ? "ok" : "err"}`}>
              {auth.authMethod}{auth.subscriptionType ? ` · ${auth.subscriptionType}` : ""}{auth.email ? ` · ${auth.email}` : ""}
            </span>
          ) : statusErr ? (
            <span className="pill err">{statusErr}</span>
          ) : null}
          {status?.auth_error ? <span className="pill err">{status.auth_error}</span> : null}
        </div>
      </div>
      {denied ? <div className="error">{t.notify_denied}</div> : null}
      <details className="settings-sys-details">
        <summary>{t.ss_sys_group}</summary>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <CadToolsSection />
          <CleanupSection />
          <OutputDirSection />
        </div>
      </details>
      <div className="settings-tabs" role="tablist">
        {tabs.map(([id, label]) => (
          <button
            type="button"
            role="tab"
            key={id}
            id={`settings-tab-${id}`}
            aria-selected={tab === id}
            aria-controls={`settings-tabpanel-${id}`}
            className={tab === id ? "active" : undefined}
            onClick={() => setTab(id)}
          >
            {label}
          </button>
        ))}
      </div>
      {tab === "accounts" ? (
        <div role="tabpanel" id="settings-tabpanel-accounts" aria-labelledby="settings-tab-accounts">
          <CliAccountsSection />
        </div>
      ) : null}
      {tab === "people" ? (
      <div role="tabpanel" id="settings-tabpanel-people" aria-labelledby="settings-tab-people" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
      <div className="row">
        <button type="button" onClick={() => onOpen?.("library")}>{t.nav_library}</button>
      </div>
      <div>
        <div className="row"><b>{t.ss_avatars}</b></div>
        <div className="muted">{t.ss_avatars_hint}</div>
        <div className="avatar-roles" role="group" aria-label={t.ss_avatars}>
          {avatarRoles.map((r) => (
            <button
              type="button"
              key={r}
              className={`avatar-role${openRole === r ? " avatar-role--open" : ""}`}
              aria-expanded={openRole === r}
              title={openRole === r ? t.ss_avatar_collapse : t.ss_avatar_expand}
              onClick={() => setOpenRole(openRole === r ? null : r)}
            >
              {roleLabel(r, lang)}
            </button>
          ))}
        </div>
        {openRole && avatarRoles.includes(openRole) ? (
          <div className="avatar-role-panel">
            <div className="row"><b>{roleLabel(openRole, lang)}</b></div>
            <AvatarPicker
              value={avatars[openRole] ?? ""}
              onChange={(id) => {
                const next = setAvatar(avatars, openRole, id);
                setAvatars(next);
                saveAvatarMap(next);
              }}
              style={style}
              lang={lang}
            />
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => {
            setAvatars({});
            saveAvatarMap({});
          }}
        >
          {t.ss_avatars_reset}
        </button>
      </div>
      </div>
      ) : null}
      {tab === "keys" ? (
        <div role="tabpanel" id="settings-tabpanel-keys" aria-labelledby="settings-tab-keys">
          <ShortcutsSection />
        </div>
      ) : null}
      {tab === "tuning" ? (
        <div role="tabpanel" id="settings-tabpanel-tuning" aria-labelledby="settings-tab-tuning" style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <MaxRunsSection />
          <TuningSection />
        </div>
      ) : null}
      {tab === "phone" ? (
        <div role="tabpanel" id="settings-tabpanel-phone" aria-labelledby="settings-tab-phone">
          <PhoneSection />
        </div>
      ) : null}
      {tab === "auto" ? (
        <div role="tabpanel" id="settings-tabpanel-auto" aria-labelledby="settings-tab-auto">
          <AutomationPanel />
        </div>
      ) : null}
      {tab === "release" ? (
        <div role="tabpanel" id="settings-tabpanel-release" aria-labelledby="settings-tab-release">
          <ReleaseConfigSection lang={lang} release={status?.release} />
        </div>
      ) : null}
      {tab === "mcp" ? (
        <div role="tabpanel" id="settings-tabpanel-mcp" aria-labelledby="settings-tab-mcp">
          <McpSection />
        </div>
      ) : null}
      {tab === "grants" ? (
        <div role="tabpanel" id="settings-tabpanel-grants" aria-labelledby="settings-tab-grants">
          <GrantsSection />
        </div>
      ) : null}
      <div className="muted">{t.cost_note}</div>
    </div>
  );
}
