import { spawn } from "node:child_process";
import fs from "node:fs";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { WebSocketServer, type WebSocket } from "ws";
import type { RunStatus, StoredEvent } from "../core/run/events.js";
import { BillingGuardError, sanitizeEnv } from "../core/run/billing-guard.js";
import { MCP_PRESETS, loadMcpServers, saveMcpServers, validateMcpServer, type McpServer, type CliMcpItem } from "../core/mcp/mcp-registry.js";
import { probeMcp } from "../core/mcp/mcp-probe.js";
import { readCliSnapshot, writeCliSnapshot, runClaudeMcpList } from "../core/mcp/mcp-cli.js";
import { defaultOutputDir } from "../core/app/outputs.js";
import { CommentsError, PreviewError, readRoles, roleDefaultModels, type OpenDirTarget, type RunManager, type StartRunInput } from "../core/run/run-manager.js";
import type { RunRecord } from "../core/run/run-store.js";
import { buildCleanupPlan, parseOlderThan } from "../core/git/cleanup-plan.js";
import { executeCleanup } from "../core/git/worktree-cleanup.js";
import { scanUsage } from "../core/usage/usage-blocks.js";
import { resolveReportText } from "../core/run/report-text.js";
import { INBOX_MAX_BYTES, listInbox, saveInboxFile, validateInboxName } from "../core/run/inbox.js";
import { LibraryError, normalizeName } from "../core/roles/role-library.js";
import { importAgentMd, type LibraryImportRequest } from "../core/roles/agent-md-import.js";
import { SkillError, validateSlug, resolveInside } from "../core/skill-workshop/package.js";
import { ATTACH_LIMITS, ATTACH_RE, attachmentRel, validateAttachmentName } from "../core/skill-workshop/attachments.js";
import { createSkillStore } from "../core/skill-workshop/store.js";
import { createSkillsGen } from "./skills-gen.js";
import type { MatchRole } from "../core/roles/role-match.js";
import { createSkillTrainer } from "../core/skill-workshop/runner.js";
import { makeSaveRunReport } from "../core/skill-workshop/run-report.js";
import { createManagerRunStep, SKILL_WORKSHOP_PROJECT, type StepManager } from "../core/skill-workshop/run-step.js";
import { addFromCatalog, catalogFile, readCatalog, searchCatalog } from "../core/roles/role-catalog.js";
import { cadStatus, findCadPython, inspectCad } from "../core/design3d/cad-tools.js";
import { dryRunRelease, executeRelease, newReleaseId, readReleaseLogChecked, type CommandRunner, type FetchLike } from "../core/release/pipeline.js";
import { findIscc } from "../core/release/inno.js";
import { RELEASE_TEMPLATES, ReleaseConfigError, readReleaseConfig, writeReleaseConfig } from "../core/release/config.js";
import { buildZip } from "../core/app/zip.js";
import { locateGit } from "../core/git/git.js";
import { DEFAULT_TOWERS, ideaAgentsOf } from "../core/app/config.js";
import { AUTOPILOT_SCHEDULE_MAX_LEN } from "../core/queue/autopilot-state.js";
import { summarizePeriod } from "../core/usage/period-summary.js";
import { findDuplicates } from "../core/queue/queue-dup.js";
import { authorize, type AuthPolicy } from "./auth.js";
import { loadKit } from "../core/design3d/design3d-kit.js";
import { readStagedW3DImages, W3DAttachmentError } from "../core/workshop3d/attachments.js";
import { createWorkshop3D, tryCreateWorkshop3D, W3DFileError, workshop3dUnavailableMessage, type Workshop3DEngine } from "../core/workshop3d/index.js";
import { W3DError } from "../core/workshop3d/state.js";
import { createMaterialLibrary, type MaterialLibrary } from "../core/workshop3d/material-library.js";
import { createVariantStore } from "../core/workshop3d/variant-store.js";
import { handleVariantsRoute } from "./variants-routes.js";
import { handleMaterialsRoute } from "./materials-routes.js";
import { handleVideoStudioRoute } from "./videostudio-routes.js";
import { handleCliAccountsRoute } from "./routes/cli-accounts.js";
import { createVideoStudio, VIDEOSTUDIO_PROJECT, type VideoStudio } from "../core/videostudio/index.js";
import type { VsStepManager } from "../core/videostudio/agent.js";
import { WORKSHOP3D_PROJECT } from "../core/workshop3d/step-adapter.js";
import { W3D_BRIEF_LIMITS, type W3DBrief } from "../core/workshop3d/types.js";
import { normalizeSlots } from "../core/workshop3d/variants.js";
import { EXT_FORMAT as DESIGN3D_EXT_FORMAT, buildDesign3dFloors } from "../core/design3d/design3d-outputs.js";
import { QUEUE_TRANSITIONS, QueueError, type QueueCommand as QueueCmd } from "../core/queue/queue-store.js";
import { checkBodySafety, checkIndependence, computeWaves, type QueueCommand as PlanCommand, type WaveEntry } from "../core/queue/queue-plan.js";
import { TUNING_LIMITS, clampMaxRuns, loadAppSettings, saveAppSettings } from "../core/app/app-settings.js";
import { validateW3DModels } from "../core/workshop3d/model-settings.js";
import { formatInfo } from "../core/skill-workshop/output-formats.js";
import { disableServe, enableServe, findTailscale, phoneInfo } from "../core/app/phone-access.js";
import { DEFAULT_STAFF_PATH, MAX_CONNECTIONS, publicView } from "../core/app/api-connections.js";
import { TEMPLATES, defaultProjectsDir, scaffoldProject, type TemplateId } from "../core/app/project-scaffold.js";
import { QUEUE_MAX_PARALLEL_CEILING } from "../core/app/config.js";
import { canRunParallel, clampMaxParallel, isUnlocked } from "../core/queue/queue-engine.js";
import { SPLITTER_MAX_IDEA_CHARS, interviewIdea, splitIdea, type SplitDeps, type SplitManager, type SplitSource, type SplitStage } from "../core/ideas/queue-split.js";
import { normalizeAnswers, type InterviewAnswers } from "../core/ideas/idea-agents.js";
import { listPendingInterviews, loadPendingInterview, removePendingInterview, savePendingInterview, type PendingInterview } from "../core/ideas/idea-interview-store.js";
const VI_DIACRITICS = /[àáảãạăằắẳẵặâầấẩẫậèéẻẽẹêềếểễệìíỉĩịòóỏõọôồốổỗộơờớởỡợùúủũụưừứửữựỳýỷỹỵđ]/i;
import { replanCosts, replanDir } from "../core/queue/queue-replan.js";
import { ESTIMATE_NOTE, budgetState, estimateCommandCost, estimateGroupCost, queueSpent } from "../core/queue/queue-budget.js";

export interface ServerOptions {
  manager: RunManager;
  policy: AuthPolicy;
  /** Directory with built UI (index.html). Optional. */
  staticDir?: string | undefined;
  /** Test hooks for the release pipeline (command runner, fetch, path existence, env). */
  releaseDeps?: ReleaseDeps | undefined;
  /** Test hook: replaces the usage log scanner. */
  usageScan?: typeof scanUsage | undefined;
  /** 3D workshop engine; defaults to the real one (tests inject a fake). null = unavailable: its routes answer 503. */
  workshop3d?: Workshop3DEngine | null | undefined;
  /** Why the engine is unavailable (shown in the 503 message) when `workshop3d` is null. */
  workshop3dError?: string | null | undefined;
  /** Test hook: builds the engine instead of createWorkshop3D (a throw makes it unavailable, never stops the server). */
  workshop3dFactory?: (() => Workshop3DEngine) | undefined;
  /** "Tạo hàng loạt" library (tests inject one with a fake python runner); null = its routes answer 503. */
  materialLibrary?: MaterialLibrary | null | undefined;
  /** Video Studio engine; defaults to the real one. null = unavailable: its routes answer 503. */
  videoStudio?: VideoStudio | null;
  /** Test hook: builds the studio instead of createVideoStudio (a throw makes it unavailable). */
  videoStudioFactory?: () => VideoStudio;
}

export interface ReleaseDeps {
  runner?: CommandRunner;
  fetch?: FetchLike;
  exists?: (p: string) => boolean;
  env?: NodeJS.ProcessEnv;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".json": "application/json; charset=utf-8",
  ".webmanifest": "application/manifest+json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".woff2": "font/woff2",
};

function json(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(JSON.stringify(body));
}

function errorMessage(e: unknown): { message: string; kind?: string } {
  if (e instanceof BillingGuardError) return { message: e.message, kind: e.kind };
  if (e instanceof Error) return { message: e.message };
  return { message: String(e) };
}

const REDACTED = "***";

function redactMap(m: Record<string, string> | undefined): Record<string, string> | undefined {
  return m ? Object.fromEntries(Object.keys(m).map((k) => [k, REDACTED])) : m;
}

/** Response view of a registry server: header and env values (bearer tokens, API keys) are never sent back to the browser. */
function redactServer(s: McpServer): McpServer {
  const out: McpServer = { ...s };
  if (s.headers) out.headers = redactMap(s.headers)!;
  if (s.env) out.env = redactMap(s.env)!;
  return out;
}

/**
 * A PUT may echo redacted values back: keep the stored value for every key whose value is still the placeholder.
 * Trade-off: a secret that is literally "***" cannot be set to a new "***" over an existing key (it keeps the stored one).
 */
function restoreMap(cur: Record<string, string> | undefined, incoming: unknown): unknown {
  if (!incoming || typeof incoming !== "object" || Array.isArray(incoming)) return incoming;
  const merged: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(incoming as Record<string, unknown>)) merged[k] = v === REDACTED && cur?.[k] !== undefined ? cur[k] : v;
  return merged;
}

function restoreSecrets(cur: McpServer, patch: Record<string, unknown>): Record<string, unknown> {
  const out = { ...patch };
  if ("headers" in out) out["headers"] = restoreMap(cur.headers, out["headers"]);
  if ("env" in out) out["env"] = restoreMap(cur.env, out["env"]);
  return out;
}

/** Concurrent `claude mcp list` refreshes share one in-flight call (it health-checks every server and is slow). */
let cliRefreshInFlight: Promise<{ at: number; items: CliMcpItem[] }> | null = null;

// ---- Planner queue helpers (docs/PLANNER-QUEUE.md section 8) ----

function toPlanCommand(c: QueueCmd): PlanCommand {
  return { id: c.id, title: c.title, body: c.body, dependsOn: c.dependsOn, files: c.files, verify: "", size: 1 };
}

/** Waves for the whole queue; a cycle or unknown id never throws (waves are then omitted, `error` says why). */
function safeWaves(commands: QueueCmd[], hotspots: string[]): { waves: Map<string, WaveEntry>; error: string | null } {
  const waves = new Map<string, WaveEntry>();
  try {
    const ids = new Set(commands.map((c) => c.id));
    for (const c of commands) {
      for (const d of c.dependsOn) if (!ids.has(d)) throw new Error(`Lệnh "${c.id}" phụ thuộc lệnh không tồn tại "${d}".`);
    }
    for (const w of computeWaves(commands.map(toPlanCommand), { hotspots })) waves.set(w.id, w);
    return { waves, error: null };
  } catch (e) {
    return { waves: new Map(), error: e instanceof Error ? e.message : String(e) };
  }
}

function queueErrorStatus(e: QueueError): number {
  if (e.conflict) return 409;
  if (e.code === "not_found") return 404;
  return 400;
}

function codingRunningCount(manager: RunManager): number {
  return manager.codingActiveCount();
}

function queueRunCheck(manager: RunManager, project: string, cmd: QueueCmd, all: QueueCmd[]): { ok: boolean; reasons: string[]; waiting?: boolean } {
  const q = manager.config.queue;
  const reasons: string[] = [];
  const budget = budgetState(queueSpent(all, replanCosts(replanDir(manager.config.dataDir, project))), q.maxBudgetUsd);
  if (!budget.canOpenNew) reasons.push(budget.message);
  const running = all.filter((c) => c.status === "đang chạy");
  const chk = canRunParallel({ ...cmd, status: "đã duyệt" }, running, q.maxParallel, codingRunningCount(manager), all, q.hotspots);
  if (!chk.ok) reasons.push(...chk.reasons);
  void project;
  return { ok: reasons.length === 0, reasons, waiting: reasons.length > 0 && chk.waiting === true && reasons.length === chk.reasons.length };
}

/** Ids of every run that belongs to a queue command (its own run plus follow-up chain), across all projects. */
function queueRunIdSet(manager: RunManager): Set<string> {
  const ids = new Set<string>();
  for (const p of manager.store.listProjects()) {
    const cmds = manager.queue.list(p.name).filter((c) => c.runId);
    if (cmds.length === 0) continue;
    const index = manager.queueRunIndex(p.name);
    for (const c of cmds) for (const id of manager.queueChainRunIds(c, index)) ids.add(id);
  }
  return ids;
}

function describeQueueCommand(manager: RunManager, cmd: QueueCmd, all: QueueCmd[], waves: Map<string, WaveEntry>, history: number[], index?: Map<string, string[]>) {
  const w = waves.get(cmd.id);
  const est = estimateCommandCost({ size: 1 }, history, manager.config.defaults);
  const editable = cmd.status === "chờ duyệt" || cmd.status === "đã duyệt";
  const canRun = cmd.status === "chờ duyệt" || cmd.status === "đã duyệt";
  const runReasons = canRun ? queueRunCheck(manager, cmd.project, cmd, all).reasons : [`Lệnh đang "${cmd.status}" nên không chạy được.`];
  const skippable = QUEUE_TRANSITIONS[cmd.status].includes("bỏ qua");
  return {
    ...cmd,
    wave: w ? w.wave : null,
    waveReasons: w ? w.reasons : [],
    locks: {
      edit: { locked: !editable, reasons: editable ? [] : [`Lệnh đã chạy hoặc đang "${cmd.status}" nên không sửa được.`] },
      approveRun: { locked: runReasons.length > 0, reasons: runReasons },
      skip: { locked: !skippable, reasons: skippable ? [] : [`Không thể bỏ qua lệnh đang "${cmd.status}".`] },
    },
    estimatedCostUsd: est.estimateUsd,
    runLive: manager.isQueueRunLive(cmd, index),
    runCommitCount: cmd.runId ? (manager.store.getRun(cmd.runId)?.commits.length ?? 0) : 0,
    runIds: manager.queueChainRunIds(cmd, index),
    mergePrecheck: cmd.runId ? (manager.store.getRun(cmd.runId)?.merge_precheck ?? null) : null,
  };
}

async function handleQueueApi(
  manager: RunManager,
  req: IncomingMessage,
  res: ServerResponse,
  method: string,
  name: string,
  target: string | undefined,
  action: string | undefined,
): Promise<void> {
  const store = manager.store;
  const project = store.getProject(name);
  if (!project) return json(res, 404, { error: "project_not_found", message: `Không tìm thấy môi trường "${name}".` });
  if (name === "default" || !project.repo_path) {
    return json(res, 400, { error: "no_repo", message: `Môi trường "${name}" chưa gắn repo nên không có hàng đợi lệnh.` });
  }
  const q = manager.config.queue;
  const notFound = (id: string) =>
    json(res, 404, { error: "not_found", message: `Không tìm thấy lệnh "${id}" trong hàng đợi của "${name}".` });
  try {
    if (target === undefined && method === "GET") {
      const all = manager.queue.list(name);
      const { waves, error } = safeWaves(all, q.hotspots);
      const history = store.listRuns({ kind: "coding", limit: 20 }).map((r) => r.cost_usd_est);
      const runIndex = manager.queueRunIndex(name);
      const commands = all.map((c) => describeQueueCommand(manager, c, all, waves, history, runIndex));
      const total = estimateGroupCost(
        all
          .filter((c) => c.status === "chờ duyệt" || c.status === "đã duyệt")
          .map((c) => estimateCommandCost({ size: 1 }, history, manager.config.defaults)),
      );
      return json(res, 200, {
        commands,
        waveError: error,
        totalEstimatedCostUsd: total.totalEstimateUsd,
        costNote: ESTIMATE_NOTE,
        budget: budgetState(queueSpent(all, replanCosts(replanDir(manager.config.dataDir, name))), q.maxBudgetUsd),
        maxParallel: clampMaxParallel(q.maxParallel),
        codingRunning: codingRunningCount(manager),
        runAll: manager.queueRunAll.status(name),
        // Per-idea blueprint / critic issues / interview, and ideas still waiting for interview answers.
        ideas: manager.queue.listIdeaMeta(name),
        interviews: listPendingInterviews(manager.config.dataDir, name).map((i) => ({
          id: i.id, idea: i.idea, questions: i.questions, createdAt: i.createdAt, ...(i.lastError ? { lastError: i.lastError } : {}),
        })),
      });
    }

    // Must be handled before manager.queue.get(name, target): "run-all" is not a command id.
    if (target === "run-all" && method === "POST" && (action === undefined || action === "stop")) {
      if (action === "stop") {
        manager.queueRunAll.stop(name);
        return json(res, 200, { runAll: manager.queueRunAll.status(name) });
      }
      const body = ((await readBody(req)) ?? {}) as Record<string, unknown>;
      const sourceRef = body["sourceRef"];
      if (sourceRef !== undefined && (typeof sourceRef !== "string" || !sourceRef)) {
        return json(res, 400, { error: "bad_request", message: "sourceRef phải là chuỗi không rỗng (mã ý tưởng)." });
      }
      try {
        await manager.queueRunAll.start(name, sourceRef);
      } catch (e) {
        if ((e as { code?: string }).code === "conflict") return json(res, 409, { error: "conflict", message: (e as Error).message });
        throw e;
      }
      return json(res, 200, { runAll: manager.queueRunAll.status(name) });
    }

    // Approve every pending command of one idea (sourceRef); does not start any run.
    if (target === "approve-all" && action === undefined && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const sourceRef = body["sourceRef"];
      if (typeof sourceRef !== "string" || !sourceRef) {
        return json(res, 400, { error: "bad_request", message: "sourceRef phải là chuỗi không rỗng (mã ý tưởng)." });
      }
      const approved: string[] = [];
      for (const c of manager.queue.list(name)) {
        if (c.sourceRef !== sourceRef || c.status !== "chờ duyệt") continue;
        manager.queue.transition(name, c.id, "đã duyệt");
        approved.push(c.id);
      }
      return json(res, 200, { approved });
    }

    // Delete a whole idea (all its commands); refused while one of them is running.
    if (target === "delete-idea" && action === undefined && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const sourceRef = body["sourceRef"];
      if (typeof sourceRef !== "string" || !sourceRef) {
        return json(res, 400, { error: "bad_request", message: "sourceRef phải là chuỗi không rỗng (mã ý tưởng)." });
      }
      return json(res, 200, { deleted: manager.queue.deleteIdea(name, sourceRef) });
    }

    if (target === "run-parallel" && action === undefined && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const rawIds = body["ids"];
      if (!Array.isArray(rawIds) || rawIds.length === 0 || rawIds.some((x) => typeof x !== "string" || !x)) {
        return json(res, 400, { error: "bad_request", message: "ids phải là mảng id lệnh (chuỗi) không rỗng." });
      }
      const ids = [...new Set(rawIds as string[])];
      const all = manager.queue.list(name);
      const picked: QueueCmd[] = [];
      for (const id of ids) {
        const c = all.find((x) => x.id === id);
        if (!c) return notFound(id);
        picked.push(c);
      }
      const reasons = new Map<string, string[]>(ids.map((id) => [id, []]));
      const add = (id: string, r: string) => reasons.get(id)!.push(r);
      const plans = all.map(toPlanCommand);
      for (const c of picked) {
        if (c.status !== "chờ duyệt" && c.status !== "đã duyệt") add(c.id, `Lệnh đang "${c.status}" nên không chạy được.`);
        const u = isUnlocked(c, all);
        if (!u.runnable) for (const r of u.reasons) add(c.id, r);
      }
      for (let i = 0; i < picked.length; i++) {
        for (let j = i + 1; j < picked.length; j++) {
          const ind = checkIndependence(toPlanCommand(picked[i]!), toPlanCommand(picked[j]!), q.hotspots, plans);
          if (!ind.independent && ind.reason) {
            add(picked[i]!.id, ind.reason);
            add(picked[j]!.id, ind.reason);
          }
        }
      }
      const free = clampMaxParallel(q.maxParallel) - codingRunningCount(manager);
      if (picked.length > free) {
        const msg = `Không đủ chỗ: cần ${picked.length}, còn ${Math.max(0, free)} (tối đa ${clampMaxParallel(q.maxParallel)} run lập trình song song).`;
        for (const c of picked) add(c.id, msg);
      }
      const budget = budgetState(queueSpent(all, replanCosts(replanDir(manager.config.dataDir, name))), q.maxBudgetUsd);
      if (!budget.canOpenNew) for (const c of picked) add(c.id, budget.message);
      const rejected: { id: string; reasons: string[] }[] = [];
      for (const [id, rs] of reasons) if (rs.length) rejected.push({ id, reasons: rs });
      if (rejected.length) return json(res, 200, { started: [], rejected });
      const started: { id: string; run: RunRecord }[] = [];
      for (const c of picked) {
        try {
          if (c.status === "chờ duyệt") manager.queue.transition(name, c.id, "đã duyệt");
          started.push({ id: c.id, run: await manager.startQueuedCommand(name, c.id) });
        } catch (e) {
          rejected.push({ id: c.id, reasons: [errorMessage(e).message] });
        }
      }
      return json(res, 200, { started, rejected });
    }

    if (target === undefined || target === "delete-idea" || target === "run-parallel" || target === "run-all" || target === "approve-all") return json(res, 404, { error: "not_found", message: "Đường dẫn không tồn tại." });
    const cmd = manager.queue.get(name, target);
    if (!cmd) return notFound(target);

    if (action === undefined && method === "PATCH") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const patch: { title?: string; body?: string; files?: string[]; dependsOn?: string[] } = {};
      const bad = (message: string) => json(res, 400, { error: "invalid", message });
      const strArr = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === "string");
      if (body["title"] !== undefined) {
        if (typeof body["title"] !== "string" || !body["title"].trim()) return bad("title phải là chuỗi không rỗng.");
        patch.title = body["title"];
      }
      if (body["body"] !== undefined) {
        if (typeof body["body"] !== "string" || !body["body"].trim()) return bad("body phải là chuỗi không rỗng.");
        const safety = checkBodySafety(body["body"]);
        if (safety.errors.length) return bad(`Lệnh "${cmd.id}": ${safety.errors.join(" ")}`);
        patch.body = body["body"];
      }
      if (body["files"] !== undefined) {
        if (!strArr(body["files"])) return bad("files phải là mảng chuỗi.");
        patch.files = body["files"];
      }
      if (body["dependsOn"] !== undefined) {
        if (!strArr(body["dependsOn"])) return bad("dependsOn phải là mảng chuỗi.");
        patch.dependsOn = body["dependsOn"];
      }
      if (Object.keys(patch).length === 0) return bad("Cần ít nhất một trường trong title, body, files, dependsOn.");
      if (cmd.status !== "chờ duyệt" && cmd.status !== "đã duyệt") {
        return json(res, 409, { error: "already_ran", message: "Lệnh đã chạy, hãy chạy lại để sửa." });
      }
      const all = manager.queue.list(name);
      if (patch.dependsOn) {
        const ids = new Set(all.map((c) => c.id));
        for (const d of patch.dependsOn) {
          if (d === cmd.id) return bad(`Lệnh "${cmd.id}" không thể phụ thuộc chính nó.`);
          if (!ids.has(d)) return bad(`dependsOn trỏ tới lệnh không tồn tại "${d}".`);
        }
      }
      const hypo = all.map((c) =>
        c.id === cmd.id ? { ...c, ...(patch.files ? { files: patch.files } : {}), ...(patch.dependsOn ? { dependsOn: patch.dependsOn } : {}) } : c,
      );
      const check = safeWaves(hypo, q.hotspots);
      if (check.error) return bad(check.error);
      const edited = manager.queue.editCommand(name, cmd.id, patch);
      const after = manager.queue.list(name);
      const { waves, error } = safeWaves(after, q.hotspots);
      const history = store.listRuns({ kind: "coding", limit: 20 }).map((r) => r.cost_usd_est);
      const updated = after.find((c) => c.id === edited.id) ?? edited;
      return json(res, 200, { command: describeQueueCommand(manager, updated, after, waves, history), waveError: error });
    }

    if (action === "skip" && method === "POST") {
      const command = manager.queue.transition(name, cmd.id, "bỏ qua");
      return json(res, 200, { command });
    }

    if (action === "confirm-done" && method === "POST") {
      if (cmd.status !== "đang chạy" && cmd.status !== "lỗi") {
        throw new QueueError("bad_transition", `Không thể xác nhận xong lệnh "${cmd.id}" đang "${cmd.status}".`, true);
      }
      if (manager.isQueueRunLive(cmd)) throw new QueueError("bad_transition", "Run còn đang chạy, hãy hủy run trước.", true);
      const command = manager.queue.transition(name, cmd.id, "đã commit");
      manager.closeOrphanQueueRuns(cmd);
      return json(res, 200, { command });
    }

    if (action === "mark-failed" && method === "POST") {
      if (cmd.status !== "đang chạy") {
        throw new QueueError("bad_transition", `Không thể đánh dấu lỗi lệnh "${cmd.id}" đang "${cmd.status}".`, true);
      }
      if (manager.isQueueRunLive(cmd)) throw new QueueError("bad_transition", "Run còn đang chạy, hãy hủy run trước.", true);
      const command = manager.queue.transition(name, cmd.id, "lỗi");
      manager.closeOrphanQueueRuns(cmd);
      manager.recordQueueLesson(name, cmd, "người dùng đánh dấu lỗi bằng tay");
      return json(res, 200, { command });
    }

    if (action === "confirm-merged" && method === "POST") {
      return json(res, 200, { command: manager.queue.transition(name, cmd.id, "đã gộp") });
    }

    if (action === "retry" && method === "POST") {
      if (cmd.status !== "lỗi") throw new QueueError("bad_transition", `Không thể chạy lại lệnh "${cmd.id}" đang "${cmd.status}".`, true);
      return json(res, 200, { command: manager.queue.transition(name, cmd.id, "đã duyệt") });
    }

    if (action === "unskip" && method === "POST") {
      if (cmd.status !== "bỏ qua") throw new QueueError("bad_transition", `Không thể hoàn tác bỏ qua lệnh "${cmd.id}" đang "${cmd.status}".`, true);
      return json(res, 200, { command: manager.queue.transition(name, cmd.id, "chờ duyệt") });
    }

    if (action === "approve-run" && method === "POST") {
      if (cmd.status === "chờ duyệt") manager.queue.transition(name, cmd.id, "đã duyệt");
      else if (cmd.status !== "đã duyệt") {
        // "lỗi" → "đã duyệt" is allowed in the table (retry), but approve-run only accepts pending/approved commands.
        throw new QueueError("bad_transition", `Không thể duyệt và chạy lệnh "${cmd.id}" đang "${cmd.status}".`, true);
      }
      const all = manager.queue.list(name);
      const approved = all.find((c) => c.id === cmd.id)!;
      const chk = queueRunCheck(manager, name, approved, all);
      if (!chk.ok && chk.waiting) {
        // Only the slot limit is in the way: keep the command approved and start it automatically, in order.
        manager.enqueueQueuedCommand(name, cmd.id);
        return json(res, 200, { started: false, waiting: true, command: approved, reasons: chk.reasons });
      }
      if (!chk.ok) return json(res, 200, { started: false, command: approved, reasons: chk.reasons });
      try {
        const run = await manager.startQueuedCommand(name, cmd.id);
        return json(res, 200, { started: true, run, command: manager.queue.get(name, cmd.id) });
      } catch (e) {
        return json(res, 200, { started: false, command: manager.queue.get(name, cmd.id), reasons: [errorMessage(e).message] });
      }
    }
    return json(res, 404, { error: "not_found", message: "Đường dẫn không tồn tại." });
  } catch (e) {
    if (e instanceof QueueError) return json(res, queueErrorStatus(e), { error: e.code, message: e.message });
    throw e;
  }
}

async function readBody(req: IncomingMessage, limit = 256 * 1024): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    let tooLarge = false;
    req.setEncoding("utf8");
    req.on("data", (c: string) => {
      if (tooLarge) return;
      data += c;
      if (data.length > limit) {
        // Do not destroy the socket: drain the rest so the handler can still answer 413.
        tooLarge = true;
        data = "";
        req.resume();
      }
    });
    req.on("end", () => {
      if (tooLarge) return reject(httpStatusError(413, "Nội dung quá lớn."));
      if (!data) return resolve({});
      try {
        resolve(JSON.parse(data));
      } catch {
        reject(httpStatusError(400, "JSON không hợp lệ."));
      }
    });
    req.on("error", reject);
  });
}

function httpStatusError(status: 400 | 413, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Body must be a plain JSON object (not array, null or string); otherwise 400. */
function requireJsonObject(body: unknown): Record<string, unknown> {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw httpStatusError(400, "Nội dung phải là một đối tượng JSON.");
  }
  return body as Record<string, unknown>;
}

/** Keep only https://<host>/… so secrets in path, query or fragment never leave the server. */
function maskWebhookUrl(u: string): string {
  try {
    return `https://${new URL(u).host}/…`;
  } catch {
    return "https://…";
  }
}

function autopilotView(manager: RunManager): {
  enabled: boolean;
  schedule: string | null;
  webhookCount: number;
  webhooks: string[];
  updatedAt: string;
} {
  const s = manager.autopilot.snapshot();
  return {
    enabled: s.enabled,
    schedule: s.schedule,
    webhookCount: s.webhooks.length,
    webhooks: s.webhooks.map(maskWebhookUrl),
    updatedAt: s.updatedAt,
  };
}

const SUMMARY_MAX_RUNS = 1000;

const SKILL_BODY_LIMIT =2.5 * 1024 * 1024;

class BodyError extends Error {
  constructor(message: string, readonly code: "too_large" | "bad_json") {
    super(message);
  }
}

/** Shared error mapping for /api/skills and /api/skills-gen: SkillError -> its status, BodyError -> 400, else 500. */
function skillErrorResponse(res: ServerResponse, e: unknown): void {
  if (e instanceof SkillError) return json(res, e.status, { error: e.code, message: e.message, ...(e.fields ? { fields: e.fields, errors: e.fields } : {}) });
  if (e instanceof BodyError) return json(res, 400, { error: e.code, message: e.message });
  return json(res, 500, { error: "internal", message: "Lỗi nội bộ khi xử lý skill." });
}

/** JSON body for skills: over the limit the rest is drained (socket stays open so the client gets the 400), then BodyError. */
async function readSkillBody(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let tooLarge = false;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        tooLarge = true;
        chunks.length = 0;
        return;
      }
      if (!tooLarge) chunks.push(c);
    });
    req.on("end", () => {
      if (tooLarge) return reject(new BodyError("Nội dung quá lớn.", "too_large"));
      const text = Buffer.concat(chunks).toString("utf8");
      if (!text) return resolve({});
      try {
        const v = JSON.parse(text) as unknown;
        if (!v || typeof v !== "object" || Array.isArray(v)) return reject(new BodyError("JSON không hợp lệ.", "bad_json"));
        resolve(v as Record<string, unknown>);
      } catch {
        reject(new BodyError("JSON không hợp lệ.", "bad_json"));
      }
    });
    req.on("error", reject);
  });
}

const W3D_TEXT_MAX = W3D_BRIEF_LIMITS.object;
const W3D_DETAILS = ["standard", "high", "ultra"];

class W3DBadRequest extends Error {}

/** Brief from POST /api/workshop3d: a one-line prompt, or a full brief with the limits parseIntake applies. */
function w3dBriefFromBody(body: Record<string, unknown>): W3DBrief {
  const att = body["attachments"];
  if (att !== undefined && !(Array.isArray(att) && att.length === 0)) {
    throw new W3DBadRequest("Ảnh mẫu tải lên qua POST /api/inbox rồi ghi mã đính kèm vào inbox_stage; khóa attachments chỉ nhận danh sách rỗng.");
  }
  const rawBrief = body["brief"];
  if (rawBrief === undefined || rawBrief === null) {
    const prompt = typeof body["prompt"] === "string" ? body["prompt"].trim() : "";
    if (!prompt) throw new W3DBadRequest("Hãy mô tả vật thể cần dựng (prompt) hoặc gửi brief.");
    if (prompt.length > W3D_TEXT_MAX) throw new W3DBadRequest(`Mô tả dài quá ${W3D_TEXT_MAX} ký tự.`);
    return { title: prompt.slice(0, 60), object: prompt, params: {}, detail: "high", attachments: [] };
  }
  if (typeof rawBrief !== "object" || Array.isArray(rawBrief)) throw new W3DBadRequest("brief phải là một đối tượng.");
  const b = rawBrief as Record<string, unknown>;
  const text = (v: unknown, max: number, label: string): string => {
    if (typeof v !== "string" || !v.trim()) throw new W3DBadRequest(`brief.${label} phải là chuỗi không rỗng.`);
    if (v.trim().length > max) throw new W3DBadRequest(`brief.${label} dài quá ${max} ký tự.`);
    return v.trim();
  };
  const detail = b["detail"] === undefined ? "high" : b["detail"];
  if (typeof detail !== "string" || !W3D_DETAILS.includes(detail)) throw new W3DBadRequest('brief.detail phải là "standard", "high" hoặc "ultra".');
  const params: Record<string, string | number> = {};
  if (b["params"] !== undefined) {
    const pr = b["params"];
    if (!pr || typeof pr !== "object" || Array.isArray(pr)) throw new W3DBadRequest("brief.params phải là đối tượng.");
    const entries = Object.entries(pr as Record<string, unknown>);
    if (entries.length > 50) throw new W3DBadRequest("brief.params tối đa 50 tham số.");
    for (const [k, v] of entries) {
      if (!k || k.length > 60) throw new W3DBadRequest("Tên tham số phải từ 1 đến 60 ký tự.");
      if (typeof v === "number" && Number.isFinite(v)) params[k] = v;
      else if (typeof v === "string" && v.length <= 200) params[k] = v;
      else throw new W3DBadRequest(`Tham số ${k.slice(0, 60)} phải là số hữu hạn hoặc chuỗi ngắn.`);
    }
  }
  const L = W3D_BRIEF_LIMITS;
  const brief: W3DBrief = { title: text(b["title"], L.title, "title"), object: text(b["object"], L.object, "object"), params, detail: detail as W3DBrief["detail"], attachments: [] };
  if (b["material"] !== undefined) brief.material = text(b["material"], L.material, "material");
  if (b["purpose"] !== undefined) brief.purpose = text(b["purpose"], L.purpose, "purpose");
  if (b["slots"] !== undefined) {
    const slots = normalizeSlots(b["slots"]);
    if (!slots.ok) throw new W3DBadRequest(slots.error);
    if (slots.value.length > 0) brief.slots = slots.value;
  }
  return brief;
}

function w3dErrorResponse(res: ServerResponse, e: unknown): void {
  if (e instanceof W3DError) return json(res, 409, { error: "w3d_state", message: e.message });
  if (e instanceof W3DFileError) return json(res, e.status, { error: "w3d_file", message: e.message });
  if (e instanceof W3DBadRequest) return json(res, 400, { error: "bad_request", message: e.message });
  if (e instanceof W3DAttachmentError) return json(res, 400, { error: "bad_attachment", message: e.message });
  if (e instanceof BodyError) return json(res, 400, { error: e.code, message: e.message });
  return json(res, 500, { error: "internal", message: "Lỗi nội bộ khi xử lý phiên dựng 3D." });
}

/** Raw body (attachments): bytes, capped; the request is destroyed once the cap is exceeded. */
async function readRawBody(req: IncomingMessage, limit: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error(`Tệp quá lớn (tối đa ${limit / 1024 / 1024} MB).`));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => resolve(Buffer.concat(chunks)));
    req.on("error", reject);
  });
}

function fileNameHeader(req: IncomingMessage): string {
  const h = req.headers["x-file-name"];
  return typeof h === "string" ? h.trim() : "";
}

function numOpt(v: unknown): number | undefined {
  const n = typeof v === "string" ? Number(v) : typeof v === "number" ? v : NaN;
  return Number.isFinite(n) ? n : undefined;
}

/** Resolve a file inside a run directory, refusing path traversal. */
function safeJoin(root: string, rel: string): string | null {
  const abs = path.resolve(root, rel);
  const normRoot = path.resolve(root) + path.sep;
  return abs.startsWith(normRoot) ? abs : null;
}

/** Validate `attachments` of POST /api/skills and read the staged files (`<stageDir>/inbox/<name>`); throws SkillError(400). */
function readStagedAttachments(raw: unknown, manager: { stageDir(id: string): string }): { items: { pair: string; side: string; name: string; data: Buffer }[]; stageDirs: string[] } {
  const items: { pair: string; side: string; name: string; data: Buffer }[] = [];
  const stageDirs = new Set<string>();
  if (raw === undefined || raw === null) return { items, stageDirs: [] };
  const bad = (msg: string, code = "bad_attachment") => new SkillError(msg, 400, code);
  if (!Array.isArray(raw)) throw bad("`attachments` phải là một danh sách.");
  for (const a of raw) {
    if (!a || typeof a !== "object") throw bad("Mục tệp đính kèm không hợp lệ.");
    const { pair, side, stageId, names } = a as Record<string, unknown>;
    if (typeof stageId !== "string" || validateInboxName(stageId)) throw bad("Mã đính kèm không hợp lệ.", "bad_stage");
    if (typeof pair !== "string" || typeof side !== "string" || !Array.isArray(names)) throw bad("Mục tệp đính kèm thiếu cặp mẫu, phía hoặc danh sách tên tệp.");
    const stageDir = manager.stageDir(stageId);
    if (!fs.existsSync(stageDir)) throw bad("Không tìm thấy tệp đính kèm đã tải lên (mã đính kèm không tồn tại).", "bad_stage");
    stageDirs.add(stageDir);
    const inboxDir = path.join(stageDir, "inbox");
    for (const n of names) {
      if (typeof n !== "string") throw bad("Tên tệp đính kèm không hợp lệ.");
      const name = validateAttachmentName(n);
      if (!ATTACH_RE.test(attachmentRel(pair, side, name))) throw bad("Cặp mẫu hoặc phía của tệp đính kèm không hợp lệ.");
      const file = resolveInside(inboxDir, name);
      let st: fs.Stats;
      try {
        st = fs.lstatSync(file);
      } catch {
        throw bad(`Tệp "${name}" chưa được tải lên (không có trong mã đính kèm).`, "attach_missing");
      }
      if (!st.isFile() || st.isSymbolicLink()) throw bad(`Tệp "${name}" không hợp lệ.`);
      if (st.size > ATTACH_LIMITS.fileBytes) throw bad(`Tệp "${name}" quá lớn (tối đa ${ATTACH_LIMITS.fileBytes / 1024 / 1024} MB mỗi tệp).`, "attach_too_big");
      items.push({ pair, side, name, data: fs.readFileSync(file) });
    }
  }
  return { items, stageDirs: [...stageDirs] };
}

export function createServer(opts: ServerOptions): http.Server {
  const { manager, policy } = opts;
  // Origins saved from Settings > Điện thoại are accepted again after a restart.
  for (const o of loadAppSettings(manager.config.dataDir).allowedOrigins ?? []) if (!(policy.extraOrigins ??= []).includes(o)) policy.extraOrigins.push(o);
  const currentPhoneInfo = () => phoneInfo({ port: policy.port, token: policy.token, origins: policy.extraOrigins ?? [], exe: findTailscale() });
  const store = manager.store;
  const skillStore = createSkillStore(manager.config.dataDir);
  // A broken 3D workshop (e.g. a bad config/roles-design3d.json) must not stop the whole app: its routes answer 503 instead.
  const w3d = opts.workshop3d !== undefined
    ? { engine: opts.workshop3d, error: opts.workshop3dError ?? null }
    : tryCreateWorkshop3D(opts.workshop3dFactory ?? (() => createWorkshop3D({ manager, dataDir: manager.config.dataDir, config: manager.config })));
  const workshop3d = w3d.engine;
  const materials = opts.materialLibrary !== undefined ? opts.materialLibrary : createMaterialLibrary({ dataDir: manager.config.dataDir, python: () => findCadPython(process.env, manager.config.tools?.cad?.python ?? null) });
  const variants = createVariantStore({ lib: materials });
  let videoStudio: VideoStudio | null = null;
  if (opts.videoStudio !== undefined) videoStudio = opts.videoStudio;
  else {
    try {
      videoStudio = (opts.videoStudioFactory ?? (() => createVideoStudio({ manager: manager as unknown as VsStepManager, dataDir: manager.config.dataDir })))();
    } catch (e) {
      console.warn(`[videostudio] không khởi tạo được: ${e instanceof Error ? e.message : String(e)}`);
      videoStudio = null;
    }
    if (videoStudio) {
      try {
        videoStudio.recover();
      } catch (e) {
        console.warn(`[videostudio] recover lỗi: ${e instanceof Error ? e.message : String(e)}`);
      }
    }
  }
  const stepAdapter = createManagerRunStep(manager as unknown as StepManager);
  const skillTrainer = createSkillTrainer({
    store: skillStore,
    runStep: stepAdapter.runStep,
    cancelActive: stepAdapter.cancelActive,
    saveRunReport: makeSaveRunReport(manager.store),
    now: () => new Date().toISOString()
  });
  const skillsGen = createSkillsGen({
    store: skillStore,
    dataDir: manager.config.dataDir,
    runStep: stepAdapter.runStep,
    cadPython: manager.config.tools?.cad?.python ?? null,
    readBody: (r) => readSkillBody(r, SKILL_BODY_LIMIT),
    listRoles: () => {
      const seen = new Map<string, MatchRole>();
      for (const file of [manager.config.defaults.coding.agentsFile, manager.config.defaults.research.agentsFile]) {
        let roles: Record<string, Record<string, unknown>> = {};
        try {
          roles = readRoles(file);
        } catch {
          continue;
        }
        for (const [id, def] of Object.entries(roles)) {
          const description = def?.["description"];
          if (typeof description !== "string" || seen.has(id)) continue;
          const prompt = def?.["prompt"];
          const tools = def?.["tools"];
          seen.set(id, {
            id,
            description,
            ...(typeof prompt === "string" ? { prompt } : {}),
            ...(Array.isArray(tools) && tools.every((t) => typeof t === "string") ? { tools: tools as string[] } : {})
          });
        }
      }
      return [...seen.values()];
    },
    finder: async (prompt) => {
      // Own adapter: the finder needs web tools (the trainer steps get none) and a budget ceiling.
      try {
        const started = await manager.startRun({ prompt, project: SKILL_WORKSHOP_PROJECT, kind: "research", roles: false, allowedTools: ["WebSearch", "WebFetch"], maxBudgetUsd: 1 } as Parameters<typeof manager.startRun>[0]);
        const done = await manager.waitFor(started.id);
        return { ok: done?.status === "done", text: done?.result_text ?? "" };
      } catch {
        return { ok: false, text: "" };
      }
    },
  });
  const wss = new WebSocketServer({
    noServer: true,
    // Echo the `tnf-token.<token>` subprotocol so browsers accept the handshake.
    handleProtocols: (protocols) => {
      for (const pr of protocols) if (pr.startsWith("tnf-token.")) return pr;
      return false;
    },
  });
  const runSubs = new Map<string, Set<WebSocket>>();
  const overview = new Set<WebSocket>();

  const send = (ws: WebSocket, msg: unknown) => {
    if (ws.readyState === ws.OPEN) ws.send(JSON.stringify(msg));
  };
  manager.on("event", ({ run_id, stored }: { run_id: string; stored: StoredEvent }) => {
    const subs = runSubs.get(run_id);
    if (subs) for (const ws of subs) send(ws, { type: "event", run_id, stored });
  });
  manager.on("run.updated", (run: RunRecord) => {
    for (const ws of overview) send(ws, { type: "run", run });
    const subs = runSubs.get(run.id);
    if (subs) for (const ws of subs) send(ws, { type: "run", run });
  });

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const p = url.pathname;
    try {
      if (p.startsWith("/api/")) {
        const fail = authorize(req, policy, { originRequired: false });
        if (fail) return json(res, fail === "bad_token" ? 401 : 403, { error: fail, message: authMessage(fail) });
        return await handleApi(req, res, url);
      }
      return serveStatic(req, res, p);
    } catch (e) {
      const st = (e as { status?: unknown } | null)?.status;
      if (st === 400 || st === 413) {
        return json(res, st, { error: st === 400 ? "bad_request" : "payload_too_large", message: (e as Error).message });
      }
      return json(res, 500, { error: "internal", ...errorMessage(e) });
    }
  });

  server.on("upgrade", (req, socket, head) => {
    const fail = authorize(req, policy, { originRequired: true });
    if (fail) {
      socket.write(`HTTP/1.1 ${fail === "bad_token" ? 401 : 403} Forbidden\r\nConnection: close\r\n\r\n`);
      socket.destroy();
      return;
    }
    const url = new URL(req.url ?? "/", `http://${req.headers.host}`);
    const m = /^\/ws\/runs\/([^/]+)$/.exec(url.pathname);
    const isOverview = url.pathname === "/ws/overview";
    if (!m && !isOverview) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => {
      // Echo the token subprotocol back so browsers accept the handshake.
      ws.on("message", () => {
        /* read-only channel: ignore client messages */
      });
      if (isOverview) {
        overview.add(ws);
        ws.on("close", () => overview.delete(ws));
        send(ws, { type: "runs", runs: store.listRuns({ limit: 50 }) });
      } else {
        const runId = decodeURIComponent(m![1]!);
        const after = numOpt(url.searchParams.get("after")) ?? 0;
        let set = runSubs.get(runId);
        if (!set) runSubs.set(runId, (set = new Set()));
        set.add(ws);
        ws.on("close", () => {
          set!.delete(ws);
          if (set!.size === 0) runSubs.delete(runId);
        });
        const run = store.getRun(runId);
        if (run) send(ws, { type: "run", run });
        for (const stored of store.getEvents(runId, after)) send(ws, { type: "event", run_id: runId, stored });
        send(ws, { type: "synced" });
      }
    });
  });

  // ---- Idea split jobs (T14): in-memory; an idea waiting for interview answers is also on disk (idea-interview-store) ----
  interface SplitJob {
    id?: string;
    project: string;
    state: "running" | "done" | "error" | "questions";
    stage?: SplitStage;
    questions?: string[];
    commands?: number;
    costUsd?: number;
    error?: string;
  }
  const splitJobs = new Map<string, SplitJob>();
  const splitBusy = new Set<string>();
  const SPLIT_JOBS_MAX = 50;

  function registerSplitJob(id: string, job: SplitJob): void {
    if (splitJobs.size >= SPLIT_JOBS_MAX) {
      for (const [k, v] of splitJobs) {
        if (v.state !== "running") splitJobs.delete(k);
        if (splitJobs.size < SPLIT_JOBS_MAX) break;
      }
    }
    job.id = id;
    splitJobs.set(id, job);
  }

  /**
   * Run `work` as one split job of `name`. The job id is `fixedId` (answers to a pending interview) or the id of the
   * first agent run it starts; the returned promise resolves with that id, or rejects when `work` fails before any run.
   */
  function launchSplitJob(name: string, fixedId: string | null, work: (deps: SplitDeps, job: SplitJob) => Promise<void>): Promise<string> {
    splitBusy.add(name);
    const job: SplitJob = { project: name, state: "running" };
    let resolveId!: (id: string) => void;
    let rejectId!: (e: unknown) => void;
    const idPromise = new Promise<string>((resolve, reject) => {
      resolveId = resolve;
      rejectId = reject;
    });
    if (fixedId) {
      registerSplitJob(fixedId, job);
      resolveId(fixedId);
    }
    const wrapped: SplitManager = {
      startRun: async (input) => {
        const r = await manager.startRun(input);
        if (!job.id) {
          registerSplitJob(r.id, job);
          resolveId(r.id);
        }
        return r;
      },
      waitFor: (id) => manager.waitFor(id),
    };
    const deps: SplitDeps = { manager: wrapped, queue: manager.queue, config: manager.config, getProject: (n) => store.getProject(n) };
    work(deps, job)
      .then(
        () => undefined,
        (e) => {
          Object.assign(job, { state: "error", error: errorMessage(e).message });
          rejectId(e); // no-op when the job id was already resolved
        },
      )
      .finally(() => splitBusy.delete(name));
    return idPromise;
  }

  function splitJobView(id: string, job: SplitJob, pending: PendingInterview | null) {
    return {
      runId: id,
      state: job.state,
      ...(job.stage ? { stage: job.stage } : {}),
      ...(job.questions ? { questions: job.questions } : pending ? { questions: pending.questions } : {}),
      ...(job.commands !== undefined ? { commands: job.commands } : {}),
      ...(job.costUsd !== undefined ? { costUsd: job.costUsd } : {}),
      ...(job.error !== undefined ? { error: job.error } : {}),
    };
  }

  async function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown> | null> {
    try {
      const raw = await readBody(req);
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
      return raw as Record<string, unknown>;
    } catch {
      return null;
    }
  }

  async function handleSplitApi(
    req: IncomingMessage,
    res: ServerResponse,
    method: string,
    name: string,
    runId: string | undefined,
    sub?: string,
  ): Promise<void> {
    const project = store.getProject(name);
    if (!project) return json(res, 404, { error: "project_not_found", message: `Không tìm thấy môi trường "${name}".` });
    if (name === "default" || !project.repo_path) {
      return json(res, 400, { error: "no_repo", message: `Môi trường "${name}" chưa gắn repo nên không chia được ý tưởng.` });
    }
    const dataDir = manager.config.dataDir;
    if (method === "GET" && runId) {
      const job = splitJobs.get(runId);
      const pending = loadPendingInterview(dataDir, name, runId);
      if (job && job.project === name) return json(res, 200, splitJobView(runId, job, pending));
      if (pending) return json(res, 200, splitJobView(runId, { project: name, state: "questions", questions: pending.questions, costUsd: pending.costUsd, ...(pending.lastError ? { error: pending.lastError } : {}) }, pending));
      return json(res, 404, { error: "not_found", message: "Không tìm thấy yêu cầu chia ý tưởng này." });
    }
    if (method === "POST" && runId && sub === "answers") {
      const pending = loadPendingInterview(dataDir, name, runId);
      if (!pending) return json(res, 404, { error: "not_found", message: "Không tìm thấy ý tưởng đang chờ trả lời phỏng vấn." });
      const body = await readJsonBody(req);
      if (!body) return json(res, 400, { error: "bad_request", message: "Nội dung gửi lên không hợp lệ." });
      if (body["dismiss"] === true) {
        removePendingInterview(dataDir, name, runId);
        splitJobs.delete(runId);
        return json(res, 200, { ok: true });
      }
      const skip = body["skip"] === true;
      if (!skip && !Array.isArray(body["answers"])) {
        return json(res, 400, { error: "bad_request", message: "Cần answers (mảng câu trả lời) hoặc skip: true." });
      }
      if (splitBusy.has(name)) {
        return json(res, 409, { error: "split_busy", message: `Môi trường "${name}" đang có một yêu cầu chia ý tưởng chạy; hãy đợi xong.` });
      }
      const answers = skip ? pending.questions.map(() => "") : normalizeAnswers(pending.questions, body["answers"]);
      const interview: InterviewAnswers = { questions: pending.questions, answers, skipped: skip };
      const id = await launchSplitJob(name, runId, async (deps, job) => {
        job.costUsd = pending.costUsd;
        try {
          const result = await splitIdea(deps, name, pending.idea, pending.source, { webSearch: pending.webSearch, interview, onStage: (s) => (job.stage = s) });
          removePendingInterview(dataDir, name, runId);
          Object.assign(job, { state: "done", commands: result.commands.length, costUsd: (job.costUsd ?? 0) + result.costUsd });
        } catch (e) {
          savePendingInterview(dataDir, { ...pending, lastError: errorMessage(e).message });
          throw e;
        }
      });
      return json(res, 202, { runId: id });
    }
    const body = await readJsonBody(req);
    if (!body) return json(res, 400, { error: "bad_request", message: "Nội dung gửi lên không hợp lệ." });
    const rawIdea = body["idea"];
    if (typeof rawIdea !== "string") return json(res, 400, { error: "bad_request", message: "Thiếu ý tưởng (idea) dạng chữ." });
    const idea = rawIdea.trim();
    if (!idea) return json(res, 400, { error: "bad_request", message: "Ý tưởng đang để trống." });
    if (idea.length > SPLITTER_MAX_IDEA_CHARS) {
      return json(res, 400, { error: "idea_too_long", message: `Ý tưởng quá dài (${idea.length} ký tự, tối đa ${SPLITTER_MAX_IDEA_CHARS}).` });
    }
    if (!VI_DIACRITICS.test(idea)) {
      return json(res, 400, { error: "need_vietnamese", message: "Hãy viết ý tưởng bằng tiếng Việt có dấu." });
    }
    const wsRaw = body["webSearch"];
    if (wsRaw !== undefined && typeof wsRaw !== "boolean") {
      return json(res, 400, { error: "bad_request", message: "webSearch phải là đúng/sai (boolean)." });
    }
    const skipRaw = body["skipInterview"];
    if (skipRaw !== undefined && typeof skipRaw !== "boolean") {
      return json(res, 400, { error: "bad_request", message: "skipInterview phải là đúng/sai (boolean)." });
    }
    const webSearch = wsRaw ?? manager.config.queue?.splitter?.webSearch ?? true;
    const srcRaw = body["source"];
    const refRaw = body["sourceRef"];
    if (srcRaw !== undefined && srcRaw !== "manual" && srcRaw !== "scout") {
      return json(res, 400, { error: "bad_request", message: 'source phải là "manual" hoặc "scout".' });
    }
    let splitSource: SplitSource = "manual";
    if (srcRaw === "scout") {
      if (typeof refRaw !== "string" || !/^[\w-]+#[a-z0-9_-]{1,32}$/.test(refRaw)) {
        return json(res, 400, { error: "bad_request", message: "Nguồn scout cần sourceRef dạng <mã run>#<mã đề xuất>." });
      }
      splitSource = { scout: true, ref: refRaw };
    } else if (refRaw !== undefined) {
      return json(res, 400, { error: "bad_request", message: 'sourceRef chỉ dùng khi source là "scout".' });
    }
    if (splitBusy.has(name)) {
      return json(res, 409, { error: "split_busy", message: `Môi trường "${name}" đang có một yêu cầu chia ý tưởng chạy; hãy đợi xong.` });
    }
    const interviewOn = manager.config.queue?.splitter?.interview === true && skipRaw !== true;
    try {
      const id = await launchSplitJob(name, null, async (deps, job) => {
        if (interviewOn) {
          job.stage = "interview";
          let iv: Awaited<ReturnType<typeof interviewIdea>> | null = null;
          try {
            iv = await interviewIdea(deps, name, idea);
          } catch (e) {
            // A failed interview never blocks the idea: the split goes on without questions.
            console.warn(`[queue] phỏng vấn ý tưởng không chạy được (${name}): ${errorMessage(e).message}`);
          }
          if (iv) {
            job.costUsd = iv.costUsd;
            if (!iv.ready) {
              savePendingInterview(dataDir, {
                id: iv.runId, project: name, idea, source: splitSource, webSearch, questions: iv.questions,
                state: "awaiting_user", createdAt: Date.now(), costUsd: iv.costUsd,
              });
              Object.assign(job, { state: "questions", questions: iv.questions });
              return;
            }
          }
        }
        const result = await splitIdea(deps, name, idea, splitSource, { webSearch, onStage: (s) => (job.stage = s) });
        Object.assign(job, { state: "done", commands: result.commands.length, costUsd: (job.costUsd ?? 0) + result.costUsd });
      });
      return json(res, 202, { runId: id });
    } catch (e) {
      const msg = errorMessage(e).message;
      return json(res, /chờ duyệt/.test(msg) ? 409 : 400, { error: "split_failed", message: msg });
    }
  }

  async function handleApi(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const p = url.pathname;
    const method = req.method ?? "GET";

    if (p === "/api/cad/status" && method === "GET") {
      return json(res, 200, await cadStatus({ configuredPython: (manager.config.tools?.cad?.python ?? null) }));
    }
    if (p === "/api/cad/inspect" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const stageId = body["stageId"];
      const fname = body["name"];
      if (typeof stageId !== "string" || typeof fname !== "string") return json(res, 400, { error: "bad_request", message: "Cần stageId và name của tệp đã đính kèm." });
      const bad = validateInboxName(stageId) ?? validateInboxName(fname);
      if (bad) return json(res, 400, { error: "bad_request", message: bad });
      const r = await inspectCad(path.join(manager.stageDir(stageId), "inbox", fname), { configuredPython: (manager.config.tools?.cad?.python ?? null) });
      return r.ok ? json(res, 200, { kind: r.kind, summary: r.summary }) : json(res, 422, { error: "cad_failed", message: r.error });
    }

    if (p === "/api/status" && method === "GET") {
      const cfg = manager.config;
      let auth: unknown = null;
      let authError: string | null = null;
      try {
        auth = await manager.authStatus();
      } catch (e) {
        authError = errorMessage(e).message;
      }
      // Phase 5.6: tell the UI whether the Claude Code CLI itself is present (installer does not bundle it).
      let claudePath: string | null = null;
      let claudeVersion: string | null = null;
      let claudeError: string | null = null;
      try {
        claudePath = manager.resolveClaude();
        claudeVersion = manager.claudeVersion();
      } catch (e) {
        claudeError = errorMessage(e).message;
      }
      let gitVersion: string | null = null;
      let gitError: string | null = null;
      try {
        gitVersion = locateGit(manager.env);
      } catch (e) {
        gitError = errorMessage(e).message;
      }
      return json(res, 200, {
        auth,
        auth_error: authError,
        claude_path: claudePath,
        claude_version: claudeVersion,
        claude_error: claudeError,
        git_version: gitVersion,
        git_error: gitError,
        rate_limit: manager.lastRateLimit,
        models: cfg.models,
        role_models: roleDefaultModels(cfg.defaults.agentsFile),
        defaults: cfg.defaults,
        limits: cfg.limits,
        towers: cfg.ui?.towers ?? DEFAULT_TOWERS,
        ui: { dailyCostWarnUsd: cfg.ui?.dailyCostWarnUsd ?? null },
        idea_agents: ideaAgentsOf(cfg),
        workspace_dir: cfg.workspaceDir,
        worktrees_dir: cfg.worktreesDir,
        queue: { splitter: { webSearch: cfg.queue?.splitter?.webSearch ?? true, maxWebCalls: cfg.queue?.splitter?.maxWebCalls ?? 20 } },
        role_models_coding: roleDefaultModels(cfg.defaults.coding.agentsFile),
        release: { viaTunnel: isViaTunnel(req), allowed: !isViaTunnel(req) || cfg.release?.allowRemote === true },
        quota_resumes: manager.listQuotaResumes(),
        quota_max_attempts: cfg.autoResume?.maxAttempts ?? 3,
        cli_accounts: manager.cliAccounts.list(),
        role_accounts: manager.getRoleAccounts(),
        note: "Chi phí hiển thị là ước tính phía client, không phải hóa đơn.",
      });
    }
    if (p === "/api/billing/status" && method === "GET") {
      try {
        const auth = await manager.authStatus();
        return json(res, 200, { ok: true, auth, mode: manager.config.defaults.authMode });
      } catch (e) {
        return json(res, 200, { ok: false, ...errorMessage(e), mode: manager.config.defaults.authMode });
      }
    }
    if (p === "/api/runs" && method === "GET") {
      const filter: Parameters<typeof store.listRuns>[0] = {};
      const q = url.searchParams.get("q");
      if (q) filter.q = q;
      const status = url.searchParams.get("status");
      if (status) filter.status = status as RunStatus;
      const project = url.searchParams.get("project");
      if (project) filter.project = project;
      const from = numOpt(url.searchParams.get("from"));
      if (from) filter.from = from;
      const to = numOpt(url.searchParams.get("to"));
      if (to) filter.to = to;
      const limit = numOpt(url.searchParams.get("limit"));
      if (limit) filter.limit = limit;
      const offset = numOpt(url.searchParams.get("offset"));
      if (offset && offset > 0) filter.offset = offset;
      if (url.searchParams.get("scout") === "1") filter.scout = true;
      // threads=1: paginate by thread (root run + its follow-ups); `total` then counts threads. Default stays flat.
      const list = (f: typeof filter) => (url.searchParams.get("threads") === "1" ? store.listRunThreads(f) : { runs: store.listRuns(f), total: store.countRuns(f) });
      const queueMode = url.searchParams.get("queue");
      if (queueMode === "only" || queueMode === "exclude") {
        // Queue runs are the runs (and follow-up chains) of queue commands; they live in their own list.
        // Filter in SQL (ids / notIds) so only the requested page is read and parsed.
        const ids = [...queueRunIdSet(manager)];
        const scoped = queueMode === "only" ? { ...filter, ids } : { ...filter, notIds: ids };
        return json(res, 200, list(scoped));
      }
      return json(res, 200, list(filter));
    }
    if (p === "/api/runs" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const input: StartRunInput = { prompt: typeof body["prompt"] === "string" ? body["prompt"] : "" };
      if (body["mode"] === "subscription" || body["mode"] === "api") input.mode = body["mode"];
      if (typeof body["model"] === "string" && body["model"]) input.model = body["model"];
      if (typeof body["account_id"] === "string" && body["account_id"].trim()) input.accountId = body["account_id"].trim();
      if (body["provider"] === "claude" || body["provider"] === "antigravity" || body["provider"] === "codex") input.provider = body["provider"];
      const mt = numOpt(body["max_turns"]);
      if (mt !== undefined) input.maxTurns = mt;
      const mb = numOpt(body["budget_usd"]);
      if (mb !== undefined) input.maxBudgetUsd = mb;
      // Raw value goes to run-manager for validation (NaN for non-numeric text -> Vietnamese 400 via start_failed); coding runs only.
      const mrc = body["max_role_calls"];
      if (mrc !== undefined && mrc !== null && mrc !== "") input.maxRoleCalls = typeof mrc === "number" ? mrc : Number(mrc);
      if (typeof body["roles"] === "boolean") input.roles = body["roles"];
      if (typeof body["project"] === "string") input.project = body["project"];
      if (body["kind"] === "coding" || body["kind"] === "research") input.kind = body["kind"];
      const sc = body["scout"];
      if (sc !== undefined && sc !== null) {
        if (typeof sc !== "boolean") return json(res, 400, { error: "bad_request", message: "scout phải là true/false." });
        if (sc) input.scout = true;
      }
      if (typeof body["inbox_stage"] === "string" && body["inbox_stage"]) {
        if (validateInboxName(body["inbox_stage"])) return json(res, 400, { error: "bad_request", message: "Mã đính kèm không hợp lệ." });
        input.inboxStage = body["inbox_stage"];
      }
      // Extra agents (object name → definition) and skills (string[]) for this run; validated in run-manager (extras.ts).
      const ag = body["agents"];
      if (ag !== undefined && ag !== null) {
        if (typeof ag !== "object" || Array.isArray(ag)) return json(res, 400, { error: "bad_request", message: "agents phải là một đối tượng {tên: định nghĩa}." });
        if (Object.keys(ag).length) input.extraAgents = ag as NonNullable<StartRunInput["extraAgents"]>;
      }
      const sk = body["skills"];
      if (sk !== undefined && sk !== null) {
        if (!Array.isArray(sk) || sk.some((s) => typeof s !== "string")) return json(res, 400, { error: "bad_request", message: "skills phải là mảng chuỗi." });
        if (sk.length) input.skills = sk as string[];
      }
      const li = body["libraryItemIds"];
      if (li !== undefined && li !== null) {
        if (!Array.isArray(li) || li.some((s) => typeof s !== "string")) return json(res, 400, { error: "bad_request", message: "libraryItemIds phải là mảng chuỗi." });
        if (li.length) input.libraryItemIds = li as string[];
      }
      const rm = body["role_models"];
      if (rm && typeof rm === "object" && !Array.isArray(rm)) {
        const clean: Record<string, string> = {};
        for (const [k, v] of Object.entries(rm as Record<string, unknown>)) if (typeof v === "string" && /^[A-Za-z0-9._-]{1,64}$/.test(v)) clean[k] = v;
        input.roleModels = clean;
      }
      try {
        const run = await manager.startRun(input);
        return json(res, 201, { run });
      } catch (e) {
        return json(res, 400, { error: "start_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/cleanup/preview" && method === "GET") {
      try {
        const days = parseOlderThan(url.searchParams.get("olderThan") ?? undefined);
        if (days === null) return json(res, 400, { error: "bad_request", message: "Giá trị olderThan không hợp lệ: cần số nguyên từ 1 trở lên (số ngày)." });
        const { plan, executeOpts } = await buildCleanupPlan({ config: manager.config, store, days, now: Date.now() });
        const preview = await executeCleanup({ ...executeOpts, dryRun: true });
        return json(res, 200, { olderThan: days, plan, inboxRemoved: preview.inboxRemoved });
      } catch (e) {
        return json(res, 500, { error: "cleanup_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/cleanup" && method === "POST") {
      // Deliberate deviation from existing delete APIs (no server-side confirmation): this bulk delete requires
      // an explicit `confirm: true` in the body. "Current plan" = recomputed now; executeCleanup re-checks each worktree.
      try {
        const body = ((await readBody(req)) ?? {}) as Record<string, unknown>;
        if (body["confirm"] !== true) return json(res, 400, { error: "confirm_required", message: "Cần xác nhận rõ: gửi confirm:true trong nội dung yêu cầu để dọn." });
        const raw = body["olderThan"];
        if (raw !== undefined && raw !== null && typeof raw !== "number" && typeof raw !== "string") return json(res, 400, { error: "bad_request", message: "olderThan phải là số nguyên hoặc chuỗi số." });
        const days = parseOlderThan(raw === undefined || raw === null ? undefined : typeof raw === "number" ? String(raw) : raw);
        if (days === null) return json(res, 400, { error: "bad_request", message: "Giá trị olderThan không hợp lệ: cần số nguyên từ 1 trở lên (số ngày)." });
        const busy = store.listRuns({ limit: 100000 }).some((r) => r.status === "queued" || r.status === "running" || manager.isActive(r.id));
        if (busy) return json(res, 409, { error: "still_running", message: "Đang có run chạy hoặc chờ chạy; chờ xong rồi dọn." });
        const { plan, executeOpts } = await buildCleanupPlan({ config: manager.config, store, days, now: Date.now() });
        const out = await executeCleanup({ ...executeOpts, dryRun: false });
        return json(res, 200, { plan, results: out.results, inboxRemoved: out.inboxRemoved });
      } catch (e) {
        return json(res, 500, { error: "cleanup_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/usage/blocks" && method === "GET") {
      try {
        return json(res, 200, await (opts.usageScan ?? scanUsage)({}));
      } catch (e) {
        return json(res, 500, { error: "usage_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/settings/max-runs" && method === "GET") {
      return json(res, 200, { maxRuns: manager.maxRuns(), ceiling: QUEUE_MAX_PARALLEL_CEILING, running: manager.codingActiveCount(), waiting: manager.waitingList() });
    }
    if (p === "/api/settings/max-runs" && method === "PUT") {
      const body = (await readBody(req)) as Record<string, unknown>;
      if (clampMaxRuns(body["maxRuns"]) === null) return json(res, 400, { error: "bad_request", message: `Số lệnh run tối đa phải là số từ 1 đến ${QUEUE_MAX_PARALLEL_CEILING}.` });
      return json(res, 200, { maxRuns: manager.setMaxRuns(body["maxRuns"] as number), ceiling: QUEUE_MAX_PARALLEL_CEILING });
    }
    // Model per role group of the 3D workshop (works even when the workshop engine is unavailable).
    if (p === "/api/settings/workshop3d-models" && method === "GET") {
      return json(res, 200, { models: loadAppSettings(manager.config.dataDir).workshop3d?.models ?? {}, options: manager.config.models });
    }
    if (p === "/api/settings/workshop3d-models" && method === "PUT") {
      const check = validateW3DModels(await readBody(req), manager.config.models.map((m) => m.id));
      if (!check.ok) return json(res, 400, { error: "bad_request", message: check.message });
      const saved = saveAppSettings(manager.config.dataDir, { workshop3d: { models: check.models } });
      return json(res, 200, { models: saved.workshop3d?.models ?? {}, options: manager.config.models });
    }
    if (p === "/api/settings/tuning" && method === "GET") {
      return json(res, 200, { values: manager.tuning(), models: manager.allAvailableModels(), limits: TUNING_LIMITS, roleCallsCeiling: manager.config.limits.maxRoleCallsCeiling ?? 30 });
    }
    if (p === "/api/settings/tuning" && method === "PUT") {
      const body = await readBody(req);
      try {
        return json(res, 200, { values: manager.setTuning(body) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    if (p === "/api/costs/by-day" && method === "GET") return json(res, 200, { days: store.costByDay() });
    if (p === "/api/costs/coding-stats" && method === "GET") return json(res, 200, store.codingCostStats());
    if (p === "/api/inbox" && method === "POST") {
      // Attachment staged before the run exists: `?stage=<id>` reuses a staging dir, otherwise a new id is minted.
      const name = fileNameHeader(req);
      const bad = validateInboxName(name);
      if (bad) return json(res, 400, { error: "bad_request", message: bad });
      const given = url.searchParams.get("stage");
      if (given && validateInboxName(given)) return json(res, 400, { error: "bad_request", message: "Mã đính kèm không hợp lệ." });
      const stageId = given || `s-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
      try {
        const data = await readRawBody(req, INBOX_MAX_BYTES);
        const file = saveInboxFile(manager.stageDir(stageId), name, data);
        return json(res, 201, { ok: true, stage_id: stageId, file, files: listInbox(manager.stageDir(stageId)) });
      } catch (e) {
        return json(res, 400, { error: "inbox_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/role-catalog" && method === "GET") {
      const roles = searchCatalog(readCatalog(catalogFile(manager.config.repoRoot)), url.searchParams.get("q") ?? "");
      return json(res, 200, { roles, in_library: manager.library.list().roles.map((r) => r.id) });
    }
    if (p === "/api/library" || p.startsWith("/api/library/")) {
      // Role/skill/prompt library (data/library/library.json). Errors carry their own status; messages are Vietnamese.
      const lib = manager.library;
      const parts = p.split("/").filter(Boolean); // ["api","library", "roles"|"items", id?]
      try {
        if (parts.length === 2 && method === "GET") return json(res, 200, lib.list());
        if (parts.length === 5 && parts[2] === "roles" && parts[3] === "from-catalog" && method === "POST") {
          const role = addFromCatalog(readCatalog(catalogFile(manager.config.repoRoot)), decodeURIComponent(parts[4]!), lib);
          return json(res, 201, { role });
        }
        if (parts.length === 3 && parts[2] === "import" && method === "POST") {
          const ibody = requireJsonObject(await readBody(req, 160 * 1024));
          if (typeof ibody["text"] !== "string") throw httpStatusError(400, "Trường text phải là chuỗi.");
          const as = ibody["as"];
          if (as !== undefined && as !== "role" && as !== "skill" && as !== "prompt") {
            throw httpStatusError(400, "Trường as phải là role, skill hoặc prompt.");
          }
          if (ibody["id"] !== undefined && typeof ibody["id"] !== "string") throw httpStatusError(400, "Trường id phải là chuỗi.");
          if (ibody["filename"] !== undefined && typeof ibody["filename"] !== "string") {
            throw httpStatusError(400, "Trường filename phải là chuỗi.");
          }
          if (ibody["dryRun"] !== undefined && typeof ibody["dryRun"] !== "boolean") {
            throw httpStatusError(400, "Trường dryRun phải là true hoặc false.");
          }
          const iopts: LibraryImportRequest = { text: ibody["text"] };
          if (as !== undefined) iopts.as = as;
          if (typeof ibody["id"] === "string") iopts.id = ibody["id"];
          if (typeof ibody["filename"] === "string") iopts.filename = ibody["filename"];
          if (typeof ibody["dryRun"] === "boolean") iopts.dryRun = ibody["dryRun"];
          const result = importAgentMd(lib, iopts);
          if (iopts.dryRun) return json(res, 200, { preview: result.preview });
          const out: Record<string, unknown> = { preview: result.preview };
          if (result.created?.kind === "role") out["role"] = result.created.role;
          else if (result.created) out["item"] = result.created.item;
          return json(res, 201, out);
        }
        const coll = parts[2];
        const id = parts[3] ? decodeURIComponent(parts[3]) : undefined;
        if (parts.length <= 4 && (coll === "roles" || coll === "items")) {
          if (!id && method === "POST") {
            const body = (await readBody(req, 160 * 1024)) as Record<string, unknown>;
            return json(res, 201, coll === "roles" ? { role: lib.createRole(body) } : { item: lib.createItem(body) });
          }
          if (id && method === "PUT") {
            const body = (await readBody(req, 160 * 1024)) as Record<string, unknown>;
            return json(res, 200, coll === "roles" ? { role: lib.updateRole(id, body) } : { item: lib.updateItem(id, body) });
          }
          if (id && method === "DELETE") {
            if (coll === "roles") lib.deleteRole(id);
            else lib.deleteItem(id);
            return json(res, 200, { ok: true });
          }
        }
        return json(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
      } catch (e) {
        if (e instanceof LibraryError) return json(res, e.status, { error: "library_error", message: e.message });
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    if (await handleMaterialsRoute(req, res, p, method, materials, { viaTunnel: isViaTunnel(req) })) return;
    if (await handleCliAccountsRoute(req, res, p, method, manager, { json, readBody: (r) => readBody(r) as Promise<Record<string, unknown>>, isViaTunnel })) return;
    if (await handleVideoStudioRoute(req, res, p, method, { studio: videoStudio, viaTunnel: isViaTunnel(req) })) return;
    if (await handleVariantsRoute(req, res, p, method, { store: workshop3d ? workshop3d.store : null, variants })) return;
    if (p === "/api/workshop3d" || p.startsWith("/api/workshop3d/")) {
      const parts = p.split("/").filter(Boolean); // ["api","workshop3d", slug?, action?]
      if (!workshop3d) return json(res, 503, { error: "w3d_unavailable", message: workshop3dUnavailableMessage(w3d.error) });
      try {
        if (parts.length === 2 && method === "GET") return json(res, 200, { sessions: workshop3d.listForApi(), kit: workshop3d.kit() });
        if (parts.length === 2 && method === "POST") {
          const body = await readSkillBody(req, SKILL_BODY_LIMIT);
          // Preflight: without the CAD python the session would only fail at the build step, after four role calls.
          const brief = w3dBriefFromBody(body);
          // Reference images: staged one by one with POST /api/inbox, then named here by their stage id.
          const stage = body["inbox_stage"];
          let images: Record<string, Buffer> = {};
          let stageDir: string | null = null;
          if (stage !== undefined && stage !== null) {
            if (typeof stage !== "string" || validateInboxName(stage)) throw new W3DBadRequest("Mã đính kèm không hợp lệ.");
            stageDir = manager.stageDir(stage);
            images = readStagedW3DImages(stageDir);
          }
          const missing = workshop3d.preflight();
          if (missing) return json(res, 503, { error: "cad_unavailable", message: missing });
          const slug = workshop3d.runner.start(brief, images);
          if (stageDir) fs.rmSync(stageDir, { recursive: true, force: true });
          return json(res, 201, { slug });
        }
        if (parts.length >= 3 && parts.length <= 4) {
          let slug: string;
          try {
            slug = decodeURIComponent(parts[2]!);
          } catch {
            return json(res, 404, { error: "not_found", message: "Không tìm thấy phiên dựng 3D." });
          }
          const detail = workshop3d.detail(slug);
          if (!detail) return json(res, 404, { error: "not_found", message: "Không tìm thấy phiên dựng 3D." });
          const action = parts[3];
          if (!action && method === "GET") return json(res, 200, detail);
          if (!action && method === "DELETE") {
            // "Xóa bản dựng": the whole session folder, nothing outside it; 409 while it runs, bakes or renders.
            const r = workshop3d.remove(slug);
            return json(res, 200, { ok: true, bytes: r.bytes });
          }
          if (action === "file" && method === "GET") {
            const rel = new URL(req.url ?? "/", "http://localhost").searchParams.get("path") ?? "";
            const info = workshop3d.filePath(slug, rel);
            res.writeHead(200, {
              "content-type": info.contentType,
              "content-length": info.size,
              "content-disposition": `${info.inline ? "inline" : "attachment"}; filename="${path.basename(info.abs).replace(/[^\w.-]/g, "_")}"`,
              "cache-control": "no-store",
              "x-content-type-options": "nosniff",
            });
            return void fs.createReadStream(info.abs).on("error", () => res.destroy()).pipe(res);
          }
          if (method === "POST" && action === "presentation") {
            // "Tạo trang trình bày": (re)builds outputs/trinh-bay/index.html from the session's files (no agent, no Blender).
            if (!workshop3d.buildPresentation) return json(res, 503, { error: "presentation_unavailable", message: "Trang trình bày chưa bật trên máy chủ này." });
            const r = workshop3d.buildPresentation(slug);
            const delivered = workshop3d.deliver?.(slug) ?? null;
            return json(res, 200, { ok: true, dir: r.dir, delivery: delivered?.dir ?? null, images: r.images, hasModel: r.hasModel, doorOpen: r.doorOpen, warnings: r.warnings });
          }
          if (method === "POST" && action === "open") {
            // Opens the session's output folder, the presentation folder or its index.html on this PC (local use only).
            if (isViaTunnel(req)) return json(res, 403, { error: "local_only", message: "Chỉ mở được trên máy chạy app, không mở qua kết nối từ xa." });
            const what = String((((await readBody(req)) ?? {}) as Record<string, unknown>)["what"] ?? "");
            // Make sure the Settings output folder is up to date before opening anything in it.
            try {
              workshop3d.deliver?.(slug);
            } catch {
              // opening falls back to the session folder below
            }
            const pp = workshop3d.paths?.(slug);
            if (!pp) return json(res, 404, { error: "not_found", message: "Không tìm thấy thư mục của phiên." });
            const dl = pp.delivery;
            const target = what === "outputs" ? (dl ?? pp.outputs) : what === "session" ? pp.session : what === "presentation" ? (dl ? path.join(dl, "trinh-bay") : pp.presentation) : what === "index" && pp.presentation ? path.join(dl ?? pp.presentation, ...(dl ? ["trinh-bay"] : []), "index.html") : null;
            if (!target || !fs.existsSync(target)) return json(res, 404, { error: "not_found", message: "Chưa có thư mục hoặc tệp này. Bấm \"Tạo trang trình bày\" trước." });
            try {
              const child = spawn("explorer.exe", [target], { detached: true, stdio: "ignore", windowsHide: false });
              child.on("error", () => undefined);
              child.unref();
              return json(res, 200, { ok: true, path: target });
            } catch (e) {
              return json(res, 500, { error: "open_failed", ...errorMessage(e) });
            }
          }
          if (method === "POST" && action === "continue") {
            // "Dựng tiếp": one more round for a finished session, with the user's notes (what to change, what is not good enough).
            const body = await readSkillBody(req, SKILL_BODY_LIMIT);
            const text = body["text"];
            if (typeof text !== "string" || !text.trim()) throw new W3DBadRequest("Hãy ghi chỗ chưa hài lòng hoặc nội dung cần sửa.");
            if (text.length > W3D_TEXT_MAX) throw new W3DBadRequest(`Nội dung dài quá ${W3D_TEXT_MAX} ký tự.`);
            workshop3d.resetCancel();
            workshop3d.runner.continueWith(slug, text);
            return json(res, 200, { ok: true });
          }
          if (method === "POST" && action && ["answer", "pause", "resume", "stop", "rebuild"].includes(action)) {
            const body = action === "answer" || action === "rebuild" ? await readSkillBody(req, SKILL_BODY_LIMIT) : {};
            if (action === "answer") {
              const text = body["text"];
              if (typeof text !== "string" || !text.trim()) throw new W3DBadRequest("Câu trả lời đang trống.");
              if (text.length > W3D_TEXT_MAX) throw new W3DBadRequest(`Câu trả lời dài quá ${W3D_TEXT_MAX} ký tự.`);
              workshop3d.runner.answer(slug, text);
            } else if (action === "rebuild") {
              const pr = body["params"];
              if (pr !== undefined && (!pr || typeof pr !== "object" || Array.isArray(pr))) throw new W3DBadRequest("params phải là đối tượng tên -> giá trị.");
              workshop3d.runner.rebuild(slug, pr as Record<string, string | number> | undefined);
            } else if (action === "pause") workshop3d.runner.pause(slug);
            else if (action === "resume") workshop3d.runner.resume(slug);
            else workshop3d.runner.stop(slug);
            return json(res, 200, { ok: true });
          }
        }
        return json(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
      } catch (e) {
        return w3dErrorResponse(res, e);
      }
    }
    if (p === "/api/skills" || p.startsWith("/api/skills/")) {
      const parts = p.split("/").filter(Boolean); // ["api","skills", slug?, "zip"?]
      try {
        const skills = skillStore;
        if (parts.length === 2 && method === "GET") return json(res, 200, { skills: await skills.list() });
        if (parts.length === 2 && method === "POST") {
          const body = await readSkillBody(req, SKILL_BODY_LIMIT);
          const title = typeof body["title"] === "string" ? body["title"] : "";
          let slug = typeof body["slug"] === "string" && body["slug"] ? body["slug"] : normalizeName(title);
          if (!slug) throw new SkillError("Không tạo được slug từ tiêu đề; hãy nhập slug (a-z, 0-9, dấu gạch ngang).", 400, "bad_slug");
          slug = validateSlug(slug);
          const { items: attachItems, stageDirs } = readStagedAttachments(body["attachments"], manager);
          const rec = await skills.create({ slug, title, goal: typeof body["goal"] === "string" ? body["goal"] : "", files: (body["files"] ?? {}) as Record<string, string> });
          if (attachItems.length > 0) {
            try {
              await skills.attachExamples(slug, attachItems);
            } catch (e) {
              await skills.remove(slug).catch(() => undefined);
              throw e;
            }
            for (const d of stageDirs) fs.rmSync(d, { recursive: true, force: true });
          }
          return json(res, 201, rec);
        }
        if (parts.length >= 3) {
          let slug: string;
          try {
            slug = validateSlug(decodeURIComponent(parts[2]!));
          } catch (e) {
            if (e instanceof SkillError) throw e;
            throw new SkillError("Slug không hợp lệ.", 400, "bad_slug");
          }
          if (parts.length === 3 && method === "GET") return json(res, 200, await skills.get(slug));
          if (parts.length === 3 && method === "PUT") {
            const body = await readSkillBody(req, SKILL_BODY_LIMIT);
            const input: { title?: string; goal?: string; files?: Record<string, string> } = {};
            if (typeof body["title"] === "string") input.title = body["title"];
            if (typeof body["goal"] === "string") input.goal = body["goal"];
            if (body["files"] !== undefined) input.files = body["files"] as Record<string, string>;
            return json(res, 200, await skills.update(slug, input));
          }
          if (parts.length === 3 && method === "DELETE") {
            await skills.remove(slug);
            return json(res, 200, { ok: true });
          }
          if (parts.length === 4 && parts[3] === "zip" && method === "GET") {
            const entries = await skills.readZipEntries(slug);
            const zip = buildZip(entries);
            res.writeHead(200, { "content-type": "application/zip", "content-length": zip.length, "content-disposition": `attachment; filename="${slug}.zip"`, "cache-control": "no-store" });
            return void res.end(zip);
          }
          if (parts.length === 4 && parts[3] === "answers" && method === "GET") {
            const schema = await skills.readInputsSchema(slug);
            return json(res, 200, { schema, answers: await skills.readAnswers(slug) });
          }
          if (parts.length === 4 && parts[3] === "answers" && method === "POST") {
            const body = await readSkillBody(req, SKILL_BODY_LIMIT);
            const answers = body["answers"];
            if (!answers || typeof answers !== "object" || Array.isArray(answers)) throw new SkillError("`answers` phải là một đối tượng id -> câu trả lời.", 400, "bad_request");
            let stageDir: string | undefined;
            const stageId = body["stageId"];
            if (stageId !== undefined && stageId !== null && stageId !== "") {
              if (typeof stageId !== "string" || validateInboxName(stageId)) throw new SkillError("Mã đính kèm không hợp lệ.", 400, "bad_stage");
              stageDir = manager.stageDir(stageId);
              if (!fs.existsSync(stageDir)) throw new SkillError("Không tìm thấy tệp đính kèm đã tải lên (mã đính kèm không tồn tại).", 400, "bad_stage");
            }
            await skills.writeAnswers(slug, answers as Record<string, unknown>, stageDir);
            return json(res, 200, { ok: true });
          }
          if (parts.length === 4 && parts[3] === "rounds" && method === "GET") {
            await skills.get(slug); // 404 for unknown slug
            return json(res, 200, await skillTrainer.getRounds(slug));
          }
          if (parts.length === 4 && parts[3] === "grade" && method === "POST") {
            await skills.get(slug); // 404 for unknown slug
            const body = await readSkillBody(req, SKILL_BODY_LIMIT);
            const score = body["score"];
            if (typeof score !== "number" || !Number.isFinite(score)) throw new SkillError("Điểm phải là số nguyên từ 0 đến 100.", 400, "invalid_grade");
            return json(res, 200, await skillTrainer.grade(slug, { score, feedback: body["feedback"] }));
          }
          if (parts[3] === "rounds" && parts.length >= 6 && parts[5] === "files" && method === "GET") {
            await skills.get(slug); // 404 for unknown slug
            const rn = /^[1-9][0-9]*$/.test(parts[4]!) ? Number(parts[4]) : 0;
            if (!rn) throw new SkillError("Số vòng không hợp lệ.", 400, "bad_round");
            if (parts.length === 6) return json(res, 200, { files: await skills.listTrialFiles(slug, rn) });
            if (parts.length === 7) {
              let name: string;
              try {
                name = decodeURIComponent(parts[6]!);
              } catch {
                throw new SkillError("Tên tệp không hợp lệ.", 400, "bad_file");
              }
              const text = await skills.readTrialFile(slug, rn, name);
              const dl = new URL(req.url ?? "/", "http://localhost").searchParams.get("download") === "1";
              res.writeHead(200, {
                "content-type": "text/markdown; charset=utf-8",
                "content-disposition": `${dl ? "attachment" : "inline"}; filename="${slug}-round-${rn}-${name}"`,
                "cache-control": "no-store"
              });
              return void res.end(text);
            }
          }
          if (parts.length === 4 && parts[3] === "restore-best" && method === "POST") {
            const { meta } = await skills.get(slug); // 404 for unknown slug
            const m = meta as unknown as { state?: string; paused?: boolean; bestRound?: number | null };
            if (["composing", "trial", "grading"].includes(String(m.state)) && m.paused !== true) {
              throw new SkillError("Đang huấn luyện: hãy tạm dừng hoặc dừng trước khi quay lại bản tốt nhất.", 409, "already_running");
            }
            const bestRound = m.bestRound;
            if (typeof bestRound !== "number" || bestRound <= 0) throw new SkillError("Chưa có vòng nào có điểm để quay lại.", 409, "no_best_round");
            const data = await skills.readRounds(slug);
            const rec = (data.rounds as Array<{ n?: number; skillVersion?: number }>).find((r) => r && r.n === bestRound);
            const ver = rec && Number.isInteger(rec.skillVersion) ? rec.skillVersion! : null;
            if (ver === null) throw new SkillError("Không tìm thấy phiên bản của vòng tốt nhất.", 409, "no_best_version");
            const restored = await skills.restoreVersion(slug, ver);
            return json(res, 200, { ok: true, restoredRound: bestRound, version: restored.meta.version });
          }
          if (parts.length === 4 && ["train", "start", "pause", "resume", "stop", "approve"].includes(parts[3]!) && method === "POST") {
            const action = parts[3]!;
            await skills.get(slug); // 404 for unknown slug
            const overrides: Record<string, number> = {};
            if (action === "train" || action === "start" || action === "resume") {
              const body = await readSkillBody(req, SKILL_BODY_LIMIT);
              for (const k of ["passScore", "maxRounds", "costCapUsd"]) {
                if (body[k] === undefined) continue;
                const v = body[k];
                if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) throw new SkillError(`Giá trị "${k}" phải là số dương.`, 400, "bad_config");
                overrides[k] = v;
              }
            }
            if (action === "train" || action === "start") return json(res, 202, await skillTrainer.train(slug, overrides));
            if (action === "pause") return json(res, 200, await skillTrainer.pause(slug));
            if (action === "resume") return json(res, 200, await skillTrainer.resume(slug, overrides));
            if (action === "stop") return json(res, 200, await skillTrainer.stop(slug));
            return json(res, 200, await skillTrainer.approve(slug));
          }
        }
        return json(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
      } catch (e) {
        return skillErrorResponse(res, e);
      }
    }
    if (p === "/api/skills-gen" || p.startsWith("/api/skills-gen/")) {
      const parts = p.split("/").filter(Boolean); // ["api","skills-gen","sessions", slug?, ...]
      try {
        const out = await skillsGen.handle(req, parts, method);
        if (!out) return json(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
        if (out.zip) {
          res.writeHead(out.status, { "content-type": "application/zip", "content-length": out.zip.data.length, "content-disposition": `attachment; filename="${out.zip.filename}"`, "cache-control": "no-store" });
          return void res.end(out.zip.data);
        }
        if (out.file) {
          res.writeHead(out.status, { "content-type": out.file.contentType, "content-length": out.file.data.length, "content-disposition": `attachment; filename="${out.file.filename}"`, "cache-control": "no-store" });
          return void res.end(out.file.data);
        }
        return json(res, out.status, out.body ?? {});
      } catch (e) {
        return skillErrorResponse(res, e);
      }
    }
    // Skill training runs live in their own project; it is not an environment and never listed as one.
    // ---- MCP registry (Settings > Kết nối MCP) ----
    if (p === "/api/mcp" && method === "GET") {
      return json(res, 200, { servers: loadMcpServers(manager.config.dataDir).map(redactServer), presets: MCP_PRESETS, cli: readCliSnapshot(manager.config.dataDir) });
    }
    if (p === "/api/mcp" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const preset = typeof body["preset"] === "string" ? MCP_PRESETS.find((x) => x.id === body["preset"]) : undefined;
        if (typeof body["preset"] === "string" && !preset) return json(res, 400, { error: "bad_request", message: "Mẫu MCP không tồn tại." });
        const server = validateMcpServer(preset ? { ...preset, enabled: true } : body);
        const list = loadMcpServers(manager.config.dataDir);
        if (list.some((x) => x.id === server.id)) return json(res, 400, { error: "bad_request", message: "Đã có máy chủ MCP cùng id." });
        saveMcpServers(manager.config.dataDir, [...list, server]);
        return json(res, 201, { server: redactServer(server) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    if (p === "/api/mcp/cli/refresh" && method === "POST") {
      try {
        cliRefreshInFlight ??= runClaudeMcpList(manager.claudePathForTools(), sanitizeEnv(manager.env, "subscription"))
          .then((items) => writeCliSnapshot(manager.config.dataDir, items))
          .finally(() => {
            cliRefreshInFlight = null;
          });
        return json(res, 200, await cliRefreshInFlight);
      } catch (e) {
        return json(res, 500, { error: "mcp_list_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/mcp/cli/login" && method === "POST") {
      if (isViaTunnel(req)) return json(res, 403, { error: "local_only", message: "Chỉ mở được trên máy chạy app, không mở qua kết nối từ xa." });
      // OAuth only works inside interactive `claude` (/mcp): open a terminal there for the user (fixed args, no user input).
      // Env is stripped of API keys like every other claude launch (CLAUDE.md rule 3).
      const opened = await new Promise<Error | null>((resolve) => {
        const child = spawn("cmd.exe", ["/c", "start", "", "cmd.exe", "/k", "claude"], {
          shell: false,
          detached: true,
          stdio: "ignore",
          cwd: manager.config.workspaceDir,
          env: sanitizeEnv(manager.env, "subscription"),
        });
        child.once("error", (e) => resolve(e));
        child.once("spawn", () => {
          child.unref();
          resolve(null);
        });
      });
      if (opened) return json(res, 500, { error: "login_failed", message: `Không mở được cửa sổ đăng nhập: ${opened.message}` });
      return json(res, 200, { ok: true });
    }
    const mcpM = /^\/api\/mcp\/([a-z0-9_-]+)(?:\/(probe))?$/.exec(p);
    if (mcpM) {
      const id = mcpM[1]!;
      const list = loadMcpServers(manager.config.dataDir);
      const cur = list.find((x) => x.id === id);
      if (!cur) return json(res, 404, { error: "not_found", message: "Không tìm thấy máy chủ MCP." });
      if (mcpM[2] === "probe" && method === "POST") {
        if (isViaTunnel(req)) return json(res, 403, { error: "local_only", message: "Chỉ kiểm tra được trên máy chạy app, không kiểm tra qua kết nối từ xa." });
        return json(res, 200, await probeMcp(cur));
      }
      if (!mcpM[2] && method === "PUT") {
        try {
          const patch = restoreSecrets(cur, (await readBody(req)) as Record<string, unknown>);
          const server = validateMcpServer({ ...cur, ...patch, id });
          saveMcpServers(manager.config.dataDir, list.map((x) => (x.id === id ? server : x)));
          return json(res, 200, { server: redactServer(server) });
        } catch (e) {
          return json(res, 400, { error: "bad_request", ...errorMessage(e) });
        }
      }
      if (!mcpM[2] && method === "DELETE") {
        saveMcpServers(manager.config.dataDir, list.filter((x) => x.id !== id));
        return json(res, 200, { ok: true });
      }
    }
    // ---- Grants ----
    if (p === "/api/grants" && method === "GET") {
      const project = new URL(req.url ?? "/", "http://localhost").searchParams.get("project");
      return json(res, 200, manager.getGrants(project));
    }
    if (p === "/api/grants" && method === "PUT") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const project = typeof body["project"] === "string" && body["project"] ? body["project"] : "__default__";
        return json(res, 200, { grants: manager.setGrants(project, body["grants"]) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    // ---- Preview config (per environment) ----
    const prevM = /^\/api\/projects\/([^/]+)\/preview$/.exec(p);
    if (prevM) {
      const name = decodeURIComponent(prevM[1]!);
      if (method === "GET") {
        if (!manager.store.getProject(name)) return json(res, 404, { error: "not_found", message: "Không tìm thấy môi trường." });
        return json(res, 200, { preview: manager.getPreviewConfig(name) });
      }
      if (method === "PUT") {
        if (!manager.store.getProject(name)) return json(res, 404, { error: "not_found", message: "Không tìm thấy môi trường." });
        const body = (await readBody(req)) as Record<string, unknown>;
        try {
          return json(res, 200, { preview: manager.setPreviewConfig(name, body["preview"]) });
        } catch (e) {
          return json(res, 400, { error: "bad_request", ...errorMessage(e) });
        }
      }
    }
    // ---- Output folder ----
    if (p === "/api/settings/output-dir" && method === "GET") {
      return json(res, 200, { outputDir: manager.outputDir(), defaultDir: defaultOutputDir(manager.config.workspaceDir) });
    }
    if (p === "/api/settings/output-dir" && method === "PUT") {
      try {
        const body = (await readBody(req)) as Record<string, unknown>;
        return json(res, 200, { outputDir: manager.setOutputDir(body["outputDir"] as string), defaultDir: defaultOutputDir(manager.config.workspaceDir) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    if (p === "/api/outputs/save" && method === "POST") {
      const group = typeof req.headers["x-output-group"] === "string" ? req.headers["x-output-group"].trim() : "";
      const name = fileNameHeader(req);
      if (!group || !name) return json(res, 400, { error: "bad_request", message: "Thiếu tên tệp hoặc nhóm thư mục." });
      try {
        const data = await readRawBody(req, 50 * 1024 * 1024);
        return json(res, 200, { ok: true, path: manager.saveOutputFile(group, name, data) });
      } catch (e) {
        return json(res, 400, { error: "save_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/projects" && method === "GET") return json(res, 200, { projects: store.listProjects().filter((x) => x.name !== SKILL_WORKSHOP_PROJECT && x.name !== WORKSHOP3D_PROJECT && x.name !== VIDEOSTUDIO_PROJECT) });
    if (p === "/api/projects" && method === "POST") {
      // CONTEXT-SPEC-v1 §8: {name, repo_path?, base_branch?, allowed_commands?}; repo_path null = plain label (research).
      const body = (await readBody(req)) as Record<string, unknown>;
      const name = typeof body["name"] === "string" ? body["name"].trim() : "";
      if (!name) return json(res, 400, { error: "bad_request", message: "Thiếu tên project." });
      const repoPath = typeof body["repo_path"] === "string" && body["repo_path"].trim() ? body["repo_path"].trim() : null;
      const base = typeof body["base_branch"] === "string" && body["base_branch"].trim() ? body["base_branch"].trim() : null;
      const cmds = Array.isArray(body["allowed_commands"]) ? (body["allowed_commands"] as unknown[]).filter((c): c is string => typeof c === "string") : [];
      try {
        const project = manager.addProject({ name, repo_path: repoPath, base_branch: base, allowed_commands: cmds });
        return json(res, 201, { project });
      } catch (e) {
        return json(res, 400, { error: "invalid_project", ...errorMessage(e) });
      }
    }
    if (p === "/api/connections" && method === "GET") {
      return json(res, 200, { connections: manager.connections.list().map(publicView), max: MAX_CONNECTIONS, defaultPath: DEFAULT_STAFF_PATH });
    }
    if (p === "/api/connections" && method === "POST") {
      try {
        const c = manager.connections.add((await readBody(req)) as Record<string, unknown>);
        return json(res, 201, { connection: publicView(c) });
      } catch (e) {
        return json(res, 400, { error: "bad_request", ...errorMessage(e) });
      }
    }
    const connM = /^\/api\/connections\/([^/]+)(?:\/(staff))?$/.exec(p);
    if (connM) {
      const cid = decodeURIComponent(connM[1]!);
      if (connM[2] === "staff" && method === "GET") {
        const r = await manager.connections.staff(cid);
        if (!r) return json(res, 404, { error: "not_found", message: "Không tìm thấy kết nối." });
        return json(res, 200, r);
      }
      if (!connM[2] && method === "DELETE") {
        if (!manager.connections.remove(cid)) return json(res, 404, { error: "not_found", message: "Không tìm thấy kết nối." });
        return json(res, 200, { ok: true });
      }
    }
    const openM = /^\/api\/skills-gen\/sessions\/([a-z0-9-]{1,40})\/rounds\/([1-9][0-9]{0,5})\/open\/([a-z]+)$/.exec(p);
    if (openM && method === "POST") {
      // Open a round's sample file in the program Windows associates with it (local use only: it opens a window on this PC).
      if (isViaTunnel(req)) return json(res, 403, { error: "local_only", message: "Chỉ mở được trên máy chạy app, không mở qua kết nối từ xa. Hãy dùng nút Tải." });
      const info = formatInfo(openM[3]!);
      if (!info) return json(res, 400, { error: "bad_format", message: "Định dạng tệp không hợp lệ." });
      const file = path.join(manager.config.dataDir, "skills-gen", openM[1]!, `round-${openM[2]}`, `sample.${info.ext}`);
      if (!fs.existsSync(file)) return json(res, 404, { error: "sample_missing", message: "Chưa có tệp mẫu cho vòng này." });
      try {
        const child = spawn("explorer.exe", [file], { detached: true, stdio: "ignore", windowsHide: false });
        child.on("error", () => undefined);
        child.unref();
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 500, { error: "open_failed", ...errorMessage(e) });
      }
    }
    if (p === "/api/phone" && method === "GET") {
      return json(res, 200, currentPhoneInfo());
    }
    if (p === "/api/phone/enable" && method === "POST") {
      const exe = findTailscale();
      if (!exe) return json(res, 400, { error: "no_tailscale", message: "Chưa cài Tailscale trên máy này. Cài từ tailscale.com/download rồi đăng nhập." });
      const before = currentPhoneInfo();
      if (!before.running || !before.origin) return json(res, 400, { error: "tailscale_off", message: "Tailscale chưa chạy hoặc chưa đăng nhập. Mở Tailscale và đăng nhập rồi thử lại." });
      const r = enableServe(exe, policy.port);
      if (!r.ok) return json(res, 400, { error: "serve_failed", message: r.message });
      const saved = loadAppSettings(manager.config.dataDir).allowedOrigins ?? [];
      if (!saved.includes(before.origin)) saveAppSettings(manager.config.dataDir, { allowedOrigins: [...saved, before.origin] });
      if (!(policy.extraOrigins ??= []).includes(before.origin)) policy.extraOrigins.push(before.origin);
      return json(res, 200, { ...currentPhoneInfo(), message: r.message });
    }
    if (p === "/api/phone/disable" && method === "POST") {
      const exe = findTailscale();
      const info = currentPhoneInfo();
      const r = exe ? disableServe(exe) : { ok: true, message: "Không tìm thấy Tailscale; chỉ gỡ quyền truy cập." };
      if (info.origin) {
        const saved = loadAppSettings(manager.config.dataDir).allowedOrigins ?? [];
        saveAppSettings(manager.config.dataDir, { allowedOrigins: saved.filter((o) => o !== info.origin) });
        if (policy.extraOrigins) policy.extraOrigins = policy.extraOrigins.filter((o) => o !== info.origin);
      }
      return json(res, r.ok ? 200 : 400, { ...currentPhoneInfo(), message: r.message });
    }
    if (p === "/api/scaffold" && method === "GET") {
      return json(res, 200, { templates: TEMPLATES, defaultParent: defaultProjectsDir(manager.config.workspaceDir) });
    }
    if (p === "/api/scaffold" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const str = (k: string) => (typeof body[k] === "string" ? (body[k] as string) : "");
      try {
        const r = scaffoldProject(
          { name: str("name"), template: body["template"] as TemplateId, goal: str("goal"), parentDir: str("parentDir") },
          { defaultParent: defaultProjectsDir(manager.config.workspaceDir), dataDir: manager.config.dataDir },
        );
        const project = manager.addProject({ name: str("name").trim(), repo_path: r.dir, base_branch: "main", allowed_commands: [] });
        return json(res, 201, { project, dir: r.dir, files: r.files, memory: r.memoryPath });
      } catch (e) {
        return json(res, 400, { error: "scaffold_failed", ...errorMessage(e) });
      }
    }
    const relGet = /^\/api\/releases\/([^/]+)$/.exec(p);
    if (relGet && method === "GET") {
      const log = readReleaseLogChecked(manager.config.dataDir, decodeURIComponent(relGet[1]!));
      if (!log) return json(res, 404, { error: "not_found", message: "Không tìm thấy bản ghi phát hành." });
      return json(res, 200, log);
    }
    const relPost = /^\/api\/projects\/([^/]+)\/release$/.exec(p);
    if (relPost && method === "POST") {
      const projectName = decodeURIComponent(relPost[1]!);
      const project = store.getProject(projectName);
      if (!project) return json(res, 404, { error: "project_not_found", message: "Không tìm thấy project." });
      if (!project.repo_path) return json(res, 400, { error: "no_repo", message: "Project không có repo đích; không thể phát hành." });
      const body = (await readBody(req)) as Record<string, unknown>;
      const dryRun = body["dryRun"] !== false;
      let branch: string | null = null;
      if (typeof body["runId"] === "string" && body["runId"]) {
        const r = store.getRun(body["runId"]);
        if (!r) return json(res, 404, { error: "not_found", message: "Không tìm thấy lần chạy." });
        if (r.status === "running" || manager.isActive(r.id)) return json(res, 409, { error: "run_active", message: "Lần chạy chưa xong; hãy chờ xong hoặc hủy trước khi phát hành." });
        branch = r.branch ?? null;
      }
      let config;
      try {
        config = readReleaseConfig(manager.config.dataDir, projectName);
      } catch (e) {
        return json(res, 400, { error: "invalid_release_config", ...errorMessage(e) });
      }
      if (!config) return json(res, 400, { error: "no_release_config", message: "Project chưa có cấu hình phát hành; hãy đặt mẫu hoặc cấu hình trước." });
      const repoPath = project.repo_path;
      const baseBranch = project.base_branch || "main";
      const deps = opts.releaseDeps ?? {};
      if (dryRun) {
        const iscc = findIscc(deps.env ?? process.env, deps.exists) ?? undefined;
        return json(res, 200, dryRunRelease({ repoPath, baseBranch, config, branch, ...(iscc ? { isccPath: iscc } : {}), ...(deps.env ? { env: deps.env } : {}) }));
      }
      if (isViaTunnel(req) && manager.config.release?.allowRemote !== true) {
        return json(res, 403, { error: "release_remote_disabled", message: "Phát hành thật bị tắt khi truy cập qua đường hầm/điện thoại. Hãy phát hành từ máy này hoặc bật release.allowRemote trong cấu hình." });
      }
      // The release runs the whole test suite; other runs executing at the same time made it take 12 min and time out.
      const busy = manager.activeCount();
      if (busy > 0) {
        return json(res, 409, { error: "runs_active", message: `Đang có ${busy} lần chạy hoạt động; bước test sẽ rất chậm và dễ quá thời gian. Hãy chờ chúng xong (hoặc hủy) rồi phát hành.` });
      }
      const releaseId = newReleaseId();
      void executeRelease({
        id: releaseId,
        dataDir: manager.config.dataDir, projectName, repoPath, baseBranch, config, branch,
        ...(deps.runner ? { runner: deps.runner } : {}), ...(deps.fetch ? { fetch: deps.fetch } : {}),
        ...(deps.exists ? { exists: deps.exists } : {}), ...(deps.env ? { env: deps.env } : {}),
      }).catch(() => undefined);
      return json(res, 202, { releaseId });
    }
    const rcm = /^\/api\/projects\/([^/]+)\/release-config$/.exec(p);
    if (rcm && (method === "GET" || method === "PUT")) {
      const projectName = decodeURIComponent(rcm[1]!);
      if (!store.getProject(projectName)) return json(res, 404, { error: "project_not_found", message: "Không tìm thấy project." });
      const dataDir = manager.config.dataDir;
      try {
        if (method === "GET") return json(res, 200, { config: readReleaseConfig(dataDir, projectName), templates: RELEASE_TEMPLATES });
        const body = (await readBody(req)) as Record<string, unknown>;
        let input: unknown;
        if (typeof body["template"] === "string") {
          input = Object.prototype.hasOwnProperty.call(RELEASE_TEMPLATES, body["template"]) ? RELEASE_TEMPLATES[body["template"]] : undefined;
          if (!input) return json(res, 400, { error: "unknown_template", message: "Mẫu phát hành không tồn tại." });
        } else if (body["config"] !== undefined) {
          input = body["config"];
        } else {
          return json(res, 400, { error: "bad_request", message: "Cần trường config hoặc template." });
        }
        return json(res, 200, { config: writeReleaseConfig(dataDir, projectName, input), templates: RELEASE_TEMPLATES });
      } catch (e) {
        if (e instanceof ReleaseConfigError) return json(res, 400, { error: "invalid_release_config", message: e.message });
        return json(res, 400, { error: "invalid_release_config", ...errorMessage(e) });
      }
    }
    if (p === "/api/autopilot" || p.startsWith("/api/autopilot/")) {
      const sub = p.slice("/api/autopilot/".length);
      const allowed: Record<string, string> = { status: "GET", enable: "POST", disable: "POST", schedule: "PUT", webhooks: "PUT", summary: "GET", "check-duplicate": "POST" };
      const want = allowed[sub];
      if (!want) return json(res, 404, { error: "not_found", message: "Không tìm thấy đường dẫn autopilot." });
      if (method !== want) return json(res, 405, { error: "method_not_allowed", message: `Chỉ hỗ trợ ${want}.` });
      if (sub === "status") return json(res, 200, autopilotView(manager));
      if (sub === "summary") {
        const ISO_RE = /^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/;
        const parseIso = (name: string): number | null | undefined => {
          const raw = url.searchParams.get(name);
          if (raw === null) return undefined;
          if (!ISO_RE.test(raw)) return null;
          const t = Date.parse(raw);
          return Number.isFinite(t) ? t : null;
        };
        const fromP = parseIso("from");
        const toP = parseIso("to");
        if (fromP === null) return json(res, 400, { error: "bad_request", message: "from phải là ngày ISO 8601." });
        if (toP === null) return json(res, 400, { error: "bad_request", message: "to phải là ngày ISO 8601." });
        const toMs = toP ?? Date.now();
        const fromMs = fromP ?? toMs - 24 * 3600 * 1000;
        if (fromMs > toMs) return json(res, 400, { error: "bad_request", message: "from không được sau to." });
        const filter = { from: fromMs, to: toMs };
        const runs = store.listRuns({ ...filter, limit: SUMMARY_MAX_RUNS });
        const truncated = store.countRuns(filter) > runs.length;
        const queueCommands = store.listProjects().flatMap((pr) => manager.queue.list(pr.name));
        const sum = summarizePeriod({ from: fromMs, to: toMs, runs, queueCommands });
        return json(res, 200, {
          from: new Date(fromMs).toISOString(),
          to: new Date(toMs).toISOString(),
          ...sum,
          truncated,
          estimate: true,
        });
      }
      if (sub === "check-duplicate") {
        const dbody = requireJsonObject(await readBody(req));
        const keys = ["project", "title", "prompt", "files"];
        const extra = Object.keys(dbody).filter((k) => !keys.includes(k));
        if (extra.length) return json(res, 400, { error: "bad_request", message: `Khóa không hợp lệ: ${extra.join(", ")}.` });
        const { project: dproj, title, prompt, files } = dbody;
        if (typeof dproj !== "string" || !dproj.trim()) return json(res, 400, { error: "bad_request", message: "project phải là chuỗi không rỗng." });
        if (typeof title !== "string" || title.length < 1 || title.length > 200) {
          return json(res, 400, { error: "bad_request", message: "title phải là chuỗi 1..200 ký tự." });
        }
        if (prompt !== undefined && (typeof prompt !== "string" || prompt.length > 20000)) {
          return json(res, 400, { error: "bad_request", message: "prompt phải là chuỗi tối đa 20000 ký tự." });
        }
        if (
          files !== undefined &&
          (!Array.isArray(files) || files.length > 50 || files.some((f) => typeof f !== "string" || f.length > 300))
        ) {
          return json(res, 400, { error: "bad_request", message: "files phải là mảng tối đa 50 chuỗi, mỗi chuỗi tối đa 300 ký tự." });
        }
        if (!store.getProject(dproj)) return json(res, 404, { error: "project_not_found", message: "Không tìm thấy project." });
        const duplicates = findDuplicates(
          {
            project: dproj,
            title,
            body: typeof prompt === "string" ? prompt : "",
            ...(Array.isArray(files) ? { files: files as string[] } : {}),
          },
          manager.queue.list(dproj),
        );
        return json(res, 200, { duplicates, hasHigh: duplicates.some((d) => d.level === "high") });
      }
      const abody = requireJsonObject(await readBody(req));
      if (sub === "schedule" || sub === "webhooks") {
        const key = sub;
        const extra = Object.keys(abody).filter((k) => k !== key);
        if (extra.length) return json(res, 400, { error: "bad_request", message: `Khóa không hợp lệ: ${extra.join(", ")}.` });
        if (!(key in abody)) return json(res, 400, { error: "bad_request", message: `Thiếu khóa ${key}.` });
        if (key === "schedule") {
          const v = abody["schedule"];
          if (v !== null && typeof v !== "string") return json(res, 400, { error: "invalid_schedule", message: "schedule phải là chuỗi hoặc null." });
          if (typeof v === "string" && v.length > AUTOPILOT_SCHEDULE_MAX_LEN) {
            return json(res, 400, { error: "invalid_schedule", message: `Lịch tối đa ${AUTOPILOT_SCHEDULE_MAX_LEN} ký tự.` });
          }
          try {
            manager.autopilot.setSchedule(v);
          } catch (e) {
            return json(res, 400, { error: "invalid_schedule", ...errorMessage(e) });
          }
        } else {
          try {
            manager.setWebhooks(abody["webhooks"]);
          } catch (e) {
            return json(res, 400, { error: "invalid_webhooks", ...errorMessage(e) });
          }
        }
        return json(res, 200, autopilotView(manager));
      }
      if (sub === "enable") manager.autopilot.enable();
      else manager.autopilot.disable();
      return json(res, 200, autopilotView(manager));
    }
    const sm = /^\/api\/projects\/([^/]+)\/queue\/split(?:\/([^/]+)(?:\/(answers))?)?$/.exec(p);
    if (sm && ((!sm[2] && method === "POST") || (sm[2] && !sm[3] && method === "GET") || (sm[2] && sm[3] && method === "POST"))) {
      return handleSplitApi(req, res, method, decodeURIComponent(sm[1]!), sm[2] ? decodeURIComponent(sm[2]) : undefined, sm[3]);
    }
    const qm = /^\/api\/projects\/([^/]+)\/queue(?:\/([^/]+)(?:\/(approve-run|skip|confirm-done|mark-failed|confirm-merged|retry|unskip|stop))?)?$/.exec(p);
    if (qm) {
      const isRunParallel = qm[2] === "run-parallel" && !qm[3];
      const isRunAll = qm[2] === "run-all" && (!qm[3] || qm[3] === "stop");
      const isApproveAll = qm[2] === "approve-all" && !qm[3];
      const isDeleteIdea = qm[2] === "delete-idea" && !qm[3];
      const ok =
        (isDeleteIdea && method === "POST") ||
        (!qm[2] && method === "GET") ||
        (isRunParallel && method === "POST") ||
        (isRunAll && method === "POST") ||
        (isApproveAll && method === "POST") ||
        (qm[2] && !isRunParallel && !isRunAll && !isApproveAll && !qm[3] && method === "PATCH") ||
        (qm[3] !== undefined && qm[3] !== "stop" && method === "POST") ||
        (qm[3] !== undefined && method === "POST");
      if (ok) return handleQueueApi(manager, req, res, method, decodeURIComponent(qm[1]!), qm[2] ? decodeURIComponent(qm[2]) : undefined, qm[3]);
    }
    const pm = /^\/api\/projects\/([^/]+)$/.exec(p);
    if (pm && pm[1] !== "validate" && method === "DELETE") {
      try {
        manager.removeProject(decodeURIComponent(pm[1]!));
        return json(res, 200, { ok: true });
      } catch (e) {
        return json(res, 400, { error: "invalid_project", ...errorMessage(e) });
      }
    }
    if (p === "/api/projects/validate" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const repoPath = typeof body["repo_path"] === "string" ? body["repo_path"].trim() : "";
      const base = typeof body["base_branch"] === "string" && body["base_branch"].trim() ? body["base_branch"].trim() : "main";
      if (!repoPath) return json(res, 200, { ok: false, head_sha: null, dirty: false, branches: [], error: "Thiếu đường dẫn repo." });
      return json(res, 200, manager.validateProject(repoPath, base));
    }
    if (p === "/api/design3d" && method === "GET") {
      let kit;
      try {
        kit = loadKit(manager.config.repoRoot);
      } catch (e) {
        return json(res, 500, { error: "kit_invalid", ...errorMessage(e) });
      }
      const entries = store.listRuns({ limit: 200 }).map((r) => ({ run: r, artifacts: store.getArtifacts(r.id) }));
      return json(res, 200, { kit, floors: buildDesign3dFloors(entries) });
    }

    const m = /^\/api\/runs\/([^/]+)(?:\/(.*))?$/.exec(p);
    if (!m) return json(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
    const runId = decodeURIComponent(m[1]!);
    const sub = m[2] ?? "";
    const run = store.getRun(runId);
    if (!run) return json(res, 404, { error: "not_found", message: "Không tìm thấy lần chạy." });

    if (sub === "" && method === "GET") {
      const project = store.getProject(run.project);
      const merged = manager.mergedFlag(run);
      return json(res, 200, {
        run: merged === undefined ? run : { ...run, merged },
        wait_reason: manager.waitReason(runId) ?? null,
        merged,
        merge_precheck: run.merge_precheck ?? null,
        active: manager.isActive(runId),
        artifacts: store.getArtifacts(runId),
        worktree_exists: manager.worktreeExists(run),
        repo_path: project?.repo_path ?? null,
        base_branch: project?.base_branch ?? null,
        stream_path: path.join(manager.config.dataDir, "runs", runId, "stream.jsonl"),
        inbox: listInbox(run.run_dir),
      });
    }
    if (sub === "roles" && method === "GET") {
      // Effective roles of the run (per-run override file wins, else the kind's default); prompts are not exposed.
      const d = manager.config.defaults;
      const override = path.join(manager.config.dataDir, "runs", runId, "roles.json");
      const file = fs.existsSync(override) ? override : run.kind === "coding" ? d.coding.agentsFile : d.agentsFile;
      const roles = Object.entries(readRoles(file)).map(([id, def]) => ({
        id,
        description: typeof def["description"] === "string" ? def["description"] : "",
        ...(typeof def["model"] === "string" ? { model: def["model"] } : {}),
      }));
      return json(res, 200, { roles });
    }
    if (sub === "model" && method === "GET") {
      const MAX_MODEL_BYTES = 50 * 1024 * 1024;
      const MODEL_TYPES: Record<string, string> = {
        stl: "model/stl",
        glb: "model/gltf-binary",
        gltf: "model/gltf+json",
        step: "application/step",
        obj: "model/obj",
      };
      const rel = url.searchParams.get("path") ?? "";
      if (!rel.trim()) return json(res, 400, { error: "bad_request", message: "Thiếu tham số path." });
      const format = DESIGN3D_EXT_FORMAT[path.extname(rel).toLowerCase()];
      if (!format) return json(res, 400, { error: "bad_request", message: "Đuôi tệp không phải mô hình 3D." });
      const file = isSecretRunFile(rel) ? null : safeJoin(run.run_dir, rel);
      if (!file) return json(res, 400, { error: "bad_request", message: "Đường dẫn không hợp lệ." });
      let real: string;
      let st: fs.Stats;
      try {
        const realRoot = fs.realpathSync(run.run_dir);
        real = fs.realpathSync(file);
        if (!(real + path.sep).startsWith(realRoot + path.sep) || real === realRoot) {
          return json(res, 400, { error: "bad_request", message: "Đường dẫn không hợp lệ." });
        }
        st = fs.statSync(real);
      } catch {
        return json(res, 404, { error: "not_found", message: "Không có tệp." });
      }
      if (!st.isFile()) return json(res, 404, { error: "not_found", message: "Không có tệp." });
      if (st.size > MAX_MODEL_BYTES) return json(res, 413, { error: "too_large", message: "Tệp 3D quá lớn (tối đa 50 MB)." });
      res.writeHead(200, { "content-type": MODEL_TYPES[format] ?? "application/octet-stream", "content-length": st.size, "cache-control": "no-store" });
      return void fs.createReadStream(real).pipe(res);
    }
    if (sub === "inbox" && method === "POST") {
      // Attach a file to an existing run (read by the next follow-up, or by the running agents if they look).
      const name = fileNameHeader(req);
      const bad = validateInboxName(name);
      if (bad) return json(res, 400, { error: "bad_request", message: bad });
      try {
        const data = await readRawBody(req, INBOX_MAX_BYTES);
        const file = saveInboxFile(run.run_dir, name, data);
        return json(res, 201, { ok: true, file, inbox: listInbox(run.run_dir) });
      } catch (e) {
        return json(res, 400, { error: "inbox_failed", ...errorMessage(e) });
      }
    }
    if (sub === "artifacts.zip" && method === "GET") {
      // "Tải tất cả": every recorded artifact (small text files) in one archive, built in memory.
      const entries = [];
      for (const a of store.getArtifacts(runId)) {
        if (isSecretRunFile(a.rel_path)) continue;
        const file = safeJoin(run.run_dir, a.rel_path);
        if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
        entries.push({ name: a.rel_path.replace(/\\/g, "/"), data: fs.readFileSync(file), mtime: a.mtime });
      }
      if (entries.length === 0) return json(res, 404, { error: "not_found", message: "Chưa có tệp nào." });
      const zip = buildZip(entries);
      res.writeHead(200, { "content-type": "application/zip", "content-length": zip.length, "content-disposition": `attachment; filename="${runId}-artifacts.zip"`, "cache-control": "no-store" });
      return void res.end(zip);
    }
    if (sub === "quota-resume" && method === "GET") {
      return json(res, 200, { resume: manager.getQuotaResume(runId), max_attempts: manager.config.autoResume?.maxAttempts ?? 3 });
    }
    if (sub === "quota-resume/cancel" && method === "POST") {
      if (!manager.cancelQuotaResume(runId)) return json(res, 409, { error: "not_pending", message: "Không có hẹn tự tiếp tục đang chờ." });
      return json(res, 200, { ok: true });
    }
    if (sub === "open-output" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      try {
        const rel = typeof body["rel_path"] === "string" && body["rel_path"] ? body["rel_path"] : undefined;
        return json(res, 200, { ok: true, path: manager.openOutput(runId, rel) });
      } catch (e) {
        return json(res, 400, { error: "open_failed", ...errorMessage(e) });
      }
    }
    if (sub === "preview" && method === "POST") {
      try {
        return json(res, 202, { state: manager.startPreview(runId, { viaTunnel: isViaTunnel(req) }) });
      } catch (e) {
        if (e instanceof PreviewError) return json(res, { not_found: 404, bad_request: 400, forbidden: 403, conflict: 409 }[e.code], { error: e.code, ...errorMessage(e) });
        throw e;
      }
    }
    if (sub === "preview" && method === "GET") {
      return json(res, 200, { state: manager.getPreviewState(runId), config: run.project ? manager.getPreviewConfig(run.project) : { kind: "none" } });
    }
    if (sub.startsWith("preview/") && method === "GET") {
      let name = "";
      try {
        name = decodeURIComponent(sub.slice("preview/".length));
      } catch {
        /* malformed escape: falls through to 404 */
      }
      const file = manager.previewFile(runId, name);
      if (!file) return json(res, 404, { error: "not_found", message: "Không tìm thấy ảnh." });
      const data = fs.readFileSync(file);
      res.writeHead(200, { "content-type": "image/png", "content-length": data.length, "cache-control": "no-store" });
      return void res.end(data);
    }
    if (sub === "open-dir" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const target: OpenDirTarget = body["target"] === "worktree" ? "worktree" : "run_dir";
      try {
        return json(res, 200, { ok: true, path: manager.openDir(runId, target) });
      } catch (e) {
        return json(res, 400, { error: "open_failed", ...errorMessage(e) });
      }
    }
    if (sub === "cleanup-worktree" && method === "POST") {
      if (manager.isActive(runId)) return json(res, 409, { error: "still_running", message: "Lần chạy vẫn đang chạy; hãy chờ xong hoặc hủy trước." });
      try {
        return json(res, 200, { ok: true, ...manager.cleanupWorktree(runId) });
      } catch (e) {
        return json(res, 400, { error: "cleanup_failed", ...errorMessage(e) });
      }
    }
    if (sub === "release" && method === "POST") {
      if (manager.isActive(runId)) return json(res, 409, { error: "still_running", message: "Lần chạy vẫn đang chạy; hãy chờ xong hoặc hủy trước." });
      try {
        return json(res, 200, { ok: true, ...manager.releaseRun(runId) });
      } catch (e) {
        return json(res, 400, { error: "release_failed", ...errorMessage(e) });
      }
    }
    if (sub === "merge-precheck" && method === "POST") {
      // The branch always comes from the run record; nothing is read from the client.
      if (run.kind !== "coding" || !run.branch) return json(res, 400, { error: "bad_request", message: "Chỉ lần chạy lập trình có nhánh mới kiểm tra gộp được." });
      try {
        const result = manager.precheckMerge(run.id);
        if (result === undefined) return json(res, 400, { error: "precheck_failed", message: "Không kiểm tra được khả năng gộp nhánh này." });
        return json(res, 200, result);
      } catch (e) {
        return json(res, 400, { error: "precheck_failed", ...errorMessage(e) });
      }
    }
    if (sub === "publish" && method === "POST") {
      if (manager.isActive(runId)) return json(res, 409, { error: "still_running", message: "Lần chạy vẫn đang chạy; hãy chờ xong hoặc hủy trước." });
      if (manager.mergedFlag(run) === false) return json(res, 409, { error: "not_merged", message: "Nhánh chưa được commit vào main. Hãy commit vào main trước khi phát hành." });
      try {
        return json(res, 200, manager.publishRun(runId));
      } catch (e) {
        return json(res, 400, { error: "publish_failed", ...errorMessage(e) });
      }
    }
    if (sub === "events" && method === "GET") {
      const after = numOpt(url.searchParams.get("after")) ?? 0;
      return json(res, 200, { events: store.getEvents(runId, after) });
    }
    if (sub === "report" && method === "GET") {
      const text = resolveReportText(run.run_dir, run.result_text);
      if (text === null) return json(res, 404, { error: "no_report", message: "Chưa có report.md." });
      res.writeHead(200, { "content-type": "text/markdown; charset=utf-8", "cache-control": "no-store" });
      return void res.end(text);
    }
    if (sub.startsWith("artifacts/") && method === "GET") {
      const rel = decodeURIComponent(sub.slice("artifacts/".length));
      const file = isSecretRunFile(rel) ? null : safeJoin(run.run_dir, rel);
      if (!file || !fs.existsSync(file) || !fs.statSync(file).isFile()) return json(res, 404, { error: "not_found", message: "Không có tệp." });
      res.writeHead(200, { "content-type": "text/plain; charset=utf-8", "cache-control": "no-store" });
      return void res.end(fs.readFileSync(file, "utf8"));
    }
    if (sub === "stream" && method === "GET") {
      const file = path.join(manager.config.dataDir, "runs", runId, "stream.jsonl");
      if (!fs.existsSync(file)) return json(res, 404, { error: "not_found", message: "Không có stream.jsonl." });
      res.writeHead(200, { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store" });
      return void fs.createReadStream(file).pipe(res);
    }
    if (sub === "cancel" && method === "POST") {
      const ok = manager.cancel(runId);
      return json(res, ok ? 200 : 409, ok ? { ok: true } : { error: "not_active", message: "Lần chạy này không còn chạy." });
    }
    if (sub === "followup" && method === "POST") {
      const body = (await readBody(req)) as Record<string, unknown>;
      const prompt = typeof body["prompt"] === "string" ? body["prompt"] : "";
      const over: Omit<StartRunInput, "prompt"> = {};
      const mt = numOpt(body["max_turns"]);
      if (mt !== undefined) over.maxTurns = mt;
      const mb = numOpt(body["budget_usd"]);
      if (mb !== undefined) over.maxBudgetUsd = mb;
      // A present, non-empty `comments` wins over `prompt` (prompt is ignored).
      const hasComments = "comments" in body && !(Array.isArray(body["comments"]) && body["comments"].length === 0);
      if (!hasComments && prompt.trim() === "") {
        return json(res, 400, { error: "empty_followup", message: "Cần nhập câu hỏi hoặc ít nhất một nhận xét." });
      }
      try {
        const child = hasComments
          ? await manager.followupWithComments(runId, body["comments"], over)
          : await manager.followup(runId, prompt, over);
        return json(res, 201, { run: child });
      } catch (e) {
        if (e instanceof CommentsError) return json(res, 400, { error: "invalid_comments", message: e.message });
        return json(res, 400, { error: "followup_failed", ...errorMessage(e) });
      }
    }
    return json(res, 404, { error: "not_found", message: "Không có đường dẫn này." });
  }

  // connect-src must also name each tunnel origin (and its ws/wss form), or the browser blocks fetch/WebSocket there.
  const extra = policy.extraOrigins ?? [];
  const csp = `default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; connect-src 'self' blob: ws://127.0.0.1:* ws://localhost:*${extra.map((o) => ` ${o} ${o.replace(/^http/, "ws")}`).join("")}`;

  function serveStatic(req: IncomingMessage, res: ServerResponse, p: string): void {
    const dir = opts.staticDir;
    if (!dir || !fs.existsSync(dir)) {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8", "content-security-policy": csp });
      res.end("<!doctype html><meta charset=utf-8><p>Giao diện chưa được build. Chạy <code>npm run build:ui</code>.</p>");
      return;
    }
    let rel = p === "/" ? "/index.html" : p;
    let file = safeJoin(dir, "." + rel);
    if (!file || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      rel = "/index.html";
      file = path.join(dir, "index.html");
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      "content-type": MIME[ext] ?? "application/octet-stream",
      "cache-control": rel === "/index.html" ? "no-store" : "public, max-age=3600",
      "x-frame-options": "DENY",
      "content-security-policy": csp,
    });
    fs.createReadStream(file).pipe(res);
  }

  return server;
}

const LOCAL_HOSTNAMES = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);

function hostnameOf(value: string, isUrl: boolean): string | null {
  try {
    const u = new URL(isUrl ? value : `http://${value}`);
    return u.hostname.toLowerCase();
  } catch {
    return null;
  }
}

/**
 * True when the request did not come straight from this machine: Host or Origin is not loopback.
 * Derived from the real connection headers only; X-Forwarded-* can only make the result stricter, never looser.
 */
/** `mcp.json` at a run-dir root may hold plaintext connector secrets: never served, whatever put it there. */
function isSecretRunFile(rel: string): boolean {
  return rel.replace(/\\/g, "/").replace(/^(\.\/)+/, "").toLowerCase() === "mcp.json";
}

export function isViaTunnel(req: IncomingMessage): boolean {
  const host = req.headers.host;
  const h = typeof host === "string" ? hostnameOf(host, false) : null;
  if (!h || !LOCAL_HOSTNAMES.has(h)) return true;
  const origin = req.headers.origin;
  if (typeof origin === "string" && origin) {
    const o = hostnameOf(origin, true);
    if (!o || !LOCAL_HOSTNAMES.has(o)) return true;
  }
  if (req.headers["x-forwarded-for"] || req.headers["x-forwarded-host"]) return true;
  return false;
}

function authMessage(f: string): string {
  switch (f) {
    case "bad_host":
      return "Header Host không hợp lệ (chỉ chấp nhận 127.0.0.1/localhost hoặc tên trong server.allowedOrigins).";
    case "bad_origin":
      return "Origin không được phép.";
    default:
      return "Thiếu hoặc sai token điều khiển.";
  }
}
