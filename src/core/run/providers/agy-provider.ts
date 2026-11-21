import type { AuthStatus } from "../billing-guard.js";
import type { CliModelChoice } from "../../shared-types.js";
import { checkAgyAuth, listAgyModelsSync, readAgyVersion, sanitizeAgyEnv } from "./agy-guard.js";
import { locateAgy } from "./agy-locator.js";
import { AgyRunner } from "./agy-runner.js";
import { DEFAULT_AGY_MODELS } from "./model-distribution.js";
import type { CliProvider, CliRunner, ProviderRunnerOptions } from "./types.js";

/** Antigravity CLI (`agy`) provider — Google OAuth subscription only (no API keys, no AI Credits). */
export class AntigravityProvider implements CliProvider {
  readonly id = "antigravity" as const;
  readonly displayName = "Antigravity CLI (agy)";

  locate(explicit?: string | null, env: NodeJS.ProcessEnv = process.env): string {
    return locateAgy(explicit, env);
  }

  readVersion(binaryPath: string, env: NodeJS.ProcessEnv, argsPrefix: readonly string[] = []): string | null {
    return readAgyVersion(binaryPath, env, argsPrefix);
  }

  sanitizeEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
    return sanitizeAgyEnv(env);
  }

  async checkAuth(
    binaryPath: string,
    env: NodeJS.ProcessEnv,
    argsPrefix: readonly string[] = [],
  ): Promise<{ status: AuthStatus; env: NodeJS.ProcessEnv }> {
    const res = await checkAgyAuth(binaryPath, env, argsPrefix);
    return { status: res.status, env: res.env };
  }

  listModels(
    binaryPath: string,
    env: NodeJS.ProcessEnv,
    fallback: readonly CliModelChoice[] = DEFAULT_AGY_MODELS,
    argsPrefix: readonly string[] = [],
  ): CliModelChoice[] {
    return listAgyModelsSync(binaryPath, env, fallback.length ? fallback : DEFAULT_AGY_MODELS, argsPrefix);
  }

  createRunner(options: ProviderRunnerOptions): CliRunner {
    const version = this.readVersion(options.claudePath, options.env, options.claudeArgsPrefix ?? []);
    return new AgyRunner(options, version);
  }
}
