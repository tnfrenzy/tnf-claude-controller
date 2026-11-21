import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dicts } from "../../ui/src/i18n.js";

const read = (p: string) => readFileSync(new URL(p, import.meta.url), "utf8");

describe("environment rows open the command popup for their own environment", () => {
  const src = read("../../ui/src/components/LeftPanel.tsx");
  it("the top quick-command box (default environment) sits next to the per-environment run buttons", () => {
    expect(src).toContain("const submit =");
    expect(src).toContain('onOpen("cmd", { projectName: "default"');
    expect(src).toContain("ss_pick_roles");
    expect(src).toContain("rolesOpen: true");
  });
  it("EnvRow run button opens cmd with its own projectName", () => {
    expect(src).toContain('onOpen("cmd", { projectName: project.name })');
    expect(src).toContain("t.env_run_tip");
  });
  it("CommandPage accepts initialRolesOpen and App forwards it", () => {
    expect(read("../../ui/src/pages/CommandPage.tsx")).toContain("initialRolesOpen");
    expect(read("../../ui/src/App.tsx")).toContain("initialRolesOpen");
  });
  it("i18n labels exist in vi and en", () => {
    expect((dicts.vi as Record<string, string>).ss_pick_roles).toBe("Chọn vai");
    expect((dicts.en as Record<string, string>).ss_pick_roles).toBeTruthy();
    expect((dicts.vi as Record<string, string>).env_run_tip).toBeTruthy();
    expect((dicts.en as Record<string, string>).env_run_tip).toBeTruthy();
  });
});
