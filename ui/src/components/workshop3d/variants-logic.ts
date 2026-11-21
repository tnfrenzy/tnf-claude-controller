// Pure logic of the "Tạo hàng loạt" tab around a master model (docs/DESIGN-3D.md 6c).
export interface VSlot { id: string; name: string; type: "material" | "part"; matched: string[]; size_mm: { w: number; d: number; h: number } | null }
export interface VOption {
  id: string;
  slot: string;
  kind: "material" | "part";
  name: string;
  command: string;
  materialId?: string;
  state: "building" | "ready" | "failed";
  error?: string;
  created: string;
}
export interface VConfig {
  id: string;
  name: string;
  choices: Record<string, string | null>;
  state: "queued" | "running" | "done" | "failed";
  error?: string;
  bytes?: number;
  created: string;
}
export interface VOverview {
  ready: boolean;
  reason: string | null;
  slots: VSlot[];
  options: VOption[];
  configs: VConfig[];
  limits: { maxConfigs: number; maxOptions: number; maxTotalConfigs: number; maxPartBytes: number };
}
export interface VMaster { slug: string; title: string; state: string }

/** Selected option ids per slot (only slots with a selection). */
export type Selection = Record<string, string[]>;

/** Number of configurations the selection makes (product of the non-empty slots); 0 when nothing is selected. */
export function comboCount(sel: Selection, slotOrder: readonly string[]): number {
  const used = slotOrder.filter((id) => (sel[id] ?? []).length > 0);
  if (used.length === 0) return 0;
  return used.reduce((n, id) => n * (sel[id]?.length ?? 0), 1);
}

/** All combinations, slot order kept, e.g. for the preview matrix. */
export function combos(sel: Selection, slotOrder: readonly string[]): Record<string, string>[] {
  const used = slotOrder.filter((id) => (sel[id] ?? []).length > 0);
  let acc: Record<string, string>[] = used.length > 0 ? [{}] : [];
  for (const id of used) {
    const next: Record<string, string>[] = [];
    for (const base of acc) for (const opt of sel[id]!) next.push({ ...base, [id]: opt });
    acc = next;
  }
  return acc;
}

/** Keeps the selection consistent with the options that exist; options that just became ready are selected by default (once). */
export function syncSelection(sel: Selection, options: readonly VOption[], seen: ReadonlySet<string>): { sel: Selection; seen: Set<string> } {
  const nextSeen = new Set(seen);
  const out: Selection = {};
  for (const o of options) {
    if (o.state !== "ready") continue;
    const had = (sel[o.slot] ?? []).includes(o.id);
    const fresh = !nextSeen.has(o.id);
    nextSeen.add(o.id);
    if (had || fresh) (out[o.slot] ??= []).push(o.id);
  }
  return { sel: out, seen: nextSeen };
}

export const configsBusy = (cs: readonly VConfig[]): boolean => cs.some((c) => c.state === "queued" || c.state === "running");
export const optionsBusy = (os: readonly VOption[]): boolean => os.some((o) => o.state === "building");

/** Masters = finished sessions (a variant needs a model.glb). The current session first. */
export function pickMasters(items: readonly VMaster[], current?: string): VMaster[] {
  const done = items.filter((s) => s.state === "done");
  return [...done].sort((a, b) => (a.slug === current ? -1 : b.slug === current ? 1 : 0));
}

export function sizeText(s: { w: number; d: number; h: number } | null): string {
  if (!s) return "—";
  const f = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(0));
  return `${f(s.w)} × ${f(s.d)} × ${f(s.h)} mm`;
}
