/* Pure helpers for the office stage (main screen). */

/**
 * Floor shown by default, as its project id: the saved one if it still exists, else the first floor, else "default".
 * A floor is matched by id (the project name; "default" for the ground floor, whose display name is "Tầng trệt") or,
 * for plain `{ name }` objects, by name.
 */
export function pickStageFloor(floors: readonly { id?: string; name: string }[], saved: string): string {
  const key = (f: { id?: string; name: string }) => f.id ?? f.name;
  const want = saved || "default";
  if (floors.some((f) => key(f) === want)) return want;
  return floors[0] ? key(floors[0]) : "default";
}

/** Newest finished coding run of a project (shortcut to the release button), or null. */
export function latestDoneCodingRun(runs: readonly { id: string; kind?: string; status: string; created_at: number }[]): string | null {
  let best: { id: string; created_at: number } | null = null;
  for (const r of runs) {
    if (r.kind !== "coding" || r.status !== "done") continue;
    if (!best || r.created_at > best.created_at) best = r;
  }
  return best ? best.id : null;
}
