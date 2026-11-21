import { useEffect, useState } from "react";
import { api } from "../../api";
import { useT, type Dict } from "../../i18n";
import { Modal } from "../common/Modal";
import { stateOf, type EmployeeState } from "../../office/api-staff";
import type { Employee, PublicConnection, StaffResult } from "../../../../src/core/shared-types";

const STATE_KEY: Record<EmployeeState, keyof Dict> = {
  working: "api_st_working",
  lockwait: "api_st_lockwait",
  paused: "api_st_paused",
  unwired: "api_st_unwired",
  failed: "api_st_failed",
  idle: "api_st_idle",
};
const STATE_COLOR: Record<EmployeeState, string> = { working: "#5aa0ff", lockwait: "#ffb15c", paused: "#8b98b3", unwired: "#8b98b3", failed: "#ff5c5c", idle: "#4fd18b" };

const POLL_MS = 8000;

/** One API floor: a numbers table with one row per employee (no office view). Polls only while open. */
export function ApiFloorPopup({ conn, onClose, onDeleted }: { conn: PublicConnection; onClose: () => void; onDeleted: () => void }) {
  const { t } = useT();
  const [res, setRes] = useState<StaffResult | null>(null);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const load = () => {
      api.connectionStaff(conn.id).then((r) => alive && setRes(r)).catch((e: Error) => alive && setErr(e.message));
    };
    load();
    const id = setInterval(() => { if (!document.hidden) load(); }, POLL_MS);
    return () => { alive = false; clearInterval(id); };
  }, [conn.id]);

  const employees: readonly Employee[] = res && res.ok ? res.employees : [];
  const del = () => {
    if (!window.confirm(t.api_delete_confirm)) return;
    api.deleteConnection(conn.id).then(() => { onDeleted(); onClose(); }).catch((e: Error) => setErr(e.message));
  };

  return (
    <Modal size="large" title={conn.name} sub={conn.baseUrl} onClose={onClose}>
      <div className="api-floor" style={{ display: "flex", flexDirection: "column", gap: 10 }}>
        {err ? <div className="error" role="alert">{err}</div> : null}
        {res && !res.ok ? <div className="error" role="alert">{t.api_down}: {res.error}</div> : null}
        {!res && !err ? <div className="muted">{t.api_connecting}</div> : null}
        {res && res.ok ? (
          <div style={{ overflowX: "auto" }}>
            <table className="api-table">
              <thead>
                <tr>
                  <th>{t.api_col_name}</th>
                  <th>{t.api_col_state}</th>
                  <th>{t.api_col_pending}</th>
                  <th>{t.api_col_processing}</th>
                  <th>{t.api_col_failed}</th>
                  <th>{t.api_col_done}</th>
                  <th>{t.api_col_avg}</th>
                </tr>
              </thead>
              <tbody>
                {employees.map((e) => {
                  const s = stateOf(e);
                  return (
                    <tr key={e.id}>
                      <td>{e.name}{e.department ? <span className="muted"> · {e.department}</span> : null}</td>
                      <td><span style={{ color: STATE_COLOR[s], fontWeight: 600 }}>{t[STATE_KEY[s]]}</span></td>
                      <td>{e.counts ? e.counts.pending : "–"}</td>
                      <td>{e.counts ? e.counts.processing : "–"}</td>
                      <td style={e.counts && e.counts.failed > 0 ? { color: "#ff5c5c", fontWeight: 600 } : undefined}>{e.counts ? e.counts.failed : "–"}</td>
                      <td>{e.counts ? e.counts.done : "–"}</td>
                      <td>{e.avgSeconds !== null ? `${Math.round(e.avgSeconds)}s` : "–"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {employees.length === 0 ? <div className="muted">{t.api_empty}</div> : null}
          </div>
        ) : null}
        <div className="row" style={{ justifyContent: "space-between" }}>
          <span className="fine">{t.api_note_window}</span>
          <button type="button" className="danger" onClick={del}>{t.api_delete}</button>
        </div>
      </div>
    </Modal>
  );
}
