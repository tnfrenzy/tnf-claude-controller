import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { renderSystemPrompt } from "../../src/core/run/run-manager.js";
import { describe, expect, it } from "vitest";
import { applyUxSkill } from "../../src/core/roles/ux-skill.js";
import { buildCodingAllowedTools } from "../../src/core/run/permissions.js";
import { CODING_MIN_ROLE_CALLS, loadConfig } from "../../src/core/app/config.js";

const CONFIG_DIR = path.resolve(__dirname, "..", "..", "config");
const coordinator = fs.readFileSync(path.join(CONFIG_DIR, "coordinator-coding.md"), "utf8");
const roles = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "roles-coding.json"), "utf8")) as Record<string, { prompt: string; description: string; tools?: string[] }>;

// Real runs 20261023-094110-8e4b09 and 20261026-103553-98d15e: the CLI stopped a single implementer call at ~590-600 s,
// losing uncommitted work. The coordinator must therefore hand the implementer short slices and keep full-suite runs for qa.
describe("coding coordinator prompt: implementer slices", () => {
  it("limits each implementer call to 1-2 tasks and says why (about 10 minutes, finish within 6)", () => {
    expect(coordinator).toMatch(/AT MOST 2 tasks per call/);
    expect(coordinator).toMatch(/about 10 minutes/);
    expect(coordinator).toMatch(/within 6 minutes/);
  });
  it("tells the coordinator to call the implementer again for the remaining tasks", () => {
    expect(coordinator).toMatch(/call implementer again/i);
    expect(coordinator).toMatch(/remaining tasks/);
  });
  it("keeps the full suite, typecheck and UI build for qa, never the implementer", () => {
    expect(coordinator).toMatch(/whole test suite/);
    expect(coordinator).toMatch(/belong to qa/);
  });
  it("still uses the {{maxRoleCalls}} placeholder and budgets for implementer slices", () => {
    expect(coordinator).toContain("{{maxRoleCalls}}");
    expect(coordinator).toMatch(/up to 4 implementer/);
  });
});

describe("coding coordinator prompt: synchronous calls and base for qa", () => {
  it("forbids background calls and ending the turn while a subagent runs", () => {
    expect(coordinator).not.toMatch(/wait for its completion notification/);
    expect(coordinator).toMatch(/never use run_in_background/);
    expect(coordinator).toMatch(/never end your turn while any subagent is still running/);
    expect(coordinator).not.toMatch(/run in the background/);
  });
  it("passes the base to qa through the baseSha placeholder", () => {
    expect(coordinator).toContain("{{baseSha}}");
    expect(coordinator).toMatch(/git diff --name-only \{\{baseSha\}\}\.\.\.HEAD/);
  });
  it("renders baseSha to a real value with no braces left", () => {
    const out = path.join(os.tmpdir(), `coord-render-${process.pid}.md`);
    try {
      const file = renderSystemPrompt(path.join(CONFIG_DIR, "coordinator-coding.md"), out, { maxRoleCalls: "20", contextBlock: "", extraAgents: "", baseSha: "abc1234def" });
      const text = fs.readFileSync(file, "utf8");
      expect(text).toContain("git diff --name-only abc1234def...HEAD");
      expect(text).not.toMatch(/\{\{/);
    } finally {
      fs.rmSync(out, { force: true });
    }
  });
});

describe("coding role prompts", () => {
  it("implementer: only its numbered tasks, targeted tests only, commit after each task", () => {
    const p = roles["implementer"]!.prompt;
    expect(p).toMatch(/at most 2 numbered tasks/);
    expect(p).toMatch(/ONLY the targeted tests/);
    expect(p).toMatch(/never the whole suite/);
    expect(p).toMatch(/commit after EACH task/);
    expect(p).toMatch(/which of your tasks are done and which remain/);
    expect(p).not.toMatch(/Example calls:[^.]*`npm test/);
  });
  it("planner: small tasks with their own targeted test command; the full suite only for the final check", () => {
    const p = roles["planner"]!.prompt;
    expect(p).toMatch(/under 3 minutes/);
    expect(p).toMatch(/targeted test command/);
    expect(p).toMatch(/never for the implementer/);
  });
  it("qa: targeted tests by default, typecheck always, UI build only for ui/ diffs, whole suite only for integration", () => {
    const p = roles["qa"]!.prompt;
    expect(p).toMatch(/git diff --name-only <base>\.\.\.HEAD/);
    expect(p).toMatch(/npx vitest run <the plan's targeted test files/);
    expect(p).toMatch(/ONLY if the diff touches `ui\/`/);
    expect(p).toMatch(/whole suite[^;]*ONLY when the task is an integration or final-review/);
  });
  it("tool lists are unchanged (no Bash for planner, qa has no Edit/Write)", () => {
    expect(roles["planner"]!.prompt).toContain("Read, Grep, Glob, Write");
    expect(roles["qa"]!.prompt).toContain("never Edit or Write");
  });
});

describe("coding maxRoleCalls", () => {
  // analyst, planner, critic, planner+critic revision (5) + up to 4 implementer slices + qa + debug + qa = 12
  it("the minimum fits the longest chain the coordinator prompt allows", () => {
    expect(CODING_MIN_ROLE_CALLS).toBe(5 + 4 + 1 + 2);
  });
  it("shipped controller.json and the built-in default are above the minimum", () => {
    const shipped = JSON.parse(fs.readFileSync(path.join(CONFIG_DIR, "controller.json"), "utf8")) as { defaults: { coding: { maxRoleCalls: number } } };
    expect(shipped.defaults.coding.maxRoleCalls).toBeGreaterThanOrEqual(CODING_MIN_ROLE_CALLS);
    expect(loadConfig().defaults.coding.maxRoleCalls).toBeGreaterThanOrEqual(CODING_MIN_ROLE_CALLS);
  });
});

describe("ui-ux-pro-max block in the implementer prompt", () => {
  const mkRepo = (withSkill: boolean): string => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), "ux-repo-"));
    if (withSkill) {
      const scripts = path.join(root, "config", "skills", "ui-ux-pro-max", "scripts");
      fs.mkdirSync(scripts, { recursive: true });
      fs.writeFileSync(path.join(scripts, "search.py"), "# fake\n", "utf8");
    }
    return root;
  };
  const roles = () => ({ implementer: { prompt: "ORIGINAL" } });

  it("UI prompt gets the absolute skill path, --persist and --output-dir", () => {
    const root = mkRepo(true);
    const runDir = path.join(root, "run");
    const r = applyUxSkill({ roles: roles(), prompt: "Thiết kế lại giao diện dashboard", skills: [], kind: "coding", repoRoot: root, runDir });
    const p = String(r.roles.implementer!["prompt"]);
    expect(r.applied).toBe(true);
    expect(p).toContain(path.join(root, "config", "skills", "ui-ux-pro-max"));
    expect(p).toMatch(/--persist/);
    expect(p).toMatch(/--output-dir/);
  });
  it("non-UI prompt keeps the original prompt string", () => {
    const root = mkRepo(true);
    const r = applyUxSkill({ roles: roles(), prompt: "fix parser bug", skills: [], kind: "coding", repoRoot: root, runDir: root });
    expect(r.roles.implementer!["prompt"]).toBe("ORIGINAL");
  });
  it("missing skill folder changes nothing", () => {
    const root = mkRepo(false);
    const r = applyUxSkill({ roles: roles(), prompt: "giao diện", skills: [], kind: "coding", repoRoot: root, runDir: root });
    expect(r.applied).toBe(false);
    expect(r.roles.implementer!["prompt"]).toBe("ORIGINAL");
  });
  it("stripped skills never reach the coding allowedTools", () => {
    const root = mkRepo(true);
    const r = applyUxSkill({ roles: roles(), prompt: "ui", skills: ["ui-ux-pro-max"], kind: "coding", repoRoot: root, runDir: root });
    const tools = buildCodingAllowedTools({ base: ["Read"], projectCommands: [], worktreePath: path.join(root, "wt"), runDir: root, skills: r.skills });
    expect(tools.join("\n")).not.toContain("ui-ux-pro-max");
  });
});
