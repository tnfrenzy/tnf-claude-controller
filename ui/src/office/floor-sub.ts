import { roleLabel, type Lang } from "../i18n";

export type SubRun = { status?: string; agents?: ReadonlyArray<{ role: string; status: string }> } | null | undefined;

/**
 * Second line of a floor plate: "bước k/n · vai" for a running run, else "".
 * roles = ordered role ids of the run; when omitted the order of first appearance in run.agents is used. Pure.
 */
export function floorSub(run: SubRun, roles: readonly string[] | undefined, lang: Lang = "vi"): string {
  if (!run || run.status !== "running") return "";
  const agents = run.agents ?? [];
  let order = roles && roles.length > 0 ? [...roles] : [];
  if (order.length === 0) for (const a of agents) if (!order.includes(a.role)) order.push(a.role);
  let current = "";
  for (const a of agents) if (a.status === "running") current = a.role;
  const k = current ? order.indexOf(current) + 1 : 0;
  if (k <= 0) return "";
  return `${lang === "vi" ? "bước" : "step"} ${k}/${order.length} · ${roleLabel(current, lang)}`;
}
