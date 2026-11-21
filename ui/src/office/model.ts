/**
 * Pure state model for the built-in 2.5D office: folds the controller's normalized
 * events into "who sits where, doing what". No React/DOM here so it is unit-testable.
 */
import type { NormalizedEvent, RunStatus, StoredEvent, Usage } from "../types";
import { DESK_GROUPS, groupForRole, type DeskGroup } from "./layout";

export type Activity = "idle" | "tool" | "typing" | "thinking";
export type Phase = "working" | "left";
export type BubbleKind = "tool" | "text" | "done" | "error" | "info";

export interface Bubble {
  kind: BubbleKind;
  text: string;
  ts: number;
}

export interface OfficeAgent {
  id: string;
  role: string;
  parent_id: string | null;
  group: DeskGroup;
  /** Seat index inside the group (0-based); may exceed the group's desk count → standing spot. */
  seat: number;
  phase: Phase;
  activity: Activity;
  bubble: Bubble | null;
  description?: string;
  tools: number;
  tokens: number;
  lastTool?: string;
  startedAt: number;
  finishedAt?: number;
  ok: boolean;
  /** Last verdict line this agent returned (critic / qa), shown as a badge on its desk. */
  verdict?: string;
  /** Set by mergeOffices: which run the agent belongs to and a short tag (project / run id) for the label. */
  runId?: string;
  tag?: string;
  /** Pin the job to one resident person (API floors: one person per employee) instead of any free person of the group. */
  residentId?: string;
}

export interface OfficeState {
  runId: string | null;
  status: RunStatus | "idle";
  model?: string;
  startedAt?: number;
  endedAt?: number;
  costUsd?: number;
  numTurns?: number;
  agents: OfficeAgent[];
  lastEventTs: number;
}

export const COORDINATOR_ID = "coordinator";
const BUBBLE_MAX = 90;

export function emptyOffice(runId: string | null = null): OfficeState {
  return { runId, status: "idle", agents: [], lastEventTs: 0 };
}

const clip = (s: string, n = BUBBLE_MAX): string => {
  const t = s.replace(/\s+/g, " ").trim();
  return t.length > n ? `${t.slice(0, n - 1)}…` : t;
};

/** Lowest seat index in `group` not held by a working agent. */
function freeSeat(agents: OfficeAgent[], group: DeskGroup): number {
  const taken = new Set(agents.filter((a) => a.group === group && a.phase === "working").map((a) => a.seat));
  let i = 0;
  while (taken.has(i)) i++;
  return i;
}

function ensureAgent(state: OfficeState, id: string, role: string, parent: string | null, ts: number, description?: string): OfficeState {
  if (state.agents.some((a) => a.id === id)) return state;
  const group = groupForRole(role);
  const agent: OfficeAgent = {
    id,
    role,
    parent_id: parent,
    group,
    seat: freeSeat(state.agents, group),
    phase: "working",
    activity: "idle",
    bubble: description ? { kind: "info", text: clip(description), ts } : null,
    tools: 0,
    tokens: 0,
    startedAt: ts,
    ok: true,
  };
  if (description) agent.description = description;
  return { ...state, agents: [...state.agents, agent] };
}

function patch(state: OfficeState, id: string, f: (a: OfficeAgent) => OfficeAgent): OfficeState {
  let hit = false;
  const agents = state.agents.map((a) => {
    if (a.id !== id) return a;
    hit = true;
    return f(a);
  });
  return hit ? { ...state, agents } : state;
}

function finishAll(state: OfficeState, ts: number, ok: boolean): OfficeState {
  return {
    ...state,
    endedAt: ts,
    agents: state.agents.map((a) => (a.phase === "working" ? { ...a, phase: "left", finishedAt: ts, activity: "idle", ok: a.ok && ok } : a)),
  };
}

export function reduceOffice(state: OfficeState, stored: StoredEvent): OfficeState {
  const e: NormalizedEvent = stored.event;
  const ts = stored.ts;
  let s: OfficeState = { ...state, lastEventTs: Math.max(state.lastEventTs, ts) };
  switch (e.type) {
    case "run.started": {
      s = { ...s, runId: e.run_id, status: "running", startedAt: s.startedAt ?? ts };
      if (e.model) s.model = e.model;
      return ensureAgent(s, COORDINATOR_ID, "coordinator", null, ts);
    }
    case "agent.started":
      s = ensureAgent(s, e.parent_id ?? COORDINATOR_ID, e.parent_id ? "subagent" : "coordinator", null, ts);
      return ensureAgent(s, e.agent_id, e.role, e.parent_id, ts, e.description);
    case "tool.use": {
      s = ensureAgent(s, e.agent_id, e.agent_id === COORDINATOR_ID ? "coordinator" : "subagent", null, ts);
      const text = e.input_summary ? `${e.tool}: ${e.input_summary}` : e.tool;
      return patch(s, e.agent_id, (a) => ({ ...a, activity: "tool", tools: a.tools + 1, lastTool: e.tool, bubble: { kind: "tool", text: clip(text), ts } }));
    }
    case "tool.result":
      return patch(s, e.agent_id, (a) => ({
        ...a,
        activity: "idle",
        bubble: e.ok ? (a.bubble?.kind === "tool" ? null : a.bubble) : { kind: "error", text: clip(e.summary), ts },
      }));
    case "text.delta":
      return patch(s, e.agent_id, (a) => (a.activity === "typing" ? a : { ...a, activity: "typing" }));
    case "thinking.delta":
      return patch(s, e.agent_id, (a) => (a.activity === "thinking" ? a : { ...a, activity: "thinking" }));
    case "text.message":
      return patch(s, e.agent_id, (a) => ({ ...a, activity: "idle", bubble: e.text.trim() ? { kind: "text", text: clip(e.text), ts } : a.bubble }));
    case "agent.progress":
      return patch(s, e.agent_id, (a) => {
        const next: OfficeAgent = { ...a, tokens: Math.max(a.tokens, e.total_tokens), tools: Math.max(a.tools, e.tool_uses) };
        if (e.last_tool) {
          next.lastTool = e.last_tool;
          if (!a.bubble || a.bubble.kind === "info" || a.bubble.kind === "tool") next.bubble = { kind: "tool", text: e.last_tool, ts };
          next.activity = "tool";
        }
        if (e.description && !next.description) next.description = e.description;
        return next;
      });
    case "agent.finished": {
      const ok = !e.status || e.status === "completed";
      return patch(s, e.agent_id, (a) => ({
        ...a,
        phase: "left",
        finishedAt: ts,
        activity: "idle",
        ok,
        // keep a verdict bubble (it is the agent's handoff); otherwise show the finish summary
        bubble: a.verdict ? a.bubble : { kind: ok ? "done" : "error", text: clip(e.summary, 70), ts },
      }));
    }
    case "permission.denied":
      return patch(s, e.agent_id, (a) => ({ ...a, bubble: { kind: "error", text: clip(`${e.tool}: ${e.reason}`), ts } }));
    case "agent.verdict": {
      const bad = /^(NEEDS_REVISION|BLOCKED|FAIL)$/i.test(e.verdict);
      return patch(s, e.agent_id, (a) => ({ ...a, verdict: e.verdict, bubble: { kind: bad ? "error" : "done", text: `VERDICT: ${e.verdict}`, ts } }));
    }
    case "vcs.commit":
      return patch(s, e.agent_id, (a) => ({ ...a, bubble: { kind: "info", text: clip(`⎇ commit · ${e.branch}`), ts } }));
    case "run.result":
      s = { ...s, status: e.ok ? "done" : "error", costUsd: e.cost_usd_est, numTurns: e.num_turns };
      return finishAll(s, ts, e.ok);
    case "run.error":
      return finishAll({ ...s, status: "error" }, ts, false);
    case "run.cancelled":
      return finishAll({ ...s, status: "cancelled" }, ts, false);
    default:
      return s;
  }
}

export function reduceAll(events: StoredEvent[], runId: string | null = null): OfficeState {
  return events.reduce(reduceOffice, emptyOffice(runId));
}

/** Agents still visible in the scene: working ones, plus those that left within `linger` ms (walk-out animation). */
export function visibleAgents(state: OfficeState, now: number, linger = 4000): OfficeAgent[] {
  return state.agents.filter((a) => a.phase === "working" || (a.finishedAt !== undefined && now - a.finishedAt < linger));
}

/** Agents whose bubble should still be shown (bubbles fade after `ttl` ms unless the agent is mid-tool). */
export function bubbleFor(a: OfficeAgent, now: number, ttl = 12000): Bubble | null {
  if (!a.bubble) return null;
  if (a.activity === "tool" && a.bubble.kind === "tool") return a.bubble;
  return now - a.bubble.ts < ttl ? a.bubble : null;
}

/** Id of the single coordinator character shown when several runs are merged. */
export const MERGED_COORDINATOR_ID = "coordinator*";

/** Sum several usages; undefined when there is none. */
export function sumUsage(list: (Usage | undefined)[]): Usage | undefined {
  const us = list.filter((u): u is Usage => !!u);
  if (us.length === 0) return undefined;
  return us.reduce(
    (n, u) => ({ input: n.input + u.input, output: n.output + u.output, cache_read: n.cache_read + u.cache_read, cache_write: n.cache_write + u.cache_write }),
    { input: 0, output: 0, cache_read: 0, cache_write: 0 },
  );
}

type TaggedAgent = OfficeAgent & { runId: string; tag: string };

function mergeCoordinators(coords: TaggedAgent[]): OfficeAgent {
  const base = coords[0]!;
  const working = coords.filter((c) => c.phase === "working");
  const tags = (working.length ? working : coords).map((c) => c.tag).filter(Boolean);
  const source = working
    .filter((c) => c.bubble)
    .sort((a, b) => b.bubble!.ts - a.bubble!.ts)[0] ?? base;
  const merged: OfficeAgent = {
    ...base,
    id: MERGED_COORDINATOR_ID,
    group: "coordinator",
    seat: 0,
    runId: base.runId,
    tools: coords.reduce((n, c) => n + c.tools, 0),
    tokens: coords.reduce((n, c) => n + c.tokens, 0),
    bubble: source.bubble,
    activity: source.activity,
  };
  if (source.lastTool !== undefined) merged.lastTool = source.lastTool;
  else delete merged.lastTool;
  if (tags.length) merged.tag = tags.join(", ");
  else delete merged.tag;
  if (working.length) {
    merged.phase = "working";
    merged.ok = true;
    delete merged.finishedAt;
  } else {
    merged.phase = "left";
    merged.ok = coords.every((c) => c.ok);
    const fins = coords.map((c) => c.finishedAt).filter((t): t is number => t !== undefined);
    if (fins.length) merged.finishedAt = Math.max(...fins);
    else delete merged.finishedAt;
  }
  return merged;
}

/**
 * Combine several runs into one office: agents keep their order of arrival, seats are
 * re-assigned globally so two runs never share a desk. Ids are prefixed by run id.
 * With two or more coordinators (concurrent runs) they collapse into ONE character with id
 * MERGED_COORDINATOR_ID (seat 0, tag lists the running runs, `left` only when all have ended).
 * Note: when a second run arrives, the coordinator's id changes from `runId:coordinator`
 * to MERGED_COORDINATOR_ID, so consumers keyed on id will see one character replaced by another.
 */
export function mergeOffices(states: { state: OfficeState; tag?: string | undefined }[]): OfficeAgent[] {
  const all = states
    .flatMap(({ state, tag }) => state.agents.map((a) => ({ ...a, runId: state.runId ?? "", tag: tag ?? "" })))
    .sort((a, b) => a.startedAt - b.startedAt);
  const coords = all.filter((a) => a.id === COORDINATOR_ID);
  const mergedCoord = coords.length >= 2 ? mergeCoordinators(coords) : null;
  const base = mergedCoord ? coords[0] : null;
  const out: OfficeAgent[] = [];
  for (const a of all) {
    if (mergedCoord) {
      if (a === base) {
        out.push(mergedCoord);
        continue;
      }
      if (a.id === COORDINATOR_ID) continue;
    }
    const id = `${a.runId}:${a.id}`;
    const seat = a.phase === "working" ? freeSeat(out, a.group) : a.seat;
    const merged: OfficeAgent = { ...a, id, seat };
    if (!a.tag) delete merged.tag;
    out.push(merged);
  }
  return out;
}

export { DESK_GROUPS };
