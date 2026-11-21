import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { RunStore } from "../../src/core/run/run-store.js";
import { loadConfig, parseDailyCostWarn } from "../../src/core/app/config.js";

let seq = 0;
function add(store: RunStore, kind: "coding" | "research", status: "done" | "error", cost: number | null) {
  const id = `r${++seq}`;
  store.createRun({ id, status: "running", prompt: "x", mode: "m", model: null, session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: "D:/x", kind });
  store.updateRun(id, { status, ...(cost === null ? {} : { cost_usd_est: cost }) });
}

describe("codingCostStats", () => {
  it("empty db gives n=0", () => {
    expect(new RunStore(":memory:").codingCostStats()).toEqual({ n: 0, median: 0, max: 0 });
  });
  it("median of odd and even counts", () => {
    const s = new RunStore(":memory:");
    for (const c of [3, 1, 2]) add(s, "coding", "done", c);
    expect(s.codingCostStats()).toEqual({ n: 3, median: 2, max: 3 });
    add(s, "coding", "done", 10);
    expect(s.codingCostStats()).toEqual({ n: 4, median: 2.5, max: 10 });
  });
  it("ignores research, error, null and zero cost", () => {
    const s = new RunStore(":memory:");
    add(s, "coding", "done", 1);
    add(s, "research", "done", 9);
    add(s, "coding", "error", 9);
    add(s, "coding", "done", null);
    add(s, "coding", "done", 0);
    expect(s.codingCostStats()).toEqual({ n: 1, median: 1, max: 1 });
  });
});

describe("parseDailyCostWarn", () => {
  it("accepts positive numbers only", () => {
    expect(parseDailyCostWarn(5)).toBe(5);
    expect(parseDailyCostWarn(0.01)).toBe(0.01);
    expect(parseDailyCostWarn(undefined)).toBeNull();
    expect(parseDailyCostWarn(-1)).toBeNull();
    expect(parseDailyCostWarn(0)).toBeNull();
    expect(parseDailyCostWarn("5")).toBeNull();
  });
  it("is wired into loadConfig", () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-cost-"));
    fs.mkdirSync(path.join(root, "config"));
    const file = path.join(root, "config", "controller.json");
    try {
      fs.writeFileSync(file, JSON.stringify({ ui: { dailyCostWarnUsd: 3 } }));
      expect(loadConfig(file).ui.dailyCostWarnUsd).toBe(3);
      fs.writeFileSync(file, JSON.stringify({}));
      expect(loadConfig(file).ui.dailyCostWarnUsd).toBeNull();
    } finally {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
});
