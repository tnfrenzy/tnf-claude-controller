/** Normalized events emitted by the controller (CONTEXT-SPEC §5.3). */

export interface Usage {
  input: number;
  output: number;
  cache_read: number;
  cache_write: number;
}

export type RunStatus = "queued" | "running" | "done" | "error" | "cancelled";

export interface AgentInfo {
  agent_id: string;
  role: string;
  parent_id: string | null;
  tool_use_id: string | null;
  model?: string;
  status: "running" | "finished";
  summary?: string;
  usage: Usage;
  /** From `system/task_progress` (background subagents, CLI ≥ 2.1.3xx). */
  progress?: { total_tokens: number; tool_uses: number; duration_ms: number; last_tool?: string };
  /** From `system/task_notification`: file holding the subagent's full final reply (observed EMPTY in 2.1.301). */
  output_file?: string;
  /** Full final reply text of the subagent (task_notification.summary is the complete reply, not a digest). */
  reply?: string;
  task_status?: string;
  /** Parsed from the first line of the reply (`VERDICT: …`, CONTEXT-SPEC-v1 §5.4). */
  verdict?: string;
}

export interface VerdictRecord {
  agent_id: string;
  role: string;
  verdict: string;
  /** Rest of the verdict line (e.g. PASS_ENV explanation). */
  note?: string;
  at: number;
}

export type NormalizedEvent =
  | { type: "run.started"; run_id: string; session_id?: string; model?: string; claude_version?: string; tools?: string[] }
  | { type: "agent.started"; agent_id: string; role: string; parent_id: string | null; tool_use_id: string | null; description?: string }
  | { type: "text.delta"; agent_id: string; text: string }
  | { type: "thinking.delta"; agent_id: string; text: string }
  | { type: "text.message"; agent_id: string; text: string }
  | { type: "tool.use"; agent_id: string; tool_use_id: string; tool: string; input_summary: string; input?: unknown }
  | { type: "tool.result"; agent_id: string; tool_use_id: string; ok: boolean; summary: string }
  | { type: "agent.finished"; agent_id: string; summary: string; status?: string; output_file?: string }
  | { type: "agent.progress"; agent_id: string; total_tokens: number; tool_uses: number; duration_ms: number; last_tool?: string; description?: string }
  | { type: "permission.denied"; agent_id: string; tool: string; reason: string }
  /** First line of a subagent reply matched `VERDICT: <X>` (critic/qa). */
  | { type: "agent.verdict"; agent_id: string; role: string; verdict: string; note?: string }
  /** From `system/vcs_state_changed` (CLI ≥ 2.1.301): a commit landed in the worktree. */
  | { type: "vcs.commit"; agent_id: string; kind: string; branch: string; cwd: string }
  | { type: "api.retry"; attempt: number; error: string }
  | { type: "rate.limit"; status: string; five_hour_pct: number | null; seven_day_pct: number | null; five_hour_resets_at: number | null; seven_day_resets_at: number | null; using_overage: boolean; resets_at?: number | null; limit_type?: string | null }
  | { type: "usage.update"; agent_id: string; usage: Usage; model?: string }
  | {
      type: "run.result";
      ok: boolean;
      text: string;
      cost_usd_est: number;
      usage: Usage;
      duration_ms: number;
      num_turns: number;
      permission_denials: unknown[];
      session_id?: string;
      stop_reason?: string;
    }
  | { type: "run.segment"; index: number; text: string; num_turns: number; duration_ms: number }
  | { type: "notice"; key: string; text: string }
  | { type: "run.error"; kind: string; message: string }
  | { type: "run.cancelled" }
  | { type: "unknown"; raw: unknown };

export interface StoredEvent {
  seq: number;
  run_id: string;
  ts: number;
  event: NormalizedEvent;
}

export const emptyUsage = (): Usage => ({ input: 0, output: 0, cache_read: 0, cache_write: 0 });

export function addUsage(a: Usage, b: Usage): Usage {
  return {
    input: a.input + b.input,
    output: a.output + b.output,
    cache_read: a.cache_read + b.cache_read,
    cache_write: a.cache_write + b.cache_write,
  };
}
