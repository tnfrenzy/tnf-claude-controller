import { useRef, useState } from "react";
import type { DragEvent } from "react";
import { useT } from "../../i18n";
import { isBinaryFileName } from "../../skills/skillCreate";

/** Human-readable size: B, KB or MB. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface AttachPickerProps {
  label: string;
  files: { name: string; size: number }[];
  onAdd: (files: File[]) => void;
  onRemove: (index: number) => void;
}

/** Add-file button + drop zone + list (name, size, remove) with a warning under binary files. */
export function AttachPicker({ label, files, onAdd, onRemove }: AttachPickerProps) {
  const { t } = useT();
  const ref = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);

  function onDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setOver(false);
    const list = Array.from(e.dataTransfer?.files ?? []);
    if (list.length) onAdd(list);
  }

  return (
    <div
      onDragOver={(e) => { e.preventDefault(); setOver(true); }}
      onDragLeave={() => setOver(false)}
      onDrop={onDrop}
      style={{ display: "grid", gap: 4, minWidth: 0, padding: 6, border: `1px dashed ${over ? "#7aa7ff" : "#555"}`, borderRadius: 6 }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 }}>
        <strong style={{ minWidth: 0 }}>{label}</strong>
        <button type="button" onClick={() => ref.current?.click()}>{t.skillf_add_file}</button>
        <span style={{ opacity: 0.7, minWidth: 0 }}>{t.skillf_drop_hint}</span>
        <input
          ref={ref}
          type="file"
          multiple
          hidden
          onChange={(e) => {
            const list = Array.from(e.target.files ?? []);
            if (list.length) onAdd(list);
            e.target.value = "";
          }}
        />
      </div>
      {files.length ? (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "grid", gap: 4, minWidth: 0 }}>
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`} style={{ minWidth: 0 }}>
              <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center", minWidth: 0 }}>
                <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{f.name}</span>
                <span style={{ opacity: 0.7 }}>{formatFileSize(f.size)}</span>
                <button type="button" aria-label={`${t.skillf_remove_file}: ${f.name}`} onClick={() => onRemove(i)}>×</button>
              </div>
              {isBinaryFileName(f.name) ? <div style={{ color: "#e0b050", fontSize: 13, minWidth: 0 }}>{t.skillf_binary_warn}</div> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
