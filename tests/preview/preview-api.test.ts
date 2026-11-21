import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import type { PreviewDeps } from "../../src/core/preview/preview.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "p".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;
let gate: Promise<void> | null = null;
let deskGate: Promise<void> | null = null;
let probeCalls = 0;
const spawnedPorts = new Set<number>();

function fakeDeps(): PreviewDeps {
  return {
    web: {
      browserPath: "C:\\fake\\edge.exe",
      spawnServer: (_c, _a, o) => { const port = Number(o.env["PORT"] ?? 4242); spawnedPorts.add(port); return { pid: port, onExit: () => undefined, log: () => ["ready"] }; },
      killTree: (pid) => { spawnedPorts.delete(pid); },
      probe: async (url) => {
        probeCalls++;
        if (!spawnedPorts.has(Number(new URL(url).port))) return null; // pre-spawn check: nothing else is listening on this port
        if (gate) await gate;
        return 200;
      },
      runBrowser: async (_exe, args) => {
        const arg = args.find((a) => a.startsWith("--screenshot="));
        if (arg) fs.writeFileSync(arg.slice("--screenshot=".length), Buffer.from([0x89]));
        return { code: 0, timedOut: false };
      },
      sleep: async () => undefined,
      fileOk: (f) => {
        try {
          return fs.statSync(f).size > 0;
        } catch {
          return false;
        }
      },
      tmpProfile: () => path.join(root, "profile"),
      rmDir: () => undefined,
    },
    desktop: {
      helperExe: async () => { if (deskGate) await deskGate; return "C:\\fake\\helper.exe"; },
      spawnApp: () => ({ pid: 1, onExit: () => undefined, log: () => [] }),
      killTree: () => undefined,
      closeApp: async () => undefined,
      runHelper: async () => ({ code: 0, stderr: "", timedOut: false }),
      sleep: async () => undefined,
      fileOk: () => true,
    },
  };
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-prevapi-"));
  const config: ControllerConfig = {
    repoRoot: root,
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
        allowedTools: ["Agent", "Read"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: ["Bash(git push*)"],
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
    previewDeps: fakeDeps(),
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function mkRun(id: string, project: string, worktree: string | null): void {
  const store = started.manager.store;
  if (!store.getProject(project)) store.upsertProject({ name: project, repo_path: null, base_branch: null, allowed_commands: [] });
  store.createRun({ id, status: "done", prompt: "p", mode: "coding", model: "sonnet", session_id: null, parent_run_id: null, project, claude_version: null, run_dir: path.join(root, "runs", id), kind: "coding", worktree_path: worktree } as never);
}

const WEB = { kind: "web", startCommand: "npm run dev", url: "http://localhost:5173", pages: ["/", "/login"], readyTimeoutSec: 5 };

async function setPreview(project: string, preview: unknown): Promise<void> {
  const r = await fetch(`${base}/api/projects/${project}/preview`, { method: "PUT", headers: H, body: JSON.stringify({ preview }) });
  expect(r.status).toBe(200);
}

async function setGrant(project: string, preview: boolean): Promise<void> {
  const r = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ project, grants: { preview } }) });
  expect(r.status).toBe(200);
}

type StateBody = { state: { status: string; step: string | null; result: { shots: Array<{ file: string; ok: boolean }> } | null }; config: { kind: string } };

async function waitState(id: string, want: string): Promise<StateBody> {
  const until = Date.now() + 3000;
  let last: StateBody | null = null;
  while (Date.now() < until) {
    last = (await (await fetch(`${base}/api/runs/${id}/preview`, { headers: H })).json()) as StateBody;
    if (last.state.status === want) return last;
    await new Promise((r) => setTimeout(r, 25));
  }
  throw new Error(`state never reached ${want}: ${JSON.stringify(last)}`);
}

describe("preview routes", () => {
  it("requires the token", async () => {
    expect((await fetch(`${base}/api/runs/x/preview`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base}/api/runs/x/preview`)).status).toBe(401);
    expect((await fetch(`${base}/api/runs/x/preview/home-375.png`)).status).toBe(401);
  });

  it("404 for an unknown run", async () => {
    expect((await fetch(`${base}/api/runs/ghost/preview`, { method: "POST", headers: H })).status).toBe(404);
  });

  it("400 when the environment has no preview config", async () => {
    mkRun("r-none", "env-none", null);
    const r = await fetch(`${base}/api/runs/r-none/preview`, { method: "POST", headers: H });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain("Xem trước");
    const g = (await (await fetch(`${base}/api/runs/r-none/preview`, { headers: H })).json()) as StateBody;
    expect(g.state.status).toBe("idle");
    expect(g.config.kind).toBe("none");
  });

  it("403 while the preview grant is off", async () => {
    mkRun("r-off", "env-off", null);
    await setPreview("env-off", WEB);
    const r = await fetch(`${base}/api/runs/r-off/preview`, { method: "POST", headers: H });
    expect(r.status).toBe(403);
    expect(((await r.json()) as { message: string }).message).toContain("quyền");
  });

  it("400 for a missing worktree, then 202 and ok with 4 shots once it exists", async () => {
    const wt = path.join(root, "wt-ok");
    mkRun("r-ok", "env-ok", wt);
    await setPreview("env-ok", WEB);
    await setGrant("env-ok", true);
    const miss = await fetch(`${base}/api/runs/r-ok/preview`, { method: "POST", headers: H });
    expect(miss.status).toBe(400);
    expect(((await miss.json()) as { message: string }).message).toContain("Worktree");
    fs.mkdirSync(wt, { recursive: true });
    const r = await fetch(`${base}/api/runs/r-ok/preview`, { method: "POST", headers: H });
    expect(r.status).toBe(202);
    expect(((await r.json()) as { state: { status: string } }).state.status).toBe("running");
    const done = await waitState("r-ok", "ok");
    expect(done.state.result?.shots).toHaveLength(4);
    expect(done.state.result?.shots.every((s) => s.ok)).toBe(true);
    expect(done.config.kind).toBe("web");
  });

  it("409 when a capture is already running", async () => {
    const wt = path.join(root, "wt-busy");
    fs.mkdirSync(wt, { recursive: true });
    mkRun("r-busy", "env-busy", wt);
    await setPreview("env-busy", WEB);
    await setGrant("env-busy", true);
    let release!: () => void;
    gate = new Promise<void>((res) => { release = res; });
    const before = probeCalls;
    try {
      expect((await fetch(`${base}/api/runs/r-busy/preview`, { method: "POST", headers: H })).status).toBe(202);
      const until = Date.now() + 3000;
      while (probeCalls === before && Date.now() < until) await new Promise((r) => setTimeout(r, 10));
      const again = await fetch(`${base}/api/runs/r-busy/preview`, { method: "POST", headers: H });
      expect(again.status).toBe(409);
      expect(((await again.json()) as { message: string }).message).toContain("Đang chụp");
      expect(((await (await fetch(`${base}/api/runs/r-busy/preview`, { headers: H })).json()) as StateBody).state.status).toBe("running");
    } finally {
      release();
      gate = null;
    }
    await waitState("r-busy", "ok");
  });

  it("409 when another run of an environment on the same url is capturing", async () => {
    const wt = path.join(root, "wt-lock");
    fs.mkdirSync(wt, { recursive: true });
    mkRun("r-lock1", "env-lock1", wt);
    mkRun("r-lock2", "env-lock2", wt);
    for (const p of ["env-lock1", "env-lock2"]) {
      await setPreview(p, { ...WEB, url: "http://localhost:5199" });
      await setGrant(p, true);
    }
    let release!: () => void;
    gate = new Promise<void>((res) => { release = res; });
    try {
      expect((await fetch(`${base}/api/runs/r-lock1/preview`, { method: "POST", headers: H })).status).toBe(202);
      const other = await fetch(`${base}/api/runs/r-lock2/preview`, { method: "POST", headers: H });
      expect(other.status).toBe(409);
      expect(((await other.json()) as { message: string }).message).toContain("Một lượt chụp khác");
    } finally {
      release();
      gate = null;
    }
    await waitState("r-lock1", "ok");
    // The lock is released afterwards.
    expect((await fetch(`${base}/api/runs/r-lock2/preview`, { method: "POST", headers: H })).status).toBe(202);
    await waitState("r-lock2", "ok");
  });

  it("normalizes the lock to the port (localhost vs 127.0.0.1), not the url string", async () => {
    const wt = path.join(root, "wt-port");
    fs.mkdirSync(wt, { recursive: true });
    mkRun("r-port1", "env-port1", wt);
    mkRun("r-port2", "env-port2", wt);
    mkRun("r-port3", "env-port3", wt);
    await setPreview("env-port1", { ...WEB, url: "http://localhost:5301" });
    await setPreview("env-port2", { ...WEB, url: "http://127.0.0.1:5301" });
    await setPreview("env-port3", { ...WEB, url: "http://localhost:5302" });
    for (const p of ["env-port1", "env-port2", "env-port3"]) await setGrant(p, true);
    let release!: () => void;
    gate = new Promise<void>((res) => { release = res; });
    try {
      expect((await fetch(`${base}/api/runs/r-port1/preview`, { method: "POST", headers: H })).status).toBe(202);
      expect((await fetch(`${base}/api/runs/r-port2/preview`, { method: "POST", headers: H })).status).toBe(409);
      expect((await fetch(`${base}/api/runs/r-port3/preview`, { method: "POST", headers: H })).status).toBe(202);
    } finally {
      release();
      gate = null;
    }
    await waitState("r-port1", "ok");
    await waitState("r-port3", "ok");
    expect((await fetch(`${base}/api/runs/r-port2/preview`, { method: "POST", headers: H })).status).toBe(202);
    await waitState("r-port2", "ok");
  });

  it("409 for a web capture while the run is running or queued; desktop and finished runs are fine", async () => {
    const wt = path.join(root, "wt-runstate");
    fs.mkdirSync(wt, { recursive: true });
    mkRun("r-live", "env-live", wt);
    await setPreview("env-live", { ...WEB, url: "http://localhost:5311" });
    await setGrant("env-live", true);
    const store = started.manager.store;
    for (const st of ["running", "queued"] as const) {
      store.updateRun("r-live", { status: st });
      const r = await fetch(`${base}/api/runs/r-live/preview`, { method: "POST", headers: H });
      expect(r.status).toBe(409);
      expect(((await r.json()) as { message: string }).message).toContain("đang chạy hoặc đang chờ");
    }
    store.updateRun("r-live", { status: "done" });
    expect((await fetch(`${base}/api/runs/r-live/preview`, { method: "POST", headers: H })).status).toBe(202);
    await waitState("r-live", "ok");

    mkRun("r-live-desk", "env-live-desk", null);
    await setPreview("env-live-desk", { kind: "desktop", exePath: process.execPath, args: [], windowTitle: "My App", settleSec: 1 });
    await setGrant("env-live-desk", true);
    store.updateRun("r-live-desk", { status: "running" });
    expect((await fetch(`${base}/api/runs/r-live-desk/preview`, { method: "POST", headers: H })).status).toBe(202);
    await waitState("r-live-desk", "ok");
  });

  it("two desktop captures cannot run at once, and the lock is released afterwards", async () => {
    mkRun("r-d1", "env-d1", null);
    mkRun("r-d2", "env-d2", null);
    for (const p of ["env-d1", "env-d2"]) {
      await setPreview(p, { kind: "desktop", exePath: process.execPath, args: [], windowTitle: "My App", settleSec: 1 });
      await setGrant(p, true);
    }
    let release!: () => void;
    deskGate = new Promise<void>((res) => { release = res; });
    try {
      expect((await fetch(`${base}/api/runs/r-d1/preview`, { method: "POST", headers: H })).status).toBe(202);
      expect((await fetch(`${base}/api/runs/r-d2/preview`, { method: "POST", headers: H })).status).toBe(409);
    } finally {
      release();
      deskGate = null;
    }
    await waitState("r-d1", "ok");
    expect((await fetch(`${base}/api/runs/r-d2/preview`, { method: "POST", headers: H })).status).toBe(202);
    await waitState("r-d2", "ok");
  });

  it("a throwing deps factory does not leave the run stuck in running", async () => {
    const wt = path.join(root, "wt-throw");
    fs.mkdirSync(wt, { recursive: true });
    mkRun("r-throw", "env-throw", wt);
    await setPreview("env-throw", { ...WEB, url: "http://localhost:5188" });
    await setGrant("env-throw", true);
    const opts = (started.manager as unknown as { opts: { previewDeps?: PreviewDeps } }).opts;
    const saved = opts.previewDeps;
    Object.defineProperty(opts, "previewDeps", { configurable: true, get() { throw new Error("boom"); } });
    try {
      expect(() => started.manager.startPreview("r-throw", { viaTunnel: false })).toThrow("boom");
    } finally {
      Object.defineProperty(opts, "previewDeps", { configurable: true, writable: true, value: saved });
    }
    expect(started.manager.getPreviewState("r-throw").status).toBe("idle");
    expect((await fetch(`${base}/api/runs/r-throw/preview`, { method: "POST", headers: H })).status).toBe(202);
    await waitState("r-throw", "ok");
  });

  it("400 when the old preview folder cannot be wiped", async () => {
    const wt = path.join(root, "wt-wipe");
    fs.mkdirSync(wt, { recursive: true });
    mkRun("r-wipe", "env-wipe", wt);
    await setPreview("env-wipe", { ...WEB, url: "http://localhost:5177" });
    await setGrant("env-wipe", true);
    // A file where the preview folder's parent should be makes mkdir fail (and the wipe is a no-op).
    const runOut = path.join(started.manager.outputDir(), "r-wipe");
    fs.mkdirSync(path.dirname(runOut), { recursive: true });
    fs.writeFileSync(runOut, "not a dir");
    const r = await fetch(`${base}/api/runs/r-wipe/preview`, { method: "POST", headers: H });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain("Không xóa được ảnh cũ");
    expect(started.manager.getPreviewState("r-wipe").status).toBe("idle");
  });

  it("serves captured PNGs and rejects traversal and non-png names", async () => {
    const ok = await fetch(`${base}/api/runs/r-ok/preview/home-375.png`, { headers: H });
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("image/png");
    expect(ok.headers.get("cache-control")).toBe("no-store");
    expect((await ok.arrayBuffer()).byteLength).toBeGreaterThan(0);
    expect((await fetch(`${base}/api/runs/r-ok/preview/..%2Fx.png`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/runs/r-ok/preview/a.txt`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/runs/r-ok/preview/preview.json`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/runs/r-ok/preview/nope.png`, { headers: H })).status).toBe(404);
  });

  it("403 for a desktop capture requested through the tunnel, 202 locally", async () => {
    mkRun("r-desk", "env-desk", null);
    await setPreview("env-desk", { kind: "desktop", exePath: process.execPath, args: [], windowTitle: "My App", settleSec: 1 });
    await setGrant("env-desk", true);
    const tun = await fetch(`${base}/api/runs/r-desk/preview`, { method: "POST", headers: { ...H, "x-forwarded-for": "100.64.0.1" } });
    expect(tun.status).toBe(403);
    expect(((await tun.json()) as { message: string }).message).toContain("máy chạy app");
    const local = await fetch(`${base}/api/runs/r-desk/preview`, { method: "POST", headers: H });
    expect(local.status).toBe(202);
    const done = await waitState("r-desk", "ok");
    expect(done.state.result?.shots[0]?.file).toBe("window.png");
    expect(done.config.kind).toBe("desktop");
  });
});
