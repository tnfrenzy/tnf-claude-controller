import type { Dict } from "./i18n";
import type { PopupId } from "./lib/popup";
import type { ProjectSummary } from "./types";

export type PaletteAction =
  | { kind: "hash"; hash: string }
  | { kind: "env"; name: string }
  | { kind: "open"; id: PopupId };

export interface PaletteItem {
  id: string;
  group: "env" | "page";
  label: string;
  hint?: string;
  keywords: string;
  action: PaletteAction;
}

export interface PaletteData {
  projects: ProjectSummary[];
}

/** Same result as fold() in src/core/app/util.ts. */
export function foldText(s: string): string {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/gi, "d").toLowerCase();
}

function makeItem(id: string, group: PaletteItem["group"], label: string, hint: string | undefined, action: PaletteAction): PaletteItem {
  const keywords = foldText([label, hint ?? "", id].join(" "));
  const base = { id, group, label, keywords, action };
  return hint ? { ...base, hint } : base;
}

export function buildPaletteItems(input: { data: PaletteData; t: Dict; shortcuts?: Record<string, string> }): PaletteItem[] {
  const { data, t } = input;
  const keyHint = (id: string): string | undefined => {
    const k = input.shortcuts?.[id];
    return k ? `Alt+${k}` : undefined;
  };
  const items: PaletteItem[] = [];
  const pages: Array<[PopupId, string]> = [
    ["cmd", t.nav_cmd],
    ["history", t.nav_history],
    ["library", t.nav_library],
    ["settings", t.ss_settings],
  ];
  for (const [id, label] of pages) items.push(makeItem(`page:${id}`, "page", label, keyHint(`page:${id}`), { kind: "open", id }));
  for (const p of data.projects) items.push(makeItem(`env:${p.name}`, "env", p.name, keyHint(`env:${p.name}`), { kind: "env", name: p.name }));
  return items;
}

export function filterPaletteItems(items: PaletteItem[], query: string): PaletteItem[] {
  const words = foldText(query).split(/\s+/).filter(Boolean);
  if (words.length === 0) return items;
  return items.filter((it) => words.every((w) => it.keywords.includes(w)));
}
