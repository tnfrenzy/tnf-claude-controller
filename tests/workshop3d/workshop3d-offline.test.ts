// Offline end-to-end acceptance of the 3D workshop: real RunManager + fake Claude CLI (one stream per role, chosen by
// the role's system prompt, FAKE_CLAUDE_BY_ROLE_DIR), real build/GLB/USDZ/validator when the CAD python exists, fake render.
// The real CAD python needs 20 to 70 s per spawn (cold start): the Python case runs about 100 s, allowed 6 minutes.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CAD_PYTHON_MISSING_MSG, findCadPython } from "../../src/core/design3d/cad-tools.js";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import { defaultValidate, type BuildResult } from "../../src/core/workshop3d/build.js";
import { createWorkshop3D, type Workshop3DDeps } from "../../src/core/workshop3d/index.js";
import type { RenderPlan } from "../../src/core/workshop3d/role-output.js";
import type { W3DRunner } from "../../src/core/workshop3d/runner.js";
import { initialSnapshot } from "../../src/core/workshop3d/state.js";
import { createW3DStore, type W3DStore } from "../../src/core/workshop3d/store.js";
import type { W3DBrief } from "../../src/core/workshop3d/types.js";
// @ts-expect-error plain ESM script without types
import { buildScenarios } from "../../fixtures/workshop3d/make-streams.mjs";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const STREAMS = path.resolve(__dirname, "..", "..", "fixtures", "workshop3d");
const MODEL_PY = path.resolve(__dirname, "..", "..", "fixtures", "workshop3d-model.py");
const python = findCadPython(process.env);
const pythonAvailable = python !== null;
const BRIEF: W3DBrief = { title: "Hộp trưng bày", object: "hộp 400 x 300 x 200 mm", params: {}, detail: "standard", attachments: [] };
const PLAN_IDS = ["base", "handle", "lid"];

function tmpConfig(root: string): ControllerConfig {
  const roles = path.join(root, "roles.json");
  const coord = path.join(root, "coord.md");
  fs.writeFileSync(roles, "{}");
  fs.writeFileSync(coord, "coordinator");
  const base = { allowedTools: ["Agent"], agentsFile: roles, systemPromptFile: coord, disallowedTools: [], extraArgs: [], maxRoleCalls: 8 };
  return {
    repoRoot: path.resolve(__dirname, "..", ".."), claudePath: null, models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "workspace"), worktreesDir: path.join(root, "workspace", "worktrees"), dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: ["Agent"], agentsFile: roles,
      systemPromptFile: coord, maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
      research: base,
      coding: { ...base, allowedTools: ["Agent", "Read"], settingsFile: path.join(root, "deny.json") },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  } as ControllerConfig;
}

let root: string;
let runStore: RunStore;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-off-"));
  runStore = new RunStore(":memory:");
});
afterEach(() => {
  runStore.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const OK_BUILD: BuildResult = { ok: true, stage: "done", bboxMm: [400, 300, 200], triangles: 100, glbBytes: 10, warnings: [], files: [] };
const TINY_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==", "base64");
type Stack = { store: W3DStore; runner: W3DRunner; renderPlans: RenderPlan[] };

/**
 * The real factory createWorkshop3D (index.ts); role runs go through the real RunManager + fake CLI.
 * Only the headless-browser render is faked (four tiny PNGs; the real one is covered by workshop3d-render.test.ts).
 * `extra` replaces more seams: with `build`, CAD does not run at all.
 */
function makeStack(scenario: "ok" | "fix", extra: Workshop3DDeps = {}): Stack {
  const config = tmpConfig(root);
  const mgr = new RunManager({
    config, store: runStore, claudePath: process.execPath, claudeArgsPrefix: [FAKE],
    env: { ...process.env, TNF_FAKE_CLAUDE: "1", FAKE_CLAUDE_BY_ROLE_DIR: path.join(root, "streams", scenario) },
  });
  const dataDir = path.join(root, "data");
  const renderPlans: RenderPlan[] = [];
  const engine = createWorkshop3D({
    manager: mgr, dataDir, config,
    deps: {
      python,
      render: async (slug, plan) => {
        renderPlans.push(plan);
        const files = plan.cameras.map((c) => `renders/${c.name}.png`);
        for (const f of files) createW3DStore(dataDir).writeFile(slug, f, TINY_PNG);
        return { ok: true, files };
      },
      patchParams: async () => ({ ok: true, changed: [], ignored: [] }),
      ...extra,
    },
  });
  return { store: engine.store, runner: engine.runner, renderPlans };
}

function stage(): void {
  for (const [rel, content] of Object.entries(buildScenarios() as Record<string, string>)) {
    const f = path.join(root, "streams", rel);
    fs.mkdirSync(path.dirname(f), { recursive: true });
    fs.writeFileSync(f, content);
  }
}

type Gltf = {
  nodes?: { name?: string; mesh?: number }[];
  meshes?: { primitives: { attributes: { POSITION?: number }; material?: number }[] }[];
  accessors?: { count: number }[];
  materials?: { pbrMetallicRoughness?: { metallicFactor?: number } }[];
};
/** The JSON chunk of a GLB. */
function glbJson(file: string): Gltf {
  const b = fs.readFileSync(file);
  expect(b.toString("utf8", 0, 4)).toBe("glTF");
  const len = b.readUInt32LE(12);
  return JSON.parse(b.toString("utf8", 20, 20 + len)) as Gltf;
}
const glbNodeNames = (g: Gltf): string[] => (g.nodes ?? []).map((n) => n.name ?? "").filter(Boolean);

describe("fixtures", () => {
  it("committed streams equal what make-streams.mjs generates from fixtures/workshop3d-model.py (no drift)", () => {
    for (const [rel, content] of Object.entries(buildScenarios() as Record<string, string>)) {
      expect(fs.readFileSync(path.join(STREAMS, rel), "utf8").split("\r\n").join("\n"), rel).toBe(content);
    }
  });
});

// Not a silent skip: without the CAD python this prints why, and W3D_REQUIRE_PYTHON=1 (CI) turns the skip into a failure.
const requirePython = process.env["W3D_REQUIRE_PYTHON"] === "1";
if (!pythonAvailable) console.warn("workshop3d-offline: CAD python not found (TNF_CAD_PYTHON or D:\tnf-cad-tools\cad-venv), skipping the real-build case. Set W3D_REQUIRE_PYTHON=1 to fail instead.");

describe.skipIf(!pythonAvailable && !requirePython)("workshop3d offline, real CAD python", () => {
  it("runs the fix-loop scenario to done with real build, GLB, USDZ and validator", async () => {
    expect(python, "W3D_REQUIRE_PYTHON=1 but no CAD python was found").not.toBeNull();
    stage();
    const { store, runner, renderPlans } = makeStack("fix");
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const rec = store.get(slug)!;
    expect(rec.snapshot.state, rec.snapshot.error ?? "").toBe("done");
    for (const f of ["model.py", "spec.json", "materials.json", "REPORT.md", "outputs/model.step", "outputs/model.glb", "outputs/model.usdz", "outputs/parts/base.stl"]) {
      expect(fs.existsSync(path.join(store.dir(slug), f)), f).toBe(true);
    }
    // gltf-validator: zero errors; part ids in the GLB equal the plan ids
    const glb = path.join(store.dir(slug), "outputs", "model.glb");
    const v = await defaultValidate(new Uint8Array(fs.readFileSync(glb)));
    expect(v.errors, v.messages.join("; ")).toBe(0);
    const g = glbJson(glb);
    expect(glbNodeNames(g).sort()).toEqual(PLAN_IDS);
    // geometry is really there: the base node has a mesh with vertices; the handle is the metallic part of materials.json
    const meshOf = (name: string) => g.meshes![g.nodes!.find((n) => n.name === name)!.mesh!]!.primitives[0]!;
    expect(g.accessors![meshOf("base").attributes.POSITION!]!.count).toBeGreaterThan(0);
    expect(g.materials![meshOf("handle").material!]!.pbrMetallicRoughness?.metallicFactor).toBe(1);
    // the model script on disk is the fixture's script (the python block is extracted unchanged)
    expect(fs.readFileSync(path.join(store.dir(slug), "model.py"), "utf8").trim()).toBe(fs.readFileSync(MODEL_PY, "utf8").trim());
    // fix loop: the reviewer said no once (material issue), materials ran twice, then the reviewer accepted
    for (const r of [0, 1]) {
      expect(fs.existsSync(path.join(store.dir(slug), "rounds", String(r), "material-artist.txt")), `materials round ${r}`).toBe(true);
      expect(fs.existsSync(path.join(store.dir(slug), "rounds", String(r), "visual-reviewer.txt")), `reviewer round ${r}`).toBe(true);
    }
    expect(rec.snapshot.fixRounds).toBe(1);
    // the factory handed the render-director's plan to the render dep, once per rendering pass (before and after the material fix)
    expect(renderPlans).toHaveLength(2);
    expect(renderPlans[0]).toMatchObject({ environment: "studio", exposure: 1 });
    expect(renderPlans[0]!.cameras.map((c) => c.name)).toEqual(["mat_truoc", "mat_sau", "ba_phan_tu", "chi_tiet_tay_nam"]);
    // cost: 11 role calls x 0.01 USD (intake, art, plan, cad, materials x2, render-director, reviewer x2, optimizer, presenter)
    expect(rec.snapshot.costUsd).toBeCloseTo(0.11, 5);
  }, 360_000);
});

describe("workshop3d offline, without Python", () => {
  it("fails with a Vietnamese script error after 4 failed builds, then resume with a good build reaches done", async () => {
    stage();
    let good = false;
    const { store, runner } = makeStack("ok", {
      assemble: async () => OK_BUILD,
      build: async () => (good ? OK_BUILD : { ok: false, stage: "script", error: "Script lỗi (mã 1).\nNameError: name 'x' is not defined", warnings: [], files: [] }),
    });
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const failed = store.get(slug)!.snapshot;
    expect(failed.state).toBe("failed");
    expect(failed.error).toMatch(/Script/);
    expect(failed.error).toMatch(/4 lần/);
    expect(failed.resumeState).toBe("modeling");
    good = true;
    runner.resume(slug);
    await runner.idle(slug);
    expect(store.get(slug)!.snapshot.state, store.get(slug)!.snapshot.error ?? "").toBe("done");
    expect(store.readFile(slug, "REPORT.md")).toContain("Hộp trưng bày");
  }, 120_000);

  it("the factory's build uses the python from deps: none installed -> environment error at building, the modeler is not asked again", async () => {
    stage();
    const { store, runner, renderPlans } = makeStack("ok", { python: null });
    const slug = runner.start(BRIEF);
    await runner.idle(slug);
    const s = store.get(slug)!.snapshot;
    expect(s.state).toBe("failed");
    expect(s.resumeState).toBe("building");
    expect(s.buildRetries).toBe(0);
    expect(s.error).toContain(CAD_PYTHON_MISSING_MSG);
    expect(fs.readdirSync(path.join(store.dir(slug), "rounds"))).toEqual(["0"]);
    expect(fs.existsSync(path.join(store.dir(slug), "rounds", "0", "cad-modeler.txt"))).toBe(true);
    expect(renderPlans).toHaveLength(0);
  }, 120_000);

  it("a new engine instance recovers a session saved in the modeling state and finishes it", async () => {
    stage();
    const first = makeStack("ok", { build: async () => OK_BUILD, assemble: async () => OK_BUILD });
    const slug = first.store.create(BRIEF);
    first.store.writeFile(slug, "art.json", JSON.stringify({ style: "tối giản", palette: ["#c9a46a"], materials: ["gỗ sồi"] }));
    first.store.writeFile(slug, "spec.json", JSON.stringify({ bbox_mm: [400, 300, 200], tolerance_mm: 2, parts: PLAN_IDS.map((id) => ({ id, name: id, material: "gỗ" })) }));
    first.store.saveSnapshot(slug, { ...initialSnapshot(), state: "modeling" });
    // process restart: nothing is running, a new stack on the same data dir picks the session up
    const second = makeStack("ok", { build: async () => OK_BUILD, assemble: async () => OK_BUILD });
    expect(second.runner.recover()).toEqual([slug]);
    await second.runner.idle(slug);
    expect(second.store.get(slug)!.snapshot.state, second.store.get(slug)!.snapshot.error ?? "").toBe("done");
  }, 120_000);
});
