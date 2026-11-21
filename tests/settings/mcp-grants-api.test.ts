import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "m".repeat(48);
const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;
const opened: Array<{ dir: string; select?: string }> = [];

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mcpapi-"));
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
    openPath: (a) => {
      opened.push(a);
    },
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

describe("MCP registry routes", () => {
  it("requires the token", async () => {
    expect((await fetch(`${base}/api/mcp`)).status).toBe(401);
    expect((await fetch(`${base}/api/grants`)).status).toBe(401);
    expect((await fetch(`${base}/api/settings/output-dir`)).status).toBe(401);
  });

  it("add preset, toggle, bad id, delete", async () => {
    const add = await fetch(`${base}/api/mcp`, { method: "POST", headers: H, body: JSON.stringify({ preset: "desktop-commander" }) });
    expect(add.status).toBe(201);
    const list = (await (await fetch(`${base}/api/mcp`, { headers: H })).json()) as { servers: Array<{ id: string; enabled: boolean }>; presets: unknown[] };
    expect(list.servers.map((s) => s.id)).toContain("desktop-commander");
    expect(Array.isArray(list.presets)).toBe(true);
    const dup = await fetch(`${base}/api/mcp`, { method: "POST", headers: H, body: JSON.stringify({ preset: "desktop-commander" }) });
    expect(dup.status).toBe(400);
    const put = await fetch(`${base}/api/mcp/desktop-commander`, { method: "PUT", headers: H, body: JSON.stringify({ enabled: false }) });
    expect(((await put.json()) as { server: { enabled: boolean } }).server.enabled).toBe(false);
    expect((await fetch(`${base}/api/mcp`, { method: "POST", headers: H, body: JSON.stringify({ id: "Bad Id", name: "x", kind: "stdio", command: "a" }) })).status).toBe(400);
    expect((await fetch(`${base}/api/mcp/nope`, { method: "PUT", headers: H, body: "{}" })).status).toBe(404);
    expect((await fetch(`${base}/api/mcp/desktop-commander`, { method: "DELETE", headers: H })).status).toBe(200);
  });

  it("probe of a failing server returns ok:false", async () => {
    await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ id: "broken", name: "broken", kind: "stdio", command: process.execPath, args: ["-e", "process.exit(1)"], enabled: true }),
    });
    const r = await fetch(`${base}/api/mcp/broken/probe`, { method: "POST", headers: H });
    expect(r.status).toBe(200);
    expect(((await r.json()) as { ok: boolean }).ok).toBe(false);
  }, 60_000);

  it("redacts header and env values in POST/GET/PUT but keeps them stored", async () => {
    const file = path.join(root, "data", "mcp-servers.json");
    const add = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ id: "remote1", name: "remote", kind: "http", url: "https://example.com/mcp", headers: { Authorization: "Bearer SECRET123" }, enabled: true }),
    });
    expect(add.status).toBe(201);
    expect(await add.text()).not.toContain("SECRET123");
    const addEnv = await fetch(`${base}/api/mcp`, {
      method: "POST",
      headers: H,
      body: JSON.stringify({ id: "local1", name: "local", kind: "stdio", command: "a", env: { API_KEY: "ENVSECRET456" }, enabled: true }),
    });
    expect(addEnv.status).toBe(201);
    expect(await addEnv.text()).not.toContain("ENVSECRET456");
    const text = await (await fetch(`${base}/api/mcp`, { headers: H })).text();
    expect(text).not.toContain("SECRET123");
    expect(text).not.toContain("ENVSECRET456");
    const j = JSON.parse(text) as { servers: Array<{ id: string; headers?: Record<string, string>; env?: Record<string, string> }> };
    expect(j.servers.find((s) => s.id === "remote1")?.headers).toEqual({ Authorization: "***" });
    expect(j.servers.find((s) => s.id === "local1")?.env).toEqual({ API_KEY: "***" });
    expect(fs.readFileSync(file, "utf8")).toContain("SECRET123");
    expect(fs.readFileSync(file, "utf8")).toContain("ENVSECRET456");
    // The UI echoes the redacted view back on a full save: stored values must survive.
    const put = await fetch(`${base}/api/mcp/remote1`, { method: "PUT", headers: H, body: JSON.stringify({ enabled: false, headers: { Authorization: "***" } }) });
    expect(put.status).toBe(200);
    expect(await put.text()).not.toContain("SECRET123");
    const putEnv = await fetch(`${base}/api/mcp/local1`, { method: "PUT", headers: H, body: JSON.stringify({ env: { API_KEY: "***", OTHER: "new" } }) });
    expect(putEnv.status).toBe(200);
    expect(await putEnv.text()).not.toContain("ENVSECRET456");
    const disk = fs.readFileSync(file, "utf8");
    expect(disk).toContain("SECRET123");
    expect(disk).toContain("ENVSECRET456");
    expect(disk).toContain("new");
  });
});

describe("grants routes", () => {
  it("fallback chain builtin -> default -> project, and error paths", async () => {
    const g0 = (await (await fetch(`${base}/api/grants?project=envA`, { headers: H })).json()) as { source: string };
    expect(g0.source).toBe("builtin");
    started.manager.store.upsertProject({ name: "envA", repo_path: null, base_branch: null, allowed_commands: [] });
    const putDef = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ grants: { web: false } }) });
    expect(putDef.status).toBe(200);
    const g1 = (await (await fetch(`${base}/api/grants?project=envA`, { headers: H })).json()) as { source: string; grants: { web: boolean } };
    expect(g1.source).toBe("default");
    expect(g1.grants.web).toBe(false);
    const g1b = (await (await fetch(`${base}/api/grants`, { headers: H })).json()) as { source: string };
    expect(g1b.source).toBe("default");
    const put = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ project: "envA", grants: { web: true } }) });
    expect(put.status).toBe(200);
    const got = (await (await fetch(`${base}/api/grants?project=envA`, { headers: H })).json()) as { grants: { web: boolean }; source: string };
    expect(got.source).toBe("project");
    expect(got.grants.web).toBe(true);
    const unk = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ project: "ghost", grants: {} }) });
    expect(unk.status).toBe(400);
    expect(((await unk.json()) as { message: string }).message).toContain("Không tìm thấy môi trường");
    const bad = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ project: "envA", grants: { extraDirs: [{ path: path.join(root, "nope"), write: false }] } }) });
    expect(bad.status).toBe(400);
  });

  it("default profile (no project): missing extra dir -> 400, valid PUT -> 200 and source default", async () => {
    const missing = path.join(root, "no-such-dir-default");
    const bad = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ grants: { extraDirs: [{ path: missing, write: false }] } }) });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toContain("Thư mục không tồn tại");
    const ok = await fetch(`${base}/api/grants`, { method: "PUT", headers: H, body: JSON.stringify({ grants: { web: true } }) });
    expect(ok.status).toBe(200);
    const got = (await (await fetch(`${base}/api/grants`, { headers: H })).json()) as { source: string };
    expect(got.source).toBe("default");
  });

  it("rejects a project literally named __default__", async () => {
    const r = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "__default__" }) });
    expect(r.status).toBe(400);
    expect(((await r.json()) as { message: string }).message).toContain("dành riêng");
  });
});

describe("output folder routes", () => {
  it("change dir, open-output selects the file, traversal refused", async () => {
    const out = path.join(root, "my-outputs");
    const put = await fetch(`${base}/api/settings/output-dir`, { method: "PUT", headers: H, body: JSON.stringify({ outputDir: out }) });
    expect(put.status).toBe(200);
    const got = (await (await fetch(`${base}/api/settings/output-dir`, { headers: H })).json()) as { outputDir: string; defaultDir: string };
    expect(got.outputDir).toBe(out);
    expect(typeof got.defaultDir).toBe("string");
    const runDir = path.join(root, "rundir1");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "report.md"), "hello");
    started.manager.store.createRun({ id: "rid1", status: "done", prompt: "p", mode: "research", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: runDir });
    const r = await fetch(`${base}/api/runs/rid1/open-output`, { method: "POST", headers: H, body: JSON.stringify({ rel_path: "report.md" }) });
    expect(r.status).toBe(200);
    expect(fs.readFileSync(path.join(out, "rid1", "report.md"), "utf8")).toBe("hello");
    expect(opened.at(-1)?.select).toBe(path.join(out, "rid1", "report.md"));
    const bad = await fetch(`${base}/api/runs/rid1/open-output`, { method: "POST", headers: H, body: JSON.stringify({ rel_path: "../../x" }) });
    expect(bad.status).toBe(400);
  });

  it("outputs/save writes under the group and rejects bad names/groups/missing headers", async () => {
    const hdr = (name: string, group: string): Record<string, string> => ({ "x-controller-token": TOKEN, "x-file-name": name, "x-output-group": group, "content-type": "application/octet-stream" });
    const ok = await fetch(`${base}/api/outputs/save`, { method: "POST", headers: hdr("s1-round-1.docx", "skills/s1"), body: Buffer.from("zip") });
    expect(ok.status).toBe(200);
    const bad = await fetch(`${base}/api/outputs/save`, { method: "POST", headers: hdr("x.docx", "../evil"), body: Buffer.from("z") });
    expect(bad.status).toBe(400);
    const noName = await fetch(`${base}/api/outputs/save`, { method: "POST", headers: { "x-controller-token": TOKEN, "x-output-group": "skills/s1" }, body: Buffer.from("z") });
    expect(noName.status).toBe(400);
    const noGroup = await fetch(`${base}/api/outputs/save`, { method: "POST", headers: { "x-controller-token": TOKEN, "x-file-name": "a.docx" }, body: Buffer.from("z") });
    expect(noGroup.status).toBe(400);
  });
});

describe("secrets and local-only routes", () => {
  it("never serves a run-dir mcp.json (artifact route 404, zip without it)", async () => {
    const runDir = path.join(root, "rundir-secret");
    fs.mkdirSync(runDir, { recursive: true });
    fs.writeFileSync(path.join(runDir, "report.md"), "hello");
    fs.writeFileSync(path.join(runDir, "mcp.json"), '{"mcpServers":{"x":{"env":{"K":"PLAINSECRET"}}}}');
    started.manager.store.createRun({ id: "rid-secret", status: "done", prompt: "p", mode: "research", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: runDir });
    started.manager.store.scanArtifacts("rid-secret", runDir);
    expect((await fetch(`${base}/api/runs/rid-secret/artifacts/mcp.json`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/runs/rid-secret/artifacts/.%2Fmcp.json`, { headers: H })).status).toBe(404);
    expect((await fetch(`${base}/api/runs/rid-secret/artifacts/report.md`, { headers: H })).status).toBe(200);
    const zip = Buffer.from(await (await fetch(`${base}/api/runs/rid-secret/artifacts.zip`, { headers: H })).arrayBuffer());
    expect(zip.includes("report.md")).toBe(true);
    expect(zip.includes("mcp.json")).toBe(false);
    expect(zip.includes("PLAINSECRET")).toBe(false);
  });

  it("refuses connector login and probe when the request looks remote (tunnel)", async () => {
    const post = (p: string): Promise<{ status: number; body: string }> =>
      new Promise((resolve, reject) => {
        const r = http.request({ host: "127.0.0.1", port: started.policy.port, method: "POST", path: p, headers: { ...H, "x-forwarded-for": "100.64.0.1", "content-length": "0" } }, (res) => {
          let b = "";
          res.on("data", (c) => (b += c));
          res.on("end", () => resolve({ status: res.statusCode ?? 0, body: b }));
        });
        r.on("error", reject);
        r.end();
      });
    await fetch(`${base}/api/mcp`, { method: "POST", headers: H, body: JSON.stringify({ id: "tunnelsrv", name: "t", kind: "stdio", command: process.execPath, args: ["-e", "process.exit(1)"], enabled: true }) });
    const login = await post("/api/mcp/cli/login");
    expect(login.status).toBe(403);
    expect(JSON.parse(login.body).error).toBe("local_only");
    const probe = await post("/api/mcp/tunnelsrv/probe");
    expect(probe.status).toBe(403);
    expect(JSON.parse(probe.body).error).toBe("local_only");
  });
});
