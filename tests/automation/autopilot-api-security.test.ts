import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const TOKEN = "a".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];

const ROUTES: Array<{ method: string; path: string; body?: unknown }> = [
  { method: "GET", path: "/api/autopilot/status" },
  { method: "POST", path: "/api/autopilot/enable", body: {} },
  { method: "POST", path: "/api/autopilot/disable", body: {} },
  { method: "PUT", path: "/api/autopilot/schedule", body: { schedule: null } },
  { method: "PUT", path: "/api/autopilot/webhooks", body: { webhooks: [] } },
  { method: "GET", path: "/api/autopilot/summary" },
  { method: "POST", path: "/api/autopilot/check-duplicate", body: { project: "x", title: "y" } },
];

let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-apsec-"));
  fs.mkdirSync(path.join(root, "config"), { recursive: true });
  const config = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "workspace"),
    worktreesDir: path.join(root, "workspace", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
    defaults: {
      authMode: "subscription",
      model: "sonnet",
      maxTurns: 40,
      maxBudgetUsd: 3,
      timeoutMs: 60_000,
      allowedTools: RESEARCH_TOOLS,
      agentsFile: path.join(root, "roles.json"),
      systemPromptFile: path.join(root, "coord.md"),
      maxConcurrentSubagents: 3,
      maxSubagentSpawnDepth: 1,
      extraArgs: [],
      research: { allowedTools: RESEARCH_TOOLS, agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      coding: {
        allowedTools: ["Agent", "Read"],
        agentsFile: path.join(root, "roles-coding.json"),
        systemPromptFile: path.join(root, "coord-coding.md"),
        settingsFile: path.join(root, "deny.json"),
        disallowedTools: [],
        extraArgs: ["--setting-sources", "project"],
        maxRoleCalls: 8,
      },
    },
    limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
    queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [] },
    automation: { enabled: false, maxRetries: 0, schedule: null, webhooks: [] },
  } as unknown as ControllerConfig;
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: FIX },
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

function bodyOf(r: { body?: unknown }): string | undefined {
  return r.body === undefined ? undefined : JSON.stringify(r.body);
}

describe("autopilot method and path", () => {
  it.each(["GET", "POST", "PUT"])("%s /api/autopilot returns 404 not_found", async (method) => {
    const r = await fetch(`${base}/api/autopilot`, { method, headers: H, body: method === "GET" ? undefined : "{}" });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("not_found");
  });

  it("unknown sub path returns 404 not_found", async () => {
    const r = await fetch(`${base}/api/autopilot/nope`, { headers: H });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("not_found");
  });

  it.each([
    ["POST", "/api/autopilot/status"],
    ["PUT", "/api/autopilot/status"],
    ["POST", "/api/autopilot/summary"],
    ["GET", "/api/autopilot/check-duplicate"],
  ])("%s %s returns 405 method_not_allowed", async (method, p) => {
    const r = await fetch(`${base}${p}`, { method, headers: H, body: method === "GET" ? undefined : "{}" });
    expect(r.status).toBe(405);
    expect((await r.json()).error).toBe("method_not_allowed");
  });
});

async function getStatus(): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}/api/autopilot/status`, { headers: H });
  expect(r.status).toBe(200);
  return (await r.json()) as Record<string, unknown>;
}

describe("autopilot malformed input", () => {
  it.each([
    ["POST", "/api/autopilot/enable"],
    ["POST", "/api/autopilot/disable"],
    ["PUT", "/api/autopilot/schedule"],
    ["PUT", "/api/autopilot/webhooks"],
  ])("%s %s with broken JSON returns 400 bad_request and leaves state unchanged", async (method, p) => {
    const before = await getStatus();
    const r = await fetch(`${base}${p}`, { method, headers: H, body: "{bad" });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("bad_request");
    expect(await getStatus()).toEqual(before);
  });

  it("PUT webhooks with a non-https URL returns 400 invalid_webhooks and leaves state unchanged", async () => {
    const before = await getStatus();
    const r = await fetch(`${base}/api/autopilot/webhooks`, {
      method: "PUT",
      headers: H,
      body: JSON.stringify({ webhooks: ["http://example.com/hook"] }),
    });
    expect(r.status).toBe(400);
    expect((await r.json()).error).toBe("invalid_webhooks");
    expect(await getStatus()).toEqual(before);
  });

  it("PUT schedule with an empty string clears the schedule (200, schedule null)", async () => {
    const r = await fetch(`${base}/api/autopilot/schedule`, { method: "PUT", headers: H, body: JSON.stringify({ schedule: "" }) });
    expect(r.status).toBe(200);
    expect((await r.json()).schedule).toBeNull();
    expect((await getStatus()).schedule).toBeNull();
  });

  it("PUT webhooks with an empty array is accepted (200, webhookCount 0)", async () => {
    const r = await fetch(`${base}/api/autopilot/webhooks`, { method: "PUT", headers: H, body: JSON.stringify({ webhooks: [] }) });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(body.webhookCount).toBe(0);
    expect(body.webhooks).toEqual([]);
    expect((await getStatus()).webhookCount).toBe(0);
  });
});

describe("autopilot valid paths", () => {
  it("POST enable then disable toggles the flag, confirmed by GET status", async () => {
    const en = await fetch(`${base}/api/autopilot/enable`, { method: "POST", headers: H, body: "{}" });
    expect(en.status).toBe(200);
    expect((await en.json()).enabled).toBe(true);
    expect((await getStatus()).enabled).toBe(true);
    const dis = await fetch(`${base}/api/autopilot/disable`, { method: "POST", headers: H, body: "{}" });
    expect(dis.status).toBe(200);
    expect((await dis.json()).enabled).toBe(false);
    expect((await getStatus()).enabled).toBe(false);
  });

  it("POST check-duplicate with only project and title returns duplicates array and hasHigh", async () => {
    started.manager.store.upsertProject({ name: "secproj", repo_path: null, base_branch: "main", allowed_commands: [] });
    const r = await fetch(`${base}/api/autopilot/check-duplicate`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ project: "secproj", title: "Some brand new idea" }),
    });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Array.isArray(body.duplicates)).toBe(true);
    expect(typeof body.hasHigh).toBe("boolean");
  });

  it("GET summary with a valid range returns the digest key set and estimate true", async () => {
    const r = await fetch(`${base}/api/autopilot/summary?from=2026-01-01&to=2026-01-02`, { headers: H });
    expect(r.status).toBe(200);
    const body = await r.json();
    expect(Object.keys(body).sort()).toEqual(
      ["blocked", "costUsd", "counts", "estimate", "from", "text", "to", "truncated"].sort(),
    );
    expect(body.estimate).toBe(true);
    expect(body.truncated).toBe(false);
  });
});

describe("autopilot auth rejections", () => {
  describe.each(ROUTES)("$method $path", (route) => {
    it("rejects wrong token with 401 bad_token", async () => {
      const r = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { ...H, "x-controller-token": "nope" },
        body: bodyOf(route),
      });
      expect(r.status).toBe(401);
      expect((await r.json()).error).toBe("bad_token");
    });

    it("rejects foreign Origin with 403 bad_origin", async () => {
      const r = await fetch(`${base}${route.path}`, {
        method: route.method,
        headers: { ...H, origin: "http://evil.example" },
        body: bodyOf(route),
      });
      expect(r.status).toBe(403);
      expect((await r.json()).error).toBe("bad_origin");
    });

    it("rejects foreign Host with 403 bad_host", async () => {
      const res = await new Promise<{ status: number; error?: string }>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: started.policy.port, path: route.path, method: route.method, headers: { ...H, host: "evil.example" } },
          (rs) => {
            let data = "";
            rs.setEncoding("utf8");
            rs.on("data", (c) => (data += c));
            rs.on("end", () => {
              let error: string | undefined;
              try {
                error = JSON.parse(data).error;
              } catch {
                /* ignore */
              }
              resolve({ status: rs.statusCode ?? 0, error });
            });
          },
        );
        req.on("error", reject);
        if (route.body !== undefined) req.write(JSON.stringify(route.body));
        req.end();
      });
      expect(res.status).toBe(403);
      expect(res.error).toBe("bad_host");
    });
  });
});
