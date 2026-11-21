import type { EventEmitter } from "node:events";
import type { AuthStatus } from "../billing-guard.js";
import type { AgentInfo, NormalizedEvent, Usage } from "../events.js";
import type { TestOutput } from "../stream-parser.js";
import type { RunnerOptions } from "../claude-runner.js";
import type { CliModelChoice, CliProviderId } from "../../shared-types.js";

/** Common incremental stream parser interface shared by all CLI providers. */
export interface CliStreamParser {
  readonly agents: Map<string, AgentInfo>;
  sessionId: string | undefined;
  claudeVersion: string | undefined;
  model: string | undefined;
  totalUsage: Usage;
  lastTestOutput: TestOutput | null;
  readonly hasResult: boolean;
  feedLine(line: string): NormalizedEvent[];
  finalize(): NormalizedEvent[];
}

/** Common runner interface emitted events: "event" (NormalizedEvent), "stderr" (string), "exit" (RunnerExit). */
export interface CliRunner extends EventEmitter {
  readonly parser: CliStreamParser;
  readonly pid: number | undefined;
  start(): void;
  cancel(): void;
}

export interface ProviderRunnerOptions extends RunnerOptions {
  /** Custom agent name for providers that support `--agent <name>` (e.g. Antigravity CLI). */
  agentName?: string | undefined;
  /** Directories added via `--add-dir` (provider-agnostic). */
  addDirs?: string[] | undefined;
  /** Reasoning effort for providers supporting `--effort` (e.g. Antigravity CLI). */
  effort?: "low" | "medium" | "high" | "xhigh" | "max" | undefined;
  /** Per-run directory outside run_dir for transient settings/secrets (e.g. data/runs/<id>). */
  runMetaDir?: string | undefined;
  /** Whether the run is read-only (no edits, no shell commands). */
  readOnlyMode?: boolean | undefined;
}

export interface CliProvider {
  readonly id: CliProviderId;
  readonly displayName: string;
  locate(explicit?: string | null, env?: NodeJS.ProcessEnv): string;
  readVersion(binaryPath: string, env: NodeJS.ProcessEnv, argsPrefix?: readonly string[]): string | null;
  /**
   * Enforce subscription/OAuth-only CLI usage (no API keys, no AI Credits),
   * return the sanitized env for child processes and current auth status.
   */
  checkAuth(binaryPath: string, env: NodeJS.ProcessEnv, argsPrefix?: readonly string[]): Promise<{ status: AuthStatus; env: NodeJS.ProcessEnv }>;
  /** Strip billing/API-key/AI-credit env vars for this provider. */
  sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
  /** List available models for this provider (may cache or return fallback). */
  listModels(binaryPath: string, env: NodeJS.ProcessEnv, fallback: readonly CliModelChoice[], argsPrefix?: readonly string[]): CliModelChoice[];
  /** Spawnable runner implementing CliRunner. */
  createRunner(options: ProviderRunnerOptions): CliRunner;
}
