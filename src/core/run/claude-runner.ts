import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import { assertNoBare } from "./billing-guard.js";
import type { AuthMode } from "../app/config.js";
import type { NormalizedEvent } from "./events.js";
import { StreamParser } from "./stream-parser.js";

export interface RunnerOptions {
  runId: string;
  /** Executable to spawn (claude.exe, or node for the fake CLI used in tests). */
  claudePath: string;
  /** Arguments inserted before the claude flags (e.g. path of a fake CLI script). */
  claudeArgsPrefix?: string[];
  cwd: string;
  env: NodeJS.ProcessEnv;
  authMode: AuthMode;
  prompt: string;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  allowedTools: string[];
  /** Tools denied even if matched by allowedTools (`--disallowedTools`). */
  disallowedTools?: string[] | undefined;
  /** Extra settings JSON file passed with `--settings` (e.g. permissions.deny rules). */
  settingsFile?: string | undefined;
  agentsFile?: string | undefined;
  systemPromptFile?: string | undefined;
  resumeSessionId?: string | undefined;
  sessionId?: string | undefined;
  streamFile: string;
  maxConcurrentSubagents: number;
  maxSubagentSpawnDepth: number;
  extraArgs?: string[] | undefined;
  /** `--permission-mode`; default dontAsk. bypassPermissions only for coding runs (worktree + deny list). */
  permissionMode?: "dontAsk" | "bypassPermissions" | undefined;
  /** Coding runs: per-call time limit in minutes, passed as BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS (unverified hypothesis). */
  callTimeoutMinutes?: number | undefined;
}

/** Build the child process env. Pure: does not mutate baseEnv. */
export function buildChildEnv(
  baseEnv: NodeJS.ProcessEnv,
  o: Pick<RunnerOptions, "maxConcurrentSubagents" | "maxSubagentSpawnDepth" | "callTimeoutMinutes">,
): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...baseEnv,
    CLAUDE_CODE_MAX_CONCURRENT_SUBAGENTS: String(o.maxConcurrentSubagents),
    CLAUDE_CODE_MAX_SUBAGENT_SPAWN_DEPTH: String(o.maxSubagentSpawnDepth),
  };
  delete env.ANTHROPIC_API_KEY;
  delete env.ANTHROPIC_AUTH_TOKEN;
  if (o.callTimeoutMinutes && o.callTimeoutMinutes > 0) {
    const ms = String(Math.round(o.callTimeoutMinutes * 60000));
    env.BASH_DEFAULT_TIMEOUT_MS = ms;
    env.BASH_MAX_TIMEOUT_MS = ms;
  }
  return env;
}

export interface RunnerExit {
  code: number | null;
  signal: NodeJS.Signals | null;
  cancelled: boolean;
  timedOut: boolean;
}

/** Build the claude -p argument list (CONTEXT-SPEC §5.2). Pure; used by tests. */
export function buildClaudeArgs(o: RunnerOptions): string[] {
  const args: string[] = [
    "-p",
    "--output-format",
    "stream-json",
    "--verbose",
    "--include-partial-messages",
    "--forward-subagent-text",
    "--model",
    o.model,
    "--permission-mode",
    o.permissionMode ?? "dontAsk",
    "--max-turns",
    String(o.maxTurns),
    "--max-budget-usd",
    String(o.maxBudgetUsd),
  ];
  if (o.allowedTools.length) args.push("--allowedTools", ...o.allowedTools);
  if (o.disallowedTools?.length) args.push("--disallowedTools", ...o.disallowedTools);
  if (o.agentsFile) args.push("--agents", o.agentsFile);
  if (o.systemPromptFile) args.push("--append-system-prompt-file", o.systemPromptFile);
  if (o.settingsFile) args.push("--settings", o.settingsFile);
  if (o.resumeSessionId) args.push("--resume", o.resumeSessionId);
  else if (o.sessionId) args.push("--session-id", o.sessionId);
  if (o.extraArgs?.length) args.push(...o.extraArgs);
  assertNoBare(args, o.authMode);
  if (args.includes("--dangerously-skip-permissions") || (args.includes("bypassPermissions") && o.permissionMode !== "bypassPermissions")) {
    throw new Error("bypassPermissions is forbidden here (only configured coding runs may use --permission-mode bypassPermissions)");
  }
  return args;
}

/**
 * Spawns one `claude -p` process (no shell), feeds the prompt via stdin, parses stream-json,
 * writes the raw stream to disk, enforces a total timeout and supports clean cancellation.
 * Events: "event" (NormalizedEvent), "exit" (RunnerExit), "stderr" (string).
 */
export class ClaudeRunner extends EventEmitter {
  readonly parser: StreamParser;
  private child: ChildProcess | null = null;
  private cancelled = false;
  private timedOut = false;
  private timer: NodeJS.Timeout | null = null;
  private stream: fs.WriteStream | null = null;
  private buffer = "";

  constructor(readonly options: RunnerOptions) {
    super();
    this.parser = new StreamParser(options.runId);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    const o = this.options;
    const args = [...(o.claudeArgsPrefix ?? []), ...buildClaudeArgs(o)];
    fs.mkdirSync(o.cwd, { recursive: true });
    fs.mkdirSync(path.dirname(o.streamFile), { recursive: true });
    this.stream = fs.createWriteStream(o.streamFile, { flags: "a", encoding: "utf8" });

    const env = buildChildEnv(o.env, o);

    const child = spawn(o.claudePath, args, {
      cwd: o.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child = child;

    child.on("error", (err) => {
      this.emit("event", { type: "run.error", kind: "spawn", message: `Không khởi động được claude: ${err.message}` } satisfies NormalizedEvent);
    });
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => this.emit("stderr", chunk));
    child.on("close", (code, signal) => this.onClose(code, signal));

    // Prompt via stdin, then close stdin explicitly (CONTEXT-SPEC §4.6).
    child.stdin!.on("error", () => {
      /* EPIPE when the process exits early; the close handler reports it */
    });
    child.stdin!.end(o.prompt, "utf8");

    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.emit("event", { type: "run.error", kind: "timeout", message: `Quá thời gian tối đa ${Math.round(o.timeoutMs / 1000)}s, đang dừng tiến trình.` } satisfies NormalizedEvent);
      this.killTree();
    }, o.timeoutMs);
  }

  /** Cancel: kill the whole process tree (subagents are in-process, but MCP/child tools may not be). */
  cancel(): void {
    if (this.cancelled) return;
    this.cancelled = true;
    this.killTree();
  }

  private killTree(): void {
    const child = this.child;
    if (!child || child.pid === undefined || child.exitCode !== null) return;
    if (process.platform === "win32") {
      spawnSync("taskkill", ["/T", "/F", "/PID", String(child.pid)], { windowsHide: true });
    } else {
      child.kill("SIGINT");
      setTimeout(() => {
        if (child.exitCode === null) child.kill("SIGKILL");
      }, 5000).unref();
    }
  }

  private onStdout(chunk: string): void {
    this.stream?.write(chunk);
    this.buffer += chunk;
    let idx: number;
    while ((idx = this.buffer.indexOf("\n")) >= 0) {
      const line = this.buffer.slice(0, idx);
      this.buffer = this.buffer.slice(idx + 1);
      this.emitLine(line);
    }
  }

  private emitLine(line: string): void {
    for (const ev of this.parser.feedLine(line)) this.emit("event", ev);
  }

  private onClose(code: number | null, signal: NodeJS.Signals | null): void {
    if (this.timer) clearTimeout(this.timer);
    if (this.buffer.trim()) {
      this.emitLine(this.buffer);
      this.buffer = "";
    }
    this.stream?.end();
    if (!this.cancelled) for (const ev of this.parser.finalize()) this.emit("event", ev);
    if (this.cancelled) {
      this.emit("event", { type: "run.cancelled" } satisfies NormalizedEvent);
    } else if (!this.parser.hasResult && !this.timedOut) {
      this.emit("event", {
        type: "run.error",
        kind: code === 0 ? "no_result" : "exit",
        message: `claude thoát với mã ${code ?? signal ?? "?"} mà không có message result.`,
      } satisfies NormalizedEvent);
    }
    this.emit("exit", { code, signal, cancelled: this.cancelled, timedOut: this.timedOut } satisfies RunnerExit);
  }
}
