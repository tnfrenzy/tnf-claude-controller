import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { NormalizedEvent } from "../events.js";
import type { RunnerExit } from "../claude-runner.js";
import { sanitizeCodexEnv } from "./codex-guard.js";
import { CodexStreamParser } from "./codex-stream-parser.js";
import type { CliRunner, ProviderRunnerOptions } from "./types.js";

/** Build argument list for `codex exec --json`. Pure; used by tests. */
export function buildCodexArgs(o: ProviderRunnerOptions): string[] {
  const args: string[] = ["exec"];
  if (o.resumeSessionId) {
    args.push("resume", o.resumeSessionId);
  }
  args.push("--json");
  if (o.model) args.push("--model", o.model);
  args.push("--sandbox", o.readOnlyMode ? "read-only" : "workspace-write");
  for (const dir of o.addDirs ?? []) {
    if (dir) args.push("--add-dir", dir);
  }
  // Read prompt from stdin ("-") to avoid Windows command-line quoting & length limits.
  args.push("-");
  if (args.includes("--dangerously-bypass-approvals-and-sandbox")) {
    throw new Error("--dangerously-bypass-approvals-and-sandbox is forbidden in TNF CLI.");
  }
  return args;
}

/**
 * Spawns one `codex exec --json` process (no shell), feeds the prompt via stdin,
 * parses NDJSON events into `NormalizedEvent`, writes raw stream to disk,
 * enforces timeout and clean cancellation.
 * Hard rule: strips OPENAI_API_KEY so only ChatGPT OAuth subscription is used.
 */
export class CodexRunner extends EventEmitter implements CliRunner {
  readonly parser: CodexStreamParser;
  private child: ChildProcess | null = null;
  private cancelled = false;
  private timedOut = false;
  private timer: NodeJS.Timeout | null = null;
  private stream: fs.WriteStream | null = null;
  private buffer = "";

  constructor(readonly options: ProviderRunnerOptions, version?: string | null) {
    super();
    this.parser = new CodexStreamParser(options.runId, options.model, version);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    const o = this.options;
    fs.mkdirSync(o.cwd, { recursive: true });
    fs.mkdirSync(path.dirname(o.streamFile), { recursive: true });

    const args = [...(o.claudeArgsPrefix ?? []), ...buildCodexArgs(o)];
    this.stream = fs.createWriteStream(o.streamFile, { flags: "a", encoding: "utf8" });
    const env = sanitizeCodexEnv(o.env);

    let finalPrompt = o.prompt;
    const guardBlock = !o.readOnlyMode
      ? "[RÀO CHẮN AN TOÀN TNF CLI]\nĐược phép đọc/sửa mã nguồn và chạy test/build/git commit trong worktree hiện tại. TUYỆT ĐỐI KHÔNG chạy git push, git reset --hard, git clean, rm -rf, npm publish hoặc npm install -g."
      : "";
    if (o.systemPromptFile && fs.existsSync(o.systemPromptFile)) {
      const sys = fs.readFileSync(o.systemPromptFile, "utf8").trim();
      if (sys) finalPrompt = `[CHỈ DẪN HỆ THỐNG]\n${sys}\n\n${guardBlock ? `${guardBlock}\n\n` : ""}[YÊU CẦU]\n${o.prompt}`;
      else if (guardBlock) finalPrompt = `${guardBlock}\n\n[YÊU CẦU]\n${o.prompt}`;
    } else if (guardBlock) {
      finalPrompt = `${guardBlock}\n\n[YÊU CẦU]\n${o.prompt}`;
    }

    const child = spawn(o.claudePath, args, {
      cwd: o.cwd,
      env,
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      shell: false,
    });
    this.child = child;

    child.on("error", (err) => {
      this.emit("event", {
        type: "run.error",
        kind: "spawn",
        message: `Không khởi động được OpenAI Codex CLI (codex): ${err.message}`,
      } satisfies NormalizedEvent);
    });
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => this.emit("stderr", chunk));
    child.on("close", (code, signal) => this.onClose(code, signal));

    child.stdin!.on("error", () => { /* EPIPE */ });
    child.stdin!.end(finalPrompt, "utf8");

    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.emit("event", {
        type: "run.error",
        kind: "timeout",
        message: `Quá thời gian tối đa ${Math.round(o.timeoutMs / 1000)}s, đang dừng tiến trình codex.`,
      } satisfies NormalizedEvent);
      this.killTree();
    }, o.timeoutMs);
  }

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
        message: `codex thoát với mã ${code ?? signal ?? "?"} mà không có kết quả.`,
      } satisfies NormalizedEvent);
    }
    this.emit("exit", { code, signal, cancelled: this.cancelled, timedOut: this.timedOut } satisfies RunnerExit);
  }
}
