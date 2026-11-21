import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n";

const src = readFileSync("ui/src/components/settings/CleanupSection.tsx", "utf8");

describe("CleanupSection source", () => {
  it("locks key strings", () => {
    for (const s of ["previewCleanup", "runCleanup", "nextConfirmStep", "cleanup_bulk_confirm1", "cleanup_bulk_confirm2", "cleanup_bulk_yes2", "confirm: true", "olderThan: previewDays", "ApiError", "useState<boolean>", "disabled={busy"]) {
      expect(src).toContain(s);
    }
  });
  it("is mounted in SettingsPanel after CadToolsSection and before tablist", () => {
    const panel = readFileSync("ui/src/pages/SettingsPanel.tsx", "utf8");
    const cad = panel.indexOf("<CadToolsSection />");
    const clean = panel.indexOf("<CleanupSection />");
    const tabs = panel.indexOf('role="tablist"');
    expect(cad).toBeGreaterThan(0);
    expect(clean).toBeGreaterThan(cad);
    expect(tabs).toBeGreaterThan(clean);
  });
  it("every cleanup_ key used exists in vi and en", () => {
    const keys = new Set(src.match(/t\.(cleanup_[a-z0-9_]+)/g)?.map((m) => m.slice(2)) ?? []);
    expect(keys.size).toBeGreaterThan(5);
    for (const k of keys) {
      expect(k in dicts.vi, k).toBe(true);
      expect(k in dicts.en, k).toBe(true);
    }
  });
});
