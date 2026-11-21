import { useState } from "react";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";
import type { Dict } from "../../i18n";
import { MAX_IMPORT_MD_BYTES, importBlockedKey, importWarningKey, isAgentMdFileName, utf8Bytes } from "../../skills/library";
import type { AgentMdPreview, LibraryImportRequest } from "../../types";

type Target = "auto" | "role" | "skill" | "prompt";

/** The id field only applies to roles; skill/prompt ids are generated from the name by the server. */
export function showIdField(target: Target): boolean {
  return target === "auto" || target === "role";
}

/**
 * Import an agent .md (pasted or chosen) into the library: preview first (dryRun), then confirm.
 * The prompt is shown as plain text only; nothing here starts a run.
 */
export function AgentMdImport({ onImported, onCancel }: { onImported: () => void; onCancel?: () => void }) {
  const { t } = useT();
  const [text, setText] = useState("");
  const [fileName, setFileName] = useState("");
  const [as, setAs] = useState<Target>("auto");
  const [id, setId] = useState("");
  const [preview, setPreview] = useState<AgentMdPreview | null>(null);
  const [sent, setSent] = useState<LibraryImportRequest | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const reset = () => {
    setPreview(null);
    setSent(null);
  };

  const buildReq = (): LibraryImportRequest => {
    const req: LibraryImportRequest = { text };
    if (as !== "auto") req.as = as;
    const cleanId = id.trim();
    if (cleanId) req.id = cleanId;
    if (fileName) req.filename = fileName;
    return req;
  };

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr(null);
    if (!isAgentMdFileName(file.name)) return setErr(t.lib_imp_ui_err_bad_name);
    if (file.size > MAX_IMPORT_MD_BYTES) return setErr(t.lib_imp_ui_err_too_big);
    try {
      const content = await file.text();
      if (utf8Bytes(content) > MAX_IMPORT_MD_BYTES) return setErr(t.lib_imp_ui_err_too_big);
      setText(content);
      setFileName(file.name);
      reset();
    } catch {
      setErr(t.lib_imp_ui_err_read);
    }
  };

  const doPreview = async () => {
    setBusy(true);
    setErr(null);
    try {
      const req = buildReq();
      const r = await api.importLibraryMd({ ...req, dryRun: true });
      setPreview(r.preview);
      setSent(req);
    } catch (e) {
      reset();
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const doImport = async () => {
    if (!preview || !sent || preview.blocked !== null) return;
    setBusy(true);
    setErr(null);
    try {
      await api.importLibraryMd({ ...sent, dryRun: false });
      onImported();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  };

  const dict = t as Dict;
  const canImport = !!preview && preview.blocked === null && !busy;

  return (
    <div className="catalog">
      <textarea
        value={text}
        onChange={(e) => { setText(e.target.value); setFileName(""); reset(); }}
        placeholder={t.lib_imp_ui_placeholder}
        aria-label={t.lib_import_paste}
        rows={8}
        style={{ width: "100%" }}
      />
      <div style={{ marginTop: 6 }}>
        <label className="muted">
          {t.lib_import_choose_file}{" "}
          <input type="file" accept=".md,.markdown" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
        {fileName && <span className="muted mono"> {fileName}</span>}
      </div>
      <div style={{ marginTop: 6, display: "flex", gap: 8, flexWrap: "wrap" }}>
        <label className="muted">
          {t.lib_imp_ui_kind_label}{" "}
          <select value={as} onChange={(e) => { setAs(e.target.value as Target); reset(); }}>
            <option value="auto">{t.lib_imp_ui_kind_auto}</option>
            <option value="role">{t.lib_import_as_role}</option>
            <option value="skill">{t.lib_import_as_skill}</option>
            <option value="prompt">{t.lib_import_as_prompt}</option>
          </select>
        </label>
        {showIdField(as) && (
          <label className="muted">
            {t.lib_imp_ui_id_label}{" "}
            <input type="text" value={id} onChange={(e) => { setId(e.target.value); reset(); }} />
          </label>
        )}
      </div>
      <p className="muted" style={{ margin: "8px 0" }}>{t.lib_import_not_vetted}</p>
      {err && <p className="error">{t.err_prefix}: {err}</p>}
      {preview && (
        <div className="catalog-card">
          <div><b>{t.lib_imp_ui_f_kind}:</b> {preview.kind} · <b>{t.lib_imp_ui_f_id}:</b> <span className="mono">{preview.id}</span></div>
          <p style={{ margin: "4px 0" }}><b>{t.lib_imp_ui_f_desc}:</b> {preview.description}</p>
          {preview.tools.length > 0 && (
            <div className="chips">
              <b>{t.lib_imp_ui_f_tools}:</b>
              {preview.tools.map((x) => <span className="chip tool" key={x}>{x}</span>)}
            </div>
          )}
          {preview.droppedTools.length > 0 && (
            <div className="chips" style={{ color: "var(--err)" }}>
              <b>{t.lib_import_dropped_tools}:</b>
              {preview.droppedTools.map((x) => <span className="chip" style={{ color: "var(--err)" }} key={x}>{x}</span>)}
            </div>
          )}
          {preview.model && <div><b>{t.lib_imp_ui_f_model}:</b> {preview.model}</div>}
          {preview.license && <div><b>{t.lib_imp_ui_f_license}:</b> {preview.license}</div>}
          {preview.dangerKeywords.length > 0 && (
            <div className="chips" style={{ color: "var(--err)", fontWeight: 600 }}>
              <b>{t.lib_import_danger}:</b>
              {preview.dangerKeywords.map((x) => <span className="chip" style={{ color: "var(--err)", fontWeight: 600 }} key={x}>{x}</span>)}
            </div>
          )}
          {preview.warnings.length > 0 && (
            <ul className="muted" style={{ margin: "6px 0" }}>
              {preview.warnings.map((w) => <li key={w}>{dict[importWarningKey(w) as keyof Dict] ?? w}</li>)}
            </ul>
          )}
          {preview.blocked !== null && (
            <p className="error">{dict[importBlockedKey(preview.blocked) as keyof Dict] ?? preview.blocked}</p>
          )}
          <div><b>{t.lib_imp_ui_f_prompt}:</b></div>
          <pre className="catalog-prompt">{preview.prompt}</pre>
        </div>
      )}
      <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
        <button className="primary" disabled={busy || text.trim() === ""} onClick={() => void doPreview()}>{t.lib_import_preview}</button>
        <button disabled={!canImport} onClick={() => void doImport()}>{t.lib_import_confirm}</button>
        {onCancel && <button onClick={onCancel}>{t.cancel}</button>}
      </div>
    </div>
  );
}
