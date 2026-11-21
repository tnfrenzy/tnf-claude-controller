import { describe, expect, it } from "vitest";
import { applyTemplate, canRunReal, needsCancelWarning, setStepField, toggleStep, validateForm } from "../../ui/src/settings/releaseConfigForm.js";

const tpl = {
  template: "web-vps",
  steps: [
    { type: "bump" },
    { type: "git-push", remote: "origin" },
    { type: "project-script", scriptPath: "scripts/deploy.sh", target: "deploy@example.com", keyPath: "keys/k", keyEnvName: "DEPLOY_KEY_PATH" },
    { type: "healthcheck", url: "https://example.com/", expectStatus: 200 },
  ],
};

describe("release config form logic", () => {
  it("applyTemplate maps steps to enabled form steps", () => {
    const f = applyTemplate(tpl);
    expect(f.steps).toHaveLength(4);
    expect(f.steps.every((s) => s.enabled)).toBe(true);
    expect(f.steps[1].fields.remote).toBe("origin");
    expect(validateForm(f)).toEqual([]);
  });

  it("toggleStep and setStepField are immutable", () => {
    const f = applyTemplate(tpl);
    const g = toggleStep(f, 0);
    expect(g.steps[0].enabled).toBe(false);
    expect(f.steps[0].enabled).toBe(true);
    expect(toggleStep(f, 0, true).steps[0].enabled).toBe(true);
    expect(toggleStep(f, 99)).toBe(f);
    const h = setStepField(f, 1, "remote", "up");
    expect(h.steps[1].fields.remote).toBe("up");
    expect(f.steps[1].fields.remote).toBe("origin");
  });

  it("validateForm rejects bad inputs", () => {
    let f = applyTemplate(tpl);
    f = setStepField(f, 2, "scriptPath", "../x.sh");
    expect(validateForm(f)[0]).toMatchObject({ step: 2, field: "scriptPath", key: "relcfg_err_script_path" });
    f = setStepField(f, 2, "scriptPath", "scripts/deploy.py");
    expect(validateForm(f)[0].key).toBe("relcfg_err_script_ext");
    f = setStepField(f, 2, "scriptPath", "scripts/deploy.sh");
    f = setStepField(f, 2, "target", "no-at-sign");
    expect(validateForm(f)[0].key).toBe("relcfg_err_target");
    f = setStepField(f, 2, "target", "deploy@example.com");
    f = setStepField(f, 2, "keyEnvName", "lower");
    expect(validateForm(f)[0].key).toBe("relcfg_err_env_name");
    f = setStepField(f, 2, "keyEnvName", "KEY_1");
    f = setStepField(f, 1, "branch", "a:b");
    expect(validateForm(f)[0].key).toBe("relcfg_err_ref");
    f = setStepField(f, 1, "branch", "main");
    f = setStepField(f, 3, "url", "ftp://x");
    expect(validateForm(f)[0].key).toBe("relcfg_err_url");
  });

  it("disabled steps are not validated", () => {
    let f = applyTemplate(tpl);
    f = setStepField(f, 2, "target", "bad");
    f = toggleStep(f, 2, false);
    expect(validateForm(f)).toEqual([]);
  });

  it("canRunReal combinations", () => {
    const f = applyTemplate(tpl);
    expect(canRunReal(f, { viaTunnel: false, allowed: false }, false)).toBe(false);
    expect(canRunReal(f, { viaTunnel: false, allowed: false }, true)).toBe(true);
    expect(canRunReal(f, { viaTunnel: true, allowed: false }, true)).toBe(false);
    expect(canRunReal(f, { viaTunnel: true, allowed: true }, true)).toBe(true);
    expect(canRunReal(f, undefined, true)).toBe(true);
    expect(canRunReal(setStepField(f, 2, "target", "x"), undefined, true)).toBe(false);
    const none = { ...f, steps: f.steps.map((s) => ({ ...s, enabled: false })) };
    expect(canRunReal(none, undefined, true)).toBe(false);
  });

  it("needsCancelWarning only for project-script before acknowledgement", () => {
    expect(needsCancelWarning("project-script", false)).toBe(true);
    expect(needsCancelWarning("project-script", true)).toBe(false);
    expect(needsCancelWarning("build", false)).toBe(false);
    expect(needsCancelWarning(undefined, false)).toBe(false);
  });
});
