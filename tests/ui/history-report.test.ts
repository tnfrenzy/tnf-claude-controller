import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const src = readFileSync(new URL("../../ui/src/pages/HistoryPage.tsx", import.meta.url), "utf8");

describe("HistoryPage report button", () => {
  it("no longer uses the grid2 layout", () => {
    expect(src).not.toMatch(/grid2/);
  });
  it("has an icon report button with aria-label opening a modal", () => {
    expect(src).toMatch(/aria-label=\{t\.history_report\}/);
    expect(src).toMatch(/<Modal title=\{t\.history_report_title\}/);
    expect(src).toMatch(/t\.cost_note/);
  });
  it("mounts UsageBlocksPanel in the report modal above the daily table", () => {
    expect(src).toMatch(/import \{ UsageBlocksPanel \} from "..\/components\/settings\/UsageBlocksPanel"/);
    const open = src.indexOf("reportOpen &&");
    const panel = src.indexOf("<UsageBlocksPanel", open);
    const table = src.indexOf("<table", open);
    expect(panel).toBeGreaterThan(open);
    expect(panel).toBeLessThan(table);
  });
  it("scout review moved out of HistoryPage into ScoutPopup", () => {
    expect(src).not.toContain("scoutRuns");
    expect(src).not.toContain("ScoutReview");
  });
});
