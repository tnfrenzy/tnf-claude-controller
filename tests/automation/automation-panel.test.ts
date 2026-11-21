import { describe, expect, it } from "vitest";
import fs from "node:fs";

describe("automation panel", () => {
  it("is mounted in settings and uses t() for visible text", () => {
    expect(fs.readFileSync("ui/src/pages/SettingsPanel.tsx", "utf8")).toContain("<AutomationPanel />");
    const src = fs.readFileSync("ui/src/pages/AutomationPanel.tsx", "utf8");
    for (const k of ["auto_title", "auto_on", "auto_schedule", "auto_webhooks", "auto_summary", "auto_dup_check"]) expect(src).toContain(`t.${k}`);
  });

  it("uses a weekly or monthly schedule picker and lists automation ideas", () => {
    const src = fs.readFileSync("ui/src/pages/AutomationPanel.tsx", "utf8");
    for (const s of ["buildSchedule", "parseScheduleForm", "t.auto_mode_weekly", "t.auto_mode_monthly", 'type="radio"', 'type="time"', "aria-pressed", "t.auto_ideas_title", "t.auto_idea_5", "autopilotSetSchedule(null)"]) expect(src).toContain(s);
    expect(src).not.toContain("setSchedule(e.target.value)");
  });
});
