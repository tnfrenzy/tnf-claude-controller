import fs from "node:fs";
import path from "node:path";
import { normalizeOrigins, CODING_MIN_ROLE_CALLS, DEFAULT_MAX_ROLE_CALLS_CEILING, QUEUE_MAX_PARALLEL_CEILING, ideaAgentsOf, type ControllerConfig } from "./config.js";
import { sanitizeGrants, type Grants } from "../run/grants.js";
import { sanitizeW3DModels, type W3DModelSettings } from "../workshop3d/model-settings.js";
import type { RoleAccountMap } from "../shared-types.js";
import { DEFAULT_AGY_MODELS, DEFAULT_CODEX_MODELS } from "../run/providers/model-distribution.js";

/** Ceilings the Settings tab may set (hard limits of the form, not of controller.json). */
export const TUNING_LIMITS = { budgetCeilingMax: 100, turnsCeilingMax: 500, webCallsMax: 100 };

/** Adjustable values of the "Điều chỉnh" settings tab. Every key optional; saved ones override controller.json. */
export interface Tuning {
  /** USD per day above which the Command page warns; null = no warning. */
  dailyCostWarnUsd?: number | null;
  /** USD ceiling of the planner queue; null = unlimited. */
  queueMaxBudgetUsd?: number | null;
  defaultModel?: string;
  defaultMaxBudgetUsd?: number;
  defaultMaxTurns?: number;
  maxBudgetUsdCeiling?: number;
  maxTurnsCeiling?: number;
  codingMaxRoleCalls?: number;
  scoutModel?: string;
  scoutBudgetUsd?: number;
  splitterModel?: string;
  splitterBudgetUsd?: number;
  replanBudgetUsd?: number;
  replanEnabled?: boolean;
  /** Hold a run that may touch the same files as a running/waiting peer of its project. */
  scopeGuardEnabled?: boolean;
  scopeModel?: string;
  scopeBudgetUsd?: number;
  splitterWebSearch?: boolean;
  splitterMaxWebCalls?: number;
  /** idea-interviewer (questions before the split) model, budget and switch. */
  interviewModel?: string;
  interviewBudgetUsd?: number;
  splitterInterview?: boolean;
  /** idea-critic (review + one re-split) model, budget and switch. */
  criticModel?: string;
  criticBudgetUsd?: number;
  splitterCritic?: boolean;
  /** Append integrate + final-review to every idea batch. */
  splitterAutoIntegrate?: boolean;
  /** Record a lesson line in lessons.md when a queued command fails. */
  queueLessons?: boolean;
}

export type FullTuning = Required<Tuning>;

/** User-changeable app settings kept in `<dataDir>/app-settings.json` (the shipped controller.json is never rewritten). */
export interface AppSettings {
  /** Most coding runs that may run at once in the whole app; extra runs wait and start in order. */
  maxRuns?: number;
  tuning?: Tuning;
  /** Extra browser origins added from Settings > Điện thoại (Tailscale Serve), on top of controller.json. */
  allowedOrigins?: string[];
  /** Folder where runs copy their deliverables; unset = built-in default. */
  outputDir?: string;
  /** Default permission ticks for environments that have none of their own. */
  defaultGrants?: Grants;
  /** 3D workshop: model per role group (main / light); a missing field = the model in roles-design3d.json. */
  workshop3d?: { models?: W3DModelSettings };
  /** Per-role CLI account & model override for controller-orchestrated flows (Level B) and phased coding (Level D). */
  roleAccounts?: RoleAccountMap;
}

export function sanitizeRoleAccounts(raw: unknown): RoleAccountMap {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return {};
  const out: RoleAccountMap = {};
  for (const [role, v] of Object.entries(raw as Record<string, unknown>)) {
    const r = role.trim();
    if (!r || !/^[a-z0-9_-]{1,50}$/i.test(r)) continue;
    if (typeof v !== "object" || v === null || Array.isArray(v)) continue;
    const o = v as Record<string, unknown>;
    const accountId = typeof o["accountId"] === "string" && o["accountId"].trim() ? o["accountId"].trim() : null;
    const model = typeof o["model"] === "string" && o["model"].trim() ? o["model"].trim() : null;
    if (accountId || model) out[r] = { ...(accountId ? { accountId } : {}), ...(model ? { model } : {}) };
  }
  return out;
}

export function clampMaxRuns(n: unknown): number | null {
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  return Math.min(QUEUE_MAX_PARALLEL_CEILING, Math.max(1, Math.floor(n)));
}

function file(dataDir: string): string {
  return path.join(dataDir, "app-settings.json");
}

const NUM_KEYS = ["defaultMaxBudgetUsd", "defaultMaxTurns", "maxBudgetUsdCeiling", "maxTurnsCeiling", "codingMaxRoleCalls", "scoutBudgetUsd", "splitterBudgetUsd", "replanBudgetUsd", "scopeBudgetUsd", "splitterMaxWebCalls", "interviewBudgetUsd", "criticBudgetUsd"] as const;
const STR_KEYS = ["defaultModel", "scoutModel", "splitterModel", "scopeModel", "interviewModel", "criticModel"] as const;
const BOOL_KEYS = ["replanEnabled", "scopeGuardEnabled", "splitterWebSearch", "splitterInterview", "splitterCritic", "splitterAutoIntegrate", "queueLessons"] as const;
const NULLABLE_KEYS = ["dailyCostWarnUsd", "queueMaxBudgetUsd"] as const;

/** Keep only known keys of the right type (file may be hand-edited); cross-field checks happen in validateTuning. */
export function sanitizeTuning(raw: unknown): Tuning {
  if (typeof raw !== "object" || raw === null) return {};
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const k of NUM_KEYS) if (typeof r[k] === "number" && Number.isFinite(r[k])) out[k] = r[k];
  for (const k of STR_KEYS) if (typeof r[k] === "string" && (r[k] as string).trim()) out[k] = (r[k] as string).trim();
  for (const k of BOOL_KEYS) if (typeof r[k] === "boolean") out[k] = r[k];
  for (const k of NULLABLE_KEYS) if (r[k] === null || (typeof r[k] === "number" && Number.isFinite(r[k]) && (r[k] as number) > 0)) out[k] = r[k];
  return out as Tuning;
}

export function loadAppSettings(dataDir: string): AppSettings {
  try {
    const raw = JSON.parse(fs.readFileSync(file(dataDir), "utf8")) as Record<string, unknown>;
    const out: AppSettings = {};
    const maxRuns = clampMaxRuns(raw["maxRuns"]);
    if (maxRuns !== null) out.maxRuns = maxRuns;
    const tuning = sanitizeTuning(raw["tuning"]);
    if (Object.keys(tuning).length) out.tuning = tuning;
    if (Array.isArray(raw["allowedOrigins"])) {
      const origins = normalizeOrigins((raw["allowedOrigins"] as unknown[]).filter((v): v is string => typeof v === "string"));
      if (origins.length) out.allowedOrigins = origins;
    }
    if (typeof raw["outputDir"] === "string" && raw["outputDir"]) out.outputDir = raw["outputDir"] as string;
    if (raw["defaultGrants"] && typeof raw["defaultGrants"] === "object") out.defaultGrants = sanitizeGrants(raw["defaultGrants"]);
    const w3d = raw["workshop3d"];
    if (w3d && typeof w3d === "object") out.workshop3d = { models: sanitizeW3DModels((w3d as Record<string, unknown>)["models"]) };
    if (raw["roleAccounts"] && typeof raw["roleAccounts"] === "object") {
      const ra = sanitizeRoleAccounts(raw["roleAccounts"]);
      if (Object.keys(ra).length) out.roleAccounts = ra;
    }
    return out;
  } catch {
    return {};
  }
}

export function saveAppSettings(dataDir: string, patch: AppSettings): AppSettings {
  const prev = loadAppSettings(dataDir);
  const next: AppSettings = { ...prev, ...patch };
  if (patch.tuning) next.tuning = { ...(prev.tuning ?? {}), ...patch.tuning };
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file(dataDir), JSON.stringify(next, null, 2), "utf8");
  return next;
}

/** Values in force right now (controller.json merged with the saved Settings values). */
export function currentTuning(config: ControllerConfig): FullTuning {
  const ia = ideaAgentsOf(config);
  return {
    dailyCostWarnUsd: config.ui?.dailyCostWarnUsd ?? null,
    queueMaxBudgetUsd: config.queue?.maxBudgetUsd ?? null,
    defaultModel: config.defaults.model,
    defaultMaxBudgetUsd: config.defaults.maxBudgetUsd,
    defaultMaxTurns: config.defaults.maxTurns,
    maxBudgetUsdCeiling: config.limits.maxBudgetUsdCeiling,
    maxTurnsCeiling: config.limits.maxTurnsCeiling,
    codingMaxRoleCalls: config.defaults.coding.maxRoleCalls,
    scoutModel: ia.scoutModel,
    scoutBudgetUsd: ia.scoutBudgetUsd,
    splitterModel: ia.splitterModel,
    splitterBudgetUsd: ia.splitterBudgetUsd,
    replanBudgetUsd: ia.replanBudgetUsd,
    scopeModel: ia.scopeModel,
    scopeBudgetUsd: ia.scopeBudgetUsd,
    scopeGuardEnabled: config.queue?.scopeGuard?.enabled === true,
    replanEnabled: config.queue?.replan?.enabled === true,
    splitterWebSearch: config.queue?.splitter?.webSearch !== false,
    splitterMaxWebCalls: config.queue?.splitter?.maxWebCalls ?? 20,
    interviewModel: ia.interviewModel,
    interviewBudgetUsd: ia.interviewBudgetUsd,
    criticModel: ia.criticModel,
    criticBudgetUsd: ia.criticBudgetUsd,
    splitterInterview: config.queue?.splitter?.interview === true,
    splitterCritic: config.queue?.splitter?.critic === true,
    splitterAutoIntegrate: config.queue?.splitter?.autoIntegrate === true,
    queueLessons: config.queue?.lessons?.enabled === true,
  };
}

/** Write the values into the live config object (takes effect for the next run, no restart). */
export function applyTuning(config: ControllerConfig, t: Tuning): void {
  if (t.dailyCostWarnUsd !== undefined) config.ui.dailyCostWarnUsd = t.dailyCostWarnUsd;
  if (t.queueMaxBudgetUsd !== undefined) config.queue.maxBudgetUsd = t.queueMaxBudgetUsd;
  if (t.defaultModel !== undefined) config.defaults.model = t.defaultModel;
  if (t.defaultMaxBudgetUsd !== undefined) config.defaults.maxBudgetUsd = t.defaultMaxBudgetUsd;
  if (t.defaultMaxTurns !== undefined) config.defaults.maxTurns = t.defaultMaxTurns;
  if (t.maxBudgetUsdCeiling !== undefined) config.limits.maxBudgetUsdCeiling = t.maxBudgetUsdCeiling;
  if (t.maxTurnsCeiling !== undefined) config.limits.maxTurnsCeiling = t.maxTurnsCeiling;
  if (t.codingMaxRoleCalls !== undefined) config.defaults.coding.maxRoleCalls = t.codingMaxRoleCalls;
  const ia = { ...ideaAgentsOf(config) };
  if (t.scoutModel !== undefined) ia.scoutModel = t.scoutModel;
  if (t.scoutBudgetUsd !== undefined) ia.scoutBudgetUsd = t.scoutBudgetUsd;
  if (t.splitterModel !== undefined) ia.splitterModel = t.splitterModel;
  if (t.splitterBudgetUsd !== undefined) ia.splitterBudgetUsd = t.splitterBudgetUsd;
  if (t.replanBudgetUsd !== undefined) ia.replanBudgetUsd = t.replanBudgetUsd;
  if (t.scopeModel !== undefined) ia.scopeModel = t.scopeModel;
  if (t.scopeBudgetUsd !== undefined) ia.scopeBudgetUsd = t.scopeBudgetUsd;
  if (t.interviewModel !== undefined) ia.interviewModel = t.interviewModel;
  if (t.interviewBudgetUsd !== undefined) ia.interviewBudgetUsd = t.interviewBudgetUsd;
  if (t.criticModel !== undefined) ia.criticModel = t.criticModel;
  if (t.criticBudgetUsd !== undefined) ia.criticBudgetUsd = t.criticBudgetUsd;
  config.ideaAgents = ia;
  if (t.splitterInterview !== undefined) config.queue.splitter = { ...config.queue.splitter, interview: t.splitterInterview };
  if (t.splitterCritic !== undefined) config.queue.splitter = { ...config.queue.splitter, critic: t.splitterCritic };
  if (t.splitterAutoIntegrate !== undefined) config.queue.splitter = { ...config.queue.splitter, autoIntegrate: t.splitterAutoIntegrate };
  if (t.queueLessons !== undefined) config.queue.lessons = { enabled: t.queueLessons };
  if (t.scopeGuardEnabled !== undefined) config.queue.scopeGuard = { enabled: t.scopeGuardEnabled };
  if (t.replanEnabled !== undefined) config.queue.replan = { ...config.queue.replan, enabled: t.replanEnabled };
  if (t.splitterWebSearch !== undefined) config.queue.splitter = { ...config.queue.splitter, webSearch: t.splitterWebSearch };
  if (t.splitterMaxWebCalls !== undefined) config.queue.splitter = { ...config.queue.splitter, maxWebCalls: t.splitterMaxWebCalls };
}

export type TuningCheck = { ok: true; patch: Tuning } | { ok: false; message: string };

/**
 * Validate a partial change against the values in force (cross-field: budgets must fit the ceiling).
 * Messages are Vietnamese because they reach the user as-is.
 */
export function validateTuning(body: unknown, config: ControllerConfig, extraModelIds?: Iterable<string>): TuningCheck {
  if (typeof body !== "object" || body === null || Array.isArray(body)) return { ok: false, message: "Dữ liệu cài đặt không hợp lệ." };
  const raw = body as Record<string, unknown>;
  const known = new Set<string>([...NUM_KEYS, ...STR_KEYS, ...BOOL_KEYS, ...NULLABLE_KEYS]);
  for (const k of Object.keys(raw)) if (!known.has(k)) return { ok: false, message: `Khóa cài đặt lạ: ${k}.` };
  const patch: Record<string, unknown> = {};
  const err = (m: string): TuningCheck => ({ ok: false, message: m });

  for (const k of NULLABLE_KEYS) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (v !== null && !(typeof v === "number" && Number.isFinite(v) && v > 0)) return err("Mức trần phải là số lớn hơn 0 (hoặc để trống = không giới hạn/tắt).");
    patch[k] = v;
  }
  for (const k of NUM_KEYS) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (typeof v !== "number" || !Number.isFinite(v)) return err("Giá trị số không hợp lệ.");
    patch[k] = v;
  }
  const modelIds = new Set<string>([
    ...config.models.map((m) => m.id),
    ...DEFAULT_AGY_MODELS.map((m) => m.id),
    ...DEFAULT_CODEX_MODELS.map((m) => m.id),
    ...(extraModelIds ?? []),
  ]);
  for (const k of STR_KEYS) {
    if (!(k in raw)) continue;
    const v = raw[k];
    if (typeof v !== "string" || !modelIds.has(v)) return err("Model không có trong danh sách model của app.");
    patch[k] = v;
  }
  for (const k of BOOL_KEYS) {
    if (!(k in raw)) continue;
    if (typeof raw[k] !== "boolean") return err("Giá trị bật/tắt không hợp lệ.");
    patch[k] = raw[k];
  }

  const cur = currentTuning(config);
  const m = { ...cur, ...patch } as FullTuning;
  const inRange = (v: number, lo: number, hi: number) => v >= lo && v <= hi;
  if (!inRange(m.maxBudgetUsdCeiling, 1, TUNING_LIMITS.budgetCeilingMax)) return err(`Trần ngân sách tối đa phải từ 1 đến ${TUNING_LIMITS.budgetCeilingMax} USD.`);
  if (!inRange(m.maxTurnsCeiling, 10, TUNING_LIMITS.turnsCeilingMax)) return err(`Trần lượt tối đa phải từ 10 đến ${TUNING_LIMITS.turnsCeilingMax}.`);
  const budgets: Array<[string, number]> = [
    ["Ngân sách mặc định mỗi run", m.defaultMaxBudgetUsd],
    ["Ngân sách Agent đề xuất", m.scoutBudgetUsd],
    ["Ngân sách Agent Ý tưởng", m.splitterBudgetUsd],
    ["Ngân sách cập nhật lại kế hoạch", m.replanBudgetUsd],
    ["Ngân sách phân tích phạm vi", m.scopeBudgetUsd],
    ["Ngân sách Agent phỏng vấn", m.interviewBudgetUsd],
    ["Ngân sách Agent phản biện", m.criticBudgetUsd],
  ];
  for (const [label, v] of budgets) {
    if (!inRange(v, 0.05, m.maxBudgetUsdCeiling)) return err(`${label} phải từ 0,05 đến trần ngân sách tối đa (${m.maxBudgetUsdCeiling} USD).`);
  }
  if (!Number.isInteger(m.defaultMaxTurns) || !inRange(m.defaultMaxTurns, 1, m.maxTurnsCeiling)) return err(`Số lượt mặc định phải là số nguyên từ 1 đến trần lượt (${m.maxTurnsCeiling}).`);
  const rc = config.limits.maxRoleCallsCeiling ?? DEFAULT_MAX_ROLE_CALLS_CEILING;
  if (!Number.isInteger(m.codingMaxRoleCalls) || !inRange(m.codingMaxRoleCalls, CODING_MIN_ROLE_CALLS, rc)) return err(`Số lượt gọi vai mỗi run lập trình phải là số nguyên từ ${CODING_MIN_ROLE_CALLS} đến ${rc}.`);
  if (!Number.isInteger(m.splitterMaxWebCalls) || !inRange(m.splitterMaxWebCalls, 0, TUNING_LIMITS.webCallsMax)) return err(`Số lần tìm web của Agent Ý tưởng phải từ 0 đến ${TUNING_LIMITS.webCallsMax}.`);
  return { ok: true, patch: patch as Tuning };
}
