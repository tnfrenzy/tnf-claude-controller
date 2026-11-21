import { recall, remember } from "./lib/prefs";

/** Persistent keyboard shortcut configuration (Settings → Phím tắt). Page and environment shortcuts are Alt + letter. */
export const PREF_SHORTCUTS = "tnf.shortcuts";
export const SHORTCUTS_EVENT = "tnf:shortcuts";
export const DEFAULT_PALETTE_KEY = "K";

export interface ShortcutsConfig {
  /** Letter that opens the command palette together with Ctrl (default K). */
  palette: string;
  /** Item id ("page:cmd", "env:<name>") → one letter/digit; "" means the user cleared it; missing means the default. */
  keys: Record<string, string>;
}

export const PAGE_SHORTCUTS: ReadonlyArray<readonly [string, string]> = [
  ["page:cmd", "R"],
  ["page:history", "H"],
  ["page:library", "T"],
  ["page:settings", "J"],
];

/** One upper-case letter or digit, or "" when the text holds none. */
export function normalizeKey(s: string): string {
  const m = String(s ?? "").toUpperCase().match(/[A-Z0-9]/);
  return m ? m[0] : "";
}

export function defaultConfig(): ShortcutsConfig {
  return { palette: DEFAULT_PALETTE_KEY, keys: {} };
}

export function parseShortcuts(raw: string): ShortcutsConfig {
  try {
    const v: unknown = JSON.parse(raw || "{}");
    if (!v || typeof v !== "object") return defaultConfig();
    const o = v as { palette?: unknown; keys?: unknown };
    const keys: Record<string, string> = {};
    if (o.keys && typeof o.keys === "object") {
      for (const [id, k] of Object.entries(o.keys as Record<string, unknown>)) {
        if (typeof k === "string" && /^(page|env):/.test(id)) keys[id] = normalizeKey(k);
      }
    }
    return { palette: normalizeKey(typeof o.palette === "string" ? o.palette : "") || DEFAULT_PALETTE_KEY, keys };
  } catch {
    return defaultConfig();
  }
}

export function loadShortcuts(): ShortcutsConfig {
  return parseShortcuts(recall(PREF_SHORTCUTS));
}

export function saveShortcuts(c: ShortcutsConfig): void {
  remember(PREF_SHORTCUTS, JSON.stringify(c));
  try {
    window.dispatchEvent(new Event(SHORTCUTS_EVENT));
  } catch {
    /* no window (tests) */
  }
}

/**
 * Effective key per item id: the user's choice wins ("" = none); pages get their defaults; an environment gets the first
 * letter of its name that no other item uses.
 */
export function resolveShortcuts(cfg: ShortcutsConfig, envNames: readonly string[]): Record<string, string> {
  const out: Record<string, string> = {};
  const used = new Set<string>();
  const take = (id: string, k: string) => {
    out[id] = k;
    if (k) used.add(k);
  };
  for (const [id] of PAGE_SHORTCUTS) if (id in cfg.keys) take(id, cfg.keys[id] ?? "");
  for (const n of envNames) if (`env:${n}` in cfg.keys) take(`env:${n}`, cfg.keys[`env:${n}`] ?? "");
  for (const [id, def] of PAGE_SHORTCUTS) if (!(id in out)) take(id, used.has(def) ? "" : def);
  for (const n of envNames) {
    const id = `env:${n}`;
    if (id in out) continue;
    const letters = n.toUpperCase().split("").filter((c) => /[A-Z0-9]/.test(c));
    take(id, letters.find((c) => !used.has(c)) ?? "");
  }
  return out;
}

/** Ids whose effective key is shared with another id (shown as a warning in Settings). */
export function duplicateKeys(map: Record<string, string>): string[] {
  const seen = new Map<string, number>();
  for (const k of Object.values(map)) if (k) seen.set(k, (seen.get(k) ?? 0) + 1);
  return [...seen.entries()].filter(([, n]) => n > 1).map(([k]) => k);
}

export type KeyEventLike = { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey?: boolean; isComposing?: boolean };

export function isPaletteKey(e: KeyEventLike, letter: string = DEFAULT_PALETTE_KEY): boolean {
  return e.key.toUpperCase() === letter.toUpperCase() && (e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && !e.isComposing;
}

/** Item id for an Alt + letter press, or null. */
export function matchShortcut(map: Record<string, string>, e: KeyEventLike): string | null {
  if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.isComposing) return null;
  const k = normalizeKey(e.key);
  if (!k || e.key.length !== 1) return null;
  for (const [id, key] of Object.entries(map)) if (key === k) return id;
  return null;
}
