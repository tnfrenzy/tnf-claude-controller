import { useEffect, useState } from "react";
import { api } from "../../api";
import { useT } from "../../i18n";

/** Settings: where every AI-made (non-code) file is collected. */
export function OutputDirSection() {
  const { t } = useT();
  const [cur, setCur] = useState("");
  const [def, setDef] = useState("");
  const [val, setVal] = useState("");
  const [err, setErr] = useState<string | null>(null);
  useEffect(() => { api.outputDirGet().then((r) => { setCur(r.outputDir); setDef(r.defaultDir); setVal(r.outputDir); }).catch((e: Error) => setErr(e.message)); }, []);
  const save = (dir: string) => { setErr(null); api.outputDirPut(dir).then((r) => { setCur(r.outputDir); setVal(r.outputDir); }).catch((e: Error) => setErr(e.message)); };
  return (
    <div className="card" data-testid="output-dir">
      <h4>{t.out_title}</h4>
      <div className="muted">{t.out_label}</div>
      <div className="row" style={{ flexWrap: "wrap" }}>
        <input style={{ flex: "1 1 220px", minWidth: 0 }} value={val} onChange={(e) => setVal(e.target.value)} aria-label={t.out_title} />
        <button type="button" disabled={!val.trim() || val === cur} onClick={() => save(val)}>{t.out_save}</button>
        <button type="button" disabled={cur === def} onClick={() => save(def)}>{t.out_default}</button>
      </div>
      <div className="fine">{t.out_note}</div>
      {err ? <div className="error">{err}</div> : null}
    </div>
  );
}
