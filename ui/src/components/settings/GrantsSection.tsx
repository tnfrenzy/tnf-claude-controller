import { useEffect, useRef, useState } from "react";
import { api, type GrantsView, type McpServerView } from "../../api";
import { useT } from "../../i18n";
import { GROUP_FIELDS, addDir, connectorRows, removeDir, setMcpAccess } from "../../settings/grantsView";

/** Settings > Cấp quyền: tick permissions per environment ("" = the default profile). */
export function GrantsSection() {
  const { t } = useT();
  const [envs, setEnvs] = useState<string[]>([]);
  const [env, setEnv] = useState<string>("");
  const [g, setG] = useState<GrantsView | null>(null);
  const [src, setSrc] = useState("");
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [connectors, setConnectors] = useState<Array<{ id: string; label: string; canRead: boolean }>>([]);
  const [dir, setDir] = useState("");
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Latest committed (server-confirmed) grants and current env, read by async callbacks so they never use a stale closure.
  const committed = useRef<GrantsView | null>(null);
  const envRef = useRef("");
  envRef.current = env;

  useEffect(() => {
    api.projects().then((r) => setEnvs(r.projects.map((p) => p.name))).catch(() => undefined);
    api.mcpList().then((r) => { setServers(r.servers); setConnectors(connectorRows(r.cli?.items ?? [])); }).catch(() => undefined);
  }, []);
  useEffect(() => {
    let cancelled = false;
    setG(null);
    committed.current = null;
    setErr(null);
    setMsg(null);
    api.grantsGet(env || null)
      .then((r) => { if (cancelled) return; committed.current = r.grants; setG(r.grants); setSrc(r.source); })
      .catch((e: Error) => { if (!cancelled) setErr(e.message); });
    return () => { cancelled = true; };
  }, [env]);

  /** Apply `change` to the latest committed grants, show it at once, PUT it; roll back and show the server message on failure. */
  const save = (change: (cur: GrantsView) => GrantsView) => {
    const base = committed.current;
    if (!base || saving) return;
    const forEnv = env;
    const next = change(base);
    if (next === base) return;
    setG(next);
    setErr(null);
    setSaving(true);
    api.grantsPut(forEnv || null, next)
      .then((r) => {
        if (envRef.current !== forEnv) return;
        committed.current = r.grants;
        setG(r.grants);
        setSrc("project");
        setMsg(t.grants_saved);
        setTimeout(() => setMsg(null), 2000);
      })
      .catch((e: Error) => {
        if (envRef.current !== forEnv) return;
        setG(committed.current);
        setErr(e.message);
      })
      .finally(() => setSaving(false));
  };

  const accessOf = (id: string) => g?.mcp[id] ?? "off";
  const mcpRows = [
    ...servers.map((s) => ({ id: s.id, label: s.name, canRead: (s.writeTools?.length ?? 0) > 0 })),
    ...connectors,
  ];

  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }} data-testid="grants-section">
      <h4>{t.grants_title}</h4>
      <div className="muted fine" data-testid="grants-guardrail-note">{t.grants_guardrail_note}</div>
      <label className="row" style={{ flexWrap: "wrap" }}>
        <span>{t.grants_env}</span>
        <select value={env} onChange={(e) => setEnv(e.target.value)} aria-label={t.grants_env} disabled={saving} style={{ maxWidth: "100%" }}>
          <option value="">{t.grants_default_profile}</option>
          {envs.map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </label>
      {err ? <div className="error" role="alert">{err}</div> : null}
      {!g ? (err ? null : <div className="muted fine">{t.grants_loading}</div>) : (
        <>
          {env && src !== "project" ? <div className="fine muted">{t.grants_using_default}</div> : null}
          {GROUP_FIELDS.map((f) => (
            <label className="row" key={f.key}>
              <input type="checkbox" disabled={saving} checked={g[f.key] as boolean} onChange={(e) => save((cur) => ({ ...cur, [f.key]: e.target.checked }))} />
              <span>{(t as Record<string, string>)[f.labelKey]}</span>
            </label>
          ))}
          <div>
            <b>{t.grants_extra_dirs}</b>
            {g.extraDirs.map((d) => (
              <div className="row" key={d.path} style={{ flexWrap: "wrap" }}>
                <span className="mono" style={{ overflowWrap: "anywhere" }}>{d.path}</span>
                <label className="row"><input type="checkbox" disabled={saving} checked={d.write} onChange={(e) => save((cur) => ({ ...cur, extraDirs: cur.extraDirs.map((x) => (x.path === d.path ? { ...x, write: e.target.checked } : x)) }))} /> {t.grants_dir_write}</label>
                <button type="button" className="mini danger" disabled={saving} aria-label={`${d.path} ✕`} onClick={() => save((cur) => removeDir(cur, d.path))}>✕</button>
              </div>
            ))}
            <div className="row" style={{ flexWrap: "wrap" }}>
              <input style={{ flex: "1 1 200px", minWidth: 0 }} value={dir} onChange={(e) => setDir(e.target.value)} placeholder="D:\Tai-lieu" aria-label={t.grants_add_dir} />
              <button type="button" disabled={saving || !dir.trim()} onClick={() => { save((cur) => addDir(cur, dir)); setDir(""); }}>{t.grants_add_dir}</button>
            </div>
          </div>
          <div>
            <b>{t.grants_mcp}</b>
            <div className="muted fine">{t.grants_mcp_default_off}</div>
            {mcpRows.length === 0 ? <div className="muted fine">{t.mcp_cli_none}</div> : null}
            {mcpRows.map((m) => (
              <div className="row" key={m.id} style={{ flexWrap: "wrap" }}>
                <span className="mono" style={{ overflowWrap: "anywhere" }}>{m.label}</span>
                <select value={accessOf(m.id)} disabled={saving} aria-label={m.label} onChange={(e) => save((cur) => setMcpAccess(cur, m.id, e.target.value as "off" | "read" | "full"))}>
                  <option value="off">{t.grants_mcp_off}</option>
                  {m.canRead ? <option value="read">{t.grants_mcp_read}</option> : null}
                  <option value="full">{t.grants_mcp_full}</option>
                </select>
              </div>
            ))}
            <label className="row">
              <input type="checkbox" disabled={saving} checked={g.anyProcess} onChange={(e) => save((cur) => ({ ...cur, anyProcess: e.target.checked }))} />
              <span className="warn">{t.grants_any_process}</span>
            </label>
            {g.anyProcess ? <div className="error fine">{t.grants_any_process_warn}</div> : null}
          </div>
          <div>
            <label className="row">
              <input type="checkbox" data-testid="grants-preview" disabled={saving} checked={g.preview} onChange={(e) => save((cur) => ({ ...cur, preview: e.target.checked }))} />
              <span>{t.grants_preview}</span>
            </label>
            <div className="muted fine">{t.grants_preview_hint}</div>
          </div>
          <div className="muted fine"><b>{t.grants_locked_title}:</b> {t.grants_locked_list}</div>
          {msg ? <div className="muted fine" role="status">{msg}</div> : null}
        </>
      )}
    </div>
  );
}
