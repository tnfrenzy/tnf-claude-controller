import type { NormalizedEvent } from "../types";

export type ChipState = "idle" | "working" | "done" | "error";

export interface RoleChip {
  role: string;
  state: ChipState;
}

export interface ChipsState {
  chips: RoleChip[];
  /** agent_id -> role, learned from agent.started (agent.finished only carries the id). */
  agents: Record<string, string>;
}

/** All roles idle; used when a project has no running run. */
export function initialChips(roles: string[]): ChipsState {
  return { chips: roles.map((role) => ({ role, state: "idle" as ChipState })), agents: {} };
}

function setRole(chips: RoleChip[], role: string, state: ChipState): RoleChip[] {
  if (chips.some((c) => c.role === role)) return chips.map((c) => (c.role === role ? { ...c, state } : c));
  return [...chips, { role, state }];
}

/** Pure reducer over normalized events: agent.started -> working, agent.finished -> done/error. Other events are ignored. */
export function reduceChips(state: ChipsState, e: NormalizedEvent): ChipsState {
  if (e.type === "agent.started") {
    return { chips: setRole(state.chips, e.role, "working"), agents: { ...state.agents, [e.agent_id]: e.role } };
  }
  if (e.type === "agent.finished") {
    const role = state.agents[e.agent_id];
    if (!role) return state;
    const ok = !e.status || e.status === "completed";
    return { ...state, chips: setRole(state.chips, role, ok ? "done" : "error") };
  }
  return state;
}
