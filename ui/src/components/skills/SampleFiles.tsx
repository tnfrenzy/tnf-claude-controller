import { useState } from "react";
import { ApiError, api } from "../../api";
import { useT } from "../../i18n";
import { isLocalHost } from "../../settings/grantsView";
import { OUTPUT_CHOICES, outputLabel } from "../../skills/skillOutputs";
import type { SessionRound } from "../../types";

/** The files of one round's sample: view in the browser (PDF, HTML), open with the program (Word, Excel, AutoCAD, SolidWorks) or download. */
export function SampleFiles({ slug, n, sample }: { slug: string; n: number; sample: NonNullable<SessionRound["sample"]> }) {
  const { t } = useT();
  const [err, setErr] = useState("");
  const local = isLocalHost(window.location.hostname);
  const fail = (e: unknown) => setErr(e instanceof ApiError || e instanceof Error ? e.message : String(e));
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {sample.files.map((f) => {
        const choice = OUTPUT_CHOICES.find((c) => c.id === f.format);
        return (
          <div key={f.format} className="row" style={{ flexWrap: "wrap", gap: 6 }}>
            <b>{outputLabel(f.format)}</b>
            {choice?.viewInBrowser ? (
              <button type="button" onClick={() => { setErr(""); api.viewSkillsGenSample(slug, n, f.format).catch(fail); }}>{t.skillg_view}</button>
            ) : (
              <button type="button" onClick={() => { setErr(""); api.openSkillsGenSample(slug, n, f.format).catch(fail); }}>{t.skillg_open}</button>
            )}
            <button type="button" onClick={() => { setErr(""); (local ? api.saveSkillsGenSample(slug, n, f.format) : api.downloadSkillsGenSample(slug, n, f.format)).catch(fail); }}>{local ? t.open_file : t.skillg_download_file}</button>
          </div>
        );
      })}
      {(sample.notes ?? []).map((note) => <div key={note} className="muted" role="status">⚠ {note}</div>)}
      {err ? <div role="alert" className="error">{err}</div> : null}
    </div>
  );
}
