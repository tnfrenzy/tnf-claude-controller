import { addUsage, emptyUsage, type AgentInfo, type NormalizedEvent, type Usage } from "./events.js";

export const COORDINATOR_ID = "coordinator";

/** CONTEXT-SPEC-v1 §5.4: first line of a critic/qa reply. Longer alternative first so APPROVED_WITH_CONCERNS wins. */
export const VERDICT_RE = /^VERDICT:\s*(APPROVED_WITH_CONCERNS|APPROVED|NEEDS_REVISION|BLOCKED|PASS_ENV|PASS|FAIL)\b[ \t]*[-:–—]?[ \t]*([^\r\n]*)/m;
/** Bash commands whose output is worth keeping as test-result.txt (SPEC §6.2). */
export const TEST_COMMAND_RE = /(?:^|&&|;|\s)(npm test|npm run test\b|npx vitest|npx jest|node --test|pytest|dotnet test|go test|cargo test)/;

export interface TestOutput {
  agent_id: string;
  command: string;
  ok: boolean;
  text: string;
}

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

export function truncate(s: string, max = 160): string {
  const one = s.replace(/\s+/g, " ").trim();
  return one.length > max ? one.slice(0, max - 1) + "…" : one;
}

export function usageFrom(u: unknown): Usage {
  if (!isObj(u)) return emptyUsage();
  return {
    input: num(u["input_tokens"]),
    output: num(u["output_tokens"]),
    cache_read: num(u["cache_read_input_tokens"]),
    cache_write: num(u["cache_creation_input_tokens"]),
  };
}

/** Human-readable one-line summary of a tool input. */
export function summarizeToolInput(tool: string, input: unknown): string {
  if (!isObj(input)) return truncate(JSON.stringify(input ?? ""));
  switch (tool) {
    case "Agent":
    case "Task":
      return truncate(`${str(input["subagent_type"], "?")}: ${str(input["description"]) || str(input["prompt"])}`);
    case "WebSearch":
      return truncate(str(input["query"]));
    case "WebFetch":
      return truncate(str(input["url"]));
    case "Read":
    case "Write":
    case "Edit":
      return truncate(str(input["file_path"]));
    case "Bash":
      return truncate(str(input["command"]));
    default:
      return truncate(JSON.stringify(input));
  }
}

function contentToText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content
      .map((c) => (isObj(c) && c["type"] === "text" ? str(c["text"]) : ""))
      .filter(Boolean)
      .join("\n");
  }
  return "";
}

/**
 * Incremental, fault-tolerant parser for `claude -p --output-format stream-json`.
 * Feed one line at a time; get back normalized events. Unknown shapes become `unknown`.
 * Builds the agent tree from `parent_tool_use_id` + `Agent` tool calls.
 */
export class StreamParser {
  readonly agents = new Map<string, AgentInfo>();
  sessionId: string | undefined;
  claudeVersion: string | undefined;
  model: string | undefined;
  totalUsage: Usage = emptyUsage();
  private sawResult = false;
  /**
   * The CLI emits several lines per API message (one `assistant` per content block, plus `message_delta`), each with a
   * usage snapshot for the SAME message id. Keep the last snapshot per id and only add the difference.
   */
  private readonly usageByMessage = new Map<string, { usage: Usage; agentId: string }>();
  private sawInit = false;
  /** `system/task_started.task_id` → tool_use_id; `permission_denied.agent_id` carries the task id (S5 stream). */
  private readonly taskToToolUse = new Map<string, string>();
  /** Bash tool_use_id → command, to recognise test runs when their tool_result arrives. */
  private readonly bashCommands = new Map<string, string>();
  /** Full output of the LAST test command seen (tool_result is otherwise truncated in events). */
  lastTestOutput: TestOutput | null = null;

  private applyUsage(lineAgentId: string, msgId: string, snapshot: Usage): { delta: Usage; agentId: string } {
    // Subagent `stream_event` lines carry parent_tool_use_id = null, so trust the agent first seen for this message id.
    const known = this.usageByMessage.get(msgId);
    const agentId = known?.agentId ?? lineAgentId;
    const prev = known?.usage ?? emptyUsage();
    const delta: Usage = {
      input: Math.max(0, snapshot.input - prev.input),
      output: Math.max(0, snapshot.output - prev.output),
      cache_read: Math.max(0, snapshot.cache_read - prev.cache_read),
      cache_write: Math.max(0, snapshot.cache_write - prev.cache_write),
    };
    this.usageByMessage.set(msgId, {
      agentId,
      usage: {
        input: Math.max(prev.input, snapshot.input),
        output: Math.max(prev.output, snapshot.output),
        cache_read: Math.max(prev.cache_read, snapshot.cache_read),
        cache_write: Math.max(prev.cache_write, snapshot.cache_write),
      },
    });
    const agent = this.agents.get(agentId);
    if (agent) agent.usage = addUsage(agent.usage, delta);
    this.totalUsage = addUsage(this.totalUsage, delta);
    return { delta, agentId };
  }

  private static nonZero(u: Usage): boolean {
    return !!(u.input || u.output || u.cache_read || u.cache_write);
  }

  constructor(private readonly runId: string) {
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

  private agentFor(parentToolUseId: unknown): string {
    if (typeof parentToolUseId !== "string" || parentToolUseId.length === 0) return COORDINATOR_ID;
    if (!this.agents.has(parentToolUseId)) {
      // A subagent we did not see being spawned (e.g. nested or missed line): register as unknown.
      this.agents.set(parentToolUseId, {
        agent_id: parentToolUseId,
        role: "unknown",
        parent_id: COORDINATOR_ID,
        tool_use_id: parentToolUseId,
        status: "running",
        usage: emptyUsage(),
      });
    }
    return parentToolUseId;
  }

  // The real coding fixture (real-coding-pass) has no parent_tool_use_id on vcs_state_changed,
  // so infer the owner from the sole running subagent. This also counts background/unknown
  // subagents that are still running; with 0 or 2+ running we cannot tell, so use the coordinator.
  private agentForVcs(parentToolUseId: unknown): string {
    if (typeof parentToolUseId === "string" && parentToolUseId.length > 0) return this.agentFor(parentToolUseId);
    const running = [...this.agents.values()].filter((a) => a.status === "running" && a.agent_id !== COORDINATOR_ID);
    const [only] = running;
    return running.length === 1 && only ? only.agent_id : COORDINATOR_ID;
  }

  private handle(msg: unknown): NormalizedEvent[] {
    if (!isObj(msg)) return [{ type: "unknown", raw: msg }];
    const type = msg["type"];
    if (typeof msg["session_id"] === "string") this.sessionId = msg["session_id"];

    switch (type) {
      case "system":
        return this.handleSystem(msg);
      case "stream_event":
        return this.handleStreamEvent(msg);
      case "assistant":
        return this.handleAssistant(msg);
      case "user":
        return this.handleUser(msg);
      case "result":
        return this.handleResult(msg);
      case "rate_limit_event":
        return this.handleRateLimit(msg);
      default:
        return [{ type: "unknown", raw: msg }];
    }
  }

  private handleSystem(msg: Json): NormalizedEvent[] {
    const subtype = msg["subtype"];
    if (subtype === "init") {
      // Each background subagent re-emits `init` for the same session; only the first one starts the run.
      if (this.sawInit) return [];
      this.sawInit = true;
      this.model = str(msg["model"]) || undefined;
      this.claudeVersion = str(msg["claude_code_version"]) || undefined;
      const ev: NormalizedEvent = { type: "run.started", run_id: this.runId };
      if (this.sessionId) ev.session_id = this.sessionId;
      if (this.model) ev.model = this.model;
      if (this.claudeVersion) ev.claude_version = this.claudeVersion;
      if (Array.isArray(msg["tools"])) ev.tools = (msg["tools"] as unknown[]).map(String);
      return [ev];
    }
    if (subtype === "api_retry") {
      return [{ type: "api.retry", attempt: num(msg["attempt"]), error: str(msg["error"]) || truncate(JSON.stringify(msg)) }];
    }
    // Observed in CLI 2.1.301 but not needed for the timeline: hook lifecycle, status pings, thinking token estimates.
    if (subtype === "hook_started" || subtype === "hook_response" || subtype === "status" || subtype === "thinking_tokens") return [];
    if (subtype === "task_updated" || subtype === "background_tasks_changed" || subtype === "post_turn_summary" || subtype === "task_summary" || subtype === "hook_progress") return [];
    // CLI ≥ 2.1.301 announces git state changes made by tools: {"kind":"commit","branch":"tnf/<id>","cwd":"<worktree>"}.
    if (subtype === "vcs_state_changed") {
      return [{ type: "vcs.commit", agent_id: this.agentForVcs(msg["parent_tool_use_id"]), kind: str(msg["kind"], "commit"), branch: str(msg["branch"]), cwd: str(msg["cwd"]) }];
    }
    // e.g. {"subtype":"notification","key":"stop-hook-error","text":"Stop hook error occurred"}
    if (subtype === "notification") return [{ type: "notice", key: str(msg["key"]), text: str(msg["text"]) || truncate(JSON.stringify(msg), 200) }];
    // Background subagent lifecycle (CLI 2.1.301): task_started → task_progress* → task_notification.
    if (subtype === "task_started") {
      const toolUseId = str(msg["tool_use_id"]);
      const taskId = str(msg["task_id"]);
      if (taskId && toolUseId) this.taskToToolUse.set(taskId, toolUseId);
      const agent = this.agents.get(toolUseId);
      if (agent) {
        const role = str(msg["subagent_type"]);
        if (role) agent.role = role;
        return [];
      }
      if (toolUseId) {
        const role = str(msg["subagent_type"]) || "subagent";
        this.agents.set(toolUseId, { agent_id: toolUseId, role, parent_id: COORDINATOR_ID, tool_use_id: toolUseId, status: "running", usage: emptyUsage() });
        const started: NormalizedEvent = { type: "agent.started", agent_id: toolUseId, role, parent_id: COORDINATOR_ID, tool_use_id: toolUseId };
        const d = str(msg["description"]);
        if (d) started.description = d;
        return [started];
      }
      return [];
    }
    if (subtype === "task_progress") {
      const toolUseId = str(msg["tool_use_id"]);
      const agent = this.agents.get(toolUseId);
      if (!agent) return [];
      const u = isObj(msg["usage"]) ? msg["usage"] : {};
      const progress = { total_tokens: num(u["total_tokens"]), tool_uses: num(u["tool_uses"]), duration_ms: num(u["duration_ms"]) } as NonNullable<AgentInfo["progress"]>;
      const lastTool = str(msg["last_tool_name"]);
      if (lastTool) progress.last_tool = lastTool;
      agent.progress = progress;
      const ev: NormalizedEvent = { type: "agent.progress", agent_id: toolUseId, ...progress };
      const d = str(msg["description"]);
      if (d) ev.description = d;
      return [ev];
    }
    if (subtype === "task_notification") {
      const toolUseId = str(msg["tool_use_id"]);
      const agent = this.agents.get(toolUseId);
      if (!agent) return [];
      const reply = str(msg["summary"]);
      const summary = truncate(reply, 600);
      agent.status = "finished";
      agent.summary = summary;
      if (reply) agent.reply = reply;
      const status = str(msg["status"]);
      if (status) agent.task_status = status;
      const outputFile = str(msg["output_file"]);
      if (outputFile) agent.output_file = outputFile;
      const ev: NormalizedEvent = { type: "agent.finished", agent_id: toolUseId, summary };
      if (status) ev.status = status;
      if (outputFile) ev.output_file = outputFile;
      const out: NormalizedEvent[] = [ev];
      const verdict = VERDICT_RE.exec(reply);
      if (verdict) {
        agent.verdict = verdict[1]!;
        out.push({ type: "agent.verdict", agent_id: toolUseId, role: agent.role, verdict: verdict[1]!, ...(verdict[2]?.trim() ? { note: verdict[2].trim() } : {}) });
      }
      return out;
    }
    if (subtype === "permission_denied") {
      // `agent_id` on this line is the background task id, not a tool_use_id (observed in S5/S6 streams).
      const byTask = this.taskToToolUse.get(str(msg["agent_id"]));
      return [
        {
          type: "permission.denied",
          agent_id: byTask ?? this.agentFor(msg["parent_tool_use_id"]),
          tool: str(msg["tool_name"]) || str(msg["tool"]),
          reason: str(msg["reason"]) || str(msg["message"]),
        },
      ];
    }
    return [{ type: "unknown", raw: msg }];
  }

  private handleStreamEvent(msg: Json): NormalizedEvent[] {
    const agentId = this.agentFor(msg["parent_tool_use_id"]);
    const ev = msg["event"];
    if (!isObj(ev)) return [{ type: "unknown", raw: msg }];
    if (ev["type"] === "content_block_delta" && isObj(ev["delta"])) {
      const d = ev["delta"];
      if (d["type"] === "text_delta") return [{ type: "text.delta", agent_id: agentId, text: str(d["text"]) }];
      if (d["type"] === "thinking_delta") return [{ type: "thinking.delta", agent_id: agentId, text: str(d["thinking"]) }];
    }
    // message_delta carries the final cumulative usage of the message (output_tokens is only partial on `assistant` lines).
    if (ev["type"] === "message_delta" && isObj(ev["usage"])) {
      const msgId = str(msg["api_message_id"]) || `anon-${this.usageByMessage.size}`;
      const r = this.applyUsage(agentId, msgId, usageFrom(ev["usage"]));
      if (StreamParser.nonZero(r.delta)) return [{ type: "usage.update", agent_id: r.agentId, usage: r.delta }];
    }
    return [];
  }

  private handleAssistant(msg: Json): NormalizedEvent[] {
    const agentId = this.agentFor(msg["parent_tool_use_id"]);
    const message = msg["message"];
    if (!isObj(message)) return [{ type: "unknown", raw: msg }];
    const out: NormalizedEvent[] = [];
    const content = Array.isArray(message["content"]) ? (message["content"] as unknown[]) : [];
    for (const block of content) {
      if (!isObj(block)) continue;
      if (block["type"] === "text") {
        const text = str(block["text"]);
        if (text) out.push({ type: "text.message", agent_id: agentId, text });
      } else if (block["type"] === "tool_use") {
        const tool = str(block["name"]);
        const toolUseId = str(block["id"]);
        const input = block["input"];
        out.push({ type: "tool.use", agent_id: agentId, tool_use_id: toolUseId, tool, input_summary: summarizeToolInput(tool, input), input });
        if (tool === "Bash" && toolUseId && isObj(input) && typeof input["command"] === "string") this.bashCommands.set(toolUseId, input["command"]);
        if ((tool === "Agent" || tool === "Task") && toolUseId) {
          const role = isObj(input) ? str(input["subagent_type"], "subagent") : "subagent";
          const description = isObj(input) ? str(input["description"]) : "";
          this.agents.set(toolUseId, {
            agent_id: toolUseId,
            role,
            parent_id: agentId,
            tool_use_id: toolUseId,
            status: "running",
            usage: emptyUsage(),
          });
          const started: NormalizedEvent = { type: "agent.started", agent_id: toolUseId, role, parent_id: agentId, tool_use_id: toolUseId };
          if (description) started.description = description;
          out.push(started);
        }
      }
    }
    if (isObj(message["usage"])) {
      const msgId = str(message["id"]) || `anon-${this.usageByMessage.size}`;
      const r = this.applyUsage(agentId, msgId, usageFrom(message["usage"]));
      const agent = this.agents.get(r.agentId);
      const model = str(message["model"]);
      if (model && agent) agent.model = model;
      if (StreamParser.nonZero(r.delta)) {
        const uev: NormalizedEvent = { type: "usage.update", agent_id: r.agentId, usage: r.delta };
        if (model) uev.model = model;
        out.push(uev);
      }
    }
    return out;
  }

  private handleUser(msg: Json): NormalizedEvent[] {
    const agentId = this.agentFor(msg["parent_tool_use_id"]);
    const message = msg["message"];
    if (!isObj(message)) return [{ type: "unknown", raw: msg }];
    const out: NormalizedEvent[] = [];
    const content = Array.isArray(message["content"]) ? (message["content"] as unknown[]) : [];
    for (const block of content) {
      if (!isObj(block) || block["type"] !== "tool_result") continue;
      const toolUseId = str(block["tool_use_id"]);
      const isError = block["is_error"] === true;
      const fullText = contentToText(block["content"]) || JSON.stringify(block["content"] ?? "");
      const summary = truncate(fullText, 300);
      out.push({ type: "tool.result", agent_id: agentId, tool_use_id: toolUseId, ok: !isError, summary });
      const cmd = this.bashCommands.get(toolUseId);
      if (cmd !== undefined) {
        this.bashCommands.delete(toolUseId);
        if (TEST_COMMAND_RE.test(cmd)) this.lastTestOutput = { agent_id: agentId, command: cmd, ok: !isError, text: fullText.slice(0, 200_000) };
      }
      const sub = this.agents.get(toolUseId);
      if (sub && sub.tool_use_id === toolUseId) {
        // Background launch: the real result arrives later via system/task_notification.
        const asyncLaunch = /^Async agent launched/i.test(summary);
        if (!asyncLaunch && sub.status === "running") {
          sub.status = "finished";
          sub.summary = summary;
          out.push({ type: "agent.finished", agent_id: toolUseId, summary });
        }
      }
    }
    return out;
  }

  /** `rate_limit_event` carries the subscription windows (five_hour / seven_day utilization 0..1). */
  private handleRateLimit(msg: Json): NormalizedEvent[] {
    const info = isObj(msg["rate_limit_info"]) ? msg["rate_limit_info"] : msg;
    const windows = isObj(info["unifiedWindows"]) ? info["unifiedWindows"] : {};
    const win = (k: string) => (isObj(windows[k]) ? (windows[k] as Json) : null);
    const pct = (w: Json | null) => (w && typeof w["utilization"] === "number" ? Math.round((w["utilization"] as number) * 1000) / 10 : null);
    const resets = (w: Json | null) => (w && typeof w["resetsAt"] === "number" ? (w["resetsAt"] as number) * 1000 : null);
    const fh = win("five_hour");
    const sd = win("seven_day");
    const rawReset = info["resetsAt"];
    const topReset = typeof rawReset === "number" && Number.isFinite(rawReset) && rawReset > 0 ? (rawReset < 1e11 ? rawReset * 1000 : rawReset) : null;
    const rawType = info["rateLimitType"];
    const limitType = typeof rawType === "string" && rawType !== "" ? rawType : null;
    return [
      {
        type: "rate.limit",
        status: str(info["status"], "unknown"),
        five_hour_pct: pct(fh),
        seven_day_pct: pct(sd),
        five_hour_resets_at: resets(fh),
        seven_day_resets_at: resets(sd),
        using_overage: info["isUsingOverage"] === true,
        resets_at: topReset,
        limit_type: limitType,
      },
    ];
  }

  private lastResult: Json | null = null;
  private segmentTurns = 0;
  private segmentDuration = 0;

  /**
   * CLI 2.1.301 emits one `result` line per coordinator turn segment (initial turn + one per task_notification wake-up),
   * all flushed at exit with `result_index`. Each is a segment; the run ends when the process exits (see finalize()).
   */
  private handleResult(msg: Json): NormalizedEvent[] {
    this.sawResult = true;
    this.lastResult = msg;
    this.segmentTurns += num(msg["num_turns"]);
    this.segmentDuration += num(msg["duration_ms"]);
    return [{ type: "run.segment", index: num(msg["result_index"]), text: str(msg["result"]), num_turns: num(msg["num_turns"]), duration_ms: num(msg["duration_ms"]) }];
  }

  /** Sum of `modelUsage` from the result line (authoritative totals across coordinator + subagents). */
  private usageFromModelUsage(msg: Json): Usage | null {
    const mu = msg["modelUsage"];
    if (!isObj(mu)) return null;
    let acc = emptyUsage();
    let any = false;
    for (const v of Object.values(mu)) {
      if (!isObj(v)) continue;
      any = true;
      acc = addUsage(acc, { input: num(v["inputTokens"]), output: num(v["outputTokens"]), cache_read: num(v["cacheReadInputTokens"]), cache_write: num(v["cacheCreationInputTokens"]) });
    }
    return any ? acc : null;
  }

  /** Called by the runner when the process has exited: turns the last `result` into run.result (+ run.error). */
  finalize(): NormalizedEvent[] {
    const msg = this.lastResult;
    if (!msg) return [];
    // Must run before the sweep below: "still running" at exit means its task_notification never came.
    const interrupted = this.interruptedRoles();
    for (const a of this.agents.values()) {
      if (a.status !== "running") continue;
      a.status = "finished";
      if (a.agent_id !== COORDINATOR_ID && a.role !== "subagent") a.task_status = "interrupted";
    }
    const resultIsError = msg["is_error"] === true || (str(msg["subtype"]) !== "success" && str(msg["subtype"]) !== "");
    const isError = resultIsError || interrupted.length > 0;
    const text = str(msg["result"]);
    const ev: NormalizedEvent = {
      type: "run.result",
      ok: !isError,
      text,
      cost_usd_est: num(msg["total_cost_usd"]),
      usage: this.usageFromModelUsage(msg) ?? this.totalUsage,
      duration_ms: this.segmentDuration || num(msg["duration_ms"]),
      num_turns: this.segmentTurns || num(msg["num_turns"]),
      permission_denials: Array.isArray(msg["permission_denials"]) ? (msg["permission_denials"] as unknown[]) : [],
    };
    if (this.sessionId) ev.session_id = this.sessionId;
    const stop = str(msg["stop_reason"]) || str(msg["subtype"]);
    if (stop) ev.stop_reason = stop;
    const out: NormalizedEvent[] = [ev];
    if (resultIsError) {
      const subtype = str(msg["subtype"]);
      const kind = subtype.includes("max_turns") ? "max_turns" : subtype.includes("budget") ? "max_budget" : subtype || "result_error";
      out.push({ type: "run.error", kind, message: text || truncate(JSON.stringify(msg), 300) });
    } else if (interrupted.length > 0) {
      const roles = [...new Set(interrupted)].join(", ");
      out.push({
        type: "run.error",
        kind: "subagent_interrupted",
        message: `Run bị cắt giữa chừng: vai ${roles} chưa chạy xong khi tiến trình claude thoát (kết quả cuối chỉ là câu chờ của coordinator, không phải báo cáo). Việc dang dở có thể còn trong worktree; dùng "Hỏi tiếp" để chạy tiếp hoặc xem diff trước khi gộp.`,
      });
    }
    return out;
  }

  /**
   * Roles of real subagent calls (Agent tool) that did not complete: the process exited before their
   * task_notification (still running), or the CLI reported them stopped/killed/failed. Bash background tasks
   * (role "subagent", no subagent_type) are ignored so a stopped test command cannot fail the run.
   */
  interruptedRoles(): string[] {
    const roles: string[] = [];
    for (const a of this.agents.values()) {
      if (a.agent_id === COORDINATOR_ID || a.role === "subagent") continue;
      if (a.status === "running" || (a.task_status !== undefined && a.task_status !== "completed")) roles.push(a.role);
    }
    return roles;
  }
}
