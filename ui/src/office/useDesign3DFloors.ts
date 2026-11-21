import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import type { Design3DFloor, Design3DKit, Workshop3DListItem } from "../types";

interface State { floors: Design3DFloor[]; kit: Design3DKit | null; sessions: Workshop3DListItem[] }

/**
 * 3D design tower: polls GET /api/design3d (old run floors + kit) and GET /api/workshop3d (workshop sessions) on a
 * timer; each source keeps its previous state on error (the workshop engine may answer 503 while unavailable).
 */
export function useDesign3DFloors(intervalMs = 10_000): State & { reload: () => void } {
  const [state, setState] = useState<State>({ floors: [], kit: null, sessions: [] });
  const load = useCallback(async () => {
    const [d3, w3] = await Promise.allSettled([api.getDesign3D(), api.workshop3dList()]);
    setState((prev) => ({
      floors: d3.status === "fulfilled" ? d3.value.floors : prev.floors,
      kit: d3.status === "fulfilled" ? d3.value.kit : prev.kit,
      sessions: w3.status === "fulfilled" && Array.isArray(w3.value.sessions) ? w3.value.sessions : prev.sessions,
    }));
  }, []);
  useEffect(() => {
    void load();
    const id = setInterval(() => {
      if (!document.hidden) void load();
    }, intervalMs);
    return () => clearInterval(id);
  }, [load, intervalMs]);
  return { ...state, reload: () => void load() };
}
