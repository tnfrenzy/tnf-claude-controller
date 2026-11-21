import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";

const dirs: string[] = [];
afterEach(() => {
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/** A DB as the 2026-10-20 controller left it: `runs` with a `project` label column, no `projects` table. */
function legacyDb(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-store-"));
  dirs.push(dir);
  const file = path.join(dir, "controller.db");
  const db = new DatabaseSync(file);
  db.exec(`CREATE TABLE runs (
    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL,
    mode TEXT NOT NULL, model TEXT, session_id TEXT, parent_run_id TEXT, claude_version TEXT, cost_usd_est REAL NOT NULL DEFAULT 0,
    usage_json TEXT NOT NULL DEFAULT '{}', num_turns INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
    result_text TEXT, error TEXT, run_dir TEXT NOT NULL, agents_json TEXT NOT NULL DEFAULT '[]', project TEXT NOT NULL DEFAULT 'default');`);
  const ins = db.prepare("INSERT INTO runs (id, created_at, updated_at, status, prompt, mode, run_dir, project, cost_usd_est) VALUES (?, ?, ?, 'done', ?, 'subscription+roles', ?, ?, ?)");
  ins.run("r1", 1000, 1000, "p1", "D:/ws/runs/r1", "alpha", 0.5);
  ins.run("r2", 2000, 2000, "p2", "D:/ws/runs/r2", "alpha", 0.25);
  ins.run("r3", 3000, 3000, "p3", "D:/ws/runs/r3", "default", 0.1);
  db.close();
  return file;
}

describe("RunStore – projects table and coding columns", () => {
  it("migrates legacy project labels into `projects` with repo_path NULL and old runs become kind=research", () => {
    const store = new RunStore(legacyDb());
    const alpha = store.getProject("alpha")!;
    expect(alpha).toMatchObject({ name: "alpha", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(alpha.created_at).toBe(1000);
    expect(store.getProject("default")).not.toBeNull();
    expect(store.getProject("nope")).toBeNull();
    const r1 = store.getRun("r1")!;
    expect(r1.kind).toBe("research");
    expect(r1.worktree_path).toBeNull();
    expect(r1.verdicts).toEqual([]);
    expect(r1.commits).toEqual([]);
    expect(r1.changed_files).toBe(0);
    store.close();
    // Reopening must be idempotent.
    const again = new RunStore(legacyDb());
    expect(again.getProject("alpha")).not.toBeNull();
    again.close();
  });

  it("upserts projects and lists them with run summaries", () => {
    const store = new RunStore(legacyDb());
    const p = store.upsertProject({ name: "spike", repo_path: "D:/ws/spike-repo", base_branch: "main", allowed_commands: ["Bash(node *)"] });
    expect(p.created_at).toBeGreaterThan(0);
    store.upsertProject({ name: "alpha", repo_path: "D:/repo", base_branch: "dev", allowed_commands: [] });
    const list = store.listProjects();
    const names = list.map((x) => x.name);
    expect(names).toEqual(expect.arrayContaining(["spike", "alpha", "default"]));
    const alpha = list.find((x) => x.name === "alpha")!;
    expect(alpha).toMatchObject({ repo_path: "D:/repo", base_branch: "dev", runs: 2, running: 0, last_at: 2000 });
    expect(alpha.cost_usd_est).toBeCloseTo(0.75);
    const spike = list.find((x) => x.name === "spike")!;
    expect(spike).toMatchObject({ runs: 0, running: 0, last_at: null, cost_usd_est: 0, allowed_commands: ["Bash(node *)"] });
    // listProjects keeps the legacy `project` field for the existing UI
    expect(alpha.project).toBe("alpha");
    store.close();
  });

  it("stores coding fields on create and update", () => {
    const store = new RunStore(":memory:");
    const rec = store.createRun({
      id: "c1", status: "running", prompt: "x", mode: "subscription+coding", model: "sonnet", session_id: null, parent_run_id: null,
      project: "spike", claude_version: null, run_dir: "D:/ws/runs/c1",
      kind: "coding", worktree_path: "D:/ws/worktrees/c1", branch: "tnf/c1", base_sha: "abc",
    });
    expect(rec).toMatchObject({ kind: "coding", worktree_path: "D:/ws/worktrees/c1", branch: "tnf/c1", base_sha: "abc", verdicts: [], commits: [], changed_files: 0 });
    store.updateRun("c1", { verdicts: [{ agent_id: "a", role: "qa", verdict: "PASS", at: 5 }], commits: [{ hash: "h1", subject: "feat: x" }], changed_files: 3 });
    const r = store.getRun("c1")!;
    expect(r.verdicts).toEqual([{ agent_id: "a", role: "qa", verdict: "PASS", at: 5 }]);
    expect(r.commits).toEqual([{ hash: "h1", subject: "feat: x" }]);
    expect(r.changed_files).toBe(3);
    expect(store.listRuns({ kind: "coding" })).toHaveLength(1);
    expect(store.listRuns({ kind: "research" })).toHaveLength(0);
    store.close();
  });

  it("createRun defaults to research with null worktree fields", () => {
    const store = new RunStore(":memory:");
    const rec = store.createRun({ id: "r", status: "running", prompt: "x", mode: "m", model: null, session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: "D:/x" });
    expect(rec).toMatchObject({ kind: "research", worktree_path: null, branch: null, base_sha: null, limits: null });
    store.close();
  });

  it("persists effective limits and reads them back", () => {
    const store = new RunStore(":memory:");
    store.createRun({ id: "r", status: "running", prompt: "x", mode: "m", model: null, session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: "D:/x" });
    const limits = { maxTurns: 40, maxBudgetUsd: 3, maxRoleCalls: 22, callTimeoutMinutes: 20 };
    store.updateRun("r", { limits });
    expect(store.getRun("r")!.limits).toEqual(limits);
    store.close();
  });

  it("migrates an old DB without limits_json: limits is null", () => {
    const file = legacyDb();
    const store = new RunStore(file);
    expect(store.getRun("r1")!.limits).toBeNull();
    store.updateRun("r1", { limits: { maxTurns: 1, maxBudgetUsd: 1, maxRoleCalls: null, callTimeoutMinutes: null } });
    expect(store.getRun("r1")!.limits).toMatchObject({ maxTurns: 1 });
    store.close();
  });

  const rawRow = (file: string, sql: string, ...args: string[]) => {
    const db = new DatabaseSync(file);
    try {
      return db.prepare(sql).get(...args) as Record<string, unknown>;
    } finally {
      db.close();
    }
  };

  it("migrates an old DB without merge_precheck_json: merge_precheck is null and reopening is idempotent", () => {
    const file = legacyDb();
    const store = new RunStore(file);
    expect(store.getRun("r1")!.merge_precheck).toBeNull();
    store.close();
    const chk = new DatabaseSync(file);
    const cols = (chk.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
    chk.close();
    expect(cols).toContain("merge_precheck_json");
    const again = new RunStore(file);
    expect(again.getRun("r2")!.merge_precheck).toBeNull();
    again.close();
  });

  it("migrates forked_from_run_id column on legacy DB", () => {
    const file = legacyDb();
    const store = new RunStore(file);
    expect(store.getRun("r1")!.forked_from_run_id).toBeNull();
    store.close();
    const chk = new DatabaseSync(file);
    const cols = (chk.prepare("PRAGMA table_info(runs)").all() as { name: string }[]).map((c) => c.name);
    chk.close();
    expect(cols).toContain("forked_from_run_id");
  });

  it("round-trips forked_from_run_id and base_sha through createRun", () => {
    const store = new RunStore(":memory:");
    const base = { status: "done" as const, prompt: "x", mode: "m", model: null, session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: "D:/x" };
    store.createRun({ ...base, id: "f", forked_from_run_id: "run-parent", base_sha: "abc123" });
    const f = store.getRun("f")!;
    expect(f.forked_from_run_id).toBe("run-parent");
    expect(f.base_sha).toBe("abc123");
    store.createRun({ ...base, id: "g" });
    expect(store.getRun("g")!.forked_from_run_id).toBeNull();
    store.close();
  });

  it("round-trips merge_precheck through updateRun and getRun", () => {
    const store = new RunStore(":memory:");
    store.createRun({ id: "m", status: "done", prompt: "x", mode: "m", model: null, session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: "D:/x" });
    const mp = { status: "conflict" as const, files: ["a.ts", "b/c.ts"], reason: "overlap", checked_at: Date.now(), base_sha_checked: null };
    store.updateRun("m", { merge_precheck: mp });
    expect(store.getRun("m")!.merge_precheck).toEqual(mp);
    store.close();
  });

  it("returns null for corrupt merge_precheck_json without throwing", () => {
    const file = legacyDb();
    const store = new RunStore(file);
    const raw = new DatabaseSync(file);
    raw.prepare("UPDATE runs SET merge_precheck_json = ? WHERE id = ?").run("{bad", "r1");
    raw.prepare("UPDATE runs SET merge_precheck_json = ? WHERE id = ?").run('{"status":"weird","files":[],"checked_at":1}', "r2");
    raw.close();
    expect(store.getRun("r1")!.merge_precheck).toBeNull();
    expect(store.getRun("r2")!.merge_precheck).toBeNull();
    store.close();
  });

  it("resetting merge_precheck to null stores SQL NULL, not the string 'null'", () => {
    const file = legacyDb();
    const store = new RunStore(file);
    store.updateRun("r1", { merge_precheck: { status: "clean", files: [], checked_at: 5, base_sha_checked: "abc" } });
    expect(store.getRun("r1")!.merge_precheck).toMatchObject({ status: "clean" });
    store.updateRun("r1", { merge_precheck: null });
    expect(store.getRun("r1")!.merge_precheck).toBeNull();
    expect(rawRow(file, "SELECT merge_precheck_json IS NULL AS n FROM runs WHERE id = ?", "r1")["n"]).toBe(1);
    store.close();
  });
});
