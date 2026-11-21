import { useCallback, useEffect, useRef, useState } from "react";
import { api } from "../api";
import type { VsListItem } from "../../../src/core/videostudio/plan-types";
import { anyVsBusy } from "./videostudio-floors";

const BUSY_MS = 5_000;
const IDLE_MS = 30_000;

/**
 * Video Studio tower: GET /api/videostudio. Reloads every 5 s while a project is busy, every 30 s otherwise;
 * the previous list is kept when a request fails (the engine may answer 503 while unavailable).
 */
export function useVideoStudioFloors(): { projects: VsListItem[]; reload: () => void } {
  const [projects, setProjects] = useState<VsListItem[]>([]);
  const busy = useRef(false);
  const load = useCallback(async () => {
    try {
      const r = await api.videoStudioList();
      const list = Array.isArray(r.projects) ? r.projects : [];
      busy.current = anyVsBusy(list);
      setProjects(list);
    } catch {
      /* keep the previous state */
    }
  }, []);
  useEffect(() => {
    void load();
    let last = Date.now();
    const id = setInterval(() => {
      if (document.hidden) return;
      const due = busy.current ? BUSY_MS : IDLE_MS;
      if (Date.now() - last >= due - 200) {
        last = Date.now();
        void load();
      }
    }, BUSY_MS);
    return () => clearInterval(id);
  }, [load]);
  return { projects, reload: () => void load() };
}
