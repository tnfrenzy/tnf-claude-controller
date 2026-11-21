import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "s".repeat(48);
let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-skt-"));
  fs.writeFileSync(path.join(root, "roles.json"), "{}");
  fs.writeFileSync(path.join(root, "coord.md"), "coordinator");
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
        agentsFile: path.join(root, "roles.json"),
        systemPromptFile: path.join(root, "coord.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: [],
        extraArgs: [],
        maxRoleCalls: 8
      }
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 }
  };
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" } });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  // Let in-flight runs (started by train/grade, cancelled by stop) finish before the DB is closed.
  for (let i = 0; i < 100 && started.manager.activeCount() > 0; i++) await new Promise((r) => setTimeout(r, 100));
  await new Promise((r) => setTimeout(r, 200));
  await started.close();
  // A cancelled child may still hold its cwd for a moment on Windows; temp cleanup is best effort.
  try {
    fs.rmSync(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 200 });
  } catch {
    /* leave the OS temp dir for the OS to clean */
  }
});

const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = H) =>
  fetch(`${base}${url}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("skill training routes", () => {
  it("requires a token", async () => {
    expect((await call("POST", "/api/skills/demo/train", {}, { "content-type": "application/json" })).status).toBe(401);
  });
  it("404 for unknown slug", async () => {
    expect((await call("POST", "/api/skills/khong-co/train", {})).status).toBe(404);
    expect((await call("GET", "/api/skills/khong-co/rounds")).status).toBe(404);
  });
  it("train 202, second train 409, rounds without holdout, approve 409, stop", async () => {
    const c = await call("POST", "/api/skills", { slug: "demo", title: "Demo", goal: "g", files: { "SKILL.md": "# S" } });
    expect(c.status).toBe(201);
    expect((await call("POST", "/api/skills/demo/train", { maxRounds: -1 })).status).toBe(400);
    const t = await call("POST", "/api/skills/demo/train", { maxRounds: 2 });
    expect(t.status).toBe(202);
    expect(((await t.json()) as { state: string }).state).toBe("composing");
    const again = await call("POST", "/api/skills/demo/train", {});
    expect(again.status).toBe(409);
    expect(((await again.json()) as { error: string }).error).toBe("already_running");
    const ap = await call("POST", "/api/skills/demo/approve", {});
    expect(ap.status).toBe(409);
    expect(((await ap.json()) as { error: string }).error).toBe("not_awaiting_approval");
    const st = await call("POST", "/api/skills/demo/stop", {});
    expect(st.status).toBe(200);
    const r = await call("GET", "/api/skills/demo/rounds");
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(JSON.parse(text)).toHaveProperty("rounds");
    expect(text).not.toMatch(/holdout/i);
  });

  it("human grading: 409 outside awaiting_score, 400 without feedback, 200 then composing, files list and download", async () => {
    const c = await call("POST", "/api/skills", { slug: "gdemo", title: "G", goal: "g", files: { "SKILL.md": "# S" } });
    expect(c.status).toBe(201);
    expect((await call("POST", "/api/skills/gdemo/grade", { score: 80, feedback: "x" })).status).toBe(409);
    // Put the pack in the state the runner leaves after a trial: awaiting_score with one unscored round and a trial file.
    const pack = path.join(root, "data", "skills", "gdemo");
    const metaFile = path.join(pack, "meta.json");
    const meta = JSON.parse(fs.readFileSync(metaFile, "utf8"));
    fs.writeFileSync(metaFile, JSON.stringify({ ...meta, state: "awaiting_score" }));
    fs.writeFileSync(path.join(pack, "rounds.json"), JSON.stringify({ version: 1, rounds: [{ n: 1, startedAt: "t", skillVersion: 1, skillSha: "x", steps: [], criteria: [], errors: [], costUsdEstimate: 0, outputFiles: ["sample-1.md"] }] }));
    fs.mkdirSync(path.join(pack, "trials", "round-1"), { recursive: true });
    fs.writeFileSync(path.join(pack, "trials", "round-1", "sample-1.md"), "# Vòng 1 - mẫu 1\n\nOUT-XYZ\n");

    const list = await call("GET", "/api/skills/gdemo/rounds/1/files");
    expect(list.status).toBe(200);
    expect(((await list.json()) as { files: { name: string }[] }).files.map((f) => f.name)).toEqual(["sample-1.md"]);
    const inline = await call("GET", "/api/skills/gdemo/rounds/1/files/sample-1.md");
    expect(inline.status).toBe(200);
    expect(inline.headers.get("content-disposition")).toMatch(/^inline/);
    expect(await inline.text()).toContain("OUT-XYZ");
    const dl = await call("GET", "/api/skills/gdemo/rounds/1/files/sample-1.md?download=1");
    expect(dl.headers.get("content-disposition")).toMatch(/^attachment/);
    expect((await call("GET", "/api/skills/gdemo/rounds/1/files/..%2Fmeta.json")).status).toBe(400);
    expect((await call("GET", "/api/skills/gdemo/rounds/abc/files")).status).toBe(400);

    expect((await call("POST", "/api/skills/gdemo/grade", { score: "80", feedback: "x" })).status).toBe(400);
    expect((await call("POST", "/api/skills/gdemo/grade", { score: 80 })).status).toBe(400);
    const ok = await call("POST", "/api/skills/gdemo/grade", { score: 80, feedback: "Thiếu phần kết" });
    expect(ok.status).toBe(200);
    expect(((await ok.json()) as { state: string }).state).toBe("composing");
    await call("POST", "/api/skills/gdemo/stop", {});
  });
});
