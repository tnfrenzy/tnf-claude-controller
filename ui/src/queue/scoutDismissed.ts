// Pure-ish module: remembers (in localStorage) which scout proposals were approved-to-run or skipped, per scout run.
// Stored items are sourceRef strings `${scoutRunId}#${proposalId}`.
import { sourceRefFor } from "./scoutRef";

export const DISMISSED_KEY = "tnf.scoutDismissed";
export const MAX_RUNS = 20;
export const MAX_IDS_PER_RUN = 64;
const MAX_RAW_CHARS = 256 * 1024;
const RUN_RE = /^[A-Za-z0-9_-]{1,64}$/;
const ID_RE = /^[a-z0-9_-]{1,32}$/;

type Store = Map<string, string[]>;

function getStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function cleanIds(runId: string, value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const prefix = `${runId}#`;
  const seen = new Set<string>();
  for (const item of value) {
    if (typeof item !== "string" || !item.startsWith(prefix)) continue;
    if (!ID_RE.test(item.slice(prefix.length))) continue;
    seen.add(item);
  }
  return [...seen].slice(-MAX_IDS_PER_RUN);
}

/** Reads and sanitizes the whole store; never throws. Map (not a plain object) so a "__proto__" run id is just a key. */
function readStore(): Store {
  const store: Store = new Map();
  try {
    const raw = getStorage()?.getItem(DISMISSED_KEY);
    if (typeof raw !== "string" || raw.length > MAX_RAW_CHARS) return store;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return store;
    if (!Object.hasOwn(data, "v") || (data as { v: unknown }).v !== 1) return store;
    if (!Object.hasOwn(data, "runs")) return store;
    const runs: unknown = (data as { runs: unknown }).runs;
    if (typeof runs !== "object" || runs === null || Array.isArray(runs)) return store;
    for (const [runId, value] of Object.entries(runs)) {
      if (!RUN_RE.test(runId)) continue;
      store.set(runId, cleanIds(runId, value));
    }
    while (store.size > MAX_RUNS) store.delete(store.keys().next().value as string);
  } catch {
    return new Map();
  }
  return store;
}

function writeStore(store: Store): void {
  try {
    getStorage()?.setItem(DISMISSED_KEY, JSON.stringify({ v: 1, runs: Object.fromEntries(store) }));
  } catch {
    // quota or private mode: ignore, state stays in memory for this call only
  }
}

export function loadDismissed(scoutRunId: string): Set<string> {
  if (!RUN_RE.test(scoutRunId)) return new Set();
  return new Set(readStore().get(scoutRunId) ?? []);
}

export function markDismissed(scoutRunId: string, proposalId: string): Set<string> {
  if (!RUN_RE.test(scoutRunId) || !ID_RE.test(proposalId)) return loadDismissed(scoutRunId);
  const store = readStore();
  const ids = store.get(scoutRunId) ?? [];
  const ref = sourceRefFor(scoutRunId, proposalId);
  if (!ids.includes(ref)) ids.push(ref);
  const trimmed = ids.slice(-MAX_IDS_PER_RUN);
  store.delete(scoutRunId); // re-insert so this run becomes the newest
  store.set(scoutRunId, trimmed);
  while (store.size > MAX_RUNS) store.delete(store.keys().next().value as string);
  writeStore(store);
  return new Set(trimmed);
}

/** `set` holds sourceRef strings (as returned by loadDismissed), hence the scoutRunId parameter. */
export function filterDismissed<T extends { id: string }>(proposals: T[], set: Set<string>, scoutRunId: string): T[] {
  return proposals.filter((p) => !set.has(sourceRefFor(scoutRunId, p.id)));
}
