import { useEffect, useMemo, useState } from "react";
import { api } from "../api";
import { SHARED_PROJECT, type FloorRun } from "./iso/floors";
import type { RunRecord } from "../types";

/** Newest running run of the project (empty project = shared floor), or null. Pure. */
export function pickLatestRun<T extends FloorRun>(runs: readonly T[], projectName: string): T | null {
  const want = projectName || SHARED_PROJECT;
  let best: T | null = null;
  for (const r of runs) {
    if ((r.project || SHARED_PROJECT) !== want || r.status !== "running") continue;
    if (!best || r.created_at > best.created_at) best = r;
  }
  return best;
}

/**
 * Polls the project's runs every 3 s and returns the newest running one plus its role ids.
 * enabled=false: no polling at all (so only one place polls at a time).
 */
export function useProjectRun(projectName: string, enabled: boolean): { run: RunRecord | null; runs: RunRecord[]; roles: string[] } {
  const [runs, setRuns] = useState<RunRecord[]>([]);
  const [roles, setRoles] = useState<string[]>([]);

  useEffect(() => {
    if (!enabled) return;
    let alive = true;
    const load = () => api.listRuns({ project: projectName, limit: 20 }).then((r) => alive && setRuns(r.runs)).catch(() => {});
    load();
    const id = setInterval(load, 3000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [projectName, enabled]);

  const run = useMemo(() => pickLatestRun(runs, projectName), [runs, projectName]);
  const runId = run ? run.id : null;

  useEffect(() => {
    if (!enabled || !runId) {
      setRoles([]);
      return;
    }
    let alive = true;
    api.runRoles(runId).then((r) => alive && setRoles(r.roles.map((x) => x.id))).catch(() => {});
    return () => {
      alive = false;
    };
  }, [runId, enabled]);

  return { run, runs, roles };
}
