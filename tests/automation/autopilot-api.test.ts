import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import http from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AUTOMATION_MAX_WEBHOOKS, validateWebhookUrls, type ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const FIX = path.resolve(__dirname, "..", "..", "fixtures", "real-coding-commit.stream.jsonl");
const TOKEN = "a".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const RESEARCH_TOOLS = ["Agent", "WebSearch", "WebFetch", "Read", "Write"];

let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-apapi-"));
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
    automation: { enabled: false, maxRetries: 0, schedule: null, webhooks: ["https://hooks.example.com/secret/path?token=abc#frag"] },
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

describe("validateWebhookUrls", () => {
  it("accepts valid https and drops duplicates", () => {
    expect(validateWebhookUrls(["https://example.com/a", "https://example.com/a", " https://hooks.example.org/x "])).toEqual([
      "https://example.com/a",
      "https://hooks.example.org/x",
    ]);
  });
  it("rejects bad input", () => {
    expect(() => validateWebhookUrls(["http://example.com/a"])).toThrow(/https/);
    expect(() => validateWebhookUrls(["https://user:pw@example.com/a"])).toThrow(/user:pass/);
    expect(() => validateWebhookUrls(["https://localhost/x"])).toThrow(/nội bộ/);
    expect(() => validateWebhookUrls(["https://10.0.0.1/x"])).toThrow(/nội bộ/);
    expect(() => validateWebhookUrls([42])).toThrow(/chuỗi/);
    expect(() => validateWebhookUrls("https://example.com")).toThrow(/mảng/);
    const many = Array.from({ length: AUTOMATION_MAX_WEBHOOKS + 1 }, (_, i) => `https://example.com/${i}`);
    expect(() => validateWebhookUrls(many)).toThrow(/tối đa/);
  });
  it("error messages have no config: prefix", () => {
    try {
      validateWebhookUrls(["http://example.com"]);
    } catch (e) {
      expect((e as Error).message.startsWith("config:")).toBe(false);
    }
  });
});

describe("autopilot status and enable/disable", () => {
  const get = (p: string) => fetch(`${base}${p}`, { headers: H });
  const post = (p: string) => fetch(`${base}${p}`, { method: "POST", headers: H, body: "{}" });

  it("requires a token", async () => {
    const r = await fetch(`${base}/api/autopilot/status`);
    expect(r.status).toBe(401);
  });
  it("defaults to disabled and masks webhook urls", async () => {
    const r = await get("/api/autopilot/status");
    expect(r.status).toBe(200);
    const text = await r.text();
    const b = JSON.parse(text) as { enabled: boolean; webhookCount: number; webhooks: string[] };
    expect(b.enabled).toBe(false);
    expect(b.webhookCount).toBe(1);
    expect(b.webhooks).toEqual(["https://hooks.example.com/…"]);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("token=abc");
  });
  it("enable then disable", async () => {
    const e = await post("/api/autopilot/enable");
    expect(e.status).toBe(200);
    expect(((await e.json()) as { enabled: boolean }).enabled).toBe(true);
    expect(((await (await get("/api/autopilot/status")).json()) as { enabled: boolean }).enabled).toBe(true);
    const d = await post("/api/autopilot/disable");
    expect(((await d.json()) as { enabled: boolean }).enabled).toBe(false);
    expect(((await (await get("/api/autopilot/status")).json()) as { enabled: boolean }).enabled).toBe(false);
  });
  it("wrong method 405, unknown sub path 404, array body 400", async () => {
    expect((await fetch(`${base}/api/autopilot/status`, { method: "PUT", headers: H, body: "{}" })).status).toBe(405);
    expect((await get("/api/autopilot/enable")).status).toBe(405);
    expect((await get("/api/autopilot/nope")).status).toBe(404);
    expect((await fetch(`${base}/api/autopilot/enable`, { method: "POST", headers: H, body: "[]" })).status).toBe(400);
  });
});

describe("autopilot schedule and webhooks update", () => {
  const put = (p: string, body: unknown) =>
    fetch(`${base}${p}`, { method: "PUT", headers: H, body: typeof body === "string" ? body : JSON.stringify(body) });
  const status = async () =>
    (await (await fetch(`${base}/api/autopilot/status`, { headers: H })).json()) as { schedule: string | null; webhooks: string[]; webhookCount: number };

  it("sets a valid schedule and clears it with null", async () => {
    const r = await put("/api/autopilot/schedule", { schedule: "every 15m" });
    expect(r.status).toBe(200);
    expect((await status()).schedule).toBe("every 15m");
    const c = await put("/api/autopilot/schedule", { schedule: null });
    expect(c.status).toBe(200);
    expect((await status()).schedule).toBeNull();
  });
  it("rejects bad schedules", async () => {
    for (const body of [{ schedule: "every 0m" }, { schedule: 5 }, { schedule: [] }, { schedule: "every 5m", extra: 1 }, { schedule: "a".repeat(500) }, {}]) {
      const r = await put("/api/autopilot/schedule", body);
      expect(r.status).toBe(400);
    }
    const bad = await put("/api/autopilot/schedule", { schedule: "every 0m" });
    expect(((await bad.json()) as { error: string }).error).toBe("invalid_schedule");
    expect((await put("/api/autopilot/schedule", "{broken")).status).toBe(400);
  });
  it("sets valid webhooks and never echoes the full path", async () => {
    const r = await put("/api/autopilot/webhooks", { webhooks: ["https://hooks.example.org/a/b/c?k=1", "https://example.com/z"] });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain("/a/b/c");
    expect(text).not.toContain("k=1");
    const s = await status();
    expect(s.webhookCount).toBe(2);
    expect(s.webhooks).toEqual(["https://hooks.example.org/…", "https://example.com/…"]);
  });
  it("rejects bad webhooks", async () => {
    const eleven = Array.from({ length: 11 }, (_, i) => `https://example.com/${i}`);
    const cases: unknown[] = [
      { webhooks: ["http://example.com/a"] },
      { webhooks: ["https://user:pw@example.com/a"] },
      { webhooks: ["https://localhost/x"] },
      { webhooks: ["https://192.168.1.5/x"] },
      { webhooks: eleven },
      { webhooks: [42] },
      { webhooks: "https://example.com" },
      { webhooks: [], extra: 1 },
    ];
    for (const body of cases) {
      const r = await put("/api/autopilot/webhooks", body);
      expect(r.status).toBe(400);
    }
    const r = await put("/api/autopilot/webhooks", { webhooks: [42] });
    expect(((await r.json()) as { error: string }).error).toBe("invalid_webhooks");
    expect((await put("/api/autopilot/webhooks", "{broken")).status).toBe(400);
  });
});

describe("autopilot summary", () => {
  const get = (p: string) => fetch(`${base}${p}`, { headers: H });
  it("requires a token and rejects bad dates", async () => {
    expect((await fetch(`${base}/api/autopilot/summary`)).status).toBe(401);
    expect((await get("/api/autopilot/summary?from=abc")).status).toBe(400);
    expect((await get("/api/autopilot/summary?to=2026-13-45")).status).toBe(400);
    expect((await get("/api/autopilot/summary?from=2026-10-30&to=2026-10-01")).status).toBe(400);
  });
  it("counts seeded runs in range and reports cost, blocked and truncated", async () => {
    const store = started.manager.store;
    const mk = (id: string, status: "done" | "error", cost: number) => {
      store.createRun({
        id, status: "running", prompt: "p", mode: "coding", model: "sonnet", session_id: null, parent_run_id: null,
        project: "default", claude_version: null, run_dir: root, kind: "research",
      });
      store.updateRun(id, { status, cost_usd_est: cost });
    };
    mk("sum-a", "done", 0.5);
    mk("sum-b", "done", 0.25);
    mk("sum-c", "error", 0.25);
    const r = await get("/api/autopilot/summary");
    expect(r.status).toBe(200);
    const b = (await r.json()) as { counts: { done: number; error: number; total: number }; costUsd: number; text: string; estimate: boolean; truncated: boolean; blocked: string[] };
    expect(b.counts.done).toBe(2);
    expect(b.counts.error).toBe(1);
    expect(b.counts.total).toBe(3);
    expect(b.costUsd).toBe(1);
    expect(b.estimate).toBe(true);
    expect(b.truncated).toBe(false);
    expect(Array.isArray(b.blocked)).toBe(true);
    expect(b.text).toContain("ước tính");
    const old = await get("/api/autopilot/summary?from=2000-01-01&to=2000-01-02");
    expect(((await old.json()) as { counts: { total: number } }).counts.total).toBe(0);
  });
});

describe("autopilot check-duplicate", () => {
  const post = (body: unknown) =>
    fetch(`${base}/api/autopilot/check-duplicate`, { method: "POST", headers: H, body: typeof body === "string" ? body : JSON.stringify(body) });
  it("requires a token", async () => {
    expect((await fetch(`${base}/api/autopilot/check-duplicate`, { method: "POST", body: "{}" })).status).toBe(401);
  });
  it("finds a near-identical queued idea and ignores unrelated ones", async () => {
    started.manager.store.upsertProject({ name: "dupproj", repo_path: null, base_branch: "main", allowed_commands: [] });
    started.manager.queue.addCommands(
      "dupproj",
      [{ id: "d1", title: "Thêm nút xuất báo cáo PDF", body: "Thêm nút xuất báo cáo PDF cho trang lịch sử", files: ["ui/src/History.tsx"] }],
      { hasRepo: true },
    );
    const before = JSON.stringify(started.manager.queue.list("dupproj"));
    const r = await post({ project: "dupproj", title: "Thêm nút xuất báo cáo PDF", prompt: "Thêm nút xuất báo cáo PDF cho trang lịch sử", files: ["ui/src/History.tsx"] });
    expect(r.status).toBe(200);
    const b = (await r.json()) as { duplicates: { id: string; level: string }[]; hasHigh: boolean };
    expect(b.duplicates[0]?.id).toBe("d1");
    expect(b.duplicates[0]?.level).toBe("high");
    expect(b.hasHigh).toBe(true);
    const other = await post({ project: "dupproj", title: "Sửa lỗi cấu hình đường hầm Tailscale" });
    expect(((await other.json()) as { duplicates: unknown[] }).duplicates).toEqual([]);
    expect(JSON.stringify(started.manager.queue.list("dupproj"))).toBe(before);
  });
  it("404 for unknown project, 400 for bad input", async () => {
    expect((await post({ project: "nope-zzz", title: "x" })).status).toBe(404);
    const bad: unknown[] = [
      { project: "dupproj" },
      { project: "dupproj", title: "x", files: "a.ts" },
      { project: "dupproj", title: "x", extra: 1 },
      { project: "dupproj", title: "a".repeat(201) },
      { project: "dupproj", title: "x", prompt: 5 },
      { project: "dupproj", title: "x", files: [1] },
      { project: "dupproj", title: "x", files: Array.from({ length: 51 }, () => "a") },
      [],
    ];
    for (const body of bad) expect((await post(body)).status).toBe(400);
    expect((await post("{broken")).status).toBe(400);
  });
});

describe("body errors", () => {
  it("broken JSON on an existing route gives 400, not 500", async () => {
    const r = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: "{not json" });
    expect(r.status).toBe(400);
  });

  it("body over 256 KB gives 413 payload_too_large and the client receives the response", async () => {
    const payload = JSON.stringify({ name: "x", pad: "a".repeat(300 * 1024) });
    const result = await new Promise<{ status: number; body: string }>((resolve, reject) => {
      const req = http.request(
        `${base}/api/projects`,
        { method: "POST", headers: { ...H, "content-length": Buffer.byteLength(payload) } },
        (res) => {
          let b = "";
          res.setEncoding("utf8");
          res.on("data", (c: string) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
        },
      );
      req.on("error", reject);
      req.end(payload);
    });
    expect(result.status).toBe(413);
    expect((JSON.parse(result.body) as { error: string }).error).toBe("payload_too_large");
  });
});
