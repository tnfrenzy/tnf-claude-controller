import { runBillingGuard, sanitizeEnv as sanitizeClaudeEnv, type AuthStatus } from "../billing-guard.js";
import { locateClaude } from "../claude-locator.js";
import { ClaudeRunner } from "../claude-runner.js";
import { readClaudeVersion } from "../../app/version.js";
import type { CliModelChoice } from "../../shared-types.js";
import type { CliProvider, CliRunner, ProviderRunnerOptions } from "./types.js";

/** Claude Code CLI provider (subscription mode only — no API keys). */
export class ClaudeProvider implements CliProvider {
  readonly id = "claude" as const;
  readonly displayName = "Claude Code CLI";

  locate(explicit?: string | null, env: NodeJS.ProcessEnv = process.env): string {
    return locateClaude(explicit, env);
  }

  readVersion(binaryPath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): string | null {
    return readClaudeVersion(binaryPath, env, argsPrefix);
  }

  sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return sanitizeClaudeEnv(env, "subscription");
  }

  async checkAuth(
    binaryPath: string,
    env: NodeJS.ProcessEnv,
    argsPrefix: readonly string[] = [],
  ): Promise<{ status: AuthStatus; env: NodeJS.ProcessEnv }> {
    return runBillingGuard(binaryPath, "subscription", env, argsPrefix);
  }

  listModels(
    _binaryPath: string,
    _env: NodeJS.ProcessEnv,
    fallback: readonly CliModelChoice[],
  ): CliModelChoice[] {
    return fallback.length
      ? fallback.map((m) => ({ ...m }))
      : [
          { id: "haiku", label: "Haiku 5.5", tier: "light" },
          { id: "sonnet", label: "Sonnet 5.5", tier: "balanced" },
          { id: "opus", label: "Opus 5.5", tier: "strong" },
        ];
  }

  createRunner(options: ProviderRunnerOptions): CliRunner {
    return new ClaudeRunner(options);
  }
}
