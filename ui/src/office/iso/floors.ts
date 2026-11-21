// Pure mapping from the run list to "floors" (one floor per project). No DOM, no React.

export interface FloorRun {
  id: string;
  project: string;
  status: string;
  created_at: number;
}

export interface Floor {
  /** Project name; "default" means the shared floor (runs without a project). */
  project: string;
  /** 1-based floor number (stable: sorted with the shared floor first, then by name). */
  number: number;
  /** Newest running run of the project, or null when idle (the office then shows default roles). */
  runId: string | null;
  running: boolean;
}

export const SHARED_PROJECT = "default";

export function floorsFromRuns(runs: readonly FloorRun[]): Floor[] {
  const byProject = new Map<string, FloorRun | null>();
  for (const r of runs) {
    const project = r.project || SHARED_PROJECT;
    const cur = byProject.get(project);
    if (!byProject.has(project)) byProject.set(project, null);
    if (r.status !== "running") continue;
    if (!cur || r.created_at > cur.created_at) byProject.set(project, r);
  }
  // The shared floor always exists, so an empty office still has somewhere to click.
  if (!byProject.has(SHARED_PROJECT)) byProject.set(SHARED_PROJECT, null);
  const names = [...byProject.keys()].sort((a, b) => (a === SHARED_PROJECT ? -1 : b === SHARED_PROJECT ? 1 : a.localeCompare(b)));
  return names.map((project, i) => {
    const run = byProject.get(project) ?? null;
    return { project, number: i + 1, runId: run ? run.id : null, running: run !== null };
  });
}
