import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { CONTEXT_SCAN_MAX_BYTES_CEILING, DEFAULT_CONTEXT_SCAN, type ContextScanConfig } from "../run/context-scan.js";
import { DEFAULT_NODE_MODULES, NODE_MODULES_MAX_MB_CEILING, type NodeModulesConfig, type NodeModulesMode } from "../git/node-modules.js";

export type AuthMode = "subscription" | "api";
/** coding = agents work in a git worktree of a target repo; research = legacy web-research roles in runs/<id>. */
export type RunKind = "coding" | "research";

/**
 * Coding coordinator budget. The longest chain the prompt allows: analyst, planner, critic, planner + critic revision (5),
 * up to 4 implementer slices (each call must stay well under the ~10 minute cap of a subagent), qa, then debug and qa again.
 */
export const CODING_MIN_ROLE_CALLS = 5 + 4 + 1 + 2;
/** Shipped default: the minimum plus slack for one retry of a crashed role. */
export const CODING_DEFAULT_ROLE_CALLS = CODING_MIN_ROLE_CALLS + 2;
/** Effective floor/default of coding role calls (older installs that still say 14 are raised to this). */
export const CODING_MIN_ROLE_CALLS_EFFECTIVE = 20;
/** Default ceiling for the user-supplied maxRoleCalls of a run. */
export const DEFAULT_MAX_ROLE_CALLS_CEILING = 30;
/** Default per-call Bash timeout (minutes) passed to the claude child process (hypothesis, see SPEC). */
export const DEFAULT_CALL_TIMEOUT_MINUTES = 20;
/** Default signatures (case-insensitive substrings) of known sandbox/environment test failures. */
export const DEFAULT_KNOWN_ENV_FAILURES = ["UNKNOWN: unknown error", "-4094", "EPERM junction"];

/** Per-kind run defaults (CONTEXT-SPEC-v1 §8: defaults.coding / defaults.research). */
export interface KindDefaults {
  allowedTools: string[];
  agentsFile: string;
  systemPromptFile: string;
  /** Settings JSON passed with `--settings` (permissions.deny). */
  settingsFile?: string;
  disallowedTools: string[];
  /** Extra flags appended to every `claude -p` call, e.g. ["--setting-sources", "project"]. */
  extraArgs: string[];
  /** Coordinator contract: max subagent calls per run (informational for prompts/UI). */
  maxRoleCalls: number;
  /** Coding only: bounded memory/doc summary injected into coordinator + analyst prompts. */
  contextScan?: ContextScanConfig;
  /** Coding only: `--permission-mode` of the run. bypassPermissions never asks or auto-denies; `disallowedTools` and the deny settings still apply. */
  permissionMode?: "dontAsk" | "bypassPermissions";
  /** Coding only: how the worktree gets the repo's node_modules (copy by default; junction over the size cap). */
  nodeModules?: NodeModulesConfig;
  /** Coding only: per-call Bash timeout in minutes (BASH_DEFAULT_TIMEOUT_MS / BASH_MAX_TIMEOUT_MS). */
  callTimeoutMinutes?: number;
  /** Coding only: signatures of known environment failures that qa classifies as ENV_KNOWN. */
  knownEnvFailures?: string[];
}

export interface RunDefaults {
  authMode: AuthMode;
  model: string;
  maxTurns: number;
  maxBudgetUsd: number;
  timeoutMs: number;
  maxConcurrentSubagents: number;
  maxSubagentSpawnDepth: number;
  /** Legacy flat fields — aliases of `research` kept for the UI / older callers. */
  allowedTools: string[];
  agentsFile: string;
  systemPromptFile: string;
  extraArgs: string[];
  research: KindDefaults;
  coding: KindDefaults;
}

export interface ModelChoice {
  id: string;
  label: string;
}

export interface ControllerConfig {
  repoRoot: string;
  claudePath: string | null;
  /** Optional explicit path to Antigravity CLI (`agy.exe`); null/undefined = auto-detect. */
  agyPath?: string | null;
  /** Optional explicit path to OpenAI Codex CLI (`codex`); null/undefined = auto-detect. */
  codexPath?: string | null;
  /** Models offered in the UI/CLI (alias or full id accepted by Claude Code). */
  models: ModelChoice[];
  workspaceDir: string;
  /** Where coding runs get their git worktrees: <worktreesDir>/<run-id>. */
  worktreesDir: string;
  dataDir: string;
  /** `server.allowedOrigins`: extra browser origins (e.g. a Tailscale Serve URL) accepted on API/WS calls. */
  server: { host: string; port: number; allowedOrigins: string[] };
  defaults: RunDefaults;
  limits: { maxTurnsCeiling: number; maxBudgetUsdCeiling: number; maxRoleCallsCeiling?: number };
  /** `autoResume`: a run cut by timeout/subagent_interrupted is continued automatically (loadConfig default on; absent key = defaults from parseAutoResume). */
  autoResume?: AutoResumeConfig;
  /** `ui.towers`: display names of the two buildings in the single-screen city scene. */
  ui: { towers: [string, string]; dailyCostWarnUsd: number | null };
  /** `release.allowRemote`: allow real releases from a phone/tunnel connection (default false). */
  release: { allowRemote: boolean };
  /** `tools.cad.python`: python.exe of the venv that has ezdxf and cadquery (null = look in the usual places, see cad-tools.ts). */
  tools: { cad: { python: string | null }; blender?: string | null };
  /** `ideaAgents`: model and per-run budget cap of the idea agents (scout "Đề xuất", splitter "Ý tưởng", replan). Optional; use `ideaAgentsOf`. */
  ideaAgents?: IdeaAgentsConfig;
  /** `queue`: planner queue limits; every key optional (old installs without it use the defaults). */
  queue: QueueConfig;
  /** `automation`: autopilot switch, retry cap, cron schedule and notification webhooks (all off by default). */
  automation: AutomationConfig;
  /** `workshop3d`: loop limits of the 3D workshop (optional; see Workshop3DConfig). */
  workshop3d?: Workshop3DConfig;
}

export interface IdeaAgentsConfig {
  scoutModel: string;
  scoutBudgetUsd: number;
  splitterModel: string;
  splitterBudgetUsd: number;
  replanBudgetUsd: number;
  /** Model and budget of the read-only scope analysis that decides whether a run may start next to its peers. */
  scopeModel: string;
  scopeBudgetUsd: number;
  /** idea-interviewer: asks the user up to 5 questions before the split. */
  interviewModel: string;
  interviewBudgetUsd: number;
  /** idea-critic: reviews the split once and may trigger a single re-split. */
  criticModel: string;
  criticBudgetUsd: number;
}

export const DEFAULT_IDEA_AGENTS: IdeaAgentsConfig = {
  scoutModel: "opus",
  scoutBudgetUsd: 1,
  splitterModel: "opus",
  splitterBudgetUsd: 1,
  replanBudgetUsd: 1,
  scopeModel: "sonnet",
  scopeBudgetUsd: 0.5,
  interviewModel: "opus",
  interviewBudgetUsd: 2,
  criticModel: "opus",
  criticBudgetUsd: 3,
};

/** Idea-agent settings with defaults filled in; never throws. */
export function ideaAgentsOf(config: { ideaAgents?: Partial<IdeaAgentsConfig> | undefined }): IdeaAgentsConfig {
  return { ...DEFAULT_IDEA_AGENTS, ...(config.ideaAgents ?? {}) };
}

function parseIdeaAgents(raw: unknown): IdeaAgentsConfig {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const str = (v: unknown, d: string): string => (typeof v === "string" && v.trim() ? v.trim() : d);
  const num = (v: unknown, d: number): number => (typeof v === "number" && Number.isFinite(v) && v > 0 ? v : d);
  const d = DEFAULT_IDEA_AGENTS;
  return {
    scoutModel: str(r["scoutModel"], d.scoutModel),
    scoutBudgetUsd: num(r["scoutBudgetUsd"], d.scoutBudgetUsd),
    splitterModel: str(r["splitterModel"], d.splitterModel),
    splitterBudgetUsd: num(r["splitterBudgetUsd"], d.splitterBudgetUsd),
    replanBudgetUsd: num(r["replanBudgetUsd"], d.replanBudgetUsd),
    scopeModel: str(r["scopeModel"], d.scopeModel),
    scopeBudgetUsd: num(r["scopeBudgetUsd"], d.scopeBudgetUsd),
    interviewModel: str(r["interviewModel"], d.interviewModel),
    interviewBudgetUsd: num(r["interviewBudgetUsd"], d.interviewBudgetUsd),
    criticModel: str(r["criticModel"], d.criticModel),
    criticBudgetUsd: num(r["criticBudgetUsd"], d.criticBudgetUsd),
  };
}

export interface AutomationConfig {
  enabled: boolean;
  maxRetries: number;
  schedule: string | null;
  webhooks: string[];
}

export const AUTOMATION_MAX_RETRIES = 3;
export const AUTOMATION_MAX_WEBHOOKS = 10;

export interface AutoResumeConfig {
  enabled: boolean;
  /** Continuations after the original run (each one resumes the same session). */
  maxAttempts: number;
  delaySec: number;
  /** Wait for the quota reset when a run stops on a usage limit (only an explicit false disables). */
  quotaEnabled: boolean;
  /** Extra seconds added after the reported reset time (0..1800). */
  quotaMarginSec: number;
  /** Minutes to wait when the reset time is unknown (5..600). */
  quotaFallbackMin: number;
}

export function parseAutoResume(raw: unknown): AutoResumeConfig {
  const o = typeof raw === "object" && raw !== null && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {};
  const num = (v: unknown, def: number, min: number, max: number) => (typeof v === "number" && Number.isFinite(v) ? Math.min(max, Math.max(min, Math.floor(v))) : def);
  return { enabled: o["enabled"] !== false, maxAttempts: num(o["maxAttempts"], 3, 0, 10), delaySec: num(o["delaySec"], 15, 0, 600),
    quotaEnabled: o["quotaEnabled"] !== false,
    quotaMarginSec: num(o["quotaMarginSec"], 60, 0, 1800),
    quotaFallbackMin: num(o["quotaFallbackMin"], 60, 5, 600),
  };
}

function automationFail(msg: string): never {
  throw new Error(`config: automation.${msg}`);
}

function isPrivateHost(hostRaw: string): boolean {
  // Hostname-string check only; DNS is never resolved.
  const h = hostRaw.replace(/^\[|\]$/g, "").toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".local")) return true;
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(h);
  if (m) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    return false;
  }
  if (h.includes(":")) {
    if (h === "::1" || h === "::") return true;
    if (/^f[cd][0-9a-f]{0,2}:/.test(h)) return true;
    if (/^fe[89ab][0-9a-f]?:/.test(h)) return true;
    if (h.startsWith("::ffff:")) return true;
  }
  return false;
}

/**
 * Strict: throws "config: automation.<key> ..." on bad input; missing keys use safe defaults (off).
 * The cron check is only a rough syntax check (5 fields of `0-9 * , - /`), not a full cron parser.
 */
export function parseAutomation(raw: unknown): AutomationConfig {
  const out: AutomationConfig = { enabled: false, maxRetries: 0, schedule: null, webhooks: [] };
  if (raw === undefined || raw === null) return out;
  if (typeof raw !== "object" || Array.isArray(raw)) automationFail("phải là một đối tượng");
  const a = raw as Record<string, unknown>;
  if (a["enabled"] !== undefined) {
    if (typeof a["enabled"] !== "boolean") automationFail("enabled phải là true hoặc false");
    out.enabled = a["enabled"];
  }
  const mr = a["maxRetries"];
  if (mr !== undefined) {
    if (typeof mr !== "number" || !Number.isInteger(mr) || mr < 0 || mr > AUTOMATION_MAX_RETRIES) {
      automationFail(`maxRetries phải là số nguyên từ 0 đến ${AUTOMATION_MAX_RETRIES}`);
    }
    out.maxRetries = mr;
  }
  const sc = a["schedule"];
  if (sc !== undefined && sc !== null) {
    if (typeof sc !== "string") automationFail("schedule phải là chuỗi cron 5 trường hoặc null");
    const t = sc.trim();
    if (t !== "") {
      const fields = t.split(/\s+/);
      if (fields.length !== 5 || !fields.every((f) => /^[0-9*,\-/]+$/.test(f))) {
        automationFail("schedule phải là chuỗi cron 5 trường");
      }
      out.schedule = fields.join(" ");
    }
  }
  const wh = a["webhooks"];
  if (wh !== undefined) {
    try {
      out.webhooks = validateWebhookUrls(wh);
    } catch (e) {
      return automationFail(e instanceof Error ? e.message : String(e));
    }
  }
  return out;
}

/**
 * Validates a webhook URL list: array of https strings, no user:pass, no internal hosts,
 * duplicates dropped, at most AUTOMATION_MAX_WEBHOOKS. Throws Error whose message starts with "webhooks ..."
 * (no "config:" prefix).
 */
export function validateWebhookUrls(list: unknown): string[] {
  if (!Array.isArray(list)) throw new Error("webhooks phải là một mảng URL");
  const seen: string[] = [];
  for (const item of list as unknown[]) {
    if (typeof item !== "string") throw new Error("webhooks phải gồm các chuỗi URL");
    const s = item.trim();
    let u: URL;
    try {
      u = new URL(s);
    } catch {
      throw new Error(`webhooks có URL không hợp lệ: ${s}`);
    }
    if (u.protocol !== "https:") throw new Error(`webhooks phải dùng https: ${s}`);
    if (u.username !== "" || u.password !== "") throw new Error(`webhooks không được chứa user:pass: ${s}`);
    if (isPrivateHost(u.hostname)) throw new Error(`webhooks không được trỏ vào địa chỉ nội bộ: ${s}`);
    if (!seen.includes(s)) seen.push(s);
  }
  if (seen.length > AUTOMATION_MAX_WEBHOOKS) throw new Error(`webhooks tối đa ${AUTOMATION_MAX_WEBHOOKS} mục`);
  return seen;
}

export interface QueueConfig {
  maxParallel: number;
  /** null = no queue budget ceiling (unlimited). */
  maxBudgetUsd: number | null;
  replan: { enabled: boolean };
  hotspots: string[];
  /**
   * Idea-splitter: web search on/off and the advisory cap of search calls (prompt only). `interview` (ask questions first),
   * `critic` (review + one re-split) and `autoIntegrate` (append integrate + final-review): parseQueue defaults them to
   * true; absent on a hand-built config object = off.
   */
  splitter: { webSearch: boolean; maxWebCalls: number; interview?: boolean; critic?: boolean; autoIntegrate?: boolean };
  /** Write a lesson line to data/projects/<p>/lessons.md when a queued command fails (parseQueue default on; absent = off). */
  lessons?: { enabled: boolean };
  /** Hold a new coding run while its predicted files overlap a peer run of the same project (or are uncertain). Absent = off. */
  scopeGuard?: { enabled: boolean };
}

export const DEFAULT_SPLITTER_MAX_WEB_CALLS = 20;

export const DEFAULT_QUEUE_HOTSPOTS: string[] = [
  "ui/src/i18n.ts", "ui/src/api.ts", "ui/src/types.ts", "ui/src/App.tsx",
  "src/server/http.ts", "docs/PROGRESS.md", "package.json", "package-lock.json",
];
export const QUEUE_MAX_PARALLEL_CEILING = 10;
// Queue budget ceiling of 30 USD, raised from 10 at the user's request.
// An explicit null in config means "no ceiling"; invalid or missing values still fall back to this default.
export const DEFAULT_QUEUE_MAX_BUDGET_USD = 30;

/** `workshop3d`: loop limits of new 3D workshop sessions; every key optional (defaults in src/core/workshop3d/state.ts). */
export interface Workshop3DConfig {
  maxFixRounds?: number;
  /** Fix rounds in a row without a better review total before the loop stops (0 = never stop early). */
  maxNoImproveRounds?: number;
  /** Automatic resumes after interruptions (0..5). */
  maxAutoResumes?: number;
  /** true = the cad-modeler resumes its own earlier Claude session in the fix rounds (default false; reviewers always start fresh). */
  resumeModeler?: boolean;
  /** `workshop3d.blender`: high-quality Blender render (missing = defaults; read it with parseW3DBlender). */
  blender?: W3DBlenderConfig;
}

/**
 * `workshop3d.blender`: Blender Cycles render of the final images (docs/DESIGN-3D.md "Render chất lượng cao bằng Blender").
 * Used only when Blender is found (findBlender); every key optional.
 */
export interface W3DBlenderConfig {
  enabled: boolean;
  /** blender.exe (also tools.blender / TNF_BLENDER); null = look in D:\tnf-cad-tools\blender\*\blender.exe. */
  path: string | null;
  width: number;
  height: number;
  samples: number;
  device: "auto" | "cuda" | "cpu";
  /** Each image is its own Blender process, killed (whole tree) after this many seconds. */
  perImageTimeoutSec: number;
  /** Preset names (overview, door, ceiling, floor, wall_left, wall_right, wall_back, cop) or plan:<camera>; [] = automatic. */
  views: string[];
  /** Also write outputs/model-blender.glb (kept only with 0 gltf-validator errors). */
  exportGlb: boolean;
  /** Targeted fix rounds after the final review (0..3); >= 2 also lets geometry issues go back to modeling. */
  finalFixRounds: number;
  /** Strong machines: Blender renders every review round (lower settings below), one review phase. */
  inLoop: boolean;
  loop: { width: number; height: number; samples: number };
  exposure: number;
}

export const W3D_BLENDER_DEFAULTS: W3DBlenderConfig = {
  enabled: true, path: null, width: 1280, height: 960, samples: 64, device: "auto", perImageTimeoutSec: 1500, views: [],
  exportGlb: true, finalFixRounds: 0, inLoop: false, loop: { width: 640, height: 480, samples: 24 }, exposure: 0.6,
};

/** Never throws: wrong types use the defaults, numbers are clamped. */
export function parseW3DBlender(raw: unknown): W3DBlenderConfig {
  const o = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const d = W3D_BLENDER_DEFAULTS;
  const int = (v: unknown, lo: number, hi: number, dflt: number): number => (typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, Math.round(v))) : dflt);
  const lp = (typeof o["loop"] === "object" && o["loop"] !== null ? o["loop"] : {}) as Record<string, unknown>;
  const views = Array.isArray(o["views"]) ? (o["views"] as unknown[]).filter((v): v is string => typeof v === "string" && /^(plan:)?[a-z0-9_-]{1,44}$/.test(v)).slice(0, 12) : d.views;
  return {
    enabled: typeof o["enabled"] === "boolean" ? o["enabled"] : d.enabled,
    path: typeof o["path"] === "string" && o["path"].trim() ? o["path"].trim() : null,
    width: int(o["width"], 160, 4096, d.width),
    height: int(o["height"], 120, 4096, d.height),
    samples: int(o["samples"], 1, 4096, d.samples),
    device: o["device"] === "cuda" || o["device"] === "cpu" ? o["device"] : "auto",
    perImageTimeoutSec: int(o["perImageTimeoutSec"], 30, 7200, d.perImageTimeoutSec),
    views,
    exportGlb: typeof o["exportGlb"] === "boolean" ? o["exportGlb"] : d.exportGlb,
    finalFixRounds: int(o["finalFixRounds"], 0, 3, d.finalFixRounds),
    inLoop: o["inLoop"] === true,
    loop: { width: int(lp["width"], 160, 4096, d.loop.width), height: int(lp["height"], 120, 4096, d.loop.height), samples: int(lp["samples"], 1, 4096, d.loop.samples) },
    exposure: typeof o["exposure"] === "number" && Number.isFinite(o["exposure"]) ? Math.min(5, Math.max(-5, o["exposure"])) : d.exposure,
  };
}

/** Never throws; keeps only finite numbers (state.ts clamps them). */
export function parseWorkshop3D(raw: unknown): Workshop3DConfig {
  const o = (typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const out: Workshop3DConfig = {};
  for (const k of ["maxFixRounds", "maxNoImproveRounds", "maxAutoResumes"] as const) {
    const v = o[k];
    if (typeof v === "number" && Number.isFinite(v)) out[k] = v;
  }
  if (typeof o["resumeModeler"] === "boolean") out.resumeModeler = o["resumeModeler"];
  if (o["blender"] !== undefined) out.blender = parseW3DBlender(o["blender"]);
  return out;
}

/** Never throws; missing or malformed keys use defaults, maxParallel is clamped to 1..10. */
export function parseQueue(raw: unknown): QueueConfig {
  const q = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  const mp = typeof q["maxParallel"] === "number" && Number.isFinite(q["maxParallel"]) ? Math.floor(q["maxParallel"]) : 2;
  const budget = q["maxBudgetUsd"];
  const replan = q["replan"] as { enabled?: unknown } | undefined;
  const sp = (typeof q["splitter"] === "object" && q["splitter"] !== null ? q["splitter"] : undefined) as
    | { webSearch?: unknown; maxWebCalls?: unknown; interview?: unknown; critic?: unknown; autoIntegrate?: unknown }
    | undefined;
  const hs = Array.isArray(q["hotspots"])
    ? (q["hotspots"] as unknown[]).filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim())
    : null;
  return {
    maxParallel: Math.min(QUEUE_MAX_PARALLEL_CEILING, Math.max(1, mp)),
    maxBudgetUsd:
      budget === null
        ? null
        : typeof budget === "number" && Number.isFinite(budget) && budget > 0
          ? budget
          : DEFAULT_QUEUE_MAX_BUDGET_USD,
    replan: { enabled: replan?.enabled === true },
    scopeGuard: { enabled: (q["scopeGuard"] as { enabled?: unknown } | undefined)?.enabled !== false },
    hotspots: hs ?? [...DEFAULT_QUEUE_HOTSPOTS],
    splitter: {
      webSearch: sp?.webSearch === false ? false : true,
      maxWebCalls:
        typeof sp?.maxWebCalls === "number" && Number.isFinite(sp.maxWebCalls) && sp.maxWebCalls >= 0
          ? Math.floor(sp.maxWebCalls)
          : DEFAULT_SPLITTER_MAX_WEB_CALLS,
      interview: sp?.interview !== false,
      critic: sp?.critic !== false,
      autoIntegrate: sp?.autoIntegrate !== false,
    },
    lessons: { enabled: (q["lessons"] as { enabled?: unknown } | undefined)?.enabled !== false },
  };
}

/** `ui.dailyCostWarnUsd`: positive finite number, otherwise null (no warning). Never throws. */
export function parseDailyCostWarn(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) && raw > 0 ? raw : null;
}

export const LEGACY_TOWER2 = "Tower 2";
export const DEFAULT_TOWERS: [string, string] = ["TNF Tower", "Huấn luyện AI"];

/** Two non-empty strings (trimmed, max 40 chars); anything else falls back to the defaults. */
export function parseTowers(raw: unknown): [string, string] {
  if (!Array.isArray(raw) || raw.length !== 2) return [...DEFAULT_TOWERS];
  const names = raw.map((v) => (typeof v === "string" ? v.trim().slice(0, 40).trim() : ""));
  if (names.some((n) => !n)) return [...DEFAULT_TOWERS];
  return [names[0]!, names[1] === LEGACY_TOWER2 ? DEFAULT_TOWERS[1] : names[1]!];
}

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = path.resolve(HERE, "..", "..", "..");

/** CONTEXT-SPEC-v1 §4.2: union of the coding roles' tools. Never Bash(git *) / Bash(*) / Web*. */
export const CODING_ALLOWED_TOOLS = [
  "Agent", "Read", "Grep", "Glob", "Edit", "Write",
  "Bash(npm test*)", "Bash(npm run *)", "Bash(npx vitest*)", "Bash(npx tsc*)", "Bash(node *)",
  "Bash(git add*)", "Bash(git commit*)", "Bash(git diff*)", "Bash(git status*)", "Bash(git log*)", "Bash(git show*)", "Bash(git branch --show-current*)",
];
/** CONTEXT-SPEC-v1 §4.3: second layer, independent of the settings file being read. */
export const CODING_DISALLOWED_TOOLS = ["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"];
const RESEARCH_ALLOWED_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];

/** Expand `%NAME%` environment references (installed layout uses `%LOCALAPPDATA%\TNF\Controller\...`). Unknown names are left as-is. */
export function expandEnv(p: string, env: NodeJS.ProcessEnv = process.env): string {
  return p.replace(/%([A-Za-z_][A-Za-z0-9_()]*)%/g, (m, name: string) => {
    const v = env[name] ?? env[name.toUpperCase()];
    return v === undefined ? m : v;
  });
}

function resolveFrom(root: string, p: string): string {
  const e = expandEnv(p);
  return path.isAbsolute(e) ? e : path.resolve(root, e);
}

/** Keep only well-formed http(s) origins, lower-cased, without path or trailing slash; anything else is dropped. */
export function normalizeOrigins(list: string[]): string[] {
  const out: string[] = [];
  for (const raw of list) {
    const v = raw.trim().toLowerCase().replace(/\/+$/, "");
    if (!/^https?:\/\/[a-z0-9.-]+(?::\d{1,5})?$/.test(v)) continue;
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

function strArray(v: unknown): string[] | undefined {
  return Array.isArray(v) ? v.map(String) : undefined;
}

function parseContextScan(raw: unknown, fallback: ContextScanConfig | undefined): ContextScanConfig | undefined {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("config: contextScan phải là một đối tượng.");
  const o = raw as Record<string, unknown>;
  const base = fallback ?? DEFAULT_CONTEXT_SCAN;
  if (o["enabled"] !== undefined && typeof o["enabled"] !== "boolean") throw new Error("config: contextScan.enabled phải là true/false.");
  const maxBytes = o["maxBytes"] ?? base.maxBytes;
  if (typeof maxBytes !== "number" || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > CONTEXT_SCAN_MAX_BYTES_CEILING) {
    throw new Error(`config: contextScan.maxBytes phải là số nguyên từ 1 đến ${CONTEXT_SCAN_MAX_BYTES_CEILING}.`);
  }
  let files = base.files;
  if (o["files"] !== undefined) {
    if (!Array.isArray(o["files"]) || o["files"].length > 10 || o["files"].some((f) => typeof f !== "string" || !f.trim())) {
      throw new Error("config: contextScan.files phải là mảng tối đa 10 đường dẫn tương đối.");
    }
    files = (o["files"] as string[]).map((f) => f.trim());
  }
  return { enabled: (o["enabled"] as boolean | undefined) ?? base.enabled, maxBytes, files };
}

/** JSON shape: { mode: "copy" | "junction" | "none", maxMb: 1..NODE_MODULES_MAX_MB_CEILING }; missing keys keep the fallback. */
function parseNodeModules(raw: unknown, fallback: NodeModulesConfig | undefined): NodeModulesConfig | undefined {
  if (raw === undefined || raw === null) return fallback;
  if (typeof raw !== "object" || Array.isArray(raw)) throw new Error("config: nodeModules phải là một đối tượng.");
  const o = raw as Record<string, unknown>;
  const base = fallback ?? DEFAULT_NODE_MODULES;
  const mode = o["mode"] ?? base.mode;
  if (mode !== "copy" && mode !== "junction" && mode !== "none") throw new Error('config: nodeModules.mode phải là "copy", "junction" hoặc "none".');
  const maxMb = o["maxMb"] ?? Math.round(base.maxBytes / (1024 * 1024));
  if (typeof maxMb !== "number" || !Number.isInteger(maxMb) || maxMb < 1 || maxMb > NODE_MODULES_MAX_MB_CEILING) {
    throw new Error(`config: nodeModules.maxMb phải là số nguyên từ 1 đến ${NODE_MODULES_MAX_MB_CEILING}.`);
  }
  return { mode: mode as NodeModulesMode, maxBytes: maxMb * 1024 * 1024 };
}

type RawKind =Partial<Record<keyof KindDefaults, unknown>>;

function kindDefaults(raw: RawKind | undefined, root: string, fallback: KindDefaults): KindDefaults {
  const r = raw ?? {};
  const out: KindDefaults = {
    allowedTools: strArray(r.allowedTools) ?? fallback.allowedTools,
    agentsFile: typeof r.agentsFile === "string" ? resolveFrom(root, r.agentsFile) : fallback.agentsFile,
    systemPromptFile: typeof r.systemPromptFile === "string" ? resolveFrom(root, r.systemPromptFile) : fallback.systemPromptFile,
    disallowedTools: strArray(r.disallowedTools) ?? fallback.disallowedTools,
    extraArgs: strArray(r.extraArgs) ?? fallback.extraArgs,
    maxRoleCalls: typeof r.maxRoleCalls === "number" ? r.maxRoleCalls : fallback.maxRoleCalls,
  };
  if (typeof r.callTimeoutMinutes === "number" && Number.isFinite(r.callTimeoutMinutes) && r.callTimeoutMinutes > 0) out.callTimeoutMinutes = r.callTimeoutMinutes;
  else if (fallback.callTimeoutMinutes !== undefined) out.callTimeoutMinutes = fallback.callTimeoutMinutes;
  if (r.permissionMode === "dontAsk" || r.permissionMode === "bypassPermissions") out.permissionMode = r.permissionMode;
  else if (fallback.permissionMode) out.permissionMode = fallback.permissionMode;
  const known = strArray(r.knownEnvFailures)?.map((s) => s.trim()).filter(Boolean);
  if (known) out.knownEnvFailures = known;
  else if (fallback.knownEnvFailures) out.knownEnvFailures = fallback.knownEnvFailures;
  const scan = parseContextScan(r.contextScan, fallback.contextScan);
  if (scan) out.contextScan = scan;
  const nm = parseNodeModules(r.nodeModules, fallback.nodeModules);
  if (nm) out.nodeModules = nm;
  const settings = typeof r.settingsFile === "string" ? resolveFrom(root, r.settingsFile) : r.settingsFile === null ? undefined : fallback.settingsFile;
  if (settings) out.settingsFile = settings;
  return out;
}

/** Load config/controller.json and resolve all paths against the repo root. */
export const DEFAULT_RUN_TIMEOUT_MS = 60 * 60 * 1000;
const OLD_DEFAULT_RUN_TIMEOUT_MS = 30 * 60 * 1000;

/** Missing -> 60 min; exactly the old 30 min default (installed configs keep it on upgrade) -> 60 min; any other explicit value is kept. */
export function migrateRunTimeout(v: number | undefined): number {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v === OLD_DEFAULT_RUN_TIMEOUT_MS) return DEFAULT_RUN_TIMEOUT_MS;
  return v;
}

export function loadConfig(configPath?: string): ControllerConfig {
  const file = configPath ?? path.join(REPO_ROOT, "config", "controller.json");
  const raw = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
  const root = path.dirname(path.dirname(file));
  const d = (raw["defaults"] ?? {}) as Record<string, unknown>;
  const server = raw["server"] as { host?: string; port?: number; allowedOrigins?: unknown } | undefined;
  const limits = raw["limits"] as { maxTurnsCeiling?: number; maxBudgetUsdCeiling?: number; maxRoleCallsCeiling?: number } | undefined;

  // Research: legacy flat fields are the fallback for defaults.research (older controller.json files).
  const researchFallback: KindDefaults = {
    allowedTools: strArray(d["allowedTools"]) ?? RESEARCH_ALLOWED_TOOLS,
    agentsFile: resolveFrom(root, typeof d["agentsFile"] === "string" ? d["agentsFile"] : "./config/roles-research.json"),
    systemPromptFile: resolveFrom(root, typeof d["systemPromptFile"] === "string" ? d["systemPromptFile"] : "./config/coordinator-research.md"),
    disallowedTools: [],
    extraArgs: strArray(d["extraArgs"]) ?? [],
    maxRoleCalls: 10,
  };
  const codingFallback: KindDefaults = {
    allowedTools: CODING_ALLOWED_TOOLS,
    agentsFile: resolveFrom(root, "./config/roles-coding.json"),
    systemPromptFile: resolveFrom(root, "./config/coordinator-coding.md"),
    settingsFile: resolveFrom(root, "./config/deny-settings.json"),
    disallowedTools: CODING_DISALLOWED_TOOLS,
    extraArgs: ["--setting-sources", "project"],
    maxRoleCalls: CODING_DEFAULT_ROLE_CALLS,
    contextScan: DEFAULT_CONTEXT_SCAN,
    nodeModules: DEFAULT_NODE_MODULES,
    callTimeoutMinutes: DEFAULT_CALL_TIMEOUT_MINUTES,
    knownEnvFailures: DEFAULT_KNOWN_ENV_FAILURES,
    permissionMode: "bypassPermissions",
  };
  const research = kindDefaults(d["research"] as RawKind | undefined, root, researchFallback);
  const coding = kindDefaults(d["coding"] as RawKind | undefined, root, codingFallback);
  // An installed controller.json keeps its old value across upgrades (it is never overwritten), and the old default of 8
  // cannot fit the standard chain once the implementer works in slices: never go below the minimum.
  coding.maxRoleCalls = Math.max(coding.maxRoleCalls, CODING_MIN_ROLE_CALLS, CODING_MIN_ROLE_CALLS_EFFECTIVE);

  const defaults: RunDefaults = {
    authMode: (d["authMode"] as AuthMode | undefined) ?? "subscription",
    model: (d["model"] as string | undefined) ?? "sonnet",
    maxTurns: (d["maxTurns"] as number | undefined) ?? 40,
    maxBudgetUsd: (d["maxBudgetUsd"] as number | undefined) ?? 3,
    // 60 min. The previous default (30 min) kept cutting long runs; an installed controller.json still holding exactly that old default is migrated.
    timeoutMs: migrateRunTimeout(d["timeoutMs"] as number | undefined),
    maxConcurrentSubagents: (d["maxConcurrentSubagents"] as number | undefined) ?? 3,
    maxSubagentSpawnDepth: (d["maxSubagentSpawnDepth"] as number | undefined) ?? 1,
    allowedTools: research.allowedTools,
    agentsFile: research.agentsFile,
    systemPromptFile: research.systemPromptFile,
    extraArgs: research.extraArgs,
    research,
    coding,
  };

  const claudePathRaw = raw["claudePath"];
  const agyPathRaw = raw["agyPath"];
  const codexPathRaw = raw["codexPath"];
  const modelsRaw = Array.isArray(raw["models"]) ? (raw["models"] as unknown[]) : [];
  const models: ModelChoice[] = modelsRaw
    .filter((m): m is { id: string; label?: string } => typeof m === "object" && m !== null && typeof (m as { id?: unknown }).id === "string")
    .map((m) => ({ id: m.id, label: m.label ?? m.id }));
  const workspaceDir = resolveFrom(root, (raw["workspaceDir"] as string | undefined) ?? "../tnf-claude-workspace");
  return {
    repoRoot: root,
    claudePath: typeof claudePathRaw === "string" && claudePathRaw.length > 0 ? claudePathRaw : null,
    agyPath: typeof agyPathRaw === "string" && agyPathRaw.length > 0 ? agyPathRaw : null,
    codexPath: typeof codexPathRaw === "string" && codexPathRaw.length > 0 ? codexPathRaw : null,
    models: models.length ? models : [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }, { id: "opus", label: "opus" }],
    workspaceDir,
    worktreesDir: typeof raw["worktreesDir"] === "string" ? resolveFrom(root, raw["worktreesDir"]) : path.join(workspaceDir, "worktrees"),
    dataDir: resolveFrom(root, (raw["dataDir"] as string | undefined) ?? "./data"),
    server: { host: server?.host ?? "127.0.0.1", port: server?.port ?? 4800, allowedOrigins: normalizeOrigins(strArray(server?.allowedOrigins) ?? []) },
    defaults,
    limits: {
      maxTurnsCeiling: limits?.maxTurnsCeiling ?? 100,
      maxBudgetUsdCeiling: limits?.maxBudgetUsdCeiling ?? 10,
      maxRoleCallsCeiling: limits?.maxRoleCallsCeiling ?? DEFAULT_MAX_ROLE_CALLS_CEILING,
    },
    ui: {
      towers: parseTowers((raw["ui"] as { towers?: unknown } | undefined)?.towers),
      dailyCostWarnUsd: parseDailyCostWarn((raw["ui"] as { dailyCostWarnUsd?: unknown } | undefined)?.dailyCostWarnUsd),
    },
    autoResume: parseAutoResume(raw["autoResume"]),
    release: { allowRemote: (raw["release"] as { allowRemote?: unknown } | undefined)?.allowRemote === true },
    tools: {
      cad: { python: typeof (raw["tools"] as { cad?: { python?: unknown } } | undefined)?.cad?.python === "string" ? ((raw["tools"] as { cad: { python: string } }).cad.python || null) : null },
      blender: typeof (raw["tools"] as { blender?: unknown } | undefined)?.blender === "string" ? ((raw["tools"] as { blender: string }).blender || null) : null,
    },
    ideaAgents: parseIdeaAgents(raw["ideaAgents"]),
    queue: parseQueue(raw["queue"]),
    automation: parseAutomation(raw["automation"]),
    workshop3d: parseWorkshop3D(raw["workshop3d"]),
  };
}
