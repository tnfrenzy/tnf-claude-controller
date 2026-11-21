import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RunStore } from "../../src/core/run/run-store.js";
import { loadAppSettings, saveAppSettings } from "../../src/core/app/app-settings.js";
import { DEFAULT_GRANTS } from "../../src/core/run/grants.js";

describe("project grants", () => {
  it("round-trips and null means 'use default'", () => {
    const s = new RunStore(":memory:");
    s.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(s.getProjectGrants("p")).toBeNull();
    s.setProjectGrants("p", { ...DEFAULT_GRANTS, web: false });
    expect(s.getProjectGrants("p")?.web).toBe(false);
    s.setProjectGrants("p", null);
    expect(s.getProjectGrants("p")).toBeNull();
  });
  it("upsertProject keeps existing grants", () => {
    const s = new RunStore(":memory:");
    s.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: [] });
    s.setProjectGrants("p", { ...DEFAULT_GRANTS, cmdNode: false });
    s.upsertProject({ name: "p", repo_path: null, base_branch: null, allowed_commands: ["Bash(x*)"] });
    expect(s.getProjectGrants("p")?.cmdNode).toBe(false);
  });
});

describe("app settings: outputDir + defaultGrants", () => {
  it("persists and sanitizes", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-as-"));
    saveAppSettings(dir, { outputDir: "D:\\Out", defaultGrants: { ...DEFAULT_GRANTS, web: false } });
    const s = loadAppSettings(dir);
    expect(s.outputDir).toBe("D:\\Out");
    expect(s.defaultGrants?.web).toBe(false);
  });
});
