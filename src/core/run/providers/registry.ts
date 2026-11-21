import type { CliProviderId } from "../../shared-types.js";
import { AntigravityProvider } from "./agy-provider.js";
import { ClaudeProvider } from "./claude-provider.js";
import { CodexProvider } from "./codex-provider.js";
import type { CliProvider } from "./types.js";

const CLAUDE = new ClaudeProvider();
const AGY = new AntigravityProvider();
const CODEX = new CodexProvider();

export const CLI_PROVIDERS: Record<CliProviderId, CliProvider> = {
  claude: CLAUDE,
  antigravity: AGY,
  codex: CODEX,
};

export function getCliProvider(id: CliProviderId): CliProvider {
  return CLI_PROVIDERS[id];
}

export function listCliProviders(): CliProvider[] {
  return [CLAUDE, AGY, CODEX];
}
