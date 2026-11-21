// Pure helpers of the API tower: where each employee of an API floor sits in the 2.5D office and what state shows.
import type { Employee, StaffResult } from "../../../src/core/shared-types";
import { pick } from "../lib/lang";
import type { DeskGroup, OfficeLayout } from "./layout";
import type { OfficeAgent } from "./model";
import type { Resident } from "./staff";

export type EmployeeState = "working" | "lockwait" | "paused" | "unwired" | "failed" | "idle";

/** Order matters: a paused person is paused even when jobs are still counted as processing. */
export function stateOf(e: Employee): EmployeeState {
  if (e.paused) return "paused";
  if (!e.queueKnown || !e.counts) return "unwired";
  if (e.counts.processing > 0) return "working";
  if (e.counts.pending > 0 && e.waitingLock) return "lockwait";
  if (e.counts.failed > 0) return "failed";
  return "idle";
}

/** Department key -> the office rooms (desk groups) that room of the 2.5D building stands for. */
const PREFERRED: Record<string, DeskGroup[]> = {
  sales: ["analyst"],
  acc: ["critic", "implementer"],
  eng: ["qa", "debug"],
};
const DEFAULT_PREFERRED: DeskGroup[] = ["subagent"];

export interface Placement {
  residents: Resident[];
  agents: OfficeAgent[];
  /** Employees that did not fit (the building seats one person per desk). */
  overflow: Employee[];
}

/**
 * One resident per employee, each at their own desk. Same department -> same room; a full room spills into any other
 * room (the command room last). Deterministic: sorted by department then name.
 */
export function placeEmployees(employees: readonly Employee[], layout: Pick<OfficeLayout, "desks">): Placement {
  const free = layout.desks.map((d) => ({ group: d.group, seat: d.seat }));
  const take = (groups: readonly DeskGroup[]) => {
    const i = free.findIndex((d) => groups.includes(d.group));
    return i < 0 ? null : free.splice(i, 1)[0]!;
  };
  const sorted = [...employees].sort((a, b) => (a.department ?? "~").localeCompare(b.department ?? "~") || a.name.localeCompare(b.name));
  const residents: Resident[] = [];
  const agents: OfficeAgent[] = [];
  const overflow: Employee[] = [];
  for (const e of sorted) {
    const desk =
      take(PREFERRED[e.department ?? ""] ?? DEFAULT_PREFERRED) ??
      take(["analyst", "critic", "implementer", "qa", "debug", "subagent"]) ??
      take(["coordinator"]);
    if (!desk) {
      overflow.push(e);
      continue;
    }
    const id = "emp-" + e.id;
    residents.push({ id, role: e.name, group: desk.group, seat: desk.seat });
    if (stateOf(e) === "working") {
      agents.push({
        id: "job-" + e.id,
        role: e.name,
        parent_id: null,
        group: desk.group,
        seat: desk.seat,
        phase: "working",
        activity: "typing",
        bubble: null,
        tools: 0,
        tokens: 0,
        startedAt: 0,
        ok: true,
        residentId: id,
      });
    }
  }
  return { residents, agents, overflow };
}

export type FloorBadge = "ok" | "working" | "attention" | "down";

export interface ApiFloorSummary {
  badge: FloorBadge;
  working: number;
  failed: number;
  total: number;
  text: string;
}

/** Tower plate of one API floor: Vietnamese one-liner plus a colour badge. */
export function summarizeFloor(r: StaffResult | null): ApiFloorSummary {
  if (!r) return { badge: "down", working: 0, failed: 0, total: 0, text: pick("Đang kết nối...", "Connecting...") };
  if (!r.ok) return { badge: "down", working: 0, failed: 0, total: 0, text: pick("Mất kết nối", "Disconnected") };
  const states = r.employees.map(stateOf);
  const working = states.filter((s) => s === "working").length;
  const failed = states.filter((s) => s === "failed").length;
  const total = r.employees.length;
  const badge: FloorBadge = failed > 0 ? "attention" : working > 0 ? "working" : "ok";
  const text = pick(`${total} nhân viên · ${working} đang làm${failed ? ` · ${failed} lỗi` : ""}`, `${total} staff · ${working} working${failed ? ` · ${failed} failed` : ""}`);
  return { badge, working, failed, total, text };
}
