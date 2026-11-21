import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { applyTuning, currentTuning, loadAppSettings, saveAppSettings, validateTuning } from "../../src/core/app/app-settings.js";
import { ideaAgentsOf, loadConfig } from "../../src/core/app/config.js";

describe("tuning settings", () => {
  it("validates cross-field budgets and models", () => {
    const cfg = loadConfig();
    expect(validateTuning({ scoutBudgetUsd: 2 }, cfg).ok).toBe(true);
    expect(validateTuning({ scoutBudgetUsd: 50 }, cfg).ok).toBe(false);
    expect(validateTuning({ maxBudgetUsdCeiling: 60, scoutBudgetUsd: 50 }, cfg).ok).toBe(true);
    expect(validateTuning({ scoutModel: "nope" }, cfg).ok).toBe(false);
    expect(validateTuning({ bogus: 1 }, cfg).ok).toBe(false);
    expect(validateTuning({ dailyCostWarnUsd: null, queueMaxBudgetUsd: null }, cfg).ok).toBe(true);
    expect(validateTuning({ dailyCostWarnUsd: -1 }, cfg).ok).toBe(false);
  });
  it("applies live and persists across load", () => {
    const cfg = loadConfig();
    const check = validateTuning({ scoutBudgetUsd: 3, splitterModel: "sonnet", queueMaxBudgetUsd: null, replanEnabled: true }, cfg);
    if (!check.ok) throw new Error(check.message);
    applyTuning(cfg, check.patch);
    expect(ideaAgentsOf(cfg).scoutBudgetUsd).toBe(3);
    expect(ideaAgentsOf(cfg).splitterModel).toBe("sonnet");
    expect(cfg.queue.maxBudgetUsd).toBeNull();
    expect(currentTuning(cfg).replanEnabled).toBe(true);
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-tn-"));
    saveAppSettings(d, { tuning: check.patch });
    saveAppSettings(d, { tuning: { scoutBudgetUsd: 4 } });
    expect(loadAppSettings(d).tuning).toMatchObject({ scoutBudgetUsd: 4, splitterModel: "sonnet", queueMaxBudgetUsd: null });
  });
  it("scope guard settings validate and apply", () => {
    const cfg = loadConfig();
    const ok = validateTuning({ scopeGuardEnabled: false, scopeModel: "haiku", scopeBudgetUsd: 0.2 }, cfg);
    if (!ok.ok) throw new Error(ok.message);
    applyTuning(cfg, ok.patch);
    expect(cfg.queue.scopeGuard?.enabled).toBe(false);
    expect(ideaAgentsOf(cfg).scopeModel).toBe("haiku");
    expect(validateTuning({ scopeBudgetUsd: 0 }, cfg).ok).toBe(false);
  });
});
