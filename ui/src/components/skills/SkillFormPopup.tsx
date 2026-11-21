import { useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";
import { firstMissingKey, formFieldDomId, groupFields, suggestedAnswers, validateAnswers, type InputField, type InputsSchema } from "../../skills/skillForm";
import type { InboxFile } from "../../types";
import { AttachBox } from "../common/AttachBox";
import { Modal } from "../common/Modal";

type Answers = Record<string, unknown>;

function show(v: unknown): string {
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "boolean") return v ? "true" : "false";
  return String(v);
}

/** Pure form body (no fetching) so it can be rendered statically in tests. */
export function SkillFormView(props: {
  schema: InputsSchema;
  initial?: Answers;
  onSubmit?: (answers: Answers, stageId: string | null) => void;
  busy?: boolean;
  message?: string | null;
  error?: string | null;
}) {
  const { t } = useT();
  const { schema } = props;
  const [answers, setAnswers] = useState<Answers>(() => ({ ...suggestedAnswers(schema), ...(props.initial ?? {}) }));
  const [stageId, setStageId] = useState<string | null>(null);
  const [uploaded, setUploaded] = useState<Record<string, InboxFile[]>>({});
  const [dirty, setDirty] = useState(false);
  const result = validateAnswers(schema, answers);

  const setVal = (id: string, v: unknown) => {
    setDirty(true);
    setAnswers((a) => {
      const next = { ...a };
      if (v === undefined || v === "") delete next[id];
      else next[id] = v;
      return next;
    });
  };

  const control = (f: InputField) => {
    const v = answers[f.id];
    const inputStyle = { width: "100%", maxWidth: "100%", boxSizing: "border-box" as const };
    const aria = { id: formFieldDomId(f.id), "aria-required": f.required ? true : undefined, "aria-invalid": dirty && result.errors[f.id] ? true : undefined };
    if (f.kind === "text") return <input type="text" {...aria} style={inputStyle} value={typeof v === "string" ? v : ""} onChange={(e) => setVal(f.id, e.target.value)} />;
    if (f.kind === "number") {
      return (
        <div className="row" style={{ gap: 6 }}>
          <input type="number" {...aria} style={inputStyle} value={typeof v === "number" ? v : ""} onChange={(e) => setVal(f.id, e.target.value === "" ? undefined : Number(e.target.value))} />
          {f.unit ? <span className="muted">{f.unit}</span> : null}
        </div>
      );
    }
    if (f.kind === "select") {
      return (
        <select {...aria} style={inputStyle} value={typeof v === "string" ? v : ""} onChange={(e) => setVal(f.id, e.target.value)}>
          <option value="">{t.skill_form_choose}</option>
          {(f.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
        </select>
      );
    }
    if (f.kind === "bool") {
      return (
        <select {...aria} style={inputStyle} value={typeof v === "boolean" ? (v ? "1" : "0") : ""} onChange={(e) => setVal(f.id, e.target.value === "" ? undefined : e.target.value === "1")}>
          <option value="">{t.skill_form_choose}</option>
          <option value="1">{t.skill_form_yes}</option>
          <option value="0">{t.skill_form_no}</option>
        </select>
      );
    }
    const names = Array.isArray(v) ? (v as string[]) : [];
    const known = uploaded[f.id] ?? [];
    const files: InboxFile[] = names.map((n) => known.find((k) => k.name === n) ?? { name: n, size: 0, mtime: 0 });
    return (
      <div {...aria} tabIndex={-1}>
        <AttachBox
          compact
          files={files}
          onUpload={async (file) => {
            const r = await api.stageInbox(file, stageId);
            setStageId(r.stage_id);
            setUploaded((u) => ({ ...u, [f.id]: [...(u[f.id] ?? []).filter((k) => k.name !== r.file.name), r.file] }));
            setVal(f.id, [...names.filter((n) => n !== r.file.name), r.file.name]);
            return r.files;
          }}
        />
      </div>
    );
  };

  return (
    <form
      style={{ display: "flex", flexDirection: "column", gap: 14, maxWidth: "100%" }}
      onSubmit={(e) => {
        e.preventDefault();
        setDirty(true);
        if (result.ok) {
          props.onSubmit?.(answers, stageId);
          return;
        }
        const key = firstMissingKey(schema, result.errors);
        const el = key ? document.getElementById(formFieldDomId(key)) : null;
        if (el) {
          el.scrollIntoView?.({ behavior: "smooth", block: "center" });
          el.focus?.();
        }
      }}
    >
      <p className="muted" style={{ margin: 0, fontSize: 12 }}><span className="error">*</span> {t.skill_form_required_note}</p>
      {groupFields(schema).map((g) => (
        <fieldset key={g.group} style={{ border: "1px solid var(--line, #ccc)", borderRadius: 8, padding: 10, margin: 0, minWidth: 0 }}>
          <legend>{g.group}</legend>
          {g.fields.map((f) => (
            <div key={f.id} style={{ marginBottom: 12 }}>
              <label style={{ display: "block", fontWeight: 600, marginBottom: 4 }}>
                {f.label}
                {f.required ? <span className="error" title={t.skill_form_required}> *</span> : null}
              </label>
              {control(f)}
              <p className="muted" style={{ fontSize: 12, margin: "4px 0 0" }}>{t.skill_form_reason}: {f.reason}</p>
              {f.suggested !== undefined && (
                <p className="muted" style={{ fontSize: 12, margin: "2px 0 0" }}>
                  {t.skill_form_suggested}: <span className="mono">{show(f.suggested)}</span>{" "}
                  <button type="button" onClick={() => setVal(f.id, f.suggested)}>{t.skill_form_use_suggested}</button>
                </p>
              )}
              {dirty && result.errors[f.id] ? <p className="error" style={{ fontSize: 12, margin: "4px 0 0" }}>{result.errors[f.id]}</p> : null}
            </div>
          ))}
        </fieldset>
      ))}
      {!result.ok && <p className="error" style={{ margin: 0 }}>{t.skill_form_missing}</p>}
      {props.error && <p className="error" style={{ margin: 0 }}>{props.error}</p>}
      {props.message && <p style={{ margin: 0 }}>{props.message}</p>}
      <button type="submit" disabled={props.busy}>{props.busy ? t.skill_form_saving : t.skill_form_submit}</button>
    </form>
  );
}

export function SkillFormPopup({ slug, onClose }: { slug: string; onClose: () => void }) {
  const { t } = useT();
  const [data, setData] = useState<{ schema: InputsSchema; answers: Answers } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api.getSkillAnswers(slug).then((d) => live && setData(d)).catch((e) => live && setError(e instanceof Error ? e.message : String(e)));
    return () => { live = false; };
  }, [slug]);

  return (
    <Modal title={t.skill_form_title} sub={slug} onClose={onClose}>
      {!data && !error && <p className="muted">{t.skill_form_loading}</p>}
      {!data && error && <p className="error">{error}</p>}
      {data && (
        <SkillFormView
          schema={data.schema}
          initial={data.answers}
          busy={busy}
          message={message}
          error={error}
          onSubmit={(answers, stageId) => {
            setBusy(true);
            setError(null);
            setMessage(null);
            api.saveSkillAnswers(slug, { answers, stageId })
              .then(() => setMessage(t.skill_form_saved))
              .catch((e) => setError(e instanceof Error ? e.message : String(e)))
              .finally(() => setBusy(false));
          }}
        />
      )}
    </Modal>
  );
}
