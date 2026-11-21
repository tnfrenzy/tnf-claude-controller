import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = "d".repeat(48);
const H = { "x-controller-token": TOKEN };

let started: StartedServer;
let base: string;
let root: string;
let runDir: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-d3d-api-"));
  const config: ControllerConfig = {
    repoRoot: REPO,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: ["Agent"],
      agentsFile: path.join(root, "roles.json"),
      systemPromptFile: path.join(root, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent", "Read", "Grep", "Glob", "Edit", "Write", "Bash(npm test*)"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: ["Bash(git push*)", "Bash(git reset --hard*)", "Bash(rm -rf *)"],
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
  };
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" },
  });
  base = `http://127.0.0.1:${started.policy.port}`;

  runDir = path.join(root, "rundir3d");
  fs.mkdirSync(path.join(runDir, "out"), { recursive: true });
  fs.writeFileSync(path.join(runDir, "part.stl"), "solid x\nendsolid x\n");
  fs.writeFileSync(path.join(runDir, "out", "scene.glb"), Buffer.from([0x67, 0x6c, 0x54, 0x46]));
  fs.writeFileSync(path.join(runDir, "box.obj"), "v 0 0 0\n");
  fs.writeFileSync(path.join(runDir, "notes.txt"), "not 3d");
  fs.writeFileSync(path.join(root, "outside.stl"), "solid out\n");
  const big = path.join(runDir, "big.stl");
  fs.closeSync(fs.openSync(big, "w"));
  fs.truncateSync(big, 50 * 1024 * 1024 + 1);
  started.manager.store.createRun({ id: "rid3d", status: "done", prompt: "thiet ke cai hop", mode: "research", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: runDir });
  started.manager.store.scanArtifacts("rid3d", runDir);
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const model = (p: string, headers: Record<string, string> = H): Promise<Response> =>
  fetch(`${base}/api/runs/rid3d/model?path=${encodeURIComponent(p)}`, { headers });

describe("GET /api/design3d", () => {
  it("returns kit and floors; 401 without token", async () => {
    const r = await fetch(`${base}/api/design3d`, { headers: H });
    expect(r.status).toBe(200);
    const body = (await r.json()) as { kit: { roles: string[]; templates: unknown[] }; floors: { runId: string; fileCount: number; primaryFormat: string }[] };
    expect(body.kit.roles.length).toBeGreaterThan(0);
    expect(body.kit.templates.length).toBeGreaterThanOrEqual(4);
    const floor = body.floors.find((f) => f.runId === "rid3d");
    expect(floor).toBeDefined();
    expect(floor!.fileCount).toBeGreaterThanOrEqual(3);
    expect((await fetch(`${base}/api/design3d`)).status).toBe(401);
  });
});

describe("GET /api/runs/:id/model", () => {
  it("serves .stl/.glb/.obj with the right Content-Type", async () => {
    const stl = await model("part.stl");
    expect(stl.status).toBe(200);
    expect(stl.headers.get("content-type")).toBe("model/stl");
    expect(await stl.text()).toBe("solid x\nendsolid x\n");
    const glb = await model("out/scene.glb");
    expect(glb.status).toBe(200);
    expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
    expect(Buffer.from(await glb.arrayBuffer()).toString()).toBe("glTF");
    const obj = await model("box.obj");
    expect(obj.status).toBe(200);
    expect(obj.headers.get("content-type")).toBe("model/obj");
  });

  it("rejects unknown extension and missing path with 400", async () => {
    expect((await model("notes.txt")).status).toBe(400);
    expect((await fetch(`${base}/api/runs/rid3d/model`, { headers: H })).status).toBe(400);
  });

  it("refuses paths escaping the run dir", async () => {
    for (const p of ["../outside.stl", "..\\outside.stl", "out/../../outside.stl", path.join(root, "outside.stl")]) {
      const s = (await model(p)).status;
      expect([400, 404]).toContain(s);
    }
  });

  it("404 for a missing file or run, 413 over 50 MB, 401 without token", async () => {
    expect((await model("nope.stl")).status).toBe(404);
    expect((await fetch(`${base}/api/runs/nope/model?path=part.stl`, { headers: H })).status).toBe(404);
    expect((await model("big.stl")).status).toBe(413);
    expect((await model("part.stl", {})).status).toBe(401);
  });
});
