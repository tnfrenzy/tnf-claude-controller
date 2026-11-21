// UI side of the Blender phase: state labels, progress line, badge / room phase, viewer GLB choice, engine detail.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { dicts } from "../../ui/src/i18n.js";
import { GLB_BLENDER, GLB_MAIN, GLB_MOBILE, pickSources } from "../../ui/src/components/workshop3d/logic.js";
import { workshop3dBadge } from "../../ui/src/office/design3d-floors.js";
import { w3dControls, w3dHqProgress } from "../../ui/src/office/workshop3d-session.js";
import { w3dPhase } from "../../ui/src/office/workshop3d.js";
import { makeWorkshop3DEngine } from "../../src/core/workshop3d/index.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import { initialSnapshot } from "../../src/core/workshop3d/state.js";
import type { W3DRunner } from "../../src/core/workshop3d/runner.js";

describe("labels", () => {
  it("Vietnamese and English labels for the new states and the progress line", () => {
    const vi = dicts.vi as unknown as Record<string, string>;
    const en = dicts.en as unknown as Record<string, string>;
    expect(vi["w3v_state_hqrender"]).toBe("Render chất lượng cao");
    expect(vi["w3v_state_hqreview"]).toBe("Duyệt lần cuối");
    for (const k of ["w3v_state_hqrender", "w3v_state_hqreview", "w3v_state_hqmaterials", "w3i_hq_progress", "w3i_hq_preparing"]) {
      expect(vi[k]).toBeTruthy();
      expect(en[k]).toBeTruthy();
    }
    expect(vi["w3i_hq_progress"]).toContain("{i}/{n}");
  });
});

describe("progress and controls", () => {
  it("shows image i/N while Blender runs, a preparing line before the first image", () => {
    expect(w3dHqProgress("hqrender", { running: true, total: 6, index: 3 })).toEqual({ i: 3, n: 6 });
    expect(w3dHqProgress("hqrender", null)).toBe("preparing");
    expect(w3dHqProgress("hqreview", { running: false, total: 6, index: 6 })).toBeNull();
    expect(w3dHqProgress("rendering", { running: true, total: 6, index: 2 })).toEqual({ i: 2, n: 6 });
  });
  it("hq states are working states: pause and stop allowed, badge running, room phases", () => {
    for (const s of ["hqrender", "hqreview", "hqmaterials"]) {
      expect(w3dControls(s)).toEqual({ pause: true, resume: false, stop: true });
      expect(workshop3dBadge(s).badge).toBe("running");
    }
    expect(w3dPhase("hqrender")).toBe("render");
    expect(w3dPhase("hqreview")).toBe("review");
    expect(w3dPhase("hqmaterials")).toBe("material");
  });
});

describe("viewer model choice", () => {
  it("desktop prefers model-blender.glb, phones keep the light GLB", () => {
    const files = [GLB_MAIN, GLB_MOBILE, GLB_BLENDER];
    expect(pickSources(files, "desktop").glb).toBe(GLB_BLENDER);
    expect(pickSources(files, "android").glb).toBe(GLB_MOBILE);
    expect(pickSources([GLB_MAIN], "desktop").glb).toBe(GLB_MAIN);
  });
});

describe("engine detail", () => {
  it("lists the high-quality images first and returns the Blender progress", () => {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "w3d-hq-ui-"));
    try {
      const store = createW3DStore(tmp);
      const slug = store.create({ title: "C", object: "c", params: {}, detail: "standard", attachments: [] }, initialSnapshot({}));
      const dir = store.dir(slug);
      fs.mkdirSync(path.join(dir, "renders", "hq"), { recursive: true });
      fs.writeFileSync(path.join(dir, "renders", "front.png"), "x");
      fs.writeFileSync(path.join(dir, "renders", "hq", "door.png"), "x");
      fs.writeFileSync(path.join(dir, "renders", "hq", "hq.json"), JSON.stringify({ version: 1, order: ["door", "cop"], views: { door: { key: "k", file: "renders/hq/door.png", seconds: 1, attempts: 1, at: "" } } }));
      fs.writeFileSync(path.join(dir, "renders", "hq", "progress.json"), JSON.stringify({ running: true, total: 6, done: 1, index: 2, current: "cop" }));
      const engine = makeWorkshop3DEngine({ store, runner: {} as W3DRunner });
      const d = engine.detail(slug)!;
      expect(d.renders).toEqual(["renders/hq/door.png", "renders/front.png"]);
      expect(d.hq).toMatchObject({ running: true, index: 2, total: 6 });
      expect(engine.filePath(slug, "renders/hq/door.png").inline).toBe(true);
    } finally {
      fs.rmSync(tmp, { recursive: true, force: true });
    }
  });
});
