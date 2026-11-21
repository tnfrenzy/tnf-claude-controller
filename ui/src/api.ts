import type { ArtifactRecord, Design3DResponse, Workshop3DAction, Workshop3DBriefInput, Design3DKit, Workshop3DListItem, Workshop3DSession, CatalogRole, CleanupPreview, CleanupResult, ExtraAgentInput, InboxFile, LibraryData, LibraryImportRequest, LibraryImportResponse, LibraryItem, LibraryRole, MergePrecheck, NewAgentInput, ProjectSummary, QueueApproveRunResult, QueuePatch, QueuePatchResult, QueueRunAllState, QueueRunParallelResult, QueueSkipResult, QueueView, RoleMatch, RunRecord, SkillSession, SkillsGenCreateAgentsResponse, SkillsGenSessionResponse, SplitStartResponse, SplitStatus, StatusResponse, StoredEvent, TuningResponse, TuningValues, UsageBlocks, W3DModelSettings, W3DModelsResponse } from "./types";
import { pick } from "./lib/lang";
import type { QuotaResumeResponse, VsAspect, VsLibraryItem, VsListItem, VsPlan, VsProjectDetail, VsSettingsInput, VsSettingsPublic, VsStyle } from "./types";
import type { InputsSchema } from "./skills/skillForm";
import { outputGroup } from "./settings/grantsView";
import type { PhoneInfo } from "../../src/core/shared-types";
import type { OutputFormat } from "./skills/skillOutputs";
import type { PublicConnection, StaffResult } from "../../src/core/shared-types";
import type { TemplateInfo } from "../../src/core/shared-types";
import type { SkillListItem } from "./office/floors";
import type { DiffComment } from "./run/diffComments";

export interface SkillRoundRecord {
  n: number;
  score?: number;
  errors: string[];
  costUsdEstimate: number;
  feedback?: string;
  gradedBy?: string;
}
export interface SkillRoundsResponse {
  version: number;
  rounds: SkillRoundRecord[];
  bestScore?: number | null;
  bestRound?: number | null;
  state: string;
}

const TOKEN_KEY ="tnf.controller.token";

/** Read `#token=...` from the URL once, store it, and strip it from the address bar. */
export function bootstrapToken(): string | null {
  const m = /(?:^#|&)token=([A-Za-z0-9]+)/.exec(location.hash);
  if (m?.[1]) {
    try {
      sessionStorage.setItem(TOKEN_KEY, m[1]);
    } catch {
      /* private mode: keep in memory only */
    }
    memToken = m[1];
    history.replaceState(null, "", location.pathname + "#/cmd");
  }
  return getToken();
}
let memToken: string | null = null;
export function getToken(): string | null {
  if (memToken) return memToken;
  try {
    memToken = sessionStorage.getItem(TOKEN_KEY);
  } catch {
    memToken = null;
  }
  return memToken;
}
export function setToken(t: string): void {
  memToken = t;
  try {
    sessionStorage.setItem(TOKEN_KEY, t);
  } catch {
    /* ignore */
  }
}

export interface RunMeta {
  /** Why a queued run is held back by the scope guard (null = just waiting for a free slot). */
  wait_reason?: string | null;
  run: RunRecord;
  active: boolean;
  artifacts: ArtifactRecord[];
  /** null when the run has no worktree (research). */
  worktree_exists: boolean | null;
  repo_path: string | null;
  base_branch: string | null;
  stream_path: string;
  inbox: InboxFile[];
  /** Only present in GET /api/runs/:id. */
  merged?: boolean;
  /** Latest result after a recheck (overwritten client-side). */
  merge_precheck?: MergePrecheck | null;
}

/** Server-side rule for attachment names (ASCII, no path, no leading dot). Mirrors src/core/run/inbox.ts. */
export const INBOX_NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;
export const INBOX_MAX_BYTES = 5 * 1024 * 1024;

async function upload(path: string, file: File): Promise<Response> {
  if (!INBOX_NAME_RE.test(file.name) || file.name.includes("..")) throw new ApiError("bad_name", 400, "bad_name");
  if (file.size > INBOX_MAX_BYTES || file.size === 0) throw new ApiError(pick("Tệp quá lớn hoặc rỗng (tối đa 5 MB).", "The file is empty or too large (5 MB max)."), 400, "bad_size");
  const r = await fetch(path, { method: "POST", headers: { "x-controller-token": getToken() ?? "", "content-type": "application/octet-stream", "x-file-name": file.name }, body: file });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(j.message ?? r.statusText, r.status, j.error);
  }
  return r;
}

/** Path of a 3D workshop session (GET detail; actions are sub-paths). */
export function workshop3dPath(slug: string): string {
  return `/api/workshop3d/${encodeURIComponent(slug)}`;
}

const VS = "/api/videostudio";

/** Path of a video studio project. */
export function videoStudioPath(slug: string): string {
  return `${VS}/${encodeURIComponent(slug)}`;
}

/** Path of a video studio project file (load with fetchBlob / downloadFile). */
export function videoStudioFilePath(slug: string, rel: string): string {
  return `${videoStudioPath(slug)}/file?path=${encodeURIComponent(rel)}`;
}

/** Path of a session file. No token in it: load it with fetchBlob / downloadFile (header token). */
export function workshop3dFilePath(slug: string, relPath: string): string {
  return `${workshop3dPath(slug)}/file?path=${encodeURIComponent(relPath)}`;
}

/** GET with the token header, as a Blob; a JSON error body becomes an ApiError with the server message. */
export async function fetchBlob(path: string): Promise<Blob> {
  const r = await fetch(path, { headers: { "x-controller-token": getToken() ?? "" } });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(j.message ?? r.statusText, r.status, j.error);
  }
  return r.blob();
}

/** Fetch a file with the token header and hand it to the browser as a download (the token never goes in a URL). */
export async function downloadFile(path: string, fileName: string): Promise<void> {
  const r = await fetch(path, { headers: { "x-controller-token": getToken() ?? "" } });
  if (!r.ok) throw new ApiError(r.statusText, r.status);
  const url = URL.createObjectURL(await r.blob());
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Path of a run's 3D model file. The URL carries NO token (the server only accepts the
 * x-controller-token header), so it cannot be used directly as an <a>/<img> src: callers load it with modelBlob.
 */
export function modelUrl(runId: string, relPath: string): string {
  return `/api/runs/${encodeURIComponent(runId)}/model?path=${encodeURIComponent(relPath)}`;
}

/** Fetch a run's 3D model with the token header and return it as a Blob (caller makes an ArrayBuffer/blob URL). */
export async function modelBlob(runId: string, relPath: string): Promise<Blob> {
  const r = await fetch(modelUrl(runId, relPath), { headers: { "x-controller-token": getToken() ?? "" } });
  if (!r.ok) {
    const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
    throw new ApiError(j.message ?? r.statusText, r.status, j.error);
  }
  return r.blob();
}

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code?: string,
  ) {
    super(message);
  }
}

export interface McpServerView { id: string; name: string; kind: "stdio" | "http"; command?: string; args?: string[]; url?: string; enabled: boolean; preset?: string; writeTools?: string[]; processTools?: string[] }
export interface CliMcpView { name: string; target: string; status: "connected" | "needs_auth" | "failed" | "not_configured"; detail?: string }
export interface GrantsView {
  fileWrite: boolean; web: boolean; cmdNode: boolean; cmdPython: boolean; cmdNative: boolean; cmdBasic: boolean; cmdInstall: boolean; gitRestore: boolean; anyProcess: boolean;
  preview: boolean;
  extraDirs: Array<{ path: string; write: boolean }>; mcp: Record<string, "off" | "read" | "full">;
}

export type PreviewConfigView =
  | { kind: "none" }
  | { kind: "web"; startCommand: string; url: string; pages: string[]; readyTimeoutSec?: number }
  | { kind: "desktop"; exePath: string; args: string[]; windowTitle: string; settleSec?: number };
export interface PreviewShotView { file: string; label: string; width: number; ok: boolean }
export interface PreviewStateView {
  status: "idle" | "running" | "ok" | "partial" | "error";
  step: string | null;
  result: { kind: "web" | "desktop"; started_at: number; finished_at: number; status: string; shots: PreviewShotView[]; error: string | null; log_tail: string[] } | null;
}

/** Fetch a file (token in header), post it to the server's output folder and return the saved path. */
export async function saveToOutputs(path: string, fileName: string, group: string): Promise<string> {
  const r = await fetch(path, { headers: { "x-controller-token": getToken() ?? "" } });
  if (!r.ok) throw new ApiError(r.statusText, r.status);
  const s = await fetch("/api/outputs/save", { method: "POST", headers: { "x-controller-token": getToken() ?? "", "x-file-name": fileName, "x-output-group": group, "content-type": "application/octet-stream" }, body: await r.blob() });
  const j = (await s.json().catch(() => ({}))) as { message?: string; path?: string };
  if (!s.ok) throw new ApiError(j.message ?? s.statusText, s.status);
  return j.path ?? "";
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "x-controller-token": getToken() ?? "", ...(init.headers as Record<string, string> | undefined) };
  if (init.body) headers["content-type"] = "application/json";
  const r = await fetch(path, { ...init, headers });
  const ct = r.headers.get("content-type") ?? "";
  if (!r.ok) {
    let msg = r.statusText;
    let code: string | undefined;
    if (ct.includes("json")) {
      const j = (await r.json()) as { message?: string; error?: string };
      msg = j.message ?? msg;
      code = j.error;
    }
    throw new ApiError(msg, r.status, code);
  }
  return (ct.includes("json") ? r.json() : r.text()) as Promise<T>;
}

function queuePath(project: string, ...rest: string[]): string {
  return [`/api/projects/${encodeURIComponent(project)}/queue`, ...rest.map(encodeURIComponent)].join("/");
}

export interface SkillTrainConfig { passScore?: number; maxRounds?: number; costCapUsd?: number }

// Autopilot types: declared by hand to mirror the server responses (no import from src/).
export interface AutopilotView { enabled: boolean; schedule: string | null; webhookCount: number; webhooks: string[]; updatedAt: string }
export interface DupMatch { id: string; title: string; score: number; tokenScore: number; fileScore: number; level: "high" | "medium" }
export interface DupCheckResult { duplicates: DupMatch[]; hasHigh: boolean }
export interface PeriodSummary {
  from: string;
  to: string;
  counts: { done: number; error: number; other: number; total: number };
  costUsd: number;
  blocked: string[];
  text: string;
  truncated: boolean;
  estimate: true;
}
export interface DupCheckInput { project: string; title: string; prompt?: string; files?: string[] }

export function skillActionPath(slug: string, action: string): string {
  return `/api/skills/${encodeURIComponent(slug)}/${action}`;
}
export function skillZipPath(slug: string): string {
  return skillActionPath(slug, "zip");
}
function skillPost(slug: string, action: string, cfg?: SkillTrainConfig): Promise<unknown> {
  const init: RequestInit = { method: "POST" };
  if (cfg !== undefined) init.body = JSON.stringify(cfg);
  return req<unknown>(skillActionPath(slug, action), init);
}

export interface ReleaseDryRun {
  dryRun: true;
  ok: boolean;
  preconditions: { ok: boolean; message?: string };
  version: string;
  plan: Array<{ stepIndex: number; type: string; description: string; argv: string[]; cwd: string }>;
  targets: { remote?: string; deploy?: string; url?: string };
  error?: string;
}
export interface ReleaseStepLog {
  index: number;
  type: string;
  description: string;
  status: "ok" | "failed" | "skipped" | "running";
  exitCode: number | null;
  output: string;
  startedAt?: string | null;
}
export interface CadStatusView { available: boolean; python: string | null; ezdxf: string | null; cadquery: string | null; message: string }
export interface ReleaseArtifactView { path: string; size: number; sha256: string }
export interface ReleaseLogView { id: string; status: "success" | "failed" | "running"; version: string; error?: string; warnings: string[]; steps: ReleaseStepLog[]; artifact?: ReleaseArtifactView }
export interface ReleaseResult {
  id: string;
  status: "success" | "failed";
  steps: ReleaseStepLog[];
  log: ReleaseLogView & { status: "success" | "failed" };
}
/** Server flag from /api/status: real releases are blocked when reached through a tunnel unless release.allowRemote is on. */
export interface ReleaseFlag { viaTunnel: boolean; allowed: boolean }
export interface ReleaseConfigResponse { config: unknown; templates: Record<string, unknown> }

/** Poll a background release until its log leaves "running" (the log file appears shortly after the POST). */
export async function waitReleaseLog(id: string, intervalMs = 1500, maxMs = 35 * 60 * 1000, onProgress?: (log: ReleaseLogView) => void): Promise<ReleaseLogView> {
  const t0 = Date.now();
  for (;;) {
    try {
      const log = await api.getRelease(id);
      onProgress?.(log);
      if (log.status !== "running") return log;
    } catch (e) {
      if (!(e instanceof ApiError) || Date.now() - t0 > 15000) throw e;
    }
    if (Date.now() - t0 > maxMs) throw new Error("release timeout");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

export const api = {
  status: () => req<StatusResponse>("/api/status"),
  cliAccounts: () => req<{
    accounts: import("./types").CliAccountPublic[];
    settings: Required<import("./types").CliAccountsSettings>;
    models_by_account: Record<string, import("./types").CliModelChoice[]>;
    role_accounts: import("./types").RoleAccountMap;
    cooldowns?: Record<string, number>;
  }>("/api/cli/accounts"),
  clearCliAccountCooldown: (id: string) =>
    req<{ ok: boolean; cooldowns: Record<string, number> }>(`/api/cli/accounts/${encodeURIComponent(id)}/cooldown`, { method: "DELETE" }),
  addCliAccount: (body: { id?: string; label: string; provider: import("./types").CliProviderId; isolated?: boolean; defaultModel?: string; isDefault?: boolean }) =>
    req<{ account: import("./types").CliAccountPublic }>("/api/cli/accounts", { method: "POST", body: JSON.stringify(body) }),
  updateCliAccount: (id: string, patch: { label?: string; enabled?: boolean; isDefault?: boolean; defaultModel?: string | null; priority?: number }) =>
    req<{ account: import("./types").CliAccountPublic }>(`/api/cli/accounts/${encodeURIComponent(id)}`, { method: "PATCH", body: JSON.stringify(patch) }),
  deleteCliAccount: (id: string) => req<{ ok: boolean }>(`/api/cli/accounts/${encodeURIComponent(id)}`, { method: "DELETE" }),
  checkCliAccount: (id: string) => req<{ status: import("./types").CliAccountRuntimeStatus }>(`/api/cli/accounts/${encodeURIComponent(id)}/check`, { method: "POST", body: "{}" }),
  loginCliAccount: (id: string) => req<{ ok: boolean; command: string }>(`/api/cli/accounts/${encodeURIComponent(id)}/login`, { method: "POST", body: "{}" }),
  saveCliAccountsSettings: (settings: import("./types").CliAccountsSettings) =>
    req<{ settings: Required<import("./types").CliAccountsSettings> }>("/api/cli/accounts/settings", { method: "PUT", body: JSON.stringify(settings) }),
  saveRoleAccounts: (role_accounts: import("./types").RoleAccountMap) =>
    req<{ role_accounts: import("./types").RoleAccountMap }>("/api/cli/role-accounts", { method: "PUT", body: JSON.stringify({ role_accounts }) }),
  setProjectAccount: (project: string, account_id: string | null) =>
    req<{ project: string; account_id: string | null }>(`/api/projects/${encodeURIComponent(project)}/account`, { method: "PUT", body: JSON.stringify({ account_id }) }),
  mcpList: () => req<{ servers: McpServerView[]; presets: McpServerView[]; cli: { at: number; items: CliMcpView[] } | null }>("/api/mcp"),
  mcpAddPreset: (preset: string) => req<{ server: McpServerView }>("/api/mcp", { method: "POST", body: JSON.stringify({ preset }) }),
  mcpAdd: (server: Partial<McpServerView>) => req<{ server: McpServerView }>("/api/mcp", { method: "POST", body: JSON.stringify(server) }),
  mcpSet: (id: string, patch: Partial<McpServerView>) => req<{ server: McpServerView }>(`/api/mcp/${encodeURIComponent(id)}`, { method: "PUT", body: JSON.stringify(patch) }),
  mcpRemove: (id: string) => req<{ ok: boolean }>(`/api/mcp/${encodeURIComponent(id)}`, { method: "DELETE" }),
  mcpProbe: (id: string) => req<{ ok: boolean; tools: string[]; error?: string }>(`/api/mcp/${encodeURIComponent(id)}/probe`, { method: "POST", body: "{}" }),
  mcpCliRefresh: () => req<{ at: number; items: CliMcpView[] }>("/api/mcp/cli/refresh", { method: "POST", body: "{}" }),
  mcpCliLogin: () => req<{ ok: boolean }>("/api/mcp/cli/login", { method: "POST", body: "{}" }),
  grantsGet: (project: string | null) => req<{ grants: GrantsView; source: string }>(`/api/grants${project ? `?project=${encodeURIComponent(project)}` : ""}`),
  grantsPut: (project: string | null, grants: GrantsView) => req<{ grants: GrantsView }>("/api/grants", { method: "PUT", body: JSON.stringify({ project: project ?? undefined, grants }) }),
  outputDirGet: () => req<{ outputDir: string; defaultDir: string }>("/api/settings/output-dir"),
  outputDirPut: (outputDir: string) => req<{ outputDir: string; defaultDir: string }>("/api/settings/output-dir", { method: "PUT", body: JSON.stringify({ outputDir }) }),
  getDesign3D: () => req<Design3DResponse>("/api/design3d"),
  workshop3dList: () => req<{ sessions: Workshop3DListItem[]; kit?: Design3DKit | null }>("/api/workshop3d"),
  videoStudioList: () => req<{ projects: VsListItem[] }>(VS),
  // The server answers with the created project itself (it has `slug`).
  videoStudioLibrary: async (): Promise<{ files: VsLibraryItem[] }> => {
    const r = await req<{ files?: VsLibraryItem[] }>(`${VS}/library`);
    return { files: Array.isArray(r?.files) ? r.files : [] };
  },
  videoStudioLibraryUpload: async (file: File): Promise<VsLibraryItem> => {
    const r = await fetch(`${VS}/library`, {
      method: "POST",
      headers: { "x-controller-token": getToken() ?? "", "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new ApiError(j.message ?? r.statusText, r.status, j.error);
    }
    return (await r.json()) as VsLibraryItem;
  },
  videoStudioLibraryDelete: (name: string) => req<{ ok: boolean }>(`${VS}/library/${encodeURIComponent(name)}`, { method: "DELETE" }),
  videoStudioCreate: async (input: { title: string; brief: string; styleId: string; aspect: VsAspect; libraryFiles?: string[] }): Promise<{ slug: string }> => {
    const p = await req<{ slug: string }>(VS, { method: "POST", body: JSON.stringify(input) });
    return { slug: p.slug };
  },
  // The server answers with the project fields plus `plan` and `assets` side by side; the UI works with VsProjectDetail.
  videoStudioGet: async (slug: string): Promise<VsProjectDetail> => {
    const { plan, assets, ...project } = await req<VsProjectDetail["project"] & { plan?: VsPlan | null; assets?: VsProjectDetail["assets"] }>(videoStudioPath(slug));
    return { project: project as VsProjectDetail["project"], plan: plan ?? null, assets: Array.isArray(assets) ? assets : [] };
  },
  videoStudioDelete: (slug: string) => req<{ ok: boolean }>(videoStudioPath(slug), { method: "DELETE" }),
  videoStudioFile: (slug: string, rel: string) => fetchBlob(videoStudioFilePath(slug, rel)),
  videoStudioDownload: (slug: string, rel: string, fileName: string) => downloadFile(videoStudioFilePath(slug, rel), fileName),
  videoStudioUpload: async (slug: string, file: File): Promise<{ rel: string }> => {
    const r = await fetch(`${videoStudioPath(slug)}/assets`, {
      method: "POST",
      headers: { "x-controller-token": getToken() ?? "", "content-type": "application/octet-stream", "x-file-name": encodeURIComponent(file.name) },
      body: file,
    });
    if (!r.ok) {
      const j = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
      throw new ApiError(j.message ?? r.statusText, r.status, j.error);
    }
    return (await r.json()) as { rel: string };
  },
  // The server returns the saved plan itself and 202 { state } for the long jobs (generate, narrate, render, edit-segment).
  videoStudioVoices: (): Promise<{ voices: { name: string; culture: string; gender: string }[] }> => req(`${VS}/voices`),
  videoStudioSavePlan: async (slug: string, plan: VsPlan): Promise<{ plan: VsPlan }> => ({ plan: await req<VsPlan>(`${videoStudioPath(slug)}/plan`, { method: "PUT", body: JSON.stringify({ plan }) }) }),
  videoStudioGeneratePlan: (slug: string) => req<{ state: string }>(`${videoStudioPath(slug)}/generate`, { method: "POST", body: "{}" }),
  videoStudioNarrate: (slug: string) => req<{ state: string }>(`${videoStudioPath(slug)}/narrate`, { method: "POST", body: "{}" }),
  videoStudioEditSegment: (slug: string, input: { start: number; end: number; instruction: string }) =>
    req<{ state: string }>(`${videoStudioPath(slug)}/edit-segment`, { method: "POST", body: JSON.stringify(input) }),
  videoStudioRender: (slug: string) => req<{ state: string }>(`${videoStudioPath(slug)}/render`, { method: "POST", body: "{}" }),
  videoStudioPreview: (slug: string, range?: { start: number; end: number }) => req<{ state: string }>(`${videoStudioPath(slug)}/preview`, { method: "POST", body: JSON.stringify(range ?? {}) }),
  // Styles and settings: the server answers with a bare array / object; wrapped here for the UI.
  /** Renders a few seconds with the style (an id of a saved style, or a style object); returns the sample file name. */
  videoStudioStylePreview: (input: unknown) => req<{ file: string }>(`${VS}/styles/preview`, { method: "POST", body: JSON.stringify(input) }),
  videoStudioStylePreviewFile: (file: string) => fetchBlob(`${VS}/styles/preview/${encodeURIComponent(file)}`),
  videoStudioSetStyle: (slug: string, styleId: string) => req<unknown>(`${videoStudioPath(slug)}/style`, { method: "PUT", body: JSON.stringify({ styleId }) }),
  videoStudioStyles: async (): Promise<{ styles: VsStyle[] }> => {
    const r = await req<VsStyle[] | { styles?: VsStyle[] }>(`${VS}/styles`);
    return { styles: Array.isArray(r) ? r : Array.isArray(r?.styles) ? r.styles : [] };
  },
  videoStudioSaveStyle: async (style: VsStyle): Promise<{ style: VsStyle }> => ({ style: await req<VsStyle>(`${VS}/styles`, { method: "POST", body: JSON.stringify(style) }) }),
  videoStudioDeleteStyle: (id: string) => req<{ ok: boolean }>(`${VS}/styles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  videoStudioSettings: async (): Promise<{ settings: VsSettingsPublic }> => ({ settings: await req<VsSettingsPublic>(`${VS}/settings`) }),
  videoStudioSettingsPut: async (input: VsSettingsInput): Promise<{ settings: VsSettingsPublic }> => ({ settings: await req<VsSettingsPublic>(`${VS}/settings`, { method: "PUT", body: JSON.stringify(input) }) }),
  workshop3dGet: (slug: string) => req<Workshop3DSession>(workshop3dPath(slug)),
  /** `inboxStage`: stage id of the reference images uploaded with stageInbox (POST /api/inbox). */
  workshop3dCreate: (brief: Workshop3DBriefInput, inboxStage?: string | null) =>
    req<{ slug: string }>("/api/workshop3d", { method: "POST", body: JSON.stringify(inboxStage ? { brief, inbox_stage: inboxStage } : { brief }) }),
  workshop3dAction: (slug: string, action: Workshop3DAction) => req<{ ok: true }>(`${workshop3dPath(slug)}/${action}`, { method: "POST", body: "{}" }),
  workshop3dAnswer: (slug: string, text: string) => req<{ ok: true }>(`${workshop3dPath(slug)}/answer`, { method: "POST", body: JSON.stringify({ text }) }),
  /** Deletes the whole session folder ("Xóa bản dựng"); 409 while it runs, bakes or renders. */
  workshop3dDelete: (slug: string) => req<{ ok: true; bytes: number }>(workshop3dPath(slug), { method: "DELETE" }),
  /** "Dựng tiếp": one more round (modeling to Blender) around the user's notes. */
  workshop3dContinue: (slug: string, text: string) => req<{ ok: true }>(`${workshop3dPath(slug)}/continue`, { method: "POST", body: JSON.stringify({ text }) }),
  workshop3dRebuild: (slug: string, params?: Record<string, string | number>) => req<{ ok: true }>(`${workshop3dPath(slug)}/rebuild`, { method: "POST", body: JSON.stringify(params ? { params } : {}) }),
  /** A session file (outputs/... or renders/...) as a Blob; the token rides in the header, never in the URL. */
  workshop3dFile: (slug: string, relPath: string) => fetchBlob(workshop3dFilePath(slug, relPath)),
  workshop3dDownload: (slug: string, relPath: string) => downloadFile(workshop3dFilePath(slug, relPath), relPath.split("/").pop() || relPath),
  previewGet: (id: string) => req<{ state: PreviewStateView; config: PreviewConfigView }>(`/api/runs/${encodeURIComponent(id)}/preview`),
  previewStart: (id: string) => req<{ state: PreviewStateView }>(`/api/runs/${encodeURIComponent(id)}/preview`, { method: "POST", body: JSON.stringify({}) }),
  previewConfigPut: (project: string, preview: PreviewConfigView) => req<{ preview: PreviewConfigView }>(`/api/projects/${encodeURIComponent(project)}/preview`, { method: "PUT", body: JSON.stringify({ preview }) }),
  /** Images need the token header, so load through fetch and hand back a blob URL (caller revokes it). */
  previewImageBlob: async (id: string, file: string): Promise<string> => {
    const r = await fetch(`/api/runs/${encodeURIComponent(id)}/preview/${encodeURIComponent(file)}`, { headers: { "x-controller-token": getToken() ?? "" } });
    if (!r.ok) throw new ApiError(r.statusText, r.status);
    return URL.createObjectURL(await r.blob());
  },
  openOutput: (id: string, rel?: string) => req<{ ok: boolean; path: string }>(`/api/runs/${encodeURIComponent(id)}/open-output`, { method: "POST", body: JSON.stringify(rel ? { rel_path: rel } : {}) }),
  billing: () => req<{ ok: boolean; message?: string; kind?: string; mode: string }>("/api/billing/status"),
  listRuns: (p: { q?: string; status?: string; project?: string; from?: number; to?: number; limit?: number; offset?: number; scout?: boolean; queue?: "only" | "exclude"; threads?: boolean } = {}) => {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(p)) {
      if (v === undefined || v === "" || v === false) continue;
      qs.set(k, v === true ? "1" : String(v));
    }
    return req<{ runs: RunRecord[]; total?: number }>(`/api/runs?${qs}`);
  },
  autopilotStatus: () => req<AutopilotView>("/api/autopilot/status"),
  autopilotEnable: () => req<AutopilotView>("/api/autopilot/enable", { method: "POST" }),
  autopilotDisable: () => req<AutopilotView>("/api/autopilot/disable", { method: "POST" }),
  autopilotSetSchedule: (schedule: string | null) => req<AutopilotView>("/api/autopilot/schedule", { method: "PUT", body: JSON.stringify({ schedule }) }),
  autopilotSetWebhooks: (webhooks: string[]) => req<AutopilotView>("/api/autopilot/webhooks", { method: "PUT", body: JSON.stringify({ webhooks }) }),
  autopilotSummary: (from?: string, to?: string) => {
    const qs = new URLSearchParams();
    if (from) qs.set("from", from);
    if (to) qs.set("to", to);
    const s = qs.toString();
    return req<PeriodSummary>(`/api/autopilot/summary${s ? `?${s}` : ""}`);
  },
  autopilotCheckDuplicate: (input: DupCheckInput) => req<DupCheckResult>("/api/autopilot/check-duplicate", { method: "POST", body: JSON.stringify(input) }),
  getRun: (id: string) => req<RunMeta>(`/api/runs/${encodeURIComponent(id)}`),
  openDir: (id: string, target: "run_dir" | "worktree") => req<{ ok: boolean; path: string }>(`/api/runs/${encodeURIComponent(id)}/open-dir`, { method: "POST", body: JSON.stringify({ target }) }),
  cleanupWorktree: (id: string) => req<{ ok: boolean; worktree_path: string; branch: string; worktree_removed: boolean; branch_deleted: boolean; messages: string[] }>(`/api/runs/${encodeURIComponent(id)}/cleanup-worktree`, { method: "POST", body: "{}" }),
  publishRun: (id: string) => req<{ ok: boolean; version: string; previous: string; commit: string }>(`/api/runs/${encodeURIComponent(id)}/publish`, { method: "POST", body: "{}" }),
  releaseDryRun: (project: string, runId: string) =>
    req<ReleaseDryRun>(`/api/projects/${encodeURIComponent(project)}/release`, { method: "POST", body: JSON.stringify({ dryRun: true, runId }) }),
  releaseExecute: (project: string, runId: string) =>
    req<{ releaseId: string }>(`/api/projects/${encodeURIComponent(project)}/release`, { method: "POST", body: JSON.stringify({ dryRun: false, ...(runId ? { runId } : {}) }) }),
  cadStatus: () => req<CadStatusView>("/api/cad/status"),
  getRelease: (id: string) => req<ReleaseLogView>(`/api/releases/${encodeURIComponent(id)}`),
  getReleaseConfig: (project: string) => req<ReleaseConfigResponse>(`/api/projects/${encodeURIComponent(project)}/release-config`),
  putReleaseConfig: (project: string, body: { config?: unknown; template?: string }) =>
    req<ReleaseConfigResponse>(`/api/projects/${encodeURIComponent(project)}/release-config`, { method: "PUT", body: JSON.stringify(body) }),
  releaseRun: (id: string) => req<{ ok: boolean; committed: boolean; merged: boolean; base: string; branch: string; commit: string | null }>(`/api/runs/${encodeURIComponent(id)}/release`, { method: "POST", body: "{}" }),
  mergePrecheck: (id: string) => req<MergePrecheck>(`/api/runs/${encodeURIComponent(id)}/merge-precheck`, { method: "POST", body: "{}" }),
  events: (id: string, after = 0) => req<{ events: StoredEvent[] }>(`/api/runs/${encodeURIComponent(id)}/events?after=${after}`),
  runRoles: (id: string) => req<{ roles: { id: string; description: string; model?: string }[] }>(`/api/runs/${encodeURIComponent(id)}/roles`),
  report: (id: string) => req<string>(`/api/runs/${encodeURIComponent(id)}/report`),
  artifact: (id: string, rel: string) => req<string>(`/api/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(rel)}`),
  artifactPath: (id: string, rel: string) => `/api/runs/${encodeURIComponent(id)}/artifacts/${encodeURIComponent(rel)}`,
  artifactsZipPath: (id: string) => `/api/runs/${encodeURIComponent(id)}/artifacts.zip`,
  /** Stage an attachment before the run exists; returns the (possibly new) stage id. */
  stageInbox: async (file: File, stageId: string | null) => (await upload(`/api/inbox${stageId ? `?stage=${encodeURIComponent(stageId)}` : ""}`, file)).json() as Promise<{ ok: true; stage_id: string; file: InboxFile; files: InboxFile[] }>,
  skills: () => req<{ skills: SkillListItem[] }>("/api/skills"),
  createSkill: (body: { slug?: string; title: string; goal: string; files: Record<string, string>; attachments?: { pair: string; side: "input" | "expected"; stageId: string; names: string[] }[] }) =>
    req<{ meta: SkillListItem; files: unknown }>("/api/skills", { method: "POST", body: JSON.stringify(body) }),
  startSkill: (slug: string, body: { passScore?: number; maxRounds?: number } = {}) =>
    req<unknown>(`/api/skills/${encodeURIComponent(slug)}/start`, { method: "POST", body: JSON.stringify(body) }),
  getSkill: (slug: string) => req<{ meta: { state?: string; paused?: boolean; costUsdEstimate?: number } }>(`/api/skills/${encodeURIComponent(slug)}`),
  deleteSkill: (slug: string) => req<{ ok: boolean }>(`/api/skills/${encodeURIComponent(slug)}`, { method: "DELETE" }),
  trainSkill: (slug: string, cfg: SkillTrainConfig = {}) => skillPost(slug, "train", cfg),
  pauseSkill: (slug: string) => skillPost(slug, "pause"),
  resumeSkill: (slug: string, cfg: SkillTrainConfig = {}) => skillPost(slug, "resume", cfg),
  stopSkill: (slug: string) => skillPost(slug, "stop"),
  approveSkill: (slug: string) => skillPost(slug, "approve"),
  restoreBestSkill: (slug: string) => skillPost(slug, "restore-best"),
  downloadSkillZip: (slug: string) => downloadFile(skillZipPath(slug), `${slug}.zip`),
  gradeSkillRound: (slug: string, score: number, feedback: string) =>
    req<unknown>(`/api/skills/${encodeURIComponent(slug)}/grade`, { method: "POST", body: JSON.stringify({ score, feedback }) }),
  listSkillRoundFiles: (slug: string, n: number) =>
    req<{ files: { name: string; size: number }[] }>(`/api/skills/${encodeURIComponent(slug)}/rounds/${n}/files`),
  skillRoundFileUrl: (slug: string, n: number, name: string, download = false) =>
    `/api/skills/${encodeURIComponent(slug)}/rounds/${n}/files/${encodeURIComponent(name)}${download ? "?download=1" : ""}`,
  downloadSkillRoundFile: (slug: string, n: number, name: string) =>
    downloadFile(`/api/skills/${encodeURIComponent(slug)}/rounds/${n}/files/${encodeURIComponent(name)}?download=1`, name),
  openSkillRoundFile: async (slug: string, n: number, name: string): Promise<void> => {
    const r = await fetch(`/api/skills/${encodeURIComponent(slug)}/rounds/${n}/files/${encodeURIComponent(name)}`, { headers: { "x-controller-token": getToken() ?? "" } });
    if (!r.ok) throw new ApiError(r.statusText, r.status);
    const url = URL.createObjectURL(new Blob([await r.text()], { type: "text/plain;charset=utf-8" }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  },
  getSkillRounds: (slug: string) => req<SkillRoundsResponse>(`/api/skills/${encodeURIComponent(slug)}/rounds`),
  getSkillAnswers:(slug: string) => req<{ schema: InputsSchema; answers: Record<string, unknown> }>(`/api/skills/${encodeURIComponent(slug)}/answers`),
  saveSkillAnswers: (slug: string, body: { answers: Record<string, unknown>; stageId?: string | null }) => req<{ ok: true }>(`/api/skills/${encodeURIComponent(slug)}/answers`, { method: "POST", body: JSON.stringify(body) }),
  skillsGenGenerateSample: (slug: string) => req<{ sample: { status: "running" } }>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/steps/generate-sample`, { method: "POST" }),
  skillsGenFinalize: (slug: string) => req<{ final: { status: "running" } }>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/steps/finalize`, { method: "POST" }),
  downloadSkillsGenSample: (slug: string, n: number, format: OutputFormat) =>
    downloadFile(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/rounds/${n}/sample/${format}`, `${slug}-round-${n}.${format}`),
  /** PDF / HTML open in a new browser tab (fetched with the token, shown from a blob). */
  viewSkillsGenSample: async (slug: string, n: number, format: OutputFormat): Promise<void> => {
    const r = await fetch(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/rounds/${n}/sample/${format}`, { headers: { "x-controller-token": getToken() ?? "" } });
    if (!r.ok) throw new ApiError(r.statusText, r.status);
    const type = format === "pdf" ? "application/pdf" : "text/html;charset=utf-8";
    const url = URL.createObjectURL(new Blob([await r.arrayBuffer()], { type }));
    window.open(url, "_blank");
    setTimeout(() => URL.revokeObjectURL(url), 5 * 60_000);
  },
  /** Word / Excel / AutoCAD / SolidWorks: the app asks Windows to open the file with its program (local use only). */
  openSkillsGenSample: (slug: string, n: number, format: OutputFormat) => req<{ ok: boolean }>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/rounds/${n}/open/${format}`, { method: "POST", body: "{}" }),
  skillsGenSetOutputs: (slug: string, formats: OutputFormat[]) => req<{ outputs: OutputFormat[] }>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/outputs`, { method: "PUT", body: JSON.stringify({ formats }) }),
  skillsGenStart: (body: { slug: string; brief: string; maxRounds?: number; costCapUsd?: number }) => req<SkillSession>("/api/skills-gen/sessions", { method: "POST", body: JSON.stringify(body) }),
  skillsGenUpgrade: (slug: string, note: string) => req<SkillSession>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/upgrade`, { method: "POST", body: JSON.stringify({ note }) }),
  skillsGenGet: (slug: string) => req<SkillsGenSessionResponse>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}`),
  skillsGenGrade: (slug: string, body: { score: number; feedback?: string }) => req<SkillSession>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/grade`, { method: "POST", body: JSON.stringify(body) }),
  skillsGenFindRoles: (slug: string) => req<{ matches: RoleMatch[] }>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/steps/find-roles`, { method: "POST" }),
  skillsGenCreateAgents: (slug: string, body: { newAgents?: NewAgentInput[] } = {}) => req<SkillsGenCreateAgentsResponse>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/steps/create-agents`, { method: "POST", body: JSON.stringify(body) }),
  skillsGenFindGithub: (slug: string) => req<{ finder: { status: "running" } }>(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/steps/find-github`, { method: "POST" }),
  downloadSkillsGenMd: (slug: string) => downloadFile(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/md`, `${slug}.md`),
  /** Local mode: save into the output folder (and reveal it) instead of a browser download. */
  saveSkillZip: (slug: string) => saveToOutputs(skillZipPath(slug), `${slug}.zip`, `skills/${outputGroup(slug)}`),
  saveSkillsGenSample: (slug: string, n: number, format: OutputFormat) =>
    saveToOutputs(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/rounds/${n}/sample/${format}`, `${slug}-round-${n}.${format === "step" ? "step" : format}`, `skills/${outputGroup(slug)}`),
  saveSkillsGenMd: (slug: string) => saveToOutputs(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/md`, `${slug}.md`, `skills/${outputGroup(slug)}`),
  downloadSkillsGenZip: (slug: string) => downloadFile(`/api/skills-gen/sessions/${encodeURIComponent(slug)}/zip`, `${slug}.zip`),
  attachToRun: async (id: string, file: File) => (await upload(`/api/runs/${encodeURIComponent(id)}/inbox`, file)).json() as Promise<{ ok: true; file: InboxFile; inbox: InboxFile[] }>,
  startRun: (body: { prompt: string; max_turns?: number; budget_usd?: number; max_role_calls?: number; roles?: boolean; model?: string; account_id?: string; provider?: import("./types").CliProviderId; role_models?: Record<string, string>; project?: string; kind?: "coding" | "research"; scout?: boolean; inbox_stage?: string; agents?: Record<string, ExtraAgentInput>; skills?: string[]; libraryItemIds?: string[] }) => req<{ run: RunRecord }>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  followup: (id: string, body: { prompt: string; max_turns?: number; budget_usd?: number; comments?: DiffComment[] }) => req<{ run: RunRecord }>(`/api/runs/${encodeURIComponent(id)}/followup`, { method: "POST", body: JSON.stringify(body) }),
  cancel: (id: string) => req<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}/cancel`, { method: "POST" }),
  getQuotaResume: (id: string) => req<QuotaResumeResponse>(`/api/runs/${encodeURIComponent(id)}/quota-resume`),
  cancelQuotaResume: (id: string) => req<{ ok: boolean }>(`/api/runs/${encodeURIComponent(id)}/quota-resume/cancel`, { method: "POST", body: "{}" }),
  queue:(project: string) => req<QueueView>(queuePath(project)),
  queuePatch: (project: string, id: string, patch: QueuePatch) => req<QueuePatchResult>(queuePath(project, id), { method: "PATCH", body: JSON.stringify(patch) }),
  queueApproveRun: (project: string, id: string) => req<QueueApproveRunResult>(queuePath(project, id, "approve-run"), { method: "POST" }),
  queueRunAll: (project: string, sourceRef?: string) =>
    req<{ runAll: QueueRunAllState }>(queuePath(project, "run-all"), sourceRef ? { method: "POST", body: JSON.stringify({ sourceRef }) } : { method: "POST" }),
  queueApproveAll: (project: string, sourceRef: string) =>
    req<{ approved: string[] }>(queuePath(project, "approve-all"), { method: "POST", body: JSON.stringify({ sourceRef }) }),
  queueDeleteIdea: (project: string, sourceRef: string) =>
    req<{ deleted: string[] }>(queuePath(project, "delete-idea"), { method: "POST", body: JSON.stringify({ sourceRef }) }),
  queueRunAllStop: (project: string) => req<{ runAll: QueueRunAllState }>(queuePath(project, "run-all", "stop"), { method: "POST" }),
  queueRunParallel:(project: string, ids: string[]) => req<QueueRunParallelResult>(queuePath(project, "run-parallel"), { method: "POST", body: JSON.stringify({ ids }) }),
  queueSkip: (project: string, id: string) => req<QueueSkipResult>(queuePath(project, id, "skip"), { method: "POST" }),
  queueConfirmDone: (project: string, id: string) => req<QueueSkipResult>(queuePath(project, id, "confirm-done"), { method: "POST" }),
  queueConfirmMerged: (project: string, id: string) => req<QueueSkipResult>(queuePath(project, id, "confirm-merged"), { method: "POST" }),
  queueRetry: (project: string, id: string) => req<QueueSkipResult>(queuePath(project, id, "retry"), { method: "POST" }),
  queueMarkFailed: (project: string, id: string) => req<QueueSkipResult>(queuePath(project, id, "mark-failed"), { method: "POST" }),
  queueUnskip: (project: string, id: string) => req<QueueSkipResult>(queuePath(project, id, "unskip"), { method: "POST" }),
  queueSplit: (project: string, body: { idea: string; webSearch?: boolean; source?: "scout"; sourceRef?: string; skipInterview?: boolean }) => req<SplitStartResponse>(queuePath(project, "split"), { method: "POST", body: JSON.stringify(body) }),
  queueSplitStatus: (project: string, runId: string) => req<SplitStatus>(queuePath(project, "split", runId)),
  /** Answer the interview of a pending idea (`skip` = "Bỏ qua, tự quyết", `dismiss` = drop the idea). */
  queueSplitAnswers: (project: string, runId: string, body: { answers?: string[]; skip?: boolean; dismiss?: boolean }) => req<SplitStartResponse>(queuePath(project, "split", runId, "answers"), { method: "POST", body: JSON.stringify(body) }),
  library: () => req<LibraryData>("/api/library"),
  saveLibraryRole: (role: LibraryRole, isNew: boolean) =>
    isNew
      ? req<{ role: LibraryRole }>("/api/library/roles", { method: "POST", body: JSON.stringify(role) })
      : req<{ role: LibraryRole }>(`/api/library/roles/${encodeURIComponent(role.id)}`, { method: "PUT", body: JSON.stringify(role) }),
  deleteLibraryRole: (id: string) => req<{ ok: boolean }>(`/api/library/roles/${encodeURIComponent(id)}`, { method: "DELETE" }),
  saveLibraryItem: (item: { id?: string; name: string; type: "skill" | "prompt"; content: string; roleIds: string[] }) =>
    item.id
      ? req<{ item: LibraryItem }>(`/api/library/items/${encodeURIComponent(item.id)}`, { method: "PUT", body: JSON.stringify(item) })
      : req<{ item: LibraryItem }>("/api/library/items", { method: "POST", body: JSON.stringify(item) }),
  deleteLibraryItem: (id: string) => req<{ ok: boolean }>(`/api/library/items/${encodeURIComponent(id)}`, { method: "DELETE" }),
  roleCatalog: (q: string) => req<{ roles: CatalogRole[]; in_library: string[] }>(`/api/role-catalog?q=${encodeURIComponent(q)}`),
  addFromCatalog: (id: string) => req<{ role: LibraryRole }>(`/api/library/roles/from-catalog/${encodeURIComponent(id)}`, { method: "POST" }),
  importLibraryMd: (body: LibraryImportRequest) => req<LibraryImportResponse>("/api/library/import", { method: "POST", body: JSON.stringify(body) }),
  projects: () => req<{ projects: ProjectSummary[] }>("/api/projects"),
  validateProject: (body: { repo_path: string; base_branch?: string }) => req<{ ok: boolean; head_sha: string | null; dirty: boolean; branches: string[]; error: string | null }>("/api/projects/validate", { method: "POST", body: JSON.stringify(body) }),
  connections: () => req<{ connections: PublicConnection[]; max: number; defaultPath: string }>("/api/connections"),
  addConnection: (body: { name: string; baseUrl: string; token: string; path: string }) => req<{ connection: PublicConnection }>("/api/connections", { method: "POST", body: JSON.stringify(body) }),
  deleteConnection: (id: string) => req<{ ok: boolean }>(`/api/connections/${encodeURIComponent(id)}`, { method: "DELETE" }),
  connectionStaff: (id: string) => req<StaffResult>(`/api/connections/${encodeURIComponent(id)}/staff`),
  phone: () => req<PhoneInfo>("/api/phone"),
  phoneEnable: () => req<PhoneInfo & { message?: string }>("/api/phone/enable", { method: "POST", body: "{}" }),
  phoneDisable: () => req<PhoneInfo & { message?: string }>("/api/phone/disable", { method: "POST", body: "{}" }),
  scaffoldInfo: () => req<{ templates: TemplateInfo[]; defaultParent: string }>("/api/scaffold"),
  scaffold: (body: { name: string; template: string; goal: string; parentDir: string }) => req<{ project: ProjectSummary; dir: string }>("/api/scaffold", { method: "POST", body: JSON.stringify(body) }),
  addProject: (body: { name: string; repo_path?: string; base_branch?: string; allowed_commands?: string[] }) => req<{ project: ProjectSummary }>("/api/projects", { method: "POST", body: JSON.stringify(body) }),
  deleteProject: (name: string) => req<{ ok: boolean }>(`/api/projects/${encodeURIComponent(name)}`, { method: "DELETE" }),
  codingCostStats: () => req<{ n: number; median: number; max: number }>("/api/costs/coding-stats"),
  costsByDay: () => req<{ days: { day: string; cost_usd_est: number; quota_pct: number; runs: number }[] }>("/api/costs/by-day"),
  maxRuns: () => req<{ maxRuns: number; ceiling: number; running: number; waiting: { kind: string; id: string; project: string; reason?: string }[] }>("/api/settings/max-runs"),
  tuning: () => req<TuningResponse>("/api/settings/tuning"),
  w3dModels: () => req<W3DModelsResponse>("/api/settings/workshop3d-models"),
  setW3DModels: (models: W3DModelSettings) => req<W3DModelsResponse>("/api/settings/workshop3d-models", { method: "PUT", body: JSON.stringify(models) }),
  setTuning: (patch: Partial<TuningValues>) => req<{ values: TuningValues }>("/api/settings/tuning", { method: "PUT", body: JSON.stringify(patch) }),
  setMaxRuns: (maxRuns: number) => req<{ maxRuns: number; ceiling: number }>("/api/settings/max-runs", { method: "PUT", body: JSON.stringify({ maxRuns }) }),
  previewCleanup: (olderThan?: number) => req<CleanupPreview>(`/api/cleanup/preview${olderThan === undefined ? "" : `?olderThan=${encodeURIComponent(String(olderThan))}`}`),
  runCleanup: (body: { confirm: true; olderThan?: number }) => req<CleanupResult>("/api/cleanup", { method: "POST", body: JSON.stringify(body) }),
  getUsageBlocks: () => req<UsageBlocks>("/api/usage/blocks"),
};

export type WsMessage = { type: "run"; run: RunRecord } | { type: "event"; run_id: string; stored: StoredEvent } | { type: "runs"; runs: RunRecord[] } | { type: "synced" };

/** Open an authenticated WebSocket (token travels in the subprotocol, never in the URL). */
export function openSocket(path: string, onMessage: (m: WsMessage) => void, onClose?: () => void): WebSocket {
  const proto = location.protocol === "https:" ? "wss" : "ws";
  const ws = new WebSocket(`${proto}://${location.host}${path}`, [`tnf-token.${getToken() ?? ""}`]);
  ws.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as WsMessage);
  ws.onclose = () => onClose?.();
  return ws;
}
