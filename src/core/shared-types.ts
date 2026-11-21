/** Types shared by the server and the UI. No imports, so the UI project can read this file without Node types. */

/** A scheduled "resume after the subscription quota resets" appointment (kept in RAM only). */
export interface QuotaResumeRecord {
  runId: string;
  kind: "run" | "queue";
  project: string | null;
  status: "pending" | "fired" | "cancelled" | "error";
  /** ISO timestamp. */
  resumeAt: string;
  reason: string;
  /** Position in the chain of quota resumes (1 = first appointment). */
  attempt?: number;
  error?: string;
}

export interface PublicConnection {
  id: string;
  name: string;
  baseUrl: string;
  path: string;
  hasToken: boolean;
  createdAt: number;
}

export interface Employee {
  id: string;
  name: string;
  department: string | null;
  paused: boolean;
  /** false = the job has no queue to count yet ("chưa nối"). */
  queueKnown: boolean;
  counts: { pending: number; processing: number; failed: number; done: number } | null;
  waitingLock: boolean;
  lastFinishedAt: string | null;
  avgSeconds: number | null;
  failedRate: number | null;
}

export interface StaffSnapshot {
  generatedAt: string | null;
  employees: Employee[];
}

export type StaffResult = ({ ok: true; fetchedAt: number } & StaffSnapshot) | { ok: false; error: string; status?: number };

export interface TemplateInfo {
  id: "web" | "api" | "script" | "blank";
  title: string;
  summary: string;
  /** When to choose it (Vietnamese, shown in the form). */
  whenToUse: string;
}

export interface TailscaleInfo {
  installed: boolean;
  running: boolean;
  /** This machine's tailnet name without the trailing dot, e.g. desktop-x.tail1234.ts.net. */
  dnsName: string | null;
}

export interface PhoneInfo extends TailscaleInfo {
  port: number;
  /** `https://<dnsName>` or null. */
  origin: string | null;
  /** `tailscale serve` already maps this app port. */
  serving: boolean;
  /** The origin is accepted by the server (Origin/Host checks). */
  allowed: boolean;
  /** Address to open on the phone, token included in the fragment (never sent to a server by the browser). */
  link: string | null;
}

export type CliProviderId = "claude" | "antigravity" | "codex";

export type ModelTier = "light" | "balanced" | "strong";

export interface CliModelChoice {
  id: string;
  label: string;
  tier?: ModelTier;
}

export interface CliAccountPublic {
  id: string;
  label: string;
  provider: CliProviderId;
  /** Isolated profile directory (e.g. CLAUDE_CONFIG_DIR); null = OS default profile. */
  configDir: string | null;
  binaryPath: string | null;
  defaultModel: string | null;
  enabled: boolean;
  isDefault: boolean;
  priority: number;
  createdAt: number;
}

export interface CliAccountRuntimeStatus {
  accountId: string;
  provider: CliProviderId;
  installed: boolean;
  binaryPath: string | null;
  version: string | null;
  loggedIn: boolean;
  authMethod: string;
  email?: string;
  subscriptionType?: string;
  orgName?: string;
  error?: string;
  checkedAt: number;
  models: CliModelChoice[];
  cooldownUntil: number | null;
}

/** Per-role account/model assignment for controller-orchestrated flows (Level B) and phased coding (Level D). */
export interface RoleAccountAssignment {
  accountId?: string | null;
  model?: string | null;
}

export type RoleAccountMap = Record<string, RoleAccountAssignment>;

export interface CliAccountsSettings {
  /** Automatically pick the next non-cooling-down enabled account when the chosen one hits its rate limit. */
  autoFailover?: boolean;
  /** Allow automatic failover across different CLI providers (e.g. Claude -> Antigravity). Default false. */
  crossProviderFailover?: boolean;
}
