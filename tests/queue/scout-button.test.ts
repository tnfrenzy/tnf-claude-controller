import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("scout button", () => {
  it("LeftPanel wires the helpers and api", () => {
    const l = src("../../ui/src/components/LeftPanel.tsx");
    expect(l).toContain("canScout");
    expect(l).toContain("ScoutPopup");
    const s = src("../../ui/src/components/queue/ScoutPopup.tsx");
    for (const k of ["canScout", "buildScoutPrompt", "scoutConfirmText", "api.startRun"]) expect(s).toContain(k);
  });
  it("ScoutPopup opens ScoutReview when the scout run is done", () => {
    const s = src("../../ui/src/components/queue/ScoutPopup.tsx");
    for (const k of ["ScoutReview", "api.getRun", "isScoutPrompt", "scoutReview_reopen"]) expect(s).toContain(k);
  });
  it("HistoryPage no longer hosts the scout review", () => {
    const s = src("../../ui/src/pages/HistoryPage.tsx");
    for (const k of ["ScoutReview", "isScoutPrompt", "scoutReview_reopen"]) expect(s).not.toContain(k);
  });
  it("isScoutPrompt recognises both languages", async () => {
    const m = await import("../../ui/src/queue/scoutAgent");
    expect(m.isScoutPrompt(m.buildScoutPrompt("x", "vi"))).toBe(true);
    expect(m.isScoutPrompt(m.buildScoutPrompt("x", "en"))).toBe(true);
    expect(m.isScoutPrompt("hello")).toBe(false);
  });
  it("i18n has the keys in vi and en", () => {
    const s = src("../../ui/src/i18n.ts");
    for (const k of ["env_scout", "env_scout_busy", "env_scout_tip", "env_scout_need_repo"]) {
      expect(s.split(`  ${k}:`).length - 1).toBe(2);
    }
  });
  it("scout passes focus groups and skipped proposals to the prompt", () => {
    const s = src("../../ui/src/components/queue/ScoutPopup.tsx");
    expect(s).toMatch(/buildScoutPrompt\(project\.name, lang, \{ focus, skipped: loadSkipped\(project\.name\) \}\)/);
    expect(s).toContain("SCOUT_FOCUS_IDS.map");
    expect(s).toContain("disabled={on && focus.length === 1}"); // last ticked group cannot be unticked
  });
  it("focus i18n keys exist in vi and en for all 4 groups", () => {
    const s = src("../../ui/src/i18n.ts");
    for (const k of ["scoutFocus_title", "scoutFocus_feature", "scoutFocus_security", "scoutFocus_agents", "scoutFocus_ui"]) {
      expect(s.split(`  ${k}:`).length - 1, k).toBe(2);
    }
  });
  it("loadScoutFocus defaults to all 4 groups without storage", async () => {
    const { SCOUT_FOCUS_IDS } = await import("../../ui/src/queue/scoutAgent");
    const { loadScoutFocus } = await import("../../ui/src/lib/prefs");
    expect(loadScoutFocus()).toEqual([...SCOUT_FOCUS_IDS]);
  });
  it("loadScoutFocus drops unknown values and maps empty to all", async () => {
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    };
    try {
      const { loadScoutFocus, saveScoutFocus } = await import("../../ui/src/lib/prefs");
      store.set("tnf.scoutFocus", JSON.stringify(["security", "bogus", "ui"]));
      expect(loadScoutFocus()).toEqual(["security", "ui"]);
      store.set("tnf.scoutFocus", JSON.stringify(["bogus"]));
      expect(loadScoutFocus()).toHaveLength(4);
      saveScoutFocus(["agents"]);
      expect(loadScoutFocus()).toEqual(["agents"]);
    } finally {
      delete (globalThis as { localStorage?: unknown }).localStorage;
    }
  });
  it("EnvRow lays out name, agent chips, then icon buttons", () => {
    const s = src("../../ui/src/components/LeftPanel.tsx");
    const body = s.slice(s.indexOf("function EnvRow"));
    const a = body.indexOf("{project.name}</div>");
    const b = body.indexOf('className="steps"');
    const c = body.indexOf('className="env-actions env-icons"');
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    const actions = body.slice(c, body.indexOf("</div>", c));
    expect(actions.match(/className="icon-btn"/g)?.length).toBeGreaterThanOrEqual(4);
    for (const k of ["t.env_run_tip", "t.queue_title", "t.env_scout", "t.floor_delete"]) expect(actions).toContain(k);
    expect(actions).toContain("title=");
    expect(actions).toContain("aria-label=");
  });
});
