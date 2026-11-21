import { describe, it, expect } from "vitest";
import fs from "node:fs";
import { dicts } from "../../ui/src/i18n";

const src = fs.readFileSync("ui/src/pages/SettingsPanel.tsx", "utf8");

describe("settings tabs", () => {
  it("renders a tablist with nine tabs", () => {
    expect(src).toContain('role="tablist"');
    expect(src).toContain('role="tab"');
    expect(src).toContain('role="tabpanel"');
    expect(src).toContain("aria-selected");
    for (const k of ["ss_tab_accounts", "ss_tab_people", "ss_tab_keys", "ss_tab_tuning", "ss_tab_phone", "ss_tab_auto", "ss_tab_release"]) expect(src).toContain(`t.${k}`);
    expect(src).toContain('useState<"accounts" | "people" | "keys" | "tuning" | "phone" | "auto" | "release" | "mcp" | "grants">("accounts")');
  });

  it("keeps common settings above tabs and cost note last", () => {
    const cad = src.indexOf("<CadToolsSection />");
    const list = src.indexOf('role="tablist"');
    const auto = src.indexOf("<AutomationPanel />");
    const rel = src.indexOf("<ReleaseConfigSection");
    const cost = src.indexOf("t.cost_note");
    expect(cad).toBeGreaterThan(-1);
    expect(cad).toBeLessThan(list);
    expect(list).toBeLessThan(auto);
    expect(rel).toBeLessThan(cost);
    expect(src.indexOf("t.notify_denied")).toBeLessThan(list);
  });

  it("has labels in vi and en", () => {
    for (const lang of ["vi", "en"] as const) {
      const d = dicts[lang] as Record<string, string>;
      for (const k of ["ss_tab_people", "ss_tab_keys", "ss_tab_tuning", "ss_tab_phone", "ss_tab_auto", "ss_tab_release"]) expect(d[k], `${lang}.${k}`).toBeTruthy();
    }
    expect((dicts.vi as Record<string, string>).ss_tab_people).toBe("Nhân Vật");
  });

  it("styles the tab bar", () => {
    expect(fs.readFileSync("ui/src/styles.css", "utf8")).toContain(".settings-tabs");
  });
});
