import type { VsPlan, VsProject, VsState } from "../../../../src/core/videostudio/plan-types";

const BUSY: ReadonlySet<VsState> = new Set<VsState>(["planning", "generating", "editing", "rendering"]);

export function stateIsBusy(state: VsState): boolean {
  return BUSY.has(state);
}

type ProjectExtra = { lastRender?: unknown; lastPreview?: unknown; costUsd?: unknown };

export function readLastRender(project: VsProject): string | null {
  const v = (project as VsProject & ProjectExtra).lastRender;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function readLastPreview(project: VsProject): string | null {
  const v = (project as VsProject & ProjectExtra).lastPreview;
  return typeof v === "string" && v.length > 0 ? v : null;
}

export function readCostUsd(project: VsProject): number | null {
  const v = (project as VsProject & ProjectExtra).costUsd;
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

export function hasNarration(plan: VsPlan | null | undefined): boolean {
  return !!plan?.narration?.trim();
}

export function formatClock(sec: number): string {
  const s = Math.max(0, Math.floor(Number.isFinite(sec) ? sec : 0));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}
