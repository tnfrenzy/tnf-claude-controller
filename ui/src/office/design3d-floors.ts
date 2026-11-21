/* Pure mapping from 3D design runs (GET /api/design3d floors) to display floors. */
import type { Design3DFloor } from "../types.js";

export const MAX_DESIGN3D_FLOORS = 5;

export type Design3DBadge = "running" | "done" | "failed" | "idle";
export type Design3DDisplayFloor = { id: string; name: string; badge: Design3DBadge; running: boolean; sub: string };

/** Unknown statuses map to "idle". */
export function design3dBadge(status: string): Design3DBadge {
  switch (status) {
    case "running": return "running";
    case "done": return "done";
    case "error": case "cancelled": return "failed";
    default: return "idle";
  }
}

/** Broken items are dropped first, then at most MAX_DESIGN3D_FLOORS kept in order. */
export function design3dFloorsToFloors(floors: readonly Design3DFloor[]): Design3DDisplayFloor[] {
  return floors
    .filter((f) => !!f && typeof f.runId === "string" && f.runId !== "")
    .slice(0, MAX_DESIGN3D_FLOORS)
    .map((f) => {
      const title = typeof f.title === "string" ? f.title.replace(/\s+/g, " ").trim() : "";
      const label = title || f.runId;
      const name = label.length > 34 ? `${label.slice(0, 33)}…` : label;
      const badge = design3dBadge(f.status);
      const n = typeof f.fileCount === "number" && Number.isFinite(f.fileCount) && f.fileCount >= 0 ? f.fileCount : 0;
      const fmt = typeof f.primaryFormat === "string" && f.primaryFormat.length > 0 ? ` · ${f.primaryFormat.toUpperCase()}` : "";
      return { id: f.runId, name, badge, running: badge === "running", sub: `${n} file${fmt}` };
    });
}

export function canAddDesign3DFloor(count: number): boolean {
  return count < MAX_DESIGN3D_FLOORS;
}

/** i18n key of the sub-label of a waiting session floor. */
export type W3DFloorWait = "w3i_floor_wait_answer" | "w3i_floor_paused" | "w3i_floor_quota" | "w3i_floor_stopped";
export type Design3DSessionFloor = Design3DDisplayFloor & { kind: "session"; wait: W3DFloorWait | null };
export type Design3DRunFloor = Design3DDisplayFloor & { kind: "run" };
export type Design3DAnyFloor = Design3DSessionFloor | Design3DRunFloor;

/** Badge and waiting sub-label of a 3D workshop session state (unknown states: idle, no sub-label). */
export function workshop3dBadge(state: string): { badge: Design3DBadge; wait: W3DFloorWait | null } {
  switch (state) {
    case "done": return { badge: "done", wait: null };
    case "failed": return { badge: "failed", wait: null };
    case "stopped": return { badge: "failed", wait: "w3i_floor_stopped" };
    case "awaiting_user": return { badge: "idle", wait: "w3i_floor_wait_answer" };
    case "paused": return { badge: "idle", wait: "w3i_floor_paused" };
    case "waiting_quota": return { badge: "idle", wait: "w3i_floor_quota" };
    case "intake": case "art": case "planning": case "modeling": case "building": case "materials":
    case "rendering": case "reviewing": case "optimizing": case "presenting":
    case "hqrender": case "hqreview": case "hqmaterials":
      return { badge: "running", wait: null };
    default: return { badge: "idle", wait: null };
  }
}

function floorName(title: unknown, fallback: string): string {
  const t = typeof title === "string" ? title.replace(/\s+/g, " ").trim() : "";
  const label = t || fallback;
  return label.length > 34 ? `${label.slice(0, 33)}…` : label;
}

/** Workshop sessions first (newest first, as the API lists them), then the old run floors, capped at MAX_DESIGN3D_FLOORS. */
export function workshop3dTowerFloors(
  sessions: readonly { slug: string; title: string; state: string; costUsd?: number | undefined }[],
  runs: readonly Design3DFloor[],
): Design3DAnyFloor[] {
  const out: Design3DAnyFloor[] = [];
  for (const s of sessions) {
    if (!s || typeof s.slug !== "string" || s.slug === "") continue;
    const { badge, wait } = workshop3dBadge(typeof s.state === "string" ? s.state : "");
    const cost = typeof s.costUsd === "number" && Number.isFinite(s.costUsd) && s.costUsd > 0 ? `~$${s.costUsd.toFixed(2)}` : "";
    out.push({ kind: "session", id: s.slug, name: floorName(s.title, s.slug), badge, running: badge === "running", sub: cost, wait });
  }
  for (const f of design3dFloorsToFloors(runs)) out.push({ ...f, kind: "run" });
  return out.slice(0, MAX_DESIGN3D_FLOORS);
}
