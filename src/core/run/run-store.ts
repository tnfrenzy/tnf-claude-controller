import fs from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { RunKind } from "../app/config.js";
import type { CliProviderId } from "../shared-types.js";
import type { AgentInfo, NormalizedEvent, RunStatus, StoredEvent, Usage, VerdictRecord } from "./events.js";
import type { CommitRecord } from "../git/git.js";
import { sanitizeGrants, type Grants } from "./grants.js";
import { validatePreview, NO_PREVIEW, type PreviewConfig } from "../preview/preview-config.js";

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
  /** Grouping label ("environment/project"); 'default' when not set. */
  project: string;
  claude_version: string | null;
  cost_usd_est: number;
  /** Subscription 5-hour window utilization (%) at the first/last rate-limit event of this run. */
  quota_start?: number | null;
  quota_end?: number | null;
  /** Share of the subscription window this run used, in percent points (derived from quota_start/quota_end). */
  quota_pct?: number;
  quota7_start?: number | null;
  quota7_end?: number | null;
  /** Weekly-window growth during the run, percent points. */
  quota7_pct?: number;
  usage: Usage;
  num_turns: number;
  duration_ms: number;
  result_text: string | null;
  error: string | null;
  run_dir: string;
  agents: AgentInfo[];
  /** coding = worktree of project.repo_path; research = legacy roles in run_dir (CONTEXT-SPEC-v1 §5.3). */
  kind: RunKind;
  worktree_path: string | null;
  /** Agent branch tnf/<run-id>. */
  branch: string | null;
  /** Commit the worktree branched from. */
  base_sha: string | null;
  /** Run this one was forked from (null when not a fork). */
  forked_from_run_id: string | null;
  verdicts: VerdictRecord[];
  /** Commits on base_sha..HEAD after the run. */
  commits: CommitRecord[];
  changed_files: number;
  /** Effective limits applied to this run; null for runs created before the column existed. */
  limits: RunLimits | null;
  /** Result of the pre-merge check; null when never checked or stored JSON is invalid. */
  merge_precheck?: MergePrecheck | null;
  /** CLI provider used for this run ("claude" | "antigravity"). */
  provider?: CliProviderId;
  /** CLI account id used for this run (null for legacy runs). */
  account_id?: string | null;
}

export interface MergePrecheck {
  status: "clean" | "conflict" | "unknown";
  files: string[];
  reason?: string;
  /** Epoch ms. */
  checked_at: number;
  base_sha_checked: string | null;
}

export interface RunLimits {
  maxTurns: number;
  maxBudgetUsd: number;
  maxRoleCalls: number | null;
  callTimeoutMinutes: number | null;
}

/** A target repository (or a bare label for research runs when repo_path is null). CONTEXT-SPEC-v1 §7.1. */
export interface ProjectRecord {
  name: string;
  repo_path: string | null;
  base_branch: string | null;
  /** Extra Bash(...) allow patterns for this repo's test/build commands. */
  allowed_commands: string[];
  created_at: number;
  /** Optional default CLI account id assigned to this environment/project. */
  account_id?: string | null;
}

export interface ArtifactRecord {
  run_id: string;
  rel_path: string;
  size: number;
  mtime: number;
}

export interface QuotaResumeRecord { run_id: string; project: string; kind: "run" | "queue"; scope: string | null; resume_at: number; attempt: number; status: "pending" | "fired" | "cancelled" | "failed"; reason: string; created_at: number; updated_at: number }

export interface ProjectSummary extends ProjectRecord {
  /** Same as name; kept for the existing UI. */
  project: string;
  runs: number;
  running: number;
  last_at: number | null;
  cost_usd_est: number;
}

export interface RunListFilter {
  q?: string;
  status?: RunStatus;
  project?: string;
  kind?: RunKind;
  from?: number;
  to?: number;
  limit?: number;
  offset?: number;
  /** Only scout runs (prompt starts with a scout prefix). */
  scout?: boolean;
  /** Only these run ids (an empty list matches nothing). */
  ids?: string[];
  /** Everything except these run ids. */
  notIds?: string[];
}

/** Keep in sync with SCOUT_PROMPT_PREFIXES in ui/src/queue/scoutAgent.ts. */
export const SCOUT_PROMPT_PREFIXES = [
  'Bạn là người tìm hiểu repo của môi trường "',
  'You are a scout for the repository of environment "',
];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS runs (
  id TEXT PRIMARY KEY,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  status TEXT NOT NULL,
  prompt TEXT NOT NULL,
  mode TEXT NOT NULL,
  model TEXT,
  session_id TEXT,
  parent_run_id TEXT,
  claude_version TEXT,
  cost_usd_est REAL NOT NULL DEFAULT 0,
  usage_json TEXT NOT NULL DEFAULT '{}',
  num_turns INTEGER NOT NULL DEFAULT 0,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  result_text TEXT,
  error TEXT,
  run_dir TEXT NOT NULL,
  agents_json TEXT NOT NULL DEFAULT '[]'
);
CREATE INDEX IF NOT EXISTS runs_created ON runs(created_at DESC);
CREATE TABLE IF NOT EXISTS events (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id TEXT NOT NULL,
  ts INTEGER NOT NULL,
  type TEXT NOT NULL,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS events_run ON events(run_id, seq);
CREATE TABLE IF NOT EXISTS projects (
  name TEXT PRIMARY KEY,
  repo_path TEXT,
  base_branch TEXT,
  allowed_commands TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS artifacts (
  run_id TEXT NOT NULL,
  rel_path TEXT NOT NULL,
  size INTEGER NOT NULL,
  mtime INTEGER NOT NULL,
  PRIMARY KEY (run_id, rel_path)
);
CREATE TABLE IF NOT EXISTS quota_resumes (
  run_id TEXT PRIMARY KEY,
  project TEXT NOT NULL,
  kind TEXT NOT NULL,
  scope TEXT,
  resume_at INTEGER NOT NULL,
  attempt INTEGER NOT NULL,
  status TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS quota_resumes_status_at ON quota_resumes(status, resume_at);
`;

type Row = Record<string, unknown>;

/** quota_pct = growth of the 5-hour window utilization during the run; a window reset (end < start) counts the new window's value. */
export function quotaDelta(start: number | null | undefined, end: number | null | undefined): number {
  if (start == null || end == null) return 0;
  return Math.round((end >= start ? end - start : end) * 10) / 10;
}

function quotaFields(r: Row): {
  quota_start: number | null;
  quota_end: number | null;
  quota_pct: number;
  quota7_start: number | null;
  quota7_end: number | null;
  quota7_pct: number;
} {
  const start = (r["quota_start"] as number | null) ?? null;
  const end = (r["quota_end"] as number | null) ?? null;
  const start7 = (r["quota7_start"] as number | null) ?? null;
  const end7 = (r["quota7_end"] as number | null) ?? null;
  return {
    quota_start: start,
    quota_end: end,
    quota_pct: quotaDelta(start, end),
    quota7_start: start7,
    quota7_end: end7,
    quota7_pct: quotaDelta(start7, end7),
  };
}

function rowToRun(r: Row): RunRecord {
  return {
    id: r["id"] as string,
    created_at: r["created_at"] as number,
    updated_at: r["updated_at"] as number,
    status: r["status"] as RunStatus,
    prompt: r["prompt"] as string,
    mode: r["mode"] as string,
    model: (r["model"] as string | null) ?? null,
    session_id: (r["session_id"] as string | null) ?? null,
    parent_run_id: (r["parent_run_id"] as string | null) ?? null,
    project: (r["project"] as string | null) || "default",
    claude_version: (r["claude_version"] as string | null) ?? null,
    cost_usd_est: (r["cost_usd_est"] as number) ?? 0,
    ...quotaFields(r),
    usage: JSON.parse((r["usage_json"] as string) || "{}") as Usage,
    num_turns: (r["num_turns"] as number) ?? 0,
    duration_ms: (r["duration_ms"] as number) ?? 0,
    result_text: (r["result_text"] as string | null) ?? null,
    error: (r["error"] as string | null) ?? null,
    run_dir: r["run_dir"] as string,
    agents: JSON.parse((r["agents_json"] as string) || "[]") as AgentInfo[],
    kind: ((r["kind"] as string | null) || "research") as RunKind,
    worktree_path: (r["worktree_path"] as string | null) ?? null,
    branch: (r["branch"] as string | null) ?? null,
    base_sha: (r["base_sha"] as string | null) ?? null,
    forked_from_run_id: (r["forked_from_run_id"] as string | null) ?? null,
    verdicts: JSON.parse((r["verdicts_json"] as string) || "[]") as VerdictRecord[],
    commits: JSON.parse((r["commits_json"] as string) || "[]") as CommitRecord[],
    changed_files: (r["changed_files"] as number | null) ?? 0,
    limits: parseLimits(r["limits_json"]),
    merge_precheck: parseMergePrecheck(r["merge_precheck_json"]),
    provider: r["provider"] === "antigravity" ? "antigravity" : r["provider"] === "codex" ? "codex" : "claude",
    account_id: (r["account_id"] as string | null) ?? null,
  };
}

function parseMergePrecheck(raw: unknown): MergePrecheck | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw) as Record<string, unknown> | null;
    if (!v || typeof v !== "object") return null;
    if (v["status"] !== "clean" && v["status"] !== "conflict" && v["status"] !== "unknown") return null;
    if (!Array.isArray(v["files"]) || !v["files"].every((f) => typeof f === "string")) return null;
    if (typeof v["checked_at"] !== "number") return null;
    return v as unknown as MergePrecheck;
  } catch {
    return null;
  }
}

function parseLimits(raw: unknown): RunLimits | null {
  if (typeof raw !== "string" || !raw) return null;
  try {
    const v = JSON.parse(raw) as unknown;
    return v && typeof v === "object" ? (v as RunLimits) : null;
  } catch {
    return null;
  }
}

function rowToProject(r: Row): ProjectRecord {
  let cmds: string[] = [];
  try {
    const parsed = JSON.parse((r["allowed_commands"] as string) || "[]") as unknown;
    if (Array.isArray(parsed)) cmds = parsed.map(String);
  } catch {
    /* keep [] */
  }
  return {
    name: r["name"] as string,
    repo_path: (r["repo_path"] as string | null) ?? null,
    base_branch: (r["base_branch"] as string | null) ?? null,
    allowed_commands: cmds,
    created_at: (r["created_at"] as number) ?? 0,
    account_id: (r["account_id"] as string | null) ?? null,
  };
}

function rowToQuotaResume(r: Row): QuotaResumeRecord {
  return {
    run_id: r["run_id"] as string,
    project: r["project"] as string,
    kind: r["kind"] as QuotaResumeRecord["kind"],
    scope: (r["scope"] as string | null) ?? null,
    resume_at: Number(r["resume_at"]),
    attempt: Number(r["attempt"]),
    status: r["status"] as QuotaResumeRecord["status"],
    reason: (r["reason"] as string) ?? "",
    created_at: Number(r["created_at"]),
    updated_at: Number(r["updated_at"]),
  };
}

/** SQLite-backed store for runs, normalized events and artifact listings. */
export class RunStore {
  private readonly db: DatabaseSync;

  constructor(dbPath: string) {
    if (dbPath !== ":memory:") fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    this.db = new DatabaseSync(dbPath);
    this.db.exec("PRAGMA journal_mode = WAL;");
    // WAL + NORMAL: no fsync per insert (measured 2.3 ms -> 0.12 ms per stream event); a power cut may lose the last events only.
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);
    // Migration (2026-10-20): projects/environments group runs.
    const cols = (this.db.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
    if (!cols.includes("project")) this.db.exec("ALTER TABLE runs ADD COLUMN project TEXT NOT NULL DEFAULT 'default'");
    // Migration (2026-11-09): per-environment permission ticks (JSON; NULL = use the default profile).
    const pcols = (this.db.prepare("PRAGMA table_info(projects)").all() as { name: string }[]).map((c) => c.name);
    if (!pcols.includes("grants")) this.db.exec("ALTER TABLE projects ADD COLUMN grants TEXT");
    if (!pcols.includes("preview")) this.db.exec("ALTER TABLE projects ADD COLUMN preview TEXT");
    if (!pcols.includes("account_id")) this.db.exec("ALTER TABLE projects ADD COLUMN account_id TEXT");
    // Migration (2026-10-21, CONTEXT-SPEC-v1 §7.1): coding runs in worktrees.
    const add: Record<string, string> = {
      kind: "TEXT NOT NULL DEFAULT 'research'",
      worktree_path: "TEXT",
      branch: "TEXT",
      base_sha: "TEXT",
      verdicts_json: "TEXT NOT NULL DEFAULT '[]'",
      commits_json: "TEXT NOT NULL DEFAULT '[]'",
      changed_files: "INTEGER NOT NULL DEFAULT 0",
      limits_json: "TEXT",
      merge_precheck_json: "TEXT",
      forked_from_run_id: "TEXT",
      quota_start: "REAL",
      quota_end: "REAL",
      quota7_start: "REAL",
      quota7_end: "REAL",
      provider: "TEXT NOT NULL DEFAULT 'claude'",
      account_id: "TEXT",
    };
    for (const [col, type] of Object.entries(add)) if (!cols.includes(col)) this.db.exec(`ALTER TABLE runs ADD COLUMN ${col} ${type}`);
    // Covering / lookup indexes (measured on 150 runs: the History thread query fell from ~1.6 s to ~40 ms).
    this.db.exec("CREATE INDEX IF NOT EXISTS runs_link ON runs(id, parent_run_id, forked_from_run_id, created_at, project, status, kind)");
    this.db.exec("CREATE INDEX IF NOT EXISTS runs_project ON runs(project, created_at DESC)");
    this.db.exec("CREATE INDEX IF NOT EXISTS runs_status ON runs(status)");
    // Deleted projects keep their runs; the tombstone stops the migration below from resurrecting them.
    this.db.exec("CREATE TABLE IF NOT EXISTS deleted_projects (name TEXT PRIMARY KEY, deleted_at INTEGER)");
    // Old free-form project labels become project rows without a repo (research only).
    this.db.exec(
      `INSERT OR IGNORE INTO projects (name, repo_path, base_branch, allowed_commands, created_at)
       SELECT project, NULL, NULL, '[]', MIN(created_at) FROM runs
       WHERE project NOT IN (SELECT name FROM deleted_projects) GROUP BY project`,
    );
    this.groupWorkshopRuns();
  }

  /**
   * Old workshop3d role-call runs (before `threadWith`) each sat alone in the history. Put the runs of one session in one
   * thread: the session slug comes from the session dir named in the prompt; a run whose prompt does not name it joins the
   * slug of the nearest earlier run (one session runs its role calls in sequence). Idempotent; never touches runs that
   * already have a parent or fork.
   */
  groupWorkshopRuns(project = "workshop3d"): number {
    const rows = this.db
      .prepare("SELECT id, prompt, parent_run_id, forked_from_run_id FROM runs WHERE project = ? ORDER BY created_at, id")
      .all(project) as Array<{ id: string; prompt: string; parent_run_id: string | null; forked_from_run_id: string | null }>;
    const first = new Map<string, string>();
    let lastSlug: string | null = null;
    let changed = 0;
    const upd = this.db.prepare("UPDATE runs SET forked_from_run_id = ? WHERE id = ?");
    for (const r of rows) {
      const m = /workshop3d[\/]+(\d{8}-\d{6}-[0-9a-f]{6})/.exec(r.prompt ?? "");
      const slug: string | null = m ? m[1]! : lastSlug;
      if (!slug) continue;
      lastSlug = slug;
      const root = first.get(slug);
      if (!root) {
        first.set(slug, r.id);
        continue;
      }
      if (!r.parent_run_id && !r.forked_from_run_id) {
        upd.run(root, r.id);
        changed++;
      }
    }
    return changed;
  }

  close(): void {
    this.db.close();
  }

  deleteRun(id: string): void {
    this.db.prepare("DELETE FROM runs WHERE id = ?").run(id);
  }

  createRun(
    run: Omit<RunRecord, "created_at" | "updated_at" | "agents" | "usage" | "cost_usd_est" | "quota_start" | "quota_end" | "quota_pct" | "quota7_start" | "quota7_end" | "quota7_pct" | "num_turns" | "duration_ms" | "result_text" | "error" | "kind" | "worktree_path" | "branch" | "base_sha" | "forked_from_run_id" | "verdicts" | "commits" | "changed_files" | "limits" | "provider" | "account_id"> &
      Partial<Pick<RunRecord, "kind" | "worktree_path" | "branch" | "base_sha" | "forked_from_run_id" | "provider" | "account_id">>,
  ): RunRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO runs (id, created_at, updated_at, status, prompt, mode, model, session_id, parent_run_id, project, claude_version, run_dir, kind, worktree_path, branch, base_sha, forked_from_run_id, provider, account_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        run.id, now, now, run.status, run.prompt, run.mode, run.model, run.session_id, run.parent_run_id, run.project, run.claude_version, run.run_dir,
        run.kind ?? "research", run.worktree_path ?? null, run.branch ?? null, run.base_sha ?? null,
        run.forked_from_run_id ?? null, run.provider ?? "claude", run.account_id ?? null,
      );
    return this.getRun(run.id)!;
  }

  updateRun(id: string, patch: Partial<Omit<RunRecord, "id" | "created_at">>): void {
    const sets: string[] = ["updated_at = ?"];
    const vals: unknown[] = [Date.now()];
    const map: Record<string, (v: unknown) => unknown> = {
      status: (v) => v,
      model: (v) => v,
      session_id: (v) => v,
      claude_version: (v) => v,
      cost_usd_est: (v) => v,
      quota_start: (v) => v,
      quota_end: (v) => v,
      quota7_start: (v) => v,
      quota7_end: (v) => v,
      num_turns: (v) => v,
      duration_ms: (v) => v,
      result_text: (v) => v,
      error: (v) => v,
      usage: (v) => JSON.stringify(v),
      agents: (v) => JSON.stringify(v),
      worktree_path: (v) => v,
      branch: (v) => v,
      base_sha: (v) => v,
      changed_files: (v) => v,
      verdicts: (v) => JSON.stringify(v),
      commits: (v) => JSON.stringify(v),
      limits: (v) => JSON.stringify(v),
      merge_precheck: (v) => (v === null ? null : JSON.stringify(v)),
      provider: (v) => v,
      account_id: (v) => v,
    };
    const cols: Record<string, string> = { usage: "usage_json", agents: "agents_json", verdicts: "verdicts_json", commits: "commits_json", limits: "limits_json", merge_precheck: "merge_precheck_json" };
    for (const [k, v] of Object.entries(patch)) {
      const conv = map[k];
      if (!conv || v === undefined) continue;
      sets.push(`${cols[k] ?? k} = ?`);
      vals.push(conv(v));
    }
    vals.push(id);
    this.db.prepare(`UPDATE runs SET ${sets.join(", ")} WHERE id = ?`).run(...(vals as never[]));
  }

  getRun(id: string): RunRecord | null {
    const r = this.db.prepare("SELECT * FROM runs WHERE id = ?").get(id) as Row | undefined;
    return r ? rowToRun(r) : null;
  }

  private buildWhere(filter: RunListFilter): { clause: string; vals: unknown[] } {
    const where: string[] = [];
    const vals: unknown[] = [];
    if (filter.scout) {
      where.push("(prompt LIKE ? ESCAPE '\\' OR prompt LIKE ? ESCAPE '\\')");
      for (const p of SCOUT_PROMPT_PREFIXES) vals.push(p.replace(/[\\%_]/g, (c) => "\\" + c) + "%");
    }
    if (filter.q) {
      where.push("(prompt LIKE ? OR result_text LIKE ? OR id LIKE ?)");
      const like = `%${filter.q}%`;
      vals.push(like, like, like);
    }
    if (filter.status) {
      where.push("status = ?");
      vals.push(filter.status);
    }
    if (filter.project) {
      where.push("project = ?");
      vals.push(filter.project);
    }
    if (filter.ids) {
      if (filter.ids.length === 0) where.push("0 = 1");
      else {
        where.push(`id IN (${filter.ids.map(() => "?").join(",")})`);
        vals.push(...filter.ids);
      }
    }
    if (filter.notIds && filter.notIds.length > 0) {
      where.push(`id NOT IN (${filter.notIds.map(() => "?").join(",")})`);
      vals.push(...filter.notIds);
    }
    if (filter.kind) {
      where.push("kind = ?");
      vals.push(filter.kind);
    }
    if (filter.from) {
      where.push("created_at >= ?");
      vals.push(filter.from);
    }
    if (filter.to) {
      where.push("created_at <= ?");
      vals.push(filter.to);
    }
    return { clause: where.length ? "WHERE " + where.join(" AND ") : "", vals };
  }

  listRuns(filter: RunListFilter = {}): RunRecord[] {
    const { clause, vals } = this.buildWhere(filter);
    let sql = `SELECT * FROM runs ${clause} ORDER BY created_at DESC LIMIT ?`;
    vals.push(filter.limit ?? 200);
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    if (offset > 0) {
      sql += " OFFSET ?";
      vals.push(offset);
    }
    return (this.db.prepare(sql).all(...(vals as never[])) as Row[]).map(rowToRun);
  }

  /**
   * Threaded listing: paginate by thread (a root run plus its follow-up / continue-from-commit descendants),
   * newest activity first. A thread is on the list when any member matches the filter; every member of the
   * page's threads is returned (flat, newest first) so the UI can build the tree. `total` counts threads.
   * Runs whose parent is missing are roots; runs stuck in a parent cycle become their own root (no loop).
   */
  listRunThreads(filter: RunListFilter = {}): { runs: RunRecord[]; total: number } {
    const chain = `WITH RECURSIVE link(lid, lparent) AS (
        SELECT id, COALESCE(NULLIF(parent_run_id, ''), NULLIF(forked_from_run_id, '')) FROM runs
      ), chain(cid, root) AS (
        SELECT lid, lid FROM link WHERE lparent IS NULL OR lparent = lid OR lparent NOT IN (SELECT id FROM runs)
        UNION
        SELECT l.lid, c.root FROM link l JOIN chain c ON l.lparent = c.cid AND l.lid <> c.cid
      )`;
    const rootExpr = "COALESCE(c.root, runs.id)";
    const { clause, vals } = this.buildWhere(filter);
    const from = `FROM runs LEFT JOIN chain c ON c.cid = runs.id ${clause}`;
    const total = Number((this.db.prepare(`${chain} SELECT COUNT(DISTINCT ${rootExpr}) AS n ${from}`).get(...(vals as never[])) as { n: number }).n);
    const pageVals = [...vals, filter.limit ?? 200, Math.max(0, Math.floor(filter.offset ?? 0))];
    const roots = (this.db
      .prepare(`${chain} SELECT ${rootExpr} AS troot, MAX(runs.created_at) AS tlast ${from} GROUP BY troot ORDER BY tlast DESC, troot DESC LIMIT ? OFFSET ?`)
      .all(...(pageVals as never[])) as Array<{ troot: string }>).map((r) => r.troot);
    if (roots.length === 0) return { runs: [], total };
    const rows = this.db
      .prepare(`${chain} SELECT runs.* FROM runs LEFT JOIN chain c ON c.cid = runs.id WHERE ${rootExpr} IN (${roots.map(() => "?").join(",")}) ORDER BY runs.created_at DESC, runs.id DESC`)
      .all(...(roots as never[])) as Row[];
    return { runs: rows.map(rowToRun), total };
  }

  /** Id and parent of every run of a project, without parsing the JSON columns (cheap even with thousands of runs). */
  runLinks(project: string): Array<{ id: string; parent_run_id: string | null }> {
    return this.db.prepare("SELECT id, parent_run_id FROM runs WHERE project = ?").all(project) as Array<{ id: string; parent_run_id: string | null }>;
  }

  /** Total rows matching the filter (ignores limit/offset). */
  countRuns(filter: RunListFilter = {}): number {
    const { clause, vals } = this.buildWhere(filter);
    const r = this.db.prepare(`SELECT COUNT(*) AS n FROM runs ${clause}`).get(...(vals as never[])) as { n: number };
    return Number(r.n);
  }

  /** Projects (target repos / labels) with run counts, newest activity first; projects without runs come last. */
  listProjects(): ProjectSummary[] {
    const rows = this.db
      .prepare(
        `SELECT p.name, p.repo_path, p.base_branch, p.allowed_commands, p.created_at, p.account_id,
                COUNT(r.id) AS runs, COALESCE(SUM(CASE WHEN r.status = 'running' THEN 1 ELSE 0 END), 0) AS running,
                MAX(r.created_at) AS last_at, COALESCE(SUM(r.cost_usd_est), 0) AS cost_usd_est
         FROM projects p LEFT JOIN runs r ON r.project = p.name
         GROUP BY p.name ORDER BY (last_at IS NULL), last_at DESC, p.name`,
      )
      .all() as Row[];
    return rows.map((r) => ({
      ...rowToProject(r),
      project: r["name"] as string,
      runs: (r["runs"] as number) ?? 0,
      running: (r["running"] as number) ?? 0,
      last_at: (r["last_at"] as number | null) ?? null,
      cost_usd_est: (r["cost_usd_est"] as number) ?? 0,
    }));
  }

  getProject(name: string): ProjectRecord | null {
    const r = this.db.prepare("SELECT * FROM projects WHERE name = ?").get(name) as Row | undefined;
    return r ? rowToProject(r) : null;
  }

  /** Insert or update a project; created_at is kept on update. */
  upsertProject(p: Omit<ProjectRecord, "created_at">): ProjectRecord {
    this.db
      .prepare(
        `INSERT INTO projects (name, repo_path, base_branch, allowed_commands, created_at) VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(name) DO UPDATE SET repo_path = excluded.repo_path, base_branch = excluded.base_branch, allowed_commands = excluded.allowed_commands`,
      )
      .run(p.name, p.repo_path, p.base_branch, JSON.stringify(p.allowed_commands), Date.now());
    this.db.prepare("DELETE FROM deleted_projects WHERE name = ?").run(p.name);
    return this.getProject(p.name)!;
  }

  getProjectGrants(name: string): Grants | null {
    const r = this.db.prepare("SELECT grants FROM projects WHERE name = ?").get(name) as Row | undefined;
    const raw = r?.["grants"];
    if (typeof raw !== "string" || !raw) return null;
    try { return sanitizeGrants(JSON.parse(raw)); } catch { return null; }
  }

  setProjectGrants(name: string, g: Grants | null): void {
    this.db.prepare("UPDATE projects SET grants = ? WHERE name = ?").run(g ? JSON.stringify(g) : null, name);
  }

  getProjectAccount(name: string): string | null {
    const r = this.db.prepare("SELECT account_id FROM projects WHERE name = ?").get(name) as Row | undefined;
    return typeof r?.["account_id"] === "string" && r["account_id"] ? (r["account_id"] as string) : null;
  }

  setProjectAccount(name: string, accountId: string | null): void {
    this.db.prepare("UPDATE projects SET account_id = ? WHERE name = ?").run(accountId || null, name);
  }

  getProjectPreview(name: string): PreviewConfig {
    const r = this.db.prepare("SELECT preview FROM projects WHERE name = ?").get(name) as Row | undefined;
    const raw = r?.["preview"];
    if (typeof raw !== "string" || !raw) return NO_PREVIEW;
    // Re-read with a permissive exe check so a temporarily missing .exe does not wipe the saved config.
    try { return validatePreview(JSON.parse(raw), () => true); } catch { return NO_PREVIEW; }
  }

  setProjectPreview(name: string, c: PreviewConfig | null): void {
    this.db.prepare("UPDATE projects SET preview = ? WHERE name = ?").run(c && c.kind !== "none" ? JSON.stringify(c) : null, name);
  }

  /** Remove the project row and leave a tombstone; runs, events and artifacts are kept. */
  deleteProject(name: string): void {
    this.db.exec("BEGIN");
    try {
      this.db.prepare("DELETE FROM projects WHERE name = ?").run(name);
      this.db.prepare("INSERT OR REPLACE INTO deleted_projects (name, deleted_at) VALUES (?, ?)").run(name, Date.now());
      this.db.exec("COMMIT");
    } catch (e) {
      this.db.exec("ROLLBACK");
      throw e;
    }
  }

  /** Estimated cost grouped by local calendar day (YYYY-MM-DD). */
  costByDay(): { day: string; cost_usd_est: number; quota_pct: number; runs: number }[] {
    const rows = this.db.prepare("SELECT created_at, cost_usd_est, quota_start, quota_end FROM runs").all() as Row[];
    const acc = new Map<string, { cost: number; quota: number; runs: number }>();
    for (const r of rows) {
      const d = new Date(r["created_at"] as number);
      const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
      const cur = acc.get(key) ?? { cost: 0, quota: 0, runs: 0 };
      cur.quota += quotaFields(r).quota_pct;
      cur.cost += (r["cost_usd_est"] as number) ?? 0;
      cur.runs += 1;
      acc.set(key, cur);
    }
    return [...acc.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1)).map(([day, v]) => ({ day, cost_usd_est: v.cost, quota_pct: v.quota, runs: v.runs }));
  }

  /** Cost stats (n, median, max) of finished coding runs with a valid (non-null, > 0) estimated cost. */
  codingCostStats(): { n: number; median: number; max: number } {
    const rows = this.db.prepare("SELECT cost_usd_est FROM runs WHERE kind = 'coding' AND status = 'done' AND cost_usd_est IS NOT NULL AND cost_usd_est > 0").all() as Row[];
    const v = rows.map((r) => r["cost_usd_est"] as number).sort((a, b) => a - b);
    if (v.length === 0) return { n: 0, median: 0, max: 0 };
    const mid = v.length >> 1;
    const median = v.length % 2 ? v[mid]! : (v[mid - 1]! + v[mid]!) / 2;
    return { n: v.length, median, max: v[v.length - 1]! };
  }

  appendEvent(runId: string, event: NormalizedEvent): StoredEvent {
    const ts = Date.now();
    const res = this.db.prepare("INSERT INTO events (run_id, ts, type, json) VALUES (?, ?, ?, ?)").run(runId, ts, event.type, JSON.stringify(event));
    return { seq: Number(res.lastInsertRowid), run_id: runId, ts, event };
  }

  /** Newest rate.limit event across all runs, with observed_at = its ts; null when none or unparsable. */
  latestRateLimitEvent(): (Extract<NormalizedEvent, { type: "rate.limit" }> & { observed_at: number }) | null {
    try {
      const row = this.db.prepare("SELECT ts, json FROM events WHERE type = 'rate.limit' ORDER BY seq DESC LIMIT 1").get() as Row | undefined;
      if (!row) return null;
      const ev = JSON.parse(row["json"] as string) as Extract<NormalizedEvent, { type: "rate.limit" }>;
      return { ...ev, observed_at: row["ts"] as number };
    } catch {
      return null;
    }
  }

  getEvents(runId: string, afterSeq = 0, limit = 10000): StoredEvent[] {
    const rows = this.db.prepare("SELECT seq, run_id, ts, json FROM events WHERE run_id = ? AND seq > ? ORDER BY seq LIMIT ?").all(runId, afterSeq, limit) as Row[];
    return rows.map((r) => ({ seq: r["seq"] as number, run_id: r["run_id"] as string, ts: r["ts"] as number, event: JSON.parse(r["json"] as string) as NormalizedEvent }));
  }

  /** Scan the run directory (notes/*.md, report.md) and record artifacts. */
  scanArtifacts(runId: string, runDir: string): ArtifactRecord[] {
    const found: ArtifactRecord[] = [];
    const walk = (dir: string, rel: string, depth: number) => {
      if (depth > 3 || !fs.existsSync(dir)) return;
      for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
        if (ent.name === "stream.jsonl" || ent.name.startsWith(".")) continue;
        // mcp.json can carry plaintext connector secrets: never an artifact (defence in depth, new runs keep it outside runDir)
        if (depth === 0 && ent.name === "mcp.json") continue;
        // inbox/ holds the user's attachments (inputs), not generated artifacts
        if (depth === 0 && ent.name === "inbox" && ent.isDirectory()) continue;
        const abs = path.join(dir, ent.name);
        const r = rel ? `${rel}/${ent.name}` : ent.name;
        if (ent.isDirectory()) walk(abs, r, depth + 1);
        else if (ent.isFile()) {
          const st = fs.statSync(abs);
          found.push({ run_id: runId, rel_path: r, size: st.size, mtime: st.mtimeMs });
        }
      }
    };
    walk(runDir, "", 0);
    const ins = this.db.prepare("INSERT OR REPLACE INTO artifacts (run_id, rel_path, size, mtime) VALUES (?, ?, ?, ?)");
    for (const a of found) ins.run(a.run_id, a.rel_path, a.size, a.mtime);
    return found;
  }

  getArtifacts(runId: string): ArtifactRecord[] {
    return this.db.prepare("SELECT * FROM artifacts WHERE run_id = ? ORDER BY rel_path").all(runId) as unknown as ArtifactRecord[];
  }

  upsertQuotaResume(r: Omit<QuotaResumeRecord, "created_at" | "updated_at">): QuotaResumeRecord {
    const now = Date.now();
    this.db
      .prepare(
        `INSERT INTO quota_resumes (run_id, project, kind, scope, resume_at, attempt, status, reason, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(run_id) DO UPDATE SET project = excluded.project, kind = excluded.kind, scope = excluded.scope,
           resume_at = excluded.resume_at, attempt = excluded.attempt, status = excluded.status,
           reason = excluded.reason, updated_at = excluded.updated_at`,
      )
      .run(r.run_id, r.project, r.kind, r.scope ?? null, r.resume_at, r.attempt, r.status, r.reason ?? "", now, now);
    return this.getQuotaResume(r.run_id)!;
  }

  getQuotaResume(runId: string): QuotaResumeRecord | null {
    const row = this.db.prepare("SELECT * FROM quota_resumes WHERE run_id = ?").get(runId) as Row | undefined;
    return row ? rowToQuotaResume(row) : null;
  }

  listQuotaResumes(status?: QuotaResumeRecord["status"]): QuotaResumeRecord[] {
    const rows = (
      status
        ? this.db.prepare("SELECT * FROM quota_resumes WHERE status = ? ORDER BY resume_at ASC, run_id ASC").all(status)
        : this.db.prepare("SELECT * FROM quota_resumes ORDER BY resume_at ASC, run_id ASC").all()
    ) as Row[];
    return rows.map(rowToQuotaResume);
  }

  setQuotaResumeStatus(runId: string, status: QuotaResumeRecord["status"], reason?: string): boolean {
    const res = this.db
      .prepare("UPDATE quota_resumes SET status = ?, reason = COALESCE(?, reason), updated_at = ? WHERE run_id = ?")
      .run(status, reason ?? null, Date.now(), runId);
    return Number(res.changes) > 0;
  }
}
