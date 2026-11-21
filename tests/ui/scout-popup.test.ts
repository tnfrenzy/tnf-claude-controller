import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("ScoutPopup", () => {
  const s = src("../../ui/src/components/queue/ScoutPopup.tsx");
  it("renders one checkbox per focus group, last ticked one cannot be unticked", () => {
    expect(s).toContain("SCOUT_FOCUS_IDS.map");
    expect(s).toContain('type="checkbox"');
    expect(s).toContain("disabled={on && focus.length === 1}");
    expect(s).toContain("saveScoutFocus");
  });
  it("starts the scout run with scout: true after a confirm", () => {
    expect(s).toMatch(/window\.confirm\(scoutConfirmText\(lang\)\)/);
    expect(s).toMatch(/api\.startRun\(\{[^\n]*buildScoutPrompt\(project\.name, lang, \{ focus, skipped: loadSkipped\(project\.name\) \}\)[^\n]*scout: true/);
  });
  it("lists this environment's scout runs with review and delete", () => {
    expect(s).toContain("project: project.name");
    expect(s).toContain("setReview(r.id)");
    expect(s).toContain("hideScoutRun(r.id)");
    expect(s).toContain("t.scout_delete_ask");
    expect(s).toContain("<ScoutReview");
  });
});

describe("HistoryPage w3d tab", () => {
  const s = src("../../ui/src/pages/HistoryPage.tsx");
  it("has the Dựng 3D history tab backed by workshop3dList", () => {
    expect(s).toContain('"all" | "queue" | "w3d"');
    expect(s).toContain('setTab("w3d")');
    expect(s).toContain("api.workshop3dList()");
    expect(s).toContain("t.hist_w3d_tab");
    expect(s).toContain("onOpenWorkshop3d?.(s.slug)");
  });
  it("i18n has the labels in vi and en", () => {
    const i = src("../../ui/src/i18n.ts");
    for (const k of ["hist_w3d_tab", "hist_w3d_empty", "hist_w3d_open"]) expect(i.split(`  ${k}:`).length - 1, k).toBe(2);
  });
});
