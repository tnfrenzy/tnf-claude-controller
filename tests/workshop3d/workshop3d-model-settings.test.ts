import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { loadAppSettings, saveAppSettings } from "../../src/core/app/app-settings.js";
import { loadConfig } from "../../src/core/app/config.js";
import { pickW3DModel, sanitizeW3DModels, validateW3DModels, w3dModelGroup } from "../../src/core/workshop3d/model-settings.js";
import { loadW3DRoles } from "../../src/core/workshop3d/roles.js";
import { createW3DRunStep, type W3DStepManager } from "../../src/core/workshop3d/step-adapter.js";

const IDS = ["haiku", "sonnet", "opus", "claude-fable-5-2"];

describe("workshop3d model settings", () => {
  it("groups roles by their file model", () => {
    expect(w3dModelGroup("haiku")).toBe("light");
    expect(w3dModelGroup("sonnet")).toBe("main");
    expect(w3dModelGroup(undefined)).toBe("main");
    const roles = loadW3DRoles();
    const light = Object.entries(roles).filter(([, d]) => w3dModelGroup(d.model) === "light").map(([k]) => k).sort();
    expect(light).toEqual(["render-director", "render-presenter"]);
  });

  it("prefers the setting of the role's group, else keeps the file model", () => {
    expect(pickW3DModel("sonnet", undefined, IDS)).toBe("sonnet");
    expect(pickW3DModel("sonnet", {}, IDS)).toBe("sonnet");
    expect(pickW3DModel("sonnet", { main: "claude-fable-5-2" }, IDS)).toBe("claude-fable-5-2");
    expect(pickW3DModel("haiku", { main: "claude-fable-5-2" }, IDS)).toBe("haiku");
    expect(pickW3DModel("haiku", { light: "sonnet" }, IDS)).toBe("sonnet");
    expect(pickW3DModel("sonnet", { light: "sonnet" }, IDS)).toBe("sonnet");
    // A saved id no longer in controller.json models is ignored.
    expect(pickW3DModel("sonnet", { main: "gpt-x" }, IDS)).toBe("sonnet");
  });

  it("validates PUT bodies against the app model list", () => {
    expect(validateW3DModels({ main: "opus", light: "" }, IDS)).toEqual({ ok: true, models: { main: "opus" } });
    expect(validateW3DModels({ main: null }, IDS)).toEqual({ ok: true, models: {} });
    expect(validateW3DModels({}, IDS)).toEqual({ ok: true, models: {} });
    const bad = validateW3DModels({ main: "gpt-x" }, IDS);
    expect(bad.ok).toBe(false);
    if (!bad.ok) expect(bad.message).toMatch(/vai chính.*không có trong danh sách model/);
    const badLight = validateW3DModels({ light: 3 }, IDS);
    expect(badLight.ok).toBe(false);
    if (!badLight.ok) expect(badLight.message).toMatch(/vai nhẹ/);
    expect(validateW3DModels({ bogus: "opus" }, IDS).ok).toBe(false);
    expect(validateW3DModels([], IDS).ok).toBe(false);
    expect(validateW3DModels(null, IDS).ok).toBe(false);
  });

  it("accepts every model of the shipped controller.json", () => {
    const ids = loadConfig().models.map((m) => m.id);
    for (const id of ids) expect(validateW3DModels({ main: id, light: id }, ids).ok).toBe(true);
  });

  it("persists under workshop3d.models and sanitizes hand edits", () => {
    const d = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3m-"));
    saveAppSettings(d, { tuning: { scoutBudgetUsd: 2 } });
    saveAppSettings(d, { workshop3d: { models: { main: "opus" } } });
    const s = loadAppSettings(d);
    expect(s.workshop3d?.models).toEqual({ main: "opus" });
    expect(s.tuning?.scoutBudgetUsd).toBe(2);
    expect(JSON.parse(fs.readFileSync(path.join(d, "app-settings.json"), "utf8")).workshop3d).toEqual({ models: { main: "opus" } });
    saveAppSettings(d, { workshop3d: { models: {} } });
    expect(loadAppSettings(d).workshop3d?.models).toEqual({});
    fs.writeFileSync(path.join(d, "app-settings.json"), JSON.stringify({ workshop3d: { models: { main: "  ", light: 5, x: 1 } } }));
    expect(loadAppSettings(d).workshop3d?.models).toEqual({});
    expect(sanitizeW3DModels({ light: " sonnet " })).toEqual({ light: "sonnet" });
  });

  it("adapter passes the chosen model and reads the setting at every call", async () => {
    const roles = loadW3DRoles();
    const startRun = vi.fn(async (_i: unknown) => ({ id: "r1" }));
    const m: W3DStepManager = { startRun: startRun as W3DStepManager["startRun"], waitFor: async () => ({ status: "done" }), cancel: () => true };
    let settings: { main?: string; light?: string } = {};
    const { runStep } = createW3DRunStep(m, roles, { modelFor: (_r, fileModel) => pickW3DModel(fileModel, settings, IDS) });
    await runStep("cad-modeler", "P", "/s");
    await runStep("render-presenter", "P", "/s");
    settings = { main: "claude-fable-5-2", light: "sonnet" };
    await runStep("cad-modeler", "P", "/s");
    await runStep("render-presenter", "P", "/s");
    const models = startRun.mock.calls.map((c) => (c[0] as { model?: string }).model);
    expect(models).toEqual([roles["cad-modeler"].model, roles["render-presenter"].model, "claude-fable-5-2", "sonnet"]);
    expect(roles["render-presenter"].model).toBe("haiku");
  });
});
