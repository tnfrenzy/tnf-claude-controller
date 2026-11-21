import { describe, expect, it } from "vitest";
import { applyTuning, currentTuning, sanitizeTuning, validateTuning } from "../../src/core/app/app-settings.js";
import { DEFAULT_IDEA_AGENTS, ideaAgentsOf, loadConfig, parseQueue } from "../../src/core/app/config.js";

describe("idea quality settings", () => {
  it("interviewer and critic default to opus with budgets 2 and 3 USD", () => {
    expect(DEFAULT_IDEA_AGENTS.interviewModel).toBe("opus");
    expect(DEFAULT_IDEA_AGENTS.criticModel).toBe("opus");
    expect(DEFAULT_IDEA_AGENTS.interviewBudgetUsd).toBe(2);
    expect(DEFAULT_IDEA_AGENTS.criticBudgetUsd).toBe(3);
    expect(DEFAULT_IDEA_AGENTS.splitterModel).toBe("opus");
    expect(ideaAgentsOf({}).criticModel).toBe("opus");
  });

  it("queue.splitter interview/critic/autoIntegrate and queue.lessons default on, false turns them off", () => {
    const d = parseQueue({});
    expect(d.splitter.interview).toBe(true);
    expect(d.splitter.critic).toBe(true);
    expect(d.splitter.autoIntegrate).toBe(true);
    expect(d.lessons).toEqual({ enabled: true });
    const off = parseQueue({ splitter: { interview: false, critic: false, autoIntegrate: false }, lessons: { enabled: false } });
    expect(off.splitter.interview).toBe(false);
    expect(off.splitter.critic).toBe(false);
    expect(off.splitter.autoIntegrate).toBe(false);
    expect(off.lessons).toEqual({ enabled: false });
  });

  it("tuning exposes the new models, budgets and switches; validates and applies them", () => {
    const cfg = loadConfig();
    const cur = currentTuning(cfg);
    expect(cur.interviewModel).toBe(ideaAgentsOf(cfg).interviewModel);
    expect(cur.criticModel).toBe(ideaAgentsOf(cfg).criticModel);
    expect(cur.splitterInterview).toBe(true);
    expect(cur.splitterCritic).toBe(true);
    expect(cur.splitterAutoIntegrate).toBe(true);
    expect(cur.queueLessons).toBe(true);
    expect(validateTuning({ criticModel: "nope" }, cfg).ok).toBe(false);
    expect(validateTuning({ interviewBudgetUsd: 0 }, cfg).ok).toBe(false);
    const ok = validateTuning({ interviewModel: "sonnet", criticModel: "sonnet", interviewBudgetUsd: 1, criticBudgetUsd: 1.5, splitterInterview: false, splitterCritic: false, splitterAutoIntegrate: false, queueLessons: false }, cfg);
    if (!ok.ok) throw new Error(ok.message);
    applyTuning(cfg, ok.patch);
    const ia = ideaAgentsOf(cfg);
    expect([ia.interviewModel, ia.criticModel, ia.interviewBudgetUsd, ia.criticBudgetUsd]).toEqual(["sonnet", "sonnet", 1, 1.5]);
    expect(cfg.queue.splitter.interview).toBe(false);
    expect(cfg.queue.splitter.critic).toBe(false);
    expect(cfg.queue.splitter.autoIntegrate).toBe(false);
    expect(cfg.queue.lessons?.enabled).toBe(false);
    expect(sanitizeTuning({ interviewModel: "sonnet", splitterCritic: true, criticBudgetUsd: 2 })).toEqual({ interviewModel: "sonnet", splitterCritic: true, criticBudgetUsd: 2 });
  });
});

describe("idea quality settings UI", () => {
  it("Điều chỉnh tab has the interviewer/critic models and switches, labelled in vi and en", async () => {
    const fs = await import("node:fs");
    const path = await import("node:path");
    const src = fs.readFileSync(path.resolve(__dirname, "..", "..", "ui", "src", "components", "settings", "TuningSection.tsx"), "utf8");
    for (const k of ["interviewModel", "criticModel", "interviewBudgetUsd", "criticBudgetUsd", "splitterInterview", "splitterCritic", "splitterAutoIntegrate", "queueLessons"]) {
      expect(src).toContain(`"${k}"`);
    }
    const { dicts } = await import("../../ui/src/i18n.js");
    for (const lang of ["vi", "en"] as const) {
      expect(dicts[lang].tn_interview_model).toMatch(/idea-interviewer/);
      expect(dicts[lang].tn_critic_model).toMatch(/idea-critic/);
      expect(dicts[lang].tn_idea_model_note).toMatch(/idea-splitter/);
    }
  });
});
