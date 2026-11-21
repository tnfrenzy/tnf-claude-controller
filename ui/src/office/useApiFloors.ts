import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { summarizeFloor, type ApiFloorSummary } from "./api-staff";
import type { PublicConnection } from "../../../src/core/shared-types";

export type ApiFloor = PublicConnection & { summary: ApiFloorSummary };

/** API tower floors: the connection list plus one staff call per connection, on a timer (the server caches for 5 s). */
export function useApiFloors(intervalMs = 10_000): { floors: ApiFloor[]; max: number; defaultPath: string; reload: () => void } {
  const [state, setState] = useState<{ floors: ApiFloor[]; max: number; defaultPath: string }>({ floors: [], max: 5, defaultPath: "/api/monitor/nhan-vien-ao" });
  const load = useCallback(async () => {
    try {
      const { connections, max, defaultPath } = await api.connections();
      const floors = await Promise.all(
        connections.map(async (c) => {
          const r = await api.connectionStaff(c.id).catch(() => null);
          return { ...c, summary: summarizeFloor(r) };
        }),
      );
      setState({ floors, max, defaultPath });
    } catch {
      /* keep the previous state; the next tick retries */
    }
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
