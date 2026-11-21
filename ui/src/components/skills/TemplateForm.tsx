import { useMemo, useState } from "react";
import { extractSlots, fillTemplate, missingSlots, slotLabel } from "../../skills/library";

export function TemplateForm(props: {
  content: string;
  labels: { title: string; apply: string; cancel: string };
  onApply: (text: string) => void;
  onCancel: () => void;
}) {
  const { content, labels, onApply, onCancel } = props;
  const slots = useMemo(() => extractSlots(content), [content]);
  const [values, setValues] = useState<Record<string, string>>({});
  const blocked = missingSlots(content, values).length > 0;
  return (
    <div className="card" style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <b>{labels.title}</b>
      {slots.map((name) => (
        <label key={name} className="row">
          <span>{slotLabel(name)}</span>
          <input value={values[name] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [name]: e.target.value }))} aria-label={slotLabel(name)} />
        </label>
      ))}
      <div className="row">
        <button type="button" className="primary" disabled={blocked} onClick={() => onApply(fillTemplate(content, values))}>{labels.apply}</button>
        <button type="button" onClick={onCancel}>{labels.cancel}</button>
      </div>
    </div>
  );
}
