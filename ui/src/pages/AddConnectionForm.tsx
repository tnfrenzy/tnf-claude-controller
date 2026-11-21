import { useState } from "react";
import type { FormEvent } from "react";
import { api } from "../api";
import { useT } from "../i18n";

/** Popup body: add an API connection (= a new floor of the API tower). The token is stored on this machine only. */
export function AddConnectionForm({ defaultPath, onDone }: { defaultPath: string; onDone: () => void }) {
  const { t } = useT();
  const [name, setName] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [token, setToken] = useState("");
  const [path, setPath] = useState(defaultPath);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.addConnection({ name, baseUrl, token, path });
      onDone();
    } catch (ex) {
      setErr((ex as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} style={{ display: "grid", gap: 10 }}>
      <div className="muted">{t.api_form_note}</div>
      <label>
        {t.api_name}
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Platform" style={{ width: "100%" }} />
      </label>
      <label>
        {t.api_url}
        <input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://platform.example.com" style={{ width: "100%" }} />
      </label>
      <label>
        {t.api_token}
        <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} style={{ width: "100%" }} />
        <span className="fine">{t.api_token_hint}</span>
      </label>
      <label>
        {t.api_path}
        <input value={path} onChange={(e) => setPath(e.target.value)} style={{ width: "100%" }} />
      </label>
      {err ? <div role="alert" className="error">{err}</div> : null}
      <div>
        <button type="submit" disabled={busy}>{t.api_save}</button>
      </div>
    </form>
  );
}
