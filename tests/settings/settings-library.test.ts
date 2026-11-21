import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const read = (p: string) => readFileSync(new URL(`../../ui/src/${p}`, import.meta.url), "utf8");

describe("settings opens library", () => {
  it("SettingsPanel has a button opening the library popup", () => {
    const src = read("pages/SettingsPanel.tsx");
    expect(src).toContain('onOpen?.("library")');
    expect(src).toContain("t.nav_library");
  });
  it("App passes onOpen to SettingsPanel and keeps the library popup", () => {
    const src = read("App.tsx");
    expect(src).toMatch(/<SettingsPanel[^>]*onOpen=/);
    expect(src).toContain('open === "library"');
  });
});

describe("settings avatar picker lists library roles", () => {
  it("merges library roles via roleChoices with fallbacks", () => {
    const src = read("pages/SettingsPanel.tsx");
    expect(src).toContain("useLibrary");
    expect(src).toContain("roleChoices");
    expect(src).toContain("lib?.builtinRoles ?? []");
    expect(src).toContain("lib?.roles ?? []");
    expect(src).toContain("DEFAULT_ROLES");
    expect(src).toContain("role_models_coding");
  });
});
