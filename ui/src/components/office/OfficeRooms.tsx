import { useCallback } from "react";
import { useOfficeAgents, type OfficeRunRef } from "../../office/useOfficeAgents";
import { OfficeViewport } from "./OfficeViewport";

/**
 * The office everywhere in the app: the four-room 2.5D building with zoom and pan. Follows the given runs' events
 * (their agents walk in from the front door to their seats); resident staff are always there, runs or not.
 * Timers and sockets exist only while this is mounted.
 */
export function OfficeRooms({ runs, running }: { runs: readonly OfficeRunRef[]; running: boolean }) {
  const tagFor = useCallback((r: OfficeRunRef, many: boolean) => (many ? r.id.slice(-6) : undefined), []);
  const agents = useOfficeAgents(runs, tagFor);
  return <OfficeViewport agents={agents} running={running} />;
}
