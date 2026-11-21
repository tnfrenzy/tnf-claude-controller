import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";

const dirs: string[] = [];
const stores: RunStore[] = [];
const raws: DatabaseSync[] = [];

afterEach(() => {
  for (const s of stores.splice(0)) {
    try { s.close(); } catch { /* already closed */ }
  }
  for (const d of raws.splice(0)) {
    try { d.close(); } catch { /* already closed */ }
  }
  for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-quota-"));
  dirs.push(dir);
  return path.join(dir, "controller.db");
}

function open(file: string): RunStore {
  const s = new RunStore(file);
  stores.push(s);
  return s;
}

const base = { project: "alpha", kind: "run" as const, scope: null, attempt: 1, status: "pending" as const, reason: "quota" };

describe("RunStore quota_resumes", () => {
  it("upserts, reads back and persists across close/reopen", () => {
    const file = tmpFile();
    const a = open(file);
    const rec = a.upsertQuotaResume({ ...base, run_id: "r1", resume_at: 5000 });
    expect(rec).toMatchObject({ run_id: "r1", project: "alpha", kind: "run", scope: null, resume_at: 5000, attempt: 1, status: "pending", reason: "quota" });
    expect(rec.updated_at).toBeGreaterThanOrEqual(rec.created_at);
    a.close();
    const b = open(file);
    expect(b.getQuotaResume("r1")).toMatchObject({ run_id: "r1", resume_at: 5000, scope: null });
    expect(b.getQuotaResume("nope")).toBeNull();
  });

  it("upsert on the same run_id updates the row instead of duplicating", () => {
    const s = open(tmpFile());
    s.upsertQuotaResume({ ...base, run_id: "r1", resume_at: 5000 });
    s.upsertQuotaResume({ ...base, run_id: "r1", resume_at: 9000, attempt: 2, scope: "idea-1", kind: "queue" });
    const all = s.listQuotaResumes();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ resume_at: 9000, attempt: 2, scope: "idea-1", kind: "queue" });
  });

  it("filters by status and orders by resume_at", () => {
    const s = open(tmpFile());
    s.upsertQuotaResume({ ...base, run_id: "late", resume_at: 9000 });
    s.upsertQuotaResume({ ...base, run_id: "early", resume_at: 1000 });
    s.upsertQuotaResume({ ...base, run_id: "done", resume_at: 500, status: "fired" });
    expect(s.listQuotaResumes("pending").map((r) => r.run_id)).toEqual(["early", "late"]);
    expect(s.listQuotaResumes("fired").map((r) => r.run_id)).toEqual(["done"]);
    expect(s.listQuotaResumes("cancelled")).toEqual([]);
    expect(s.listQuotaResumes()).toHaveLength(3);
  });

  it("setQuotaResumeStatus changes status, keeps or replaces reason, and returns false for a missing row", () => {
    const s = open(tmpFile());
    s.upsertQuotaResume({ ...base, run_id: "r1", resume_at: 5000 });
    expect(s.setQuotaResumeStatus("r1", "fired")).toBe(true);
    expect(s.getQuotaResume("r1")).toMatchObject({ status: "fired", reason: "quota" });
    expect(s.setQuotaResumeStatus("r1", "failed", "boom")).toBe(true);
    const r = s.getQuotaResume("r1")!;
    expect(r).toMatchObject({ status: "failed", reason: "boom" });
    expect(r.updated_at).toBeGreaterThanOrEqual(r.created_at);
    expect(s.setQuotaResumeStatus("missing", "cancelled")).toBe(false);
  });

  it("opens an old DB without the quota_resumes table", () => {
    const file = tmpFile();
    const db = new DatabaseSync(file);
    raws.push(db);
    db.exec(`CREATE TABLE runs (
    id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL,
    mode TEXT NOT NULL, model TEXT, session_id TEXT, parent_run_id TEXT, claude_version TEXT, cost_usd_est REAL NOT NULL DEFAULT 0,
    usage_json TEXT NOT NULL DEFAULT '{}', num_turns INTEGER NOT NULL DEFAULT 0, duration_ms INTEGER NOT NULL DEFAULT 0,
    result_text TEXT, error TEXT, run_dir TEXT NOT NULL, agents_json TEXT NOT NULL DEFAULT '[]', project TEXT NOT NULL DEFAULT 'default');`);
    db.close();
    const s = open(file);
    expect(s.listQuotaResumes()).toEqual([]);
    s.upsertQuotaResume({ ...base, run_id: "r1", resume_at: 1 });
    expect(s.getQuotaResume("r1")).not.toBeNull();
  });
});
