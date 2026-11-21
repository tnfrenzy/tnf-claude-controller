import { useEffect, useMemo, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { qrMatrix } from "../../lib/qr";
import type { PhoneInfo } from "../../../../src/core/shared-types";

/** QR code as one SVG path (black modules on a white card with the 4-module quiet zone). */
function QrSvg({ text }: { text: string }) {
  const m = useMemo(() => qrMatrix(text), [text]);
  if (!m) return null;
  const quiet = 4;
  const n = m.length + quiet * 2;
  let d = "";
  m.forEach((row, y) => row.forEach((dark, x) => { if (dark) d += `M${x + quiet} ${y + quiet}h1v1h-1z`; }));
  return (
    <svg viewBox={`0 0 ${n} ${n}`} width={220} height={220} role="img" aria-label="QR" shapeRendering="crispEdges" style={{ background: "#fff", borderRadius: 8 }}>
      <path d={d} fill="#000" />
    </svg>
  );
}

/** Settings tab "Điện thoại": one switch that turns on Tailscale Serve for this app and shows a QR code to open it on a phone. */
export function PhoneSection() {
  const { t } = useT();
  const [info, setInfo] = useState<PhoneInfo | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);

  const load = () => { api.phone().then(setInfo).catch((e: Error) => setErr(e.message)); };
  useEffect(load, []);

  const run = (fn: () => Promise<PhoneInfo & { message?: string }>) => {
    setBusy(true);
    setErr(null);
    setMsg(null);
    fn()
      .then((r) => { setInfo(r); if (r.message) setMsg(r.message); })
      .catch((e: Error) => setErr(e.message))
      .finally(() => setBusy(false));
  };

  const copy = () => {
    if (!info?.link) return;
    void navigator.clipboard?.writeText(info.link).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => { /* clipboard blocked: the link is shown anyway */ });
  };

  if (!info) return err ? <div className="error">{err}</div> : <div className="muted">...</div>;
  const ready = !!info.link;
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
      <h4>{t.ph_title}</h4>
      <div className="muted">{t.ph_note}</div>
      {!info.installed ? <div className="error">{t.ph_not_installed}</div> : null}
      {info.installed && !info.running ? <div className="error">{t.ph_not_running}</div> : null}
      {info.installed && info.running ? (
        <div className="row">
          <span>{t.ph_machine}: <b>{info.dnsName}</b></span>
          <span className={`pill ${ready ? "ok" : ""}`}>{ready ? t.ph_on : t.ph_off}</span>
        </div>
      ) : null}
      <div className="row">
        {!ready ? <button type="button" disabled={busy || !info.installed || !info.running} onClick={() => run(() => api.phoneEnable())}>{t.ph_enable}</button> : null}
        {ready || info.serving || info.allowed ? <button type="button" disabled={busy} onClick={() => run(() => api.phoneDisable())}>{t.ph_disable}</button> : null}
        <button type="button" disabled={busy} onClick={load}>{t.ph_refresh}</button>
      </div>
      {info.link ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, alignItems: "flex-start" }}>
          <div className="muted">{t.ph_scan}</div>
          <QrSvg text={info.link} />
          <div className="row" style={{ flexWrap: "wrap" }}>
            <button type="button" onClick={copy}>{copied ? t.ph_copied : t.ph_copy}</button>
          </div>
          <div className="fine" style={{ wordBreak: "break-all" }}>{info.link.replace(/#token=.*/, "#token=…")}</div>
          <div className="fine">{t.ph_secret}</div>
        </div>
      ) : null}
      <div className="fine">{t.ph_steps}</div>
      {msg ? <div className="muted" role="status">{msg}</div> : null}
      {err ? <div className="error" role="alert">{err}</div> : null}
    </div>
  );
}
