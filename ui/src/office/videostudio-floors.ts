/* Pure mapping from Video Studio projects (GET /api/videostudio) to the floors of the 5th tower in the city scene. */
import type { VsListItem } from "../../../src/core/videostudio/plan-types";

export const MAX_VS_FLOORS = 5;

export type VsBadge = "running" | "done" | "failed" | "idle";
export type VsDisplayFloor = { slug: string; name: string; badge: VsBadge; running: boolean; state: string };

/** Working states -> running, done -> done, failed -> failed; draft, ready and unknown states -> idle. */
export function vsBadge(state: string): VsBadge {
  switch (state) {
    case "planning":
    case "generating":
    case "editing":
    case "rendering":
      return "running";
    case "done":
      return "done";
    case "failed":
      return "failed";
    default:
      return "idle";
  }
}

/** True while something is being built (the hook polls faster then). */
export function anyVsBusy(projects: readonly VsListItem[]): boolean {
  return projects.some((p) => vsBadge(p.state) === "running");
}

/** The newest MAX_VS_FLOORS projects (by updatedAt, newest first); broken items are dropped first. */
export function videoStudioTowerFloors(projects: readonly VsListItem[]): VsDisplayFloor[] {
  return projects
    .filter((p) => !!p && typeof p.slug === "string" && p.slug !== "")
    .slice()
    .sort((a, b) => String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? "")))
    .slice(0, MAX_VS_FLOORS)
    .map((p) => {
      const label = typeof p.title === "string" && p.title.trim() ? p.title.replace(/\s+/g, " ").trim() : p.slug;
      const badge = vsBadge(p.state);
      return { slug: p.slug, name: label.length > 34 ? `${label.slice(0, 33)}…` : label, badge, running: badge === "running", state: String(p.state) };
    });
}

export function canAddVideoStudio(count: number): boolean {
  return count < MAX_VS_FLOORS;
}
