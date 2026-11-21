import { addUsage, emptyUsage, type AgentInfo, type NormalizedEvent, type Usage } from "../events.js";
import { COORDINATOR_ID, TEST_COMMAND_RE, VERDICT_RE, truncate, type TestOutput } from "../stream-parser.js";
import type { CliStreamParser } from "./types.js";

type Json = Record<string, unknown>;

function isObj(v: unknown): v is Json {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
function str(v: unknown, fallback = ""): string {
  return typeof v === "string" ? v : fallback;
}
function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Incremental parser for `codex exec --json` NDJSON event stream.
 * Maps Codex events (`thread.started`, `turn.started`, `item.started`, `item.completed`,
 * `turn.completed`, `turn.failed`, `error`) to TNF CLI's `NormalizedEvent`.
 */
export class CodexStreamParser implements CliStreamParser {
  readonly agents = new Map<string, AgentInfo>();
  sessionId: string | undefined;
  claudeVersion: string | undefined;
  model: string | undefined;
  totalUsage: Usage = emptyUsage();
  lastTestOutput: TestOutput | null = null;

  private sawInit = false;
  private sawResult = false;
  private finalText = "";
  private finalError: string | null = null;
  private numTurns = 0;
  private startedAt = Date.now();

  constructor(private readonly runId: string, model?: string, version?: string | null) {
    if (model) this.model = model;
    if (version) this.claudeVersion = `codex ${version}`;
    this.agents.set(COORDINATOR_ID, {
      agent_id: COORDINATOR_ID,
      role: "coordinator",
      parent_id: null,
      tool_use_id: null,
      status: "running",
      usage: emptyUsage(),
    });
  }

  get hasResult(): boolean {
    return this.sawResult;
  }

  feedLine(line: string): NormalizedEvent[] {
    const trimmed = line.trim();
    if (!trimmed) return [];
    let msg: unknown;
    try {
      msg = JSON.parse(trimmed);
    } catch {
      return [{ type: "unknown", raw: { unparsed: trimmed } }];
    }
    try {
      return this.handle(msg);
    } catch (e) {
      return [{ type: "unknown", raw: { error: String(e), message: msg } }];
    }
  }

  private handle(msg: unknown): NormalizedEvent[] {
    if (!isObj(msg)) return [{ type: "unknown", raw: msg }];
    const type = str(msg["type"]);
    switch (type) {
      case "thread.started": {
        const tid = str(msg["thread_id"]);
        if (tid) this.sessionId = tid;
        if (this.sawInit) return [];
        this.sawInit = true;
        this.startedAt = Date.now();
        const ev: NormalizedEvent = { type: "run.started", run_id: this.runId };
        if (this.sessionId) ev.session_id = this.sessionId;
        if (this.model) ev.model = this.model;
        if (this.claudeVersion) ev.claude_version = this.claudeVersion;
        return [ev];
      }
      case "turn.started": {
        this.numTurns++;
        return [];
      }
      case "item.started":
      case "item.completed": {
        const item = isObj(msg["item"]) ? msg["item"] : null;
        if (!item) return [];
        const itemType = str(item["type"]);
        const id = str(item["id"]) || `codex-item-${this.numTurns}`;

        if (itemType === "agent_message" && type === "item.completed") {
          const text = str(item["text"]);
          if (!text) return [];
          this.finalText = text;
          const out: NormalizedEvent[] = [{ type: "text.message", agent_id: COORDINATOR_ID, text }];
          const verdict = VERDICT_RE.exec(text);
          if (verdict) {
            const coord = this.agents.get(COORDINATOR_ID);
            if (coord) coord.verdict = verdict[1]!;
            out.push({
              type: "agent.verdict",
              agent_id: COORDINATOR_ID,
              role: coord?.role ?? "coordinator",
              verdict: verdict[1]!,
              ...(verdict[2]?.trim() ? { note: verdict[2].trim() } : {}),
            });
          }
          return out;
        }

        if (itemType === "command_execution") {
          const cmd = str(item["command"]);
          if (type === "item.started") {
            return [{ type: "tool.use", agent_id: COORDINATOR_ID, tool_use_id: id, tool: "Bash", input_summary: truncate(cmd), input: { command: cmd } }];
          }
          const exitCode = typeof item["exit_code"] === "number" ? (item["exit_code"] as number) : 0;
          const outText = str(item["aggregated_output"]);
          if (TEST_COMMAND_RE.test(cmd)) {
            this.lastTestOutput = { agent_id: COORDINATOR_ID, command: cmd, ok: exitCode === 0, text: outText.slice(0, 200_000) };
          }
          return [{ type: "tool.result", agent_id: COORDINATOR_ID, tool_use_id: id, ok: exitCode === 0, summary: truncate(outText || `exit ${exitCode}`, 300) }];
        }

        if (itemType === "file_change" && type === "item.completed") {
          const changes = Array.isArray(item["changes"]) ? item["changes"] : [];
          const summary = truncate(JSON.stringify(changes), 200);
          return [
            { type: "tool.use", agent_id: COORDINATOR_ID, tool_use_id: id, tool: "Edit", input_summary: summary, input: changes },
            { type: "tool.result", agent_id: COORDINATOR_ID, tool_use_id: id, ok: true, summary },
          ];
        }
        return [];
      }
      case "turn.completed": {
        this.sawResult = true;
        const u = isObj(msg["usage"]) ? msg["usage"] : null;
        if (u) {
          const delta: Usage = {
            input: num(u["input_tokens"]),
            output: num(u["output_tokens"]),
            cache_read: num(u["cached_input_tokens"]),
            cache_write: 0,
          };
          this.totalUsage = addUsage(this.totalUsage, delta);
          const coord = this.agents.get(COORDINATOR_ID);
          if (coord) coord.usage = addUsage(coord.usage, delta);
          return [{ type: "usage.update", agent_id: COORDINATOR_ID, usage: delta, ...(this.model ? { model: this.model } : {}) }];
        }
        return [];
      }
      case "turn.failed":
      case "error": {
        this.sawResult = true;
        const err = isObj(msg["error"]) ? str(msg["error"]["message"]) : str(msg["message"]);
        this.finalError = err || "Codex CLI báo lỗi trong lượt chạy.";
        return [{ type: "run.error", kind: "result_error", message: this.finalError }];
      }
      default:
        return [{ type: "unknown", raw: msg }];
    }
  }

  finalize(): NormalizedEvent[] {
    if (!this.sawResult && !this.finalError) return [];
    for (const a of this.agents.values()) {
      if (a.status === "running") a.status = "finished";
    }
    const ok = !this.finalError;
    const ev: NormalizedEvent = {
      type: "run.result",
      ok,
      text: this.finalText,
      cost_usd_est: 0,
      usage: this.totalUsage,
      duration_ms: Math.max(1, Date.now() - this.startedAt),
      num_turns: this.numTurns || 1,
      permission_denials: [],
    };
    if (this.sessionId) ev.session_id = this.sessionId;
    return [ev];
  }
}
