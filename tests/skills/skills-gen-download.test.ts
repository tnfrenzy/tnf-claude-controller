import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "d".repeat(48);
let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-skd-"));
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
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const call = (method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

describe("skills-gen sample download", () => {
  it("serves sample files with the right headers and rejects bad input", async () => {
    expect((await call("POST", "/api/skills", { slug: "dl1", title: "Dl", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    expect((await call("POST", "/api/skills-gen/sessions", { slug: "dl1", brief: "b" })).status).toBe(201);
    const dir = path.join(root, "data", "skills-gen", "dl1", "round-1");
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, "sample.docx"), Buffer.from("PK\u0003\u0004docx"));

    const ok = await call("GET", "/api/skills-gen/sessions/dl1/rounds/1/sample/docx");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toBe("application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    expect(ok.headers.get("content-disposition")).toContain("attachment");
    expect(Buffer.from(await ok.arrayBuffer()).subarray(0, 2).toString("latin1")).toBe("PK");

    expect((await call("GET", "/api/skills-gen/sessions/dl1/rounds/1/sample/exe")).status).toBe(400);
    expect((await call("GET", "/api/skills-gen/sessions/dl1/rounds/0/sample/docx")).status).toBe(400);
    expect((await call("GET", "/api/skills-gen/sessions/dl1/rounds/abc/sample/docx")).status).toBe(400);
    expect((await call("GET", "/api/skills-gen/sessions/dl1/rounds/1/sample/xlsx")).status).toBe(404);
    expect((await call("GET", "/api/skills-gen/sessions/dl1/rounds/2/sample/docx")).status).toBe(404);
  });

  it("md route: 409 before completion, 400 for a bad slug", async () => {
    expect((await call("POST", "/api/skills", { slug: "dl3", title: "Dl", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    expect((await call("POST", "/api/skills-gen/sessions", { slug: "dl3", brief: "b" })).status).toBe(201);
    const r = await call("GET", "/api/skills-gen/sessions/dl3/md");
    expect(r.status).toBe(409);
    expect((await call("GET", "/api/skills-gen/sessions/BAD..SLUG/md")).status).toBe(400);
  });

  it("exposes gen.sample and gen.final, and reads old gen files", async () => {
    expect((await call("POST", "/api/skills", { slug: "dl2", title: "Dl", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    expect((await call("POST", "/api/skills-gen/sessions", { slug: "dl2", brief: "b" })).status).toBe(201);
    const gb = await (await call("GET", "/api/skills-gen/sessions/dl2")).json();
    expect(gb.gen.sample).toEqual({ status: "idle" });
    expect(gb.gen.final).toEqual({ status: "idle" });
    fs.writeFileSync(path.join(root, "data", "skills-gen", "dl2.json"), JSON.stringify({ roles: [], repos: [], finder: { status: "done" } }));
    const old = await (await call("GET", "/api/skills-gen/sessions/dl2")).json();
    expect(old.gen.finder.status).toBe("done");
    expect(old.gen.sample).toEqual({ status: "idle" });
    expect(old.gen.final).toBeUndefined();
    expect(old.gen.costCapUsd).toBe(3);
  });
});
