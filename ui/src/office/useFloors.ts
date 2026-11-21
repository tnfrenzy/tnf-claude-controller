import { useCallback, useEffect, useState } from "react";
import { api } from "../api";
import { projectsToFloors } from "./floors";
import type { Floor } from "./floors";
import { floorSub } from "./floor-sub";
import type { Lang } from "../i18n";

function readLang(): Lang {
  try {
    return localStorage.getItem("tnf.lang") === "en" ? "en" : "vi";
  } catch {
    return "vi";
  }
}

/** Floors from GET /api/projects plus running runs from GET /api/runs?status=running, refreshed on a timer (no WebSocket). */
export function useFloors(intervalMs = 5000): { floors: Floor[]; total: number; reload: () => void } {
  const [state, setState] = useState<{ floors: Floor[]; total: number }>({ floors: [], total: 0 });
  const load = useCallback(async () => {
    try {
      const { projects } = await api.projects();
      const anyRunning = projects.some((p) => p.running > 0);
      const runs = anyRunning ? (await api.listRuns({ status: "running" })).runs : [];
      const floors = projectsToFloors(projects, runs).map((f) => {
        const run = f.running ? runs.find((r) => r.project === f.name) : undefined;
        const step = floorSub(run, undefined, readLang());
        return step ? { ...f, sub: step } : f;
      });
      setState({ floors, total: projects.filter((p) => p.name !== "default").length });
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
  return { floors: state.floors, total: state.total, reload: () => void load() };
}
