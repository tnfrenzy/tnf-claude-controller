import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it, expect } from "vitest";
import { buildPrompt } from "../../src/core/workshop3d/prompts.js";
import { DEFAULT_HQ_FIX_ROUNDS, DEFAULT_MAX_NO_IMPROVE } from "../../src/core/workshop3d/state.js";
import { mergeControllerConfig } from "../../src/core/app/config-merge.js";
import { buildPresentation } from "../../src/core/workshop3d/presentation.js";

const brief = { title: "t", object: "cabin", params: { w: 1100 }, detail: "standard" as const, attachments: [] };

describe("round policy (round 1 has scored highest in every real run)", () => {
  it("stops after ONE round without improvement and gives the second Blender render a zero default", () => {
    expect(DEFAULT_MAX_NO_IMPROVE).toBe(1);
    expect(DEFAULT_HQ_FIX_ROUNDS).toBe(0);
  });

  it("asks the cad-modeler for a different approach from the first fix round on, never in the first build", () => {
    const base = { brief, files: { "model.py": "x" }, issues: [{ target: "geometry" as const, text: "tay vịn mỏng" }], best: { score: 24, round: 1 } };
    const r2 = buildPrompt("cad-modeler", { ...base, round: 1 });
    expect(r2).toContain("phương án dựng khác");
    expect(r2).toContain("24/40");
    expect(buildPrompt("cad-modeler", { ...base, round: 0 })).not.toContain("phương án dựng khác");
    expect(buildPrompt("cad-modeler", { ...base, round: 1, best: undefined })).not.toContain("phương án dựng khác");
  });
});

describe("model list merge", () => {
  it("replaces Fable 5.1 by 5.2 and keeps the user's other models", () => {
    const existing = { models: [{ id: "haiku", label: "H" }, { id: "my-model", label: "mine" }, { id: "claude-fable-5-1", label: "5.1" }] };
    const defaults = { models: [{ id: "haiku", label: "x" }, { id: "claude-fable-5-2", label: "5.2" }] };
    const out = mergeControllerConfig(existing, defaults) as { models: Array<{ id: string; label: string }> };
    expect(out.models.map((m) => m.id)).toEqual(["haiku", "my-model", "claude-fable-5-2"]);
    expect(out.models[0]!.label).toBe("H");
  });
});

describe("presentation panorama", () => {
  it("adds the 360 section when renders/pano/pano.jpg exists", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-pano-"));
    fs.mkdirSync(path.join(dir, "renders", "pano"), { recursive: true });
    fs.writeFileSync(path.join(dir, "renders", "pano", "pano.jpg"), "jpg");
    fs.writeFileSync(path.join(dir, "brief.json"), JSON.stringify({ title: "Cabin", object: "x" }));
    const r = buildPresentation(dir);
    expect(r.pano).toBe(true);
    expect(fs.readFileSync(path.join(r.dir, "index.html"), "utf8")).toContain("Xem 360");
    expect(fs.readFileSync(path.join(r.dir, "data", "pano.js"), "utf8")).toContain("data:image/jpeg;base64,");
    expect(fs.existsSync(path.join(r.dir, "lib", "pannellum.js"))).toBe(true);
  });
});
