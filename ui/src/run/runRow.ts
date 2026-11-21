/** Pure helpers for the run list cards (RunsPage / HistoryPage): status icon, grouped roles, one-line meta, project hue. */

export type StatusTone = "run" | "ok" | "err" | "warn" | "muted";
export interface StatusVisual {
  icon: string;
  tone: StatusTone;
  /** Only a running run pulses (CSS also honours prefers-reduced-motion). */
  pulse: boolean;
}

export function statusVisual(status: string): StatusVisual {
  switch (status) {
    case "running":
      return { icon: "▶", tone: "run", pulse: true };
    case "done":
      return { icon: "✓", tone: "ok", pulse: false };
    case "error":
      return { icon: "✕", tone: "err", pulse: false };
    case "cancelled":
      return { icon: "■", tone: "warn", pulse: false };
    default:
      return { icon: "•", tone: "muted", pulse: false };
  }
}

export interface GroupedRoles {
  items: { role: string; count: number }[];
  /** How many more distinct roles were cut off after `max`. */
  more: number;
}

/** Merge repeated roles ("subagent" x12), keep first-appearance order, show at most `max` distinct roles. */
export function groupRoles(roles: readonly string[], max = 3): GroupedRoles {
  const order: string[] = [];
  const counts = new Map<string, number>();
  for (const r of roles) {
    if (!counts.has(r)) order.push(r);
    counts.set(r, (counts.get(r) ?? 0) + 1);
  }
  const items = order.slice(0, max).map((role) => ({ role, count: counts.get(role) ?? 0 }));
  return { items, more: Math.max(0, order.length - max) };
}

/** "32 s", "4 ph 05 s", "1 g 02 ph". Empty string when unknown (0 or negative). */
export function formatDuration(ms: number): string {
  if (!(ms > 0)) return "";
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} ph ${String(s % 60).padStart(2, "0")} s`;
  return `${Math.floor(m / 60)} g ${String(m % 60).padStart(2, "0")} ph`;
}

export interface MetaInput {
  created_at: number;
  cost_usd_est: number;
  duration_ms: number;
}

/** Parts of the one muted line under the prompt, in order: when, cost, duration. Empty parts are dropped. */
export function metaParts(run: MetaInput, fmtCost: (n: number) => string, fmtWhen: (ms: number) => string): string[] {
  const parts = [fmtWhen(run.created_at)];
  if (run.cost_usd_est > 0) parts.push(fmtCost(run.cost_usd_est));
  const d = formatDuration(run.duration_ms);
  if (d) parts.push(d);
  return parts;
}

/** Stable hue 0..359 from a project name (same name, same colour in every list). */
export function projectHue(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % 360;
}
