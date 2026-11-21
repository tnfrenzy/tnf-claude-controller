import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { RunStore, quotaDelta } from "../../src/core/run/run-store.js";

const base = { status: "running" as const, prompt: "x", mode: "m", model: null, session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: "D:/x" };

describe("quota delta", () => {
  it("computes deltas", () => {
    expect(quotaDelta(5, 8)).toBe(3);
    expect(quotaDelta(8, 2)).toBe(2);
    expect(quotaDelta(null, 3)).toBe(0);
    expect(quotaDelta(6, 6)).toBe(0);
  });

  it("stores weekly quota and derives quota7_pct", () => {
    const store = new RunStore(":memory:");
    store.createRun({ id: "w", ...base });
    store.updateRun("w", { quota7_start: 18, quota7_end: 20 });
    const r = store.getRun("w")!;
    expect(r.quota7_pct).toBe(2);
    expect(r.quota7_start).toBe(18);
    store.close();
  });

  it("latestRateLimitEvent restores the newest rate.limit event", () => {
    const store = new RunStore(":memory:");
    expect(store.latestRateLimitEvent()).toBeNull();
    store.createRun({ id: "e", ...base });
    const rl = (p: number) => ({ type: "rate.limit" as const, status: "allowed", five_hour_pct: p, seven_day_pct: null, five_hour_resets_at: null, seven_day_resets_at: null, using_overage: false });
    store.appendEvent("e", rl(5));
    const second = store.appendEvent("e", rl(7));
    store.appendEvent("e", { type: "run.error", message: "x" } as never);
    const got = store.latestRateLimitEvent()!;
    expect(got.five_hour_pct).toBe(7);
    expect(got.observed_at).toBe(second.ts);
    store.close();
  });

  it("opens an old DB without weekly columns", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-quota-"));
    const file = path.join(dir, "controller.db");
    const db = new DatabaseSync(file);
    db.exec(
      `CREATE TABLE runs (id TEXT PRIMARY KEY, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, status TEXT NOT NULL, prompt TEXT NOT NULL, mode TEXT NOT NULL, model TEXT, session_id TEXT, parent_run_id TEXT, claude_version TEXT, run_dir TEXT NOT NULL, cost_usd_est REAL DEFAULT 0, usage_json TEXT DEFAULT '{}', agents_json TEXT DEFAULT '[]', num_turns INTEGER, duration_ms INTEGER, result_text TEXT, error TEXT, quota_start REAL, quota_end REAL)`,
    );
    db.prepare("INSERT INTO runs (id, created_at, updated_at, status, prompt, mode, run_dir) VALUES ('old', 1, 1, 'done', 'p', 'm', 'D:/x')").run();
    db.close();
    const store = new RunStore(file);
    const r = store.getRun("old")!;
    expect(r.quota7_start).toBeNull();
    expect(r.quota7_pct).toBe(0);
    store.close();
    fs.rmSync(dir, { recursive: true, force: true });
  });
});
