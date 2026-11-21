import type { AuthStatus } from "../billing-guard.js";
import type { CliModelChoice } from "../../shared-types.js";
import { checkCodexAuth, readCodexVersion, sanitizeCodexEnv } from "./codex-guard.js";
import { locateCodex } from "./codex-locator.js";
import { CodexRunner } from "./codex-runner.js";
import { DEFAULT_CODEX_MODELS } from "./model-distribution.js";
import type { CliProvider, CliRunner, ProviderRunnerOptions } from "./types.js";

/** OpenAI Codex CLI (`codex`) provider — ChatGPT OAuth subscription only (no API keys). */
export class CodexProvider implements CliProvider {
  readonly id = "codex" as const;
  readonly displayName = "OpenAI Codex CLI (ChatGPT)";

  locate(explicit?: string | null, env: NodeJS.ProcessEnv = process.env): string {
    return locateCodex(explicit, env);
  }

  readVersion(binaryPath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): string | null {
    return readCodexVersion(binaryPath, env, argsPrefix);
  }

  sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return sanitizeCodexEnv(env);
  }

  async checkAuth(
    binaryPath: string,
    env: NodeJS.ProcessEnv,
    argsPrefix: readonly string[] = [],
  ): Promise<{ status: AuthStatus; env: NodeJS.ProcessEnv }> {
    return checkCodexAuth(binaryPath, env, argsPrefix);
  }

  listModels(_binaryPath: string, _env: NodeJS.ProcessEnv, fallback: readonly CliModelChoice[] = DEFAULT_CODEX_MODELS): CliModelChoice[] {
    return fallback.length ? fallback.map((m) => ({ ...m })) : DEFAULT_CODEX_MODELS.map((m) => ({ ...m }));
  }

  createRunner(options: ProviderRunnerOptions): CliRunner {
    const version = this.readVersion(options.claudePath, options.env, options.claudeArgsPrefix ?? []);
    return new CodexRunner(options, version);
  }
}
