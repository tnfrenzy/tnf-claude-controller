import { useRef, useState } from "react";
import { ApiError } from "../../api";
import { useT } from "../../i18n";
import type { InboxFile } from "../../types";

export function fmtSize(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(2)} MB`;
}

/**
 * File picker + list for a run inbox (5.5). `onUpload` sends one file and returns the inbox listing afterwards;
 * the caller decides whether that is a staging area (Command page) or an existing run (follow-up).
 */
export function AttachBox({ files, onUpload, disabled, compact }: { files: InboxFile[]; onUpload: (f: File) => Promise<InboxFile[]>; disabled?: boolean; compact?: boolean }) {
  const { t } = useT();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const pick = async (list: FileList | null) => {
    if (!list || list.length === 0) return;
    setBusy(true);
    setErr(null);
    try {
      for (const f of Array.from(list)) await onUpload(f);
    } catch (e) {
      setErr(e instanceof ApiError && e.code === "bad_name" ? t.attach_bad_name : e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  return (
    <div className="attach-box">
      <div className="row" style={{ gap: 8 }}>
        <input ref={input} type="file" multiple style={{ display: "none" }} onChange={(e) => void pick(e.target.files)} aria-label={t.attach} />
        <button disabled={disabled || busy} onClick={() => input.current?.click()}>📎 {busy ? t.attach_uploading : t.attach_pick}</button>
        {!compact && <span className="muted" style={{ fontSize: 12 }}>{t.attach_hint}</span>}
      </div>
      {files.length > 0 && (
        <ul className="attach-list">
          {files.map((f) => (
            <li key={f.name}><span className="mono">{f.name}</span> <span className="muted">({fmtSize(f.size)})</span></li>
          ))}
        </ul>
      )}
      {err && <p className="error" style={{ marginTop: 6, marginBottom: 0 }}>{err}</p>}
    </div>
  );
}
