/** Small persistent preferences (survive closing the app window). Storage errors are swallowed. */

import { clampZoom } from "../office/zoom.js";
import { SCOUT_FOCUS_IDS, type ScoutFocus } from "../queue/scoutAgent";
import { pruneOpenState } from "../run/runTree";

export const PREF_PROJECT ="tnf.project";
export const PREF_VIEW = "tnf.view";
export const PREF_AVATARS = "tnf.avatars";
export const PREF_AVATAR_STYLE = "tnf.avatarStyle";

export const PREF_NOTIFY = "tnf.notify";
export const PREF_SCOUT_HIDDEN = "tnf.scoutHidden";

/** Ids of scout runs the user deleted from the "Đề xuất" tab (the run itself stays in the database). */
export function loadScoutHidden(): string[] {
  try {
    const v: unknown = JSON.parse(recall(PREF_SCOUT_HIDDEN) || "[]");
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(-500) : [];
  } catch {
    return [];
  }
}

export function hideScoutRun(id: string): string[] {
  const next = [...new Set([...loadScoutHidden(), id])].slice(-500);
  remember(PREF_SCOUT_HIDDEN, JSON.stringify(next));
  return next;
}
export const PREF_SCOUT_FOCUS = "tnf.scoutFocus";

/** Saved scout focus groups; unknown values dropped, empty/missing means all groups. */
export function loadScoutFocus(): ScoutFocus[] {
  try {
    const v: unknown = JSON.parse(recall(PREF_SCOUT_FOCUS) || "[]");
    const picked = Array.isArray(v) ? SCOUT_FOCUS_IDS.filter((id) => v.includes(id)) : [];
    return picked.length > 0 ? picked : [...SCOUT_FOCUS_IDS];
  } catch {
    return [...SCOUT_FOCUS_IDS];
  }
}

export function saveScoutFocus(ids: ScoutFocus[]): void {
  remember(PREF_SCOUT_FOCUS, JSON.stringify(SCOUT_FOCUS_IDS.filter((id) => ids.includes(id))));
}

export const PREF_RUN_TREE_OPEN = "tnf.runTreeOpen";
const RUN_TREE_OPEN_MAX = 300;

/** Expanded/collapsed choice per thread root id (only threads the user toggled are stored). */
export function loadRunTreeOpen(): Record<string, boolean> {
  try {
    return pruneOpenState(JSON.parse(recall(PREF_RUN_TREE_OPEN) || "{}"), RUN_TREE_OPEN_MAX);
  } catch {
    return {};
  }
}

/** Save one thread's choice; the newest choices are kept when the map grows past the cap. */
export function saveRunTreeOpen(rootId: string, open: boolean): Record<string, boolean> {
  const cur = loadRunTreeOpen();
  delete cur[rootId];
  cur[rootId] = open;
  const next = pruneOpenState(cur, RUN_TREE_OPEN_MAX);
  remember(PREF_RUN_TREE_OPEN, JSON.stringify(next));
  return next;
}

export const PREF_OFFICE_ZOOM = "tnf.officeZoom";

/** Saved office zoom scale, or null when missing/invalid. */
export function loadOfficeZoom(): number | null {
  const raw = recall(PREF_OFFICE_ZOOM);
  if (!raw) return null;
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return clampZoom(n);
}

export function saveOfficeZoom(scale: number): void {
  remember(PREF_OFFICE_ZOOM, String(scale));
}

/** Run-finished notifications toggle; default off. */
export function getNotify(): boolean {
  return recall(PREF_NOTIFY) === "1";
}

export function setNotify(on: boolean): void {
  remember(PREF_NOTIFY, on ? "1" : "");
}

export function remember(key: string, value: string): void {
  try {
    if (value) localStorage.setItem(key, value);
    else localStorage.removeItem(key);
  } catch {
    /* ignore (private mode, blocked storage) */
  }
}

export function recall(key: string): string {
  try {
    return localStorage.getItem(key) ?? "";
  } catch {
    return "";
  }
}
