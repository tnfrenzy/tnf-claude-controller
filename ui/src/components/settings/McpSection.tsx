import { useCallback, useEffect, useState } from "react";
import { api, type CliMcpView, type McpServerView } from "../../api";
import { useT } from "../../i18n";

const STATUS_KEY = { connected: "mcp_status_connected", needs_auth: "mcp_status_needs_auth", failed: "mcp_status_failed", not_configured: "mcp_status_not_configured" } as const;

/** Settings > Kết nối MCP: app-owned servers (Desktop Commander…) and the CLI's own connectors (claude.ai account, plugins).
 *  The server redacts env/header values, so this view never shows or sends them. */
export function McpSection() {
  const { t } = useT();
  const [servers, setServers] = useState<McpServerView[]>([]);
  const [cli, setCli] = useState<CliMcpView[] | null>(null);
  const [probe, setProbe] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(() => {
    api.mcpList().then((r) => { setServers(r.servers); setCli(r.cli?.items ?? null); setErr(null); }).catch((e: Error) => setErr(e.message));
  }, []);
  useEffect(load, [load]);

  const clearProbe = (id: string) => setProbe((p) => { const { [id]: _drop, ...rest } = p; return rest; });
  const run = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setErr(null);
    try { await fn(); load(); } catch (e) { setErr(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const hasDc = servers.some((s) => s.id === "desktop-commander");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 12 }} data-testid="mcp-section">
      <div className="card">
        <h4>{t.mcp_title}</h4>
        {servers.map((s) => (
          <div className="row" key={s.id} style={{ flexWrap: "wrap" }}>
            <label className="row">
              <input type="checkbox" checked={s.enabled} disabled={busy} onChange={(e) => void run(async () => { clearProbe(s.id); await api.mcpSet(s.id, { enabled: e.target.checked }); })} aria-label={s.name} />
              <b>{s.name}</b>
            </label>
            <button type="button" className="mini" disabled={busy} onClick={() => void run(async () => { const r = await api.mcpProbe(s.id); setProbe((p) => ({ ...p, [s.id]: r.ok ? `${r.tools.length}: ${r.tools.join(", ")}` : (r.error ?? "Error") })); })}>{t.mcp_probe}</button>
            <button type="button" className="mini danger" disabled={busy} aria-label={`${s.name} ✕`} onClick={() => void run(async () => { clearProbe(s.id); await api.mcpRemove(s.id); })}>✕</button>
            {probe[s.id] ? <div className="fine" style={{ flexBasis: "100%", overflowWrap: "anywhere" }}>{probe[s.id]}</div> : null}
          </div>
        ))}
        {!hasDc && <button type="button" disabled={busy} onClick={() => void run(() => api.mcpAddPreset("desktop-commander"))}>{t.mcp_add_dc}</button>}
        <div className="warn fine">{t.mcp_dc_warn}</div>
      </div>
      <div className="card">
        <h4>{t.mcp_cli_title}</h4>
        <div className="muted">{t.mcp_cli_login_hint}</div>
        <div className="row" style={{ flexWrap: "wrap" }}>
          <button type="button" disabled={busy} onClick={() => void run(async () => { const r = await api.mcpCliRefresh(); setCli(r.items); })}>{busy ? "…" : t.mcp_cli_refresh}</button>
          <button type="button" onClick={() => void run(() => api.mcpCliLogin())}>{t.mcp_cli_login}</button>
        </div>
        {!cli || cli.length === 0 ? <div className="muted">{t.mcp_cli_none}</div> : (
          <ul className="file-list">
            {cli.map((c) => (
              <li key={c.name} style={{ overflowWrap: "anywhere" }}><span className="mono">{c.name}</span> <span className={`pill ${c.status === "connected" ? "ok" : c.status === "failed" ? "err" : ""}`}>{t[STATUS_KEY[c.status] ?? "mcp_status_failed"]}</span></li>
            ))}
          </ul>
        )}
      </div>
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
