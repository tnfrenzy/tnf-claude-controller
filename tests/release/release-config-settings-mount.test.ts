import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../ui/src/${p}`, import.meta.url), "utf8");

describe("ReleaseConfigSection mount in SettingsPanel", () => {
  const src = read("pages/SettingsPanel.tsx");
  it("imports and renders the section with status?.release", () => {
    expect(src).toContain('import { ReleaseConfigSection } from "../components/settings/ReleaseConfigSection"');
    expect(src).toMatch(/<ReleaseConfigSection[^>]*release=\{status\?\.release\}/);
  });
  it("sits between the notify block and the cost note", () => {
    const notify = src.indexOf("t.notify_denied");
    const section = src.indexOf("<ReleaseConfigSection");
    const cost = src.indexOf("t.cost_note");
    expect(notify).toBeGreaterThan(0);
    expect(section).toBeGreaterThan(notify);
    expect(cost).toBeGreaterThan(section);
  });
});

describe("ReleaseConfigSection static structure and CSS", () => {
  const comp = read("components/settings/ReleaseConfigSection.tsx");
  const css = read("styles.css");
  it("uses the pure helpers and REST api", () => {
    for (const name of ["applyTemplate", "toggleStep", "setStepField", "validateForm", "canRunReal", "needsCancelWarning"]) {
      expect(comp).toContain(name);
    }
    expect(comp).not.toContain("WebSocket");
  });
  it("every relcfg class used by the component has a CSS rule", () => {
    const used = new Set<string>();
    for (const m of comp.matchAll(/relcfg-[a-z-]+/g)) used.add(m[0]);
    expect(used.size).toBeGreaterThan(5);
    for (const cls of used) expect(css, cls).toContain(`.${cls}`);
  });
  it("has overflow guards and a wide-screen rule", () => {
    expect(css).toMatch(/\.relcfg-cmd[^}]*overflow-x: auto/);
    expect(css).toMatch(/\.relcfg-log[^}]*word-break/);
    expect(css).toMatch(/@media \(min-width: 1280px\)[^@]*\.relcfg-steps/);
  });
});
