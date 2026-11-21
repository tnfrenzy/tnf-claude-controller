import { useState } from "react";
import { api, ApiError } from "../../api";
import { useT } from "../../i18n";
import type { VsLibraryItem } from "../../../../src/core/videostudio/plan-types";

export function formatSize(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** Shared images/videos the user provides once; they are attached to new videos from the create form. */
export function VideoLibraryBox(props: { files: VsLibraryItem[]; onChanged: () => void }) {
  const { t: dict } = useT();
  const t = dict as Record<string, string>;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async (list: File[]) => {
    setBusy(true);
    setError(null);
    for (const f of list) {
      try {
        await api.videoStudioLibraryUpload(f);
      } catch (e) {
        setError(`${f.name}: ${e instanceof ApiError ? e.message : String(e)}`);
        break;
      }
    }
    setBusy(false);
    props.onChanged();
  };

  const remove = async (name: string) => {
    if (!window.confirm(`${t["vs_lib_delete"]}: ${name}?`)) return;
    setError(null);
    try {
      await api.videoStudioLibraryDelete(name);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : String(e));
    }
    props.onChanged();
  };

  return (
    <div className="vs-library">
      <h4>{t["vs_lib_title"]}</h4>
      <p className="muted">{t["vs_lib_intro"]}</p>
      {props.files.length === 0 ? <p className="muted">{t["vs_lib_empty"]}</p> : null}
      <ul className="vs-library-list">
        {props.files.map((f) => (
          <li key={f.name}>
            <span className="vs-library-kind">{t[`vs_lib_kind_${f.kind}`] ?? f.kind}</span>
            <span className="vs-library-name">{f.name}</span>
            <span className="muted">{formatSize(f.size)}</span>
            <button type="button" onClick={() => void remove(f.name)}>
              {t["vs_lib_delete"]}
            </button>
          </li>
        ))}
      </ul>
      <label className="vs-library-upload">
        <span>{busy ? t["vs_lib_uploading"] : t["vs_lib_upload"]}</span>
        <input
          type="file"
          multiple
          accept="image/*,video/*,audio/*"
          disabled={busy}
          onChange={(e) => {
            const picked = Array.from(e.target.files ?? []);
            e.target.value = "";
            if (picked.length) void upload(picked);
          }}
        />
      </label>
      {error ? <p className="error">{error}</p> : null}
    </div>
  );
}
