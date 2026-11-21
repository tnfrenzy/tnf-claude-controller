/**
 * Automatic model distribution across CLI providers (Claude Code <-> Antigravity CLI).
 * Maps logical tiers ("light" | "balanced" | "strong") and cross-provider model ids
 * so roles and runs automatically get the best-fit model for whichever CLI executes them.
 */
import type { CliModelChoice, CliProviderId, ModelTier } from "../../shared-types.js";

/** Default tier assigned to each known role when distributing models automatically. */
export const ROLE_DEFAULT_TIER: Record<string, ModelTier> = {
  // Coding roles
  analyst: "light",
  critic: "light",
  qa: "light",
  planner: "balanced",
  implementer: "balanced",
  debug: "balanced",
  // Research roles
  searcher: "light",
  analyzer: "balanced",
  synthesizer: "strong",
  // Idea / queue roles
  "idea-interviewer": "strong",
  "idea-splitter": "strong",
  "idea-critic": "strong",
  // Video studio roles
  "video-director": "balanced",
  "video-editor": "balanced",
  // 3D workshop roles
  "tiep-nhan-3d": "light",
  "detail-planner": "balanced",
  "art-director": "balanced",
  "cad-modeler": "strong",
  "material-artist": "balanced",
  "render-director": "light",
  "visual-reviewer": "strong",
  "render-presenter": "light",
  "ar-optimizer": "light",
};

/** Fallback Antigravity CLI models (used when `agy models` has not been queried yet or offline). */
export const DEFAULT_AGY_MODELS: readonly CliModelChoice[] = [
  { id: "gemini-3.8-flash-low", label: "Gemini 3.8 Flash (Low) — nhanh, nhẹ", tier: "light" },
  { id: "gemini-3.8-flash-medium", label: "Gemini 3.8 Flash (Medium)", tier: "light" },
  { id: "gemini-3.8-flash-high", label: "Gemini 3.8 Flash (High)", tier: "light" },
  { id: "gemini-4-argon-medium", label: "Gemini 4 Argon (Medium) — cân bằng", tier: "balanced" },
  { id: "gemini-4-argon-high", label: "Gemini 4 Argon (High)", tier: "balanced" },
  { id: "gemini-4-neon-medium", label: "Gemini 4 Neon (Medium)", tier: "strong" },
  { id: "gemini-4-neon-high", label: "Gemini 4 Neon (High) — mạnh", tier: "strong" },
  { id: "gemini-4-hydrogen-high", label: "Gemini 4 Hydrogen (High)", tier: "strong" },
  { id: "claude-sonnet-5-5-medium", label: "Claude Sonnet 5.5 (Medium, gói Antigravity)", tier: "balanced" },
  { id: "claude-opus-5-5-high", label: "Claude Opus 5.5 (High, gói Antigravity)", tier: "strong" },
];

/** Fallback OpenAI Codex CLI models (ChatGPT subscription CLI, no API key). */
export const DEFAULT_CODEX_MODELS: readonly CliModelChoice[] = [
  { id: "gpt-5.3-codex-mini", label: "GPT-5.3 Codex Mini — nhanh, nhẹ", tier: "light" },
  { id: "gpt-5.3-codex", label: "GPT-5.3 Codex — cân bằng, mặc định", tier: "balanced" },
  { id: "gpt-5.4", label: "GPT-5.4 — mạnh, lập kế hoạch & phân tích", tier: "strong" },
  { id: "o3", label: "OpenAI o3 — suy luận sâu", tier: "strong" },
];

/** Infer a logical tier from any model id (Claude, Antigravity, or Codex). */
export function inferModelTier(modelId: string): ModelTier {
  const m = modelId.trim().toLowerCase();
  if (!m) return "balanced";
  if (m.includes("haiku") || m.includes("flash") || /(^|-)mini($|-)/.test(m) || m.endsWith("-low")) return "light";
  if (
    m.includes("opus") ||
    m.includes("fable") ||
    m.includes("neon") ||
    m.includes("hydrogen") ||
    m.includes("xhigh") ||
    m === "o3" ||
    m.startsWith("o3-") ||
    m.startsWith("gpt-5.4") ||
    m.endsWith("-pro")
  ) {
    return "strong";
  }
  return "balanced";
}

/** Check whether a model id looks native to a given provider. */
export function isModelNativeToProvider(provider: CliProviderId, modelId: string): boolean {
  const m = modelId.trim().toLowerCase();
  if (!m) return false;
  if (provider === "claude") {
    return m === "haiku" || m === "sonnet" || m === "opus" || m.startsWith("claude-");
  }
  if (provider === "codex") {
    return m.startsWith("gpt-") || m === "o3" || m.startsWith("o3-") || m.startsWith("o4-") || m.startsWith("codex-");
  }
  // Antigravity accepts gemini-*, gpt-oss-*, and claude-*-low|medium|high slugs (not bare haiku/sonnet/opus).
  if (m === "haiku" || m === "sonnet" || m === "opus") return false;
  return m.startsWith("gemini-") || m.startsWith("gpt-oss-") || /^claude-(opus|sonnet|haiku)-.+-(low|medium|high)$/.test(m);
}

const AGY_PREF_BY_TIER: Record<ModelTier, readonly string[]> = {
  light: ["gemini-3.8-flash-low", "gemini-3.8-flash-medium", "gemini-4-argon-low", "gemini-3.8-flash-high"],
  balanced: ["gemini-4-argon-medium", "gemini-4-neon-medium", "gemini-4-argon-high", "claude-sonnet-5-5-medium"],
  strong: ["gemini-4-neon-high", "gemini-4-hydrogen-high", "gemini-4-neon-xhigh", "claude-opus-5-5-high"],
};

const CLAUDE_PREF_BY_TIER: Record<ModelTier, readonly string[]> = {
  light: ["haiku", "sonnet"],
  balanced: ["sonnet", "opus", "haiku"],
  strong: ["opus", "claude-fable-5-2", "sonnet"],
};

const CODEX_PREF_BY_TIER: Record<ModelTier, readonly string[]> = {
  light: ["gpt-5.3-codex-mini", "gpt-5.3-codex"],
  balanced: ["gpt-5.3-codex", "gpt-5.4", "gpt-5.3-codex-mini"],
  strong: ["gpt-5.4", "o3", "gpt-5.3-codex"],
};

/** Pick the best available model for a provider + tier. */
export function pickModelForTier(
  provider: CliProviderId,
  tier: ModelTier,
  available: readonly CliModelChoice[],
): string {
  const availIds = new Set(available.map((m) => m.id));
  const prefs =
    provider === "antigravity"
      ? AGY_PREF_BY_TIER[tier]
      : provider === "codex"
        ? CODEX_PREF_BY_TIER[tier]
        : CLAUDE_PREF_BY_TIER[tier];
  for (const cand of prefs) {
    if (availIds.size === 0 || availIds.has(cand)) return cand;
  }
  const byTier = available.find((m) => (m.tier ?? inferModelTier(m.id)) === tier);
  if (byTier) return byTier.id;
  return (
    available[0]?.id ??
    prefs[0] ??
    (provider === "antigravity" ? "gemini-4-argon-medium" : provider === "codex" ? "gpt-5.3-codex" : "sonnet")
  );
}

/**
 * Resolve a requested model for the target provider:
 * 1. If requestedModel is valid/native for this provider (or explicitly present in `available`), keep it.
 * 2. Otherwise infer its tier (e.g. `opus` -> `strong`, `haiku` -> `light`) and map to the provider's best model.
 * 3. If no requestedModel, use accountDefaultModel (if valid for provider) or role's default tier.
 */
export function resolveModelForProvider(input: {
  provider: CliProviderId;
  requestedModel?: string | null | undefined;
  accountDefaultModel?: string | null | undefined;
  role?: string | undefined;
  available: readonly CliModelChoice[];
}): string {
  const { provider, available } = input;
  const availIds = new Set(available.map((m) => m.id));
  const req = input.requestedModel?.trim() || "";
  if (req) {
    if (availIds.has(req) || isModelNativeToProvider(provider, req)) return req;
    const tier = inferModelTier(req);
    return pickModelForTier(provider, tier, available);
  }
  const def = input.accountDefaultModel?.trim() || "";
  if (def && (availIds.has(def) || isModelNativeToProvider(provider, def))) return def;
  const tier = (input.role && ROLE_DEFAULT_TIER[input.role]) || "balanced";
  return pickModelForTier(provider, tier, available);
}

/** Auto-distribute models across a set of roles for a provider. */
export function autoDistributeRoleModels(
  provider: CliProviderId,
  roles: readonly string[],
  available: readonly CliModelChoice[],
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const r of roles) {
    const tier = ROLE_DEFAULT_TIER[r] ?? "balanced";
    out[r] = pickModelForTier(provider, tier, available);
  }
  return out;
}
