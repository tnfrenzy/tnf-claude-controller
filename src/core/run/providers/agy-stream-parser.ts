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

function agyUsageFrom(u: unknown): Usage {
  if (!isObj(u)) return emptyUsage();
  return {
    input: num(u["input_tokens"]),
    output: num(u["output_tokens"]) + num(u["thinking_tokens"]),
    cache_read: num(u["cache_read_tokens"]),
    cache_write: 0,
  };
}

function summarizeAgyTool(tool: string, params: unknown): string {
  if (!isObj(params)) return truncate(JSON.stringify(params ?? ""));
  switch (tool) {
    case "run_command":
      return truncate(str(params["CommandLine"]) || str(params["command"]));
    case "view_file":
    case "read_file":
    case "write_to_file":
    case "write_file":
    case "replace_file_content":
    case "multi_replace_file_content":
      return truncate(str(params["Path"]) || str(params["AbsolutePath"]) || str(params["TargetFile"]) || str(params["file_path"]));
    case "grep_search":
      return truncate(str(params["Query"]));
    case "find_by_name":
      return truncate(str(params["Pattern"]) || str(params["SearchDirectory"]));
    case "search_web":
      return truncate(str(params["query"]));
    case "read_url_content":
      return truncate(str(params["Url"]) || str(params["url"]));
    case "invoke_subagent":
      return truncate(`${str(params["TypeName"], "subagent")}: ${str(params["Role"]) || str(params["Prompt"])}`);
    default:
      return truncate(JSON.stringify(params));
  }
}

function isPermissionError(message: string): boolean {
  return /permission check failed|permission denied|user denied permission|required the .* permission/i.test(message);
}

/**
 * Incremental, fault-tolerant parser for `agy --output-format stream-json` (NDJSON).
 * Emits the exact same `NormalizedEvent` union as Claude's `StreamParser` so RunPage,
 * timeline, 2.5D Isometric Office, Diff/Test/Verdict, and Queue all work identically.
 */
export class AgyStreamParser implements CliStreamParser {
  readonly agents = new Map<string, AgentInfo>();
  sessionId: string | undefined;
  claudeVersion: string | undefined;
  model: string | undefined;
  totalUsage: Usage = emptyUsage();
  lastTestOutput: TestOutput | null = null;

  private sawInit = false;
  private sawResult = false;
  private lastResult: Json | null = null;
  private readonly activeCommands = new Map<string, string>();
  private readonly permissionDenials: Array<{ tool: string; reason: string }> = [];
  private softDenyNotice: string | null = null;
  private segmentIndex = 0;

  constructor(private readonly runId: string, version?: string | null) {
    if (version) this.claudeVersion = `agy ${version}`;
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

  /** Called by AgyRunner when stderr reports a headless soft-deny notice. */
  noteStderr(chunk: string): void {
    if (/required the .+ permission that headless mode cannot prompt for/i.test(chunk)) {
      this.softDenyNotice = truncate(chunk, 300);
    }
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
    const evType = str(msg["event"]);
    if (typeof msg["conversation_id"] === "string" && msg["conversation_id"]) {
      this.sessionId = msg["conversation_id"];
    }
    switch (evType) {
      case "init":
        return this.handleInit(msg);
      case "step_update":
        return this.handleStepUpdate(msg);
      case "result":
        return this.handleResult(msg);
      default:
        return [{ type: "unknown", raw: msg }];
    }
  }

  private handleInit(msg: Json): NormalizedEvent[] {
    if (this.sawInit) return [];
    this.sawInit = true;
    const init = isObj(msg["init"]) ? msg["init"] : {};
    const conv = str(msg["conversation_id"]) || str(init["conversation_id"]);
    if (conv) this.sessionId = conv;
    const model = str(init["model"]);
    if (model) this.model = model;
    const ev: NormalizedEvent = { type: "run.started", run_id: this.runId };
    if (this.sessionId) ev.session_id = this.sessionId;
    if (this.model) ev.model = this.model;
    if (this.claudeVersion) ev.claude_version = this.claudeVersion;
    if (Array.isArray(init["tools"])) ev.tools = (init["tools"] as unknown[]).map(String);
    return [ev];
  }

  private handleStepUpdate(msg: Json): NormalizedEvent[] {
    const su = isObj(msg["step_update"]) ? msg["step_update"] : null;
    if (!su) return [{ type: "unknown", raw: msg }];
    const conv = str(su["conversation_id"]);
    if (conv && !this.sessionId) this.sessionId = conv;

    const stepIndex = num(su["step_index"]);
    const state = str(su["state"]);
    const stepType = str(su["step_type"]);
    const out: NormalizedEvent[] = [];

    if (stepType === "agent_response") {
      const delta = str(su["text_delta"]);
      if (delta) out.push({ type: "text.delta", agent_id: COORDINATOR_ID, text: delta });
      if (state === "DONE" && isObj(su["usage"])) {
        const u = agyUsageFrom(su["usage"]);
        if (u.input || u.output || u.cache_read) {
          this.totalUsage = addUsage(this.totalUsage, u);
          const coord = this.agents.get(COORDINATOR_ID);
          if (coord) coord.usage = addUsage(coord.usage, u);
          const uev: NormalizedEvent = { type: "usage.update", agent_id: COORDINATOR_ID, usage: u };
          if (this.model) uev.model = this.model;
          out.push(uev);
        }
      }
      return out;
    }

    if (stepType === "tool") {
      const toolUseId = `agy-step-${stepIndex}`;
      const toolInfo = isObj(su["tool_info"]) ? su["tool_info"] : {};
      const toolName = str(su["tool_name"]) || str(toolInfo["name"]) || "tool";
      const params = toolInfo["parameters"];

      if (state === "ACTIVE") {
        if (toolName === "run_command" && isObj(params)) {
          const cmd = str(params["CommandLine"]) || str(params["command"]);
          if (cmd) this.activeCommands.set(toolUseId, cmd);
        }
        out.push({
          type: "tool.use",
          agent_id: COORDINATOR_ID,
          tool_use_id: toolUseId,
          tool: toolName,
          input_summary: summarizeAgyTool(toolName, params),
          input: params,
        });
        return out;
      }

      // DONE or ERROR
      const errObj = isObj(toolInfo["error"]) ? toolInfo["error"] : null;
      const isErr = state === "ERROR" || errObj !== null;
      const errMsg = errObj ? str(errObj["message"]) || truncate(JSON.stringify(errObj), 300) : "";
      const fullOut = isErr ? errMsg : str(toolInfo["output"]);
      const summary = truncate(fullOut, 300);

      // Ensure tool.use was emitted if ACTIVE was skipped (short tools can arrive directly as DONE).
      if (!this.activeCommands.has(toolUseId) && toolName === "run_command" && isObj(params)) {
        const cmd = str(params["CommandLine"]) || str(params["command"]);
        if (cmd) this.activeCommands.set(toolUseId, cmd);
        out.push({
          type: "tool.use",
          agent_id: COORDINATOR_ID,
          tool_use_id: toolUseId,
          tool: toolName,
          input_summary: summarizeAgyTool(toolName, params),
          input: params,
        });
      }

      if (isErr && isPermissionError(errMsg)) {
        const reason = truncate(errMsg, 300);
        this.permissionDenials.push({ tool: toolName, reason });
        out.push({ type: "permission.denied", agent_id: COORDINATOR_ID, tool: toolName, reason });
      }
      out.push({ type: "tool.result", agent_id: COORDINATOR_ID, tool_use_id: toolUseId, ok: !isErr, summary });

      const cmd = this.activeCommands.get(toolUseId);
      if (cmd !== undefined) {
        this.activeCommands.delete(toolUseId);
        if (TEST_COMMAND_RE.test(cmd)) {
          this.lastTestOutput = { agent_id: COORDINATOR_ID, command: cmd, ok: !isErr, text: fullOut.slice(0, 200_000) };
        }
      }
      return out;
    }

    if (isObj(su["subagent_info"]) && Array.isArray(su["subagent_info"]["subagents"])) {
      for (const s of su["subagent_info"]["subagents"] as unknown[]) {
        if (!isObj(s)) continue;
        const id = str(s["conversation_id"]) || `agy-sub-${stepIndex}`;
        const role = str(s["role"]) || str(s["type_name"]) || "subagent";
        if (!this.agents.has(id)) {
          this.agents.set(id, {
            agent_id: id,
            role,
            parent_id: COORDINATOR_ID,
            tool_use_id: id,
            status: state === "DONE" ? "finished" : "running",
            usage: emptyUsage(),
          });
          out.push({ type: "agent.started", agent_id: id, role, parent_id: COORDINATOR_ID, tool_use_id: id });
        } else if (state === "DONE") {
          const a = this.agents.get(id)!;
          if (a.status === "running") {
            a.status = "finished";
            out.push({ type: "agent.finished", agent_id: id, summary: "" });
          }
        }
      }
      return out;
    }

    return out;
  }

  private handleResult(msg: Json): NormalizedEvent[] {
    const res = isObj(msg["result"]) ? msg["result"] : msg;
    this.sawResult = true;
    this.lastResult = res;
    const conv = str(res["conversation_id"]);
    if (conv) this.sessionId = conv;
    const text = str(res["response"]);
    const idx = this.segmentIndex++;
    const out: NormalizedEvent[] = [
      {
        type: "run.segment",
        index: idx,
        text,
        num_turns: num(res["num_turns"]),
        duration_ms: Math.round(num(res["duration_seconds"]) * 1000),
      },
    ];
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

  finalize(): NormalizedEvent[] {
    const res = this.lastResult;
    if (!res) return [];
    for (const a of this.agents.values()) {
      if (a.status === "running") a.status = "finished";
    }
    const status = str(res["status"], "SUCCESS").toUpperCase();
    const response = str(res["response"]);
    const errText = str(res["error"]);
    const softDeniedEmpty = status === "SUCCESS" && !response.trim() && (this.permissionDenials.length > 0 || this.softDenyNotice !== null);
    const isError = status !== "SUCCESS" || softDeniedEmpty;
    const usage = isObj(res["usage"]) ? agyUsageFrom(res["usage"]) : this.totalUsage;

    const ev: NormalizedEvent = {
      type: "run.result",
      ok: !isError,
      text: response,
      cost_usd_est: 0,
      usage,
      duration_ms: Math.round(num(res["duration_seconds"]) * 1000),
      num_turns: num(res["num_turns"]) || 1,
      permission_denials: this.permissionDenials,
    };
    if (this.sessionId) ev.session_id = this.sessionId;
    if (status) ev.stop_reason = status.toLowerCase();

    const out: NormalizedEvent[] = [ev];
    if (softDeniedEmpty) {
      const reason = this.softDenyNotice ?? this.permissionDenials[0]?.reason ?? "Công cụ bị từ chối quyền trong chế độ không tương tác.";
      out.push({ type: "run.error", kind: "permission_denied", message: `Antigravity CLI bị chặn quyền và không sinh kết quả: ${reason}` });
    } else if (isError) {
      const kind = status === "CANCELED" ? "cancelled" : status === "INTERRUPTED" ? "interrupted" : "result_error";
      out.push({ type: "run.error", kind, message: errText || response || `Antigravity CLI kết thúc với trạng thái ${status}.` });
    }
    return out;
  }
}
