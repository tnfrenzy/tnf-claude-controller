// Remembers (in localStorage) scout proposals the user skipped, per environment (project), so the scout prompt can forbid re-proposing them.
export const SKIPPED_KEY = "tnf.scoutSkipped";
export const MAX_PROJECTS = 20;
export const MAX_ITEMS_PER_PROJECT = 30;
export const MAX_TITLE = 120;
export const MAX_FEATURE = 200;
const MAX_RAW_CHARS = 256 * 1024;

export type SkippedItem = { title: string; feature: string };
type Store = Map<string, SkippedItem[]>;

function getStorage(): Storage | undefined {
  try {
    return (globalThis as { localStorage?: Storage }).localStorage ?? undefined;
  } catch {
    return undefined;
  }
}

function cleanItem(value: unknown): SkippedItem | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return null;
  const v = value as { title?: unknown; feature?: unknown };
  if (typeof v.title !== "string") return null;
  const title = v.title.trim().slice(0, MAX_TITLE);
  if (!title) return null;
  const feature = typeof v.feature === "string" ? v.feature.trim().slice(0, MAX_FEATURE) : "";
  return { title, feature };
}

function dedupe(items: SkippedItem[]): SkippedItem[] {
  // keep the newest occurrence of each title (case-insensitive), preserving order of the survivors
  const seen = new Set<string>();
  const out: SkippedItem[] = [];
  for (let i = items.length - 1; i >= 0; i--) {
    const it = items[i];
    if (!it) continue;
    const key = it.title.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.unshift(it);
  }
  return out.slice(-MAX_ITEMS_PER_PROJECT);
}

function cleanItems(value: unknown): SkippedItem[] {
  if (!Array.isArray(value)) return [];
  const items: SkippedItem[] = [];
  for (const raw of value) {
    const it = cleanItem(raw);
    if (it) items.push(it);
  }
  return dedupe(items);
}

/** Map (not a plain object) so a "__proto__" project name is just a key. Never throws. */
function readStore(): Store {
  const store: Store = new Map();
  try {
    const raw = getStorage()?.getItem(SKIPPED_KEY);
    if (typeof raw !== "string" || raw.length > MAX_RAW_CHARS) return store;
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null || Array.isArray(data)) return store;
    if (!Object.hasOwn(data, "v") || (data as { v: unknown }).v !== 1) return store;
    if (!Object.hasOwn(data, "projects")) return store;
    const projects: unknown = (data as { projects: unknown }).projects;
    if (typeof projects !== "object" || projects === null || Array.isArray(projects)) return store;
    for (const [name, value] of Object.entries(projects)) {
      if (!name || name.length > 200) continue;
      store.set(name, cleanItems(value));
    }
    while (store.size > MAX_PROJECTS) store.delete(store.keys().next().value as string);
  } catch {
    return new Map();
  }
  return store;
}

function writeStore(store: Store): void {
  try {
    getStorage()?.setItem(SKIPPED_KEY, JSON.stringify({ v: 1, projects: Object.fromEntries(store) }));
  } catch {
    // quota or private mode: ignore
  }
}

/** Oldest first, newest last. */
export function loadSkipped(project: string): SkippedItem[] {
  if (typeof project !== "string" || !project) return [];
  return [...(readStore().get(project) ?? [])];
}

export function addSkipped(project: string, item: SkippedItem): SkippedItem[] {
  if (typeof project !== "string" || !project || project.length > 200) return loadSkipped(project);
  const clean = cleanItem(item);
  if (!clean) return loadSkipped(project);
  const store = readStore();
  const items = dedupe([...(store.get(project) ?? []), clean]);
  store.delete(project); // re-insert so this project becomes the newest
  store.set(project, items);
  while (store.size > MAX_PROJECTS) store.delete(store.keys().next().value as string);
  writeStore(store);
  return [...items];
}
