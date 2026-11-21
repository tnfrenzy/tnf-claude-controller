import { useCallback, useEffect, useState } from "react";
import { api, type CadStatusView } from "../../api";
import { useT } from "../../i18n";

/** Settings block: are Python, ezdxf and cadquery available to the app (so DXF and STEP attachments can be read)? */
export function CadToolsSection() {
  const { t } = useT();
  const [st, setSt] = useState<CadStatusView | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    setBusy(true);
    try {
      setSt(await api.cadStatus());
      setErr(null);
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void check();
  }, [check]);

  return (
    <div className="cad-tools" data-testid="cad-tools">
      <div className="row">
        <b>{t.cad_title}</b>
        <button type="button" className="mini" disabled={busy} onClick={() => void check()}>{busy ? t.cad_checking : t.cad_check}</button>
      </div>
      {err && <div className="error">{err}</div>}
      {st && (
        <div className={st.available ? "muted" : "warn"}>
          {st.available ? t.cad_ready : t.cad_missing}
          {st.ezdxf ? ` · ezdxf ${st.ezdxf}` : ""}
          {st.cadquery ? ` · cadquery ${st.cadquery}` : ""}
          {!st.available || st.message !== "Sẵn sàng." ? <div className="fine">{st.message}</div> : null}
          {st.python ? <div className="fine mono">{st.python}</div> : null}
        </div>
      )}
      <div className="fine">{t.cad_note}</div>
    </div>
  );
}
