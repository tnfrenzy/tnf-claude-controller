// UI-side mirror of the controller's public types (src/core/run/events.ts, run-store.ts).
export type {
  VsClipKind, VsAspect, VsState, VsVideoClip, VsAudioClip, VsTextItem, VsPlan,
  VsStyle, VsProject, VsListItem, VsAsset, VsProjectDetail, VsSettingsPublic, VsSettingsInput, VsProfile, VsLibraryItem,
} from "../../src/core/videostudio/plan-types";
export type {
  CliProviderId, ModelTier, CliModelChoice, CliAccountPublic, CliAccountRuntimeStatus,
  RoleAccountAssignment, RoleAccountMap, CliAccountsSettings,
} from "../../src/core/shared-types";
import type {
  Usage, RunStatus, AgentInfo, VerdictRecord, NormalizedEvent, StoredEvent,
} from "../../src/core/run/events";
export type {
  Usage, RunStatus, AgentInfo, VerdictRecord, NormalizedEvent, StoredEvent,
};

/** Mirrors the GET /api/design3d response (hand-written, not imported from src/). */
export interface Design3DTemplate {
  id: string;
  label: string;
  prompt: string;
  formats: ("step" | "stl" | "glb")[];
}
export interface Design3DKit {
  roles: string[];
  templates: Design3DTemplate[];
}
export interface Design3DFloor {
  runId: string;
  title: string;
  status: RunStatus;
  fileCount: number;
  primaryFormat: "step" | "stl" | "glb" | "gltf" | "obj";
}
export interface Design3DResponse {
  kit: Design3DKit;
  floors: Design3DFloor[];
}

export type RunKind = "coding" | "research";
export interface CommitRecord { hash: string; subject: string; }
/** Dry-run merge check of a run branch against its base (POST /api/runs/:id/merge-precheck). */
export interface MergePrecheck {
  status: "clean" | "conflict" | "unknown";
  files: string[];
  reason?: string;
  checked_at: number;
  base_sha_checked?: string | null;
}

export interface RunRecord {
  id: string;
  created_at: number;
  updated_at: number;
  status: RunStatus;
  prompt: string;
  mode: string;
  model: string | null;
  session_id: string | null;
  parent_run_id: string | null;
  /** "Continue from commit" source run (resumeFrom); older servers omit it. */
  forked_from_run_id?: string | null;
  project: string;
  claude_version: string | null;
  cost_usd_est: number;
  /** % of the subscription 5-hour window used by this run (server-derived). */
  quota_pct?: number;
  quota_start?: number | null;
  quota_end?: number | null;
  quota7_start?: number | null;
  quota7_end?: number | null;
  quota7_pct?: number | null;
  usage: Usage;
  num_turns: number;
  duration_ms: number;
  result_text: string | null;
  error: string | null;
  run_dir: string;
  agents: AgentInfo[];
  kind: RunKind;
  worktree_path: string | null;
  branch: string | null;
  base_sha: string | null;
  verdicts: VerdictRecord[];
  /** Computed by GET /api/runs/:id for coding runs with a repo: branch already merged into base. */
  merged?: boolean;
  commits: CommitRecord[];
  changed_files: number;
  /** Effective limits applied to the run; null for runs created before this was recorded. */
  limits?: { maxTurns: number; maxBudgetUsd: number; maxRoleCalls: number | null; callTimeoutMinutes: number | null } | null;
  merge_precheck?: MergePrecheck | null;
}

export interface ArtifactRecord {
  run_id: string;
  rel_path: string;
  size: number;
  mtime: number;
}

/** A file the user attached to a run (`<run-dir>/inbox/<name>`). */
export interface InboxFile {
  name: string;
  size: number;
  mtime: number;
}

export interface AuthStatus {
  loggedIn: boolean;
  authMethod: string;
  subscriptionType?: string;
  email?: string;
  orgName?: string;
}

export interface RateLimitInfo {
  status: string;
  five_hour_pct: number | null;
  seven_day_pct: number | null;
  five_hour_resets_at: number | null;
  seven_day_resets_at: number | null;
  using_overage: boolean;
  observed_at: number;
}

export interface QuotaResume {
  run_id: string;
  project: string;
  kind: "run" | "queue";
  scope: string | null;
  resume_at: number;
  attempt: number;
  status: "pending" | "fired" | "cancelled" | "failed";
  reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface QuotaResumeResponse {
  resume: QuotaResume | null;
  max_attempts: number;
}

export interface StatusResponse {
  quota_resumes?: QuotaResume[];
  quota_max_attempts?: number;
  auth: AuthStatus | null;
  auth_error: string | null;
  /** Resolved Claude Code CLI; `claude_error` is set when the CLI is not installed / not found. */
  claude_path?: string | null;
  claude_version?: string | null;
  claude_error?: string | null;
  /** `git --version` on PATH (coding runs need it); `git_error` when missing. */
  git_version?: string | null;
  git_error?: string | null;
  rate_limit: RateLimitInfo | null;
  models: { id: string; label: string }[];
  /** Default model per role from config/roles.json */
  role_models: Record<string, string>;
  defaults: { authMode: "subscription" | "api"; model: string; maxTurns: number; maxBudgetUsd: number; allowedTools: string[]; coding?: { maxRoleCalls?: number } };
  limits: { maxTurnsCeiling: number; maxBudgetUsdCeiling: number; maxRoleCallsCeiling?: number };
  workspace_dir: string;
  worktrees_dir?: string;
  role_models_coding?: Record<string, string>;
  towers?: [string, string];
  ui?: { dailyCostWarnUsd: number | null };
  idea_agents?: { scoutModel: string; scoutBudgetUsd: number; splitterModel: string; splitterBudgetUsd: number; replanBudgetUsd: number };
  release?: { viaTunnel: boolean; allowed: boolean };
  queue?: { splitter: { webSearch: boolean; maxWebCalls: number } };
  cli_accounts?: import("../../src/core/shared-types").CliAccountPublic[];
  role_accounts?: import("../../src/core/shared-types").RoleAccountMap;
}

export interface SplitStartResponse {
  runId: string;
}

export interface SplitStatus {
  runId: string;
  /** "questions" = the interviewer asked; answer with api.queueSplitAnswers. */
  state: "running" | "done" | "error" | "questions";
  stage?: "interview" | "split" | "critic" | "resplit";
  questions?: string[];
  commands?: number;
  costUsd?: number;
  error?: string;
}

export interface QueueBlueprint {
  goal: string;
  constraints: string[];
  architecture: string;
  interfaces: { owner: string; name: string; description: string }[];
}

export type CriticIssueKind = "gap" | "dependency" | "too_big" | "file_conflict" | "no_verify" | "contract";

/** Per-idea meta from GET /queue (`ideas`, keyed by the commands' sourceRef). */
export interface IdeaMeta {
  blueprint?: QueueBlueprint;
  criticIssues?: { commandId?: string; kind: CriticIssueKind; note: string }[];
  resplit?: boolean;
  resplitError?: string;
  interview?: { questions: string[]; answers: string[]; skipped: boolean };
  warnings?: string[];
}

/** Idea waiting for interview answers (GET /queue `interviews`). */
export interface PendingInterview {
  id: string;
  idea: string;
  questions: string[];
  createdAt: number;
  lastError?: string;
}

export interface ProjectSummary {
  name: string;
  /** Same as name (legacy field). */
  project: string;
  repo_path: string | null;
  base_branch: string | null;
  allowed_commands: string[];
  created_at: number;
  runs: number;
  running: number;
  last_at: number | null;
  cost_usd_est: number;
}

/** Extra subagent for one run (API: agents is Record<name, ExtraAgentInput>). tools are limited to the safe list; never Bash. */
export interface ExtraAgentInput {
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

export const SAFE_AGENT_TOOLS = ["Read", "Grep", "Glob", "Edit", "Write", "WebSearch", "WebFetch"] as const;

/** Custom role stored in the global library (`/api/library`). Tools are limited to SAFE_AGENT_TOOLS. */
export interface LibraryRole {
  id: string;
  description: string;
  prompt: string;
  tools?: string[];
  model?: string;
}

/** Skill or prompt text; appended to the prompts of the roles in `roleIds` (empty = coordinator only). */
export interface LibraryItem {
  id: string;
  name: string;
  type: "skill" | "prompt";
  content: string;
  roleIds: string[];
  createdAt: number;
}

export interface LibraryData {
  roles: LibraryRole[];
  items: LibraryItem[];
  /** names of the built-in roles (coding + research) */
  builtinRoles: string[];
}

export type AgentMdWarning =
  | "no_frontmatter"
  | "tools_dropped"
  | "tools_defaulted"
  | "model_dropped"
  | "prompt_truncated"
  | "description_truncated"
  | "danger_keyword"
  | "license_unknown";

export interface AgentMdPreview {
  kind: "role" | "skill" | "prompt";
  id: string;
  name: string;
  description: string;
  prompt: string;
  tools: string[];
  model?: string;
  droppedTools: string[];
  dangerKeywords: string[];
  warnings: AgentMdWarning[];
  license: string | null;
  licenseOk: boolean | null;
  blocked: null | "empty" | "library_full" | "id_conflict" | "license_not_permissive";
}

export interface LibraryImportRequest {
  text: string;
  dryRun?: boolean;
  filename?: string;
  as?: "role" | "skill" | "prompt";
  id?: string;
}

export interface LibraryImportResponse {
  preview: AgentMdPreview;
  role?: LibraryRole;
  item?: LibraryItem;
}

/** Ready-made role offered by "Tìm vai mới" (`/api/role-catalog`). */
export interface CatalogRole extends LibraryRole {
  name: string;
  tags: string[];
}

/** Command queue (mirrors src/core/queue/queue-store.ts and the queue routes in src/server/http.ts). */
export type QueueStatus = "chờ duyệt" | "đã duyệt" | "đang chạy" | "đã commit" | "đã gộp" | "bỏ qua" | "lỗi";

export interface QueueReference {
  url: string;
  title: string;
  note: string;
}

export interface QueueCommand {
  id: string;
  project: string;
  batch: number;
  position: number;
  title: string;
  body: string;
  bodyOriginal: string;
  dependsOn: string[];
  files: string[];
  references: QueueReference[];
  warnings: string[];
  source: "manual" | "scout";
  sourceRef: string;
  ideaTitle?: string;
  size?: 1 | 2;
  verify?: string;
  parallelGroup?: string;
  consumes?: string[];
  produces?: string[];
  acceptance?: string[];
  kind?: "coding" | "research";
  /** Set on commands the controller appended (integrate, final-review). */
  auto?: "integrate" | "final-review";
  status: QueueStatus;
  runId: string | null;
  branch: string | null;
  estCostUsd: number;
  createdAt: number;
  updatedAt: number;
  approvedAt: number | null;
  /** Every run of this command (original + follow-ups), oldest first. */
  runIds?: string[];
  mergePrecheck?: MergePrecheck | null;
}

export interface QueueLock {
  locked: boolean;
  reasons: string[];
}

export interface DescribedCommand extends QueueCommand {
  wave: number | null;
  waveReasons: string[];
  estimatedCostUsd: number;
  locks: { edit: QueueLock; approveRun: QueueLock; skip: QueueLock };
  /** True when a run of this command (or a follow-up descendant) is really running. */
  runLive?: boolean;
  /** Number of commits of the command's run (0 when none). */
  runCommitCount?: number;
}

export interface QueueBudgetState {
  canOpenNew: boolean;
  reached: boolean;
  spentUsd: number;
  /** null = unlimited queue budget. */
  maxBudgetUsd: number | null;
  remainingUsd: number | null;
  message: string;
}

export interface QueueView {
  commands: DescribedCommand[];
  waveError: string | null;
  totalEstimatedCostUsd: number;
  costNote: string;
  budget: QueueBudgetState;
  maxParallel: number;
  codingRunning: number;
  runAll?: QueueRunAllState;
  /** Per-idea meta keyed by sourceRef (absent on old servers). */
  ideas?: Record<string, IdeaMeta>;
  /** Ideas waiting for interview answers. */
  interviews?: PendingInterview[];
}

export interface QueueRunAllState {
  active: boolean;
  running: string[];
  committed: string[];
  failed: string[];
  blocked: string[];
  lastError: string | null;
  /** Idea scope of the current run-all (null = whole project). */
  sourceRef?: string | null;
  pausedUntil?: number | null;
  pauseReason?: string | null;
  pauseRunId?: string | null;
}

export interface QueuePatch {
  title?: string;
  body?: string;
  files?: string[];
  dependsOn?: string[];
}

/** PATCH returns the described command (locks, wave, cost). */
export interface QueuePatchResult {
  command: DescribedCommand;
  waveError: string | null;
}

/** approve-run: discriminate on `started`. The command is the raw stored row. */
export type QueueApproveRunResult =
  | { started: true; run: RunRecord; command: QueueCommand | null }
  | { started: false; command: QueueCommand | null; reasons: string[] };

export interface QueueRunParallelResult {
  started: { id: string; run: RunRecord }[];
  rejected: { id: string; reasons: string[] }[];
}

/** skip returns the raw stored row, not a described one. */
export interface QueueSkipResult {
  command: QueueCommand;
}

// Skills-gen (mirror of src/core/roles/skill-session.ts, skill-agent-set.ts, role-match.ts, agent-finder.ts, src/server/skills-gen.ts).
export interface SkillAgent {
  id: string;
  description: string;
  prompt?: string;
  tools: string[];
  source: "existing" | "new";
}

export interface NewAgentInput {
  id: string;
  description: string;
  prompt: string;
  tools?: string[];
}

export interface SessionRound {
  n: number;
  startedAt: string;
  feedbackIn?: string;
  score?: number;
  feedback?: string;
  gradedAt?: string;
  sample?: { files: { format: "docx" | "xlsx" | "pdf" | "html" | "dxf" | "step"; name: string }[]; summary: string; costUsd: number; notes?: string[] };
  error?: string;
}

export interface SkillSession {
  version: 1;
  brief: string;
  agents: SkillAgent[];
  maxRounds: number;
  status: "generating" | "awaiting_score" | "paused" | "completed" | "exhausted";
  rounds: SessionRound[];
  createdAt: string;
  updatedAt: string;
}

export interface RoleMatch {
  id: string;
  score: number;
  reasons: string[];
}

export interface FinderRepo {
  url: string;
  name: string;
  reason: string;
  features: string[];
}

export interface GenState {
  roles: RoleMatch[];
  repos: FinderRepo[];
  finder: { status: "idle" | "running" | "done" | "failed"; error?: string };
  sample?: { status: "idle" | "running" | "done" | "failed"; error?: string };
  /** Absent on legacy sessions completed before the final-skill step existed. */
  final?: { status: "idle" | "running" | "done" | "failed"; error?: string };
  costUsd?: number;
  costCapUsd?: number;
  /** Formats chosen to open and grade the samples (absent = Word + Excel). */
  outputs?: ("docx" | "xlsx" | "pdf" | "html" | "dxf" | "step")[];
}

export interface SkillsGenSessionResponse {
  session: SkillSession;
  gen: GenState;
}

export interface SkillsGenCreateAgentsResponse {
  session: SkillSession;
  warnings: string[];
  missing: boolean;
}

// Worktree cleanup (mirror of src/core/git/worktree-cleanup.ts and /api/cleanup* in src/server/http.ts).
export type CleanupSkipReason =
  | "active"
  | "no_worktree"
  | "no_branch"
  | "no_project"
  | "too_recent"
  | "shared_worktree"
  | "outside_worktrees_dir"
  | "missing"
  | "uncommitted"
  | "unmerged"
  | "status_unknown"
  | "error";

export interface CleanupCandidate {
  /** Every run that shares this worktree. */
  runIds: string[];
  worktreePath: string;
  branch: string;
  repoPath: string;
  baseBranch: string;
  estimatedBytes: number;
}

export interface CleanupSkip {
  runId: string;
  reason: CleanupSkipReason;
  severity: "info" | "warn";
  detail?: string;
}

export interface CleanupPlan {
  candidates: CleanupCandidate[];
  skipped: CleanupSkip[];
  totalBytes: number;
}

export interface CleanupRunResult {
  runId: string;
  worktreePath: string;
  status: "removed" | "dry-run" | "failed" | "skipped";
  error?: string;
  detail?: string;
  bytes: number;
}

/** Body of GET /api/cleanup/preview (olderThan is sent as a query parameter, in days). */
export interface CleanupPreview {
  olderThan: number;
  plan: CleanupPlan;
  inboxRemoved: string[];
}

/** Body of POST /api/cleanup. */
export interface CleanupResult {
  plan: CleanupPlan;
  results: CleanupRunResult[];
  inboxRemoved: string[];
}

// Usage blocks (mirror of src/core/usage/usage-blocks.ts; body of GET /api/usage/blocks).
export interface TokenTotals {
  input: number;
  output: number;
  cacheCreation: number;
  cacheRead: number;
  total: number;
  estimatedCostUsd?: number;
}

export interface DayUsage extends TokenTotals {
  day: string;
}

export interface SessionUsage extends TokenTotals {
  sessionId: string;
  firstAt: string;
  lastAt: string;
}

export interface UsageBlock extends TokenTotals {
  start: string;
  end: string;
  firstAt: string;
  lastAt: string;
  entries: number;
}

export interface UsageBlocks {
  byDay: DayUsage[];
  bySession: SessionUsage[];
  blocks: UsageBlock[];
  activeBlock: UsageBlock | null;
  remainingMs: number;
  skippedLines: number;
  skippedFiles: number;
  costIsEstimate: true;
}

/** Values of the Settings "Điều chỉnh" tab (mirror of src/core/app/app-settings.ts FullTuning). */
export interface TuningValues {
  dailyCostWarnUsd: number | null;
  queueMaxBudgetUsd: number | null;
  defaultModel: string;
  defaultMaxBudgetUsd: number;
  defaultMaxTurns: number;
  maxBudgetUsdCeiling: number;
  maxTurnsCeiling: number;
  codingMaxRoleCalls: number;
  scoutModel: string;
  scoutBudgetUsd: number;
  splitterModel: string;
  splitterBudgetUsd: number;
  replanBudgetUsd: number;
  replanEnabled: boolean;
  scopeGuardEnabled: boolean;
  scopeModel: string;
  scopeBudgetUsd: number;
  splitterWebSearch: boolean;
  splitterMaxWebCalls: number;
  interviewModel: string;
  interviewBudgetUsd: number;
  splitterInterview: boolean;
  criticModel: string;
  criticBudgetUsd: number;
  splitterCritic: boolean;
  splitterAutoIntegrate: boolean;
  queueLessons: boolean;
}

export interface TuningResponse {
  values: TuningValues;
  models: { id: string; label: string; provider?: "claude" | "antigravity" | "codex" }[];
  limits: { budgetCeilingMax: number; turnsCeilingMax: number; webCallsMax: number };
  roleCallsCeiling: number;
}

/** Mirrors GET/PUT /api/settings/workshop3d-models; a missing field = the model of the role file. */
export interface W3DModelSettings {
  main?: string;
  light?: string;
}
export interface W3DModelsResponse {
  models: W3DModelSettings;
  options: { id: string; label: string }[];
}

/** Mirrors GET /api/workshop3d and GET /api/workshop3d/:slug (hand-written, not imported from src/core/workshop3d). */
export interface Workshop3DListItem {
  slug: string;
  title: string;
  state: string;
  costUsd?: number;
  updatedAt?: number | string;
}
export interface Workshop3DSnapshot {
  state: string;
  round?: number;
  fixRounds?: number;
  maxFixRounds?: number;
  issues?: unknown[];
  questions?: string[];
  costUsd?: number;
  note?: string | null;
  error?: string | null;
  /** Epoch ms when waiting_quota ends. */
  waitUntil?: number | null;
  /** Why it waits: the subscription limit, or an automatic resume after a role was cut off. */
  waitReason?: "quota" | "retry" | null;
}
export interface Workshop3DSession {
  brief?: { title?: string; [key: string]: unknown };
  snapshot: Workshop3DSnapshot;
  files?: unknown[];
  renders?: unknown[];
  /** Blender high-quality progress (renders/hq/progress.json), null before the first Blender render. */
  hq?: { running?: unknown; total?: unknown; done?: unknown; index?: unknown; current?: unknown } | null;
  report?: unknown;
  /** Bytes of the session folder (delete confirmation). */
  diskBytes?: unknown;
  /** Absolute folders of the session (outputs = the deliverables; presentation = outputs/trinh-bay once built). */
  paths?: unknown;
}
/** Body brief of POST /api/workshop3d (limits are checked again on the server). */
export interface Workshop3DBriefInput {
  title: string;
  object: string;
  params: Record<string, string | number>;
  material?: string;
  purpose?: string;
  detail: "standard" | "high" | "ultra";
  attachments: [];
  /** Configurable parts (variants / "Tạo hàng loạt"); ids are ASCII (see slotIdFromName). */
  slots?: { id: string; name: string; type: "material" | "part" }[];
}
export type Workshop3DAction = "pause" | "resume" | "stop";
