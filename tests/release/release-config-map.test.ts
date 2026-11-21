import { describe, expect, it } from "vitest";
import { applyTemplate, setStepField, toggleStep } from "../../ui/src/settings/releaseConfigForm.js";
import { configToForm, formToConfig } from "../../ui/src/settings/releaseConfigMap.js";
import { dicts } from "../../ui/src/i18n.js";

const tpl = {
  template: "web-vps",
  steps: [
    { type: "bump" },
    { type: "git-push", remote: "origin" },
    { type: "healthcheck", url: "https://example.com/", expectStatus: 200 },
  ],
};

describe("release config map", () => {
  it("turns expectStatus string into number", () => {
    let f = applyTemplate(tpl);
    f = setStepField(f, 2, "expectStatus", "200");
    const hc = formToConfig(f).steps[2]!;
    expect(hc["expectStatus"]).toBe(200);
  });
  it("drops disabled steps", () => {
    const f = toggleStep(applyTemplate(tpl), 1, false);
    expect(formToConfig(f).steps.map((s) => s["type"])).toEqual(["bump", "healthcheck"]);
  });
  it("drops empty optional fields", () => {
    let f = applyTemplate(tpl);
    f = setStepField(f, 1, "branch", "  ");
    expect(formToConfig(f).steps[1]).toEqual({ type: "git-push", remote: "origin" });
  });
  it("configToForm falls back to template when config is empty", () => {
    expect(configToForm(null, tpl)).toEqual(applyTemplate(tpl));
    expect(configToForm({ steps: [] }, tpl)).toEqual(applyTemplate(tpl));
  });
  it("configToForm disables template steps absent from config", () => {
    const f = configToForm({ template: "web-vps", steps: [{ type: "bump" }, { type: "git-push", remote: "up" }] }, tpl);
    expect(f.steps.map((s) => s.enabled)).toEqual([true, true, false]);
    expect(f.steps[1]!.fields["remote"]).toBe("up");
  });
  it("new i18n keys exist in vi and en", () => {
    for (const k of ["relcfg_project", "relcfg_tag", "relcfg_prefix", "relcfg_script", "relcfg_expect_status", "relcfg_loading", "relcfg_saved", "relcfg_save_failed", "relcfg_no_projects", "relcfg_required_mark"]) {
      expect((dicts.vi as Record<string, string>)[k]).toBeTruthy();
      expect((dicts.en as Record<string, string>)[k]).toBeTruthy();
    }
  });
});
