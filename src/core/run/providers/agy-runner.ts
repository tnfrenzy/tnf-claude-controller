import { EventEmitter } from "node:events";
import fs from "node:fs";
import path from "node:path";
import { spawn, spawnSync, type ChildProcess } from "node:child_process";
import type { NormalizedEvent } from "../events.js";
import type { RunnerExit } from "../claude-runner.js";
import { sanitizeAgyEnv } from "./agy-guard.js";
import { buildAgySettings, writeAgySettingsFile } from "./agy-permissions.js";
import { AgyStreamParser } from "./agy-stream-parser.js";
import type { CliRunner, ProviderRunnerOptions } from "./types.js";

/** Build argument list for `agy --input-format stream-json --output-format stream-json`. Pure; used by tests. */
export function buildAgyArgs(o: ProviderRunnerOptions, settingsFile: string): string[] {
  const args: string[] = [
    "--input-format",
    "stream-json",
    "--output-format",
    "stream-json",
    "--disable-slash-commands",
    "--settings",
    settingsFile,
  ];
  if (o.model) args.push("--model", o.model);
  if (o.effort) args.push("--effort", o.effort);
  if (o.agentName) args.push("--agent", o.agentName);
  if (o.resumeSessionId) args.push("--conversation", o.resumeSessionId);
  for (const dir of o.addDirs ?? []) {
    if (dir) args.push("--add-dir", dir);
  }
  if (o.timeoutMs && o.timeoutMs > 0) {
    args.push("--print-timeout", `${Math.max(1, Math.ceil(o.timeoutMs / 1000))}s`);
  }
  if (args.includes("--dangerously-skip-permissions")) {
    throw new Error("--dangerously-skip-permissions is forbidden in TNF CLI.");
  }
  return args;
}

/**
 * Spawns one `agy` process (no shell), writes the prompt as NDJSON on stdin,
 * parses `stream-json` events into `NormalizedEvent`, writes raw stream to disk,
 * enforces timeout and clean tree cancellation.
 * Hard rules: strips API keys / ADC vars, forces `useG1Credits: false` in per-run settings.
 */
export class AgyRunner extends EventEmitter implements CliRunner {
  readonly parser: AgyStreamParser;
  private child: ChildProcess | null = null;
  private cancelled = false;
  private timedOut = false;
  private timer: NodeJS.Timeout | null = null;
  private stream: fs.WriteStream | null = null;
  private buffer = "";
  private settingsFilePath: string | null = null;

  constructor(readonly options: ProviderRunnerOptions, version?: string | null) {
    super();
    this.parser = new AgyStreamParser(options.runId, version);
  }

  get pid(): number | undefined {
    return this.child?.pid;
  }

  start(): void {
    const o = this.options;
    fs.mkdirSync(o.cwd, { recursive: true });
    fs.mkdirSync(path.dirname(o.streamFile), { recursive: true });

    const metaDir = o.runMetaDir ?? path.dirname(o.streamFile);
    const settingsPayload = buildAgySettings({
      cwd: o.cwd,
      readOnly: o.readOnlyMode,
      permissionMode: o.permissionMode,
      allowedTools: o.allowedTools,
      disallowedTools: o.disallowedTools,
      addDirs: o.addDirs,
      claudeDenySettingsFile: o.settingsFile,
    });
    this.settingsFilePath = writeAgySettingsFile(metaDir, settingsPayload);

    const args = [...(o.claudeArgsPrefix ?? []), ...buildAgyArgs(o, this.settingsFilePath)];
    this.stream = fs.createWriteStream(o.streamFile, { flags: "a", encoding: "utf8" });

    const env = sanitizeAgyEnv(o.env);

    // Combine system prompt file (if any and no custom --agent) cleanly at the top of the prompt.
    let finalPrompt = o.prompt;
    if (!o.agentName && o.systemPromptFile && fs.existsSync(o.systemPromptFile)) {
      const sys = fs.readFileSync(o.systemPromptFile, "utf8").trim();
      if (sys) {
        finalPrompt = `[CHỈ DẪN HỆ THỐNG]\n${sys}\n\n[YÊU CẦU]\n${o.prompt}`;
      }
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
        message: `Không khởi động được Antigravity CLI (agy): ${err.message}`,
      } satisfies NormalizedEvent);
    });
    child.stdout!.setEncoding("utf8");
    child.stdout!.on("data", (chunk: string) => this.onStdout(chunk));
    child.stderr!.setEncoding("utf8");
    child.stderr!.on("data", (chunk: string) => {
      this.parser.noteStderr(chunk);
      this.emit("stderr", chunk);
    });
    child.on("close", (code, signal) => this.onClose(code, signal));

    child.stdin!.on("error", () => {
      /* EPIPE when child exits early */
    });
    const ndjsonPrompt = JSON.stringify({ event: "user", message: { content: finalPrompt } }) + "\n";
    child.stdin!.end(ndjsonPrompt, "utf8");

    this.timer = setTimeout(() => {
      this.timedOut = true;
      this.emit("event", {
        type: "run.error",
        kind: "timeout",
        message: `Quá thời gian tối đa ${Math.round(o.timeoutMs / 1000)}s, đang dừng tiến trình agy.`,
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
        message: `agy thoát với mã ${code ?? signal ?? "?"} mà không có sự kiện result.`,
      } satisfies NormalizedEvent);
    }
    this.emit("exit", { code, signal, cancelled: this.cancelled, timedOut: this.timedOut } satisfies RunnerExit);
  }
}
