import { useEffect, useMemo, useState } from "react";
import { api, openSocket, type WsMessage } from "../api";
import { emptyOffice, mergeOffices, reduceOffice, type OfficeAgent, type OfficeState } from "./model";
import type { StoredEvent } from "../types";

/** What the office needs to know about a run. */
export interface OfficeRunRef {
  id: string;
  project: string;
}

/**
 * Follows each run's event stream (WebSocket with a REST fallback) and merges the runs into one set of office agents.
 * `tagFor` names a run when several are shown at once. Sockets and timers live only while the component is mounted.
 */
export function useOfficeAgents(runs: readonly OfficeRunRef[], tagFor: (r: OfficeRunRef, many: boolean) => string | undefined): OfficeAgent[] {
  const [states, setStates] = useState<Record<string, OfficeState>>({});
  const ids = runs.map((r) => r.id).join("|");

  useEffect(() => {
    const sockets = new Map<string, { ws: WebSocket | null; closed: boolean; poll?: ReturnType<typeof setInterval> }>();
    for (const id of ids.split("|").filter(Boolean)) {
      const slot: { ws: WebSocket | null; closed: boolean; poll?: ReturnType<typeof setInterval> } = { ws: null, closed: false };
      sockets.set(id, slot);
      let seq = 0;
      setStates((s) => (s[id] ? s : { ...s, [id]: emptyOffice(id) }));
      const apply = (stored: StoredEvent) => {
        if (stored.seq <= seq) return;
        seq = stored.seq;
        setStates((s) => ({ ...s, [id]: reduceOffice(s[id] ?? emptyOffice(id), stored) }));
      };
      const connect = () => {
        slot.ws = openSocket(
          `/ws/runs/${encodeURIComponent(id)}?after=${seq}`,
          (m: WsMessage) => {
            if (m.type === "event") apply(m.stored);
          },
          () => {
            if (!slot.closed) setTimeout(connect, 1500);
          },
        );
      };
      connect();
      // REST fallback (idempotent thanks to the seq filter) so the office also works without WebSockets.
      slot.poll = setInterval(() => api.events(id, seq).then((r) => r.events.forEach(apply)).catch(() => {}), 2500);
    }
    return () => {
      for (const slot of sockets.values()) {
        if (slot.poll) clearInterval(slot.poll);
        slot.closed = true;
        slot.ws?.close();
      }
    };
  }, [ids]);

  return useMemo(
    () =>
      mergeOffices(
        runs
          .filter((r) => states[r.id])
          .map((r) => {
            const tag = tagFor(r, runs.length > 1);
            return tag === undefined ? { state: states[r.id]! } : { state: states[r.id]!, tag };
          }),
      ),
    [runs, states, tagFor],
  );
}
