import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";

const settings = readFileSync("ui/src/pages/SettingsPanel.tsx", "utf8");
const section = readFileSync("ui/src/components/settings/CadToolsSection.tsx", "utf8");
const pkg = readFileSync("scripts/package.ts", "utf8");

describe("CAD tools wired into the app", () => {
  it("Settings shows the CAD status block, fed by GET /api/cad/status", () => {
    expect(settings).toContain("<CadToolsSection />");
    expect(section).toContain("api.cadStatus()");
    expect(section).toContain('data-testid="cad-tools"');
  });
  it("every CAD label exists in Vietnamese and English", () => {
    for (const k of ["cad_title", "cad_ready", "cad_missing", "cad_check", "cad_checking", "cad_note"] as const) {
      expect(dicts.vi[k], k).toBeTruthy();
      expect(dicts.en[k], k).toBeTruthy();
    }
  });
  it("the Python scripts ship with the installed app", () => {
    expect(pkg).toContain('path.join(ROOT, "tools", "cad")');
    for (const f of ["check_env.py", "dxf_info.py", "step_info.py"]) expect(readFileSync(`tools/cad/${f}`, "utf8").length).toBeGreaterThan(100);
  });
});
