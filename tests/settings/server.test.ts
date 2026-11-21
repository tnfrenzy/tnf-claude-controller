import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";
import { runGit } from "../../src/core/git/git.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const RESEARCH_TOOLS = ["Agent"];

let started: StartedServer;
let base: string;
let root: string;
let testConfig: ControllerConfig;
const TOKEN = "t".repeat(48);
const opened: string[] = [];

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-srv-"));
  const config: ControllerConfig = {
    repoRoot: root,
    claudePath: null,
    models: [{ id: "haiku", label: "haiku" }, { id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { host: "127.0.0.1", port: 0, allowedOrigins: ["https://pc.tail1234.ts.net"] },
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
      research: { allowedTools: RESEARCH_TOOLS, agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
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
  testConfig = config;
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles", FAKE_CLAUDE_WRITE_ARTIFACTS: "1" },
    openDirectory: (dir) => opened.push(dir),
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const H = { "x-controller-token": TOKEN, "content-type": "application/json" };

describe("static web manifest", () => {
  it("serves /manifest.webmanifest as manifest+json with standalone display and a token-free start_url", async () => {
    const staticDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-static-"));
    fs.writeFileSync(path.join(staticDir, "index.html"), "<!doctype html><title>x</title>");
    fs.writeFileSync(path.join(staticDir, "manifest.webmanifest"), JSON.stringify({ name: "TNF CLI", display: "standalone", start_url: "/", scope: "/" }));
    const s = await startServer({ config: testConfig, port: 0, token: "m".repeat(48), staticDir });
    try {
      const r = await fetch(`http://127.0.0.1:${s.policy.port}/manifest.webmanifest`);
      expect(r.status).toBe(200);
      expect(r.headers.get("content-type")).toContain("application/manifest+json");
      const j = (await r.json()) as { display: string; start_url: string };
      expect(j.display).toBe("standalone");
      expect(j.start_url).not.toMatch(/token/i);
    } finally {
      await s.close();
      fs.rmSync(staticDir, { recursive: true, force: true });
    }
  });
});

describe("API security", () => {
  it("rejects missing token with 401", async () => {
    const r = await fetch(`${base}/api/runs`);
    expect(r.status).toBe(401);
  });
  it("rejects wrong token", async () => {
    const r = await fetch(`${base}/api/runs`, { headers: { "x-controller-token": "nope" } });
    expect(r.status).toBe(401);
  });
  it("rejects foreign Origin with 403", async () => {
    const r = await fetch(`${base}/api/runs`, { headers: { ...H, origin: "http://evil.example" } });
    expect(r.status).toBe(403);
    expect((await r.json()).error).toBe("bad_origin");
  });
  it("rejects foreign Host with 403 (DNS rebinding)", async () => {
    // fetch() does not allow overriding Host, so use a raw request.
    const status = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: started.policy.port, path: "/api/runs", headers: { ...H, host: "evil.example" } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(status).toBe(403);
  });
  it("accepts same-origin with token", async () => {
    const r = await fetch(`${base}/api/runs`, { headers: { ...H, origin: `http://localhost:${started.policy.port}` } });
    expect(r.status).toBe(200);
  });
  it("tunnel origin from server.allowedOrigins passes (HTTP + WS), its Host passes, look-alikes still 403", async () => {
    const tunnel = "https://pc.tail1234.ts.net";
    const ok = await fetch(`${base}/api/runs`, { headers: { ...H, origin: "HTTPS://PC.tail1234.ts.net" } });
    expect(ok.status).toBe(200);
    const lookalike = await fetch(`${base}/api/runs`, { headers: { ...H, origin: "https://pc.tail1234.ts.net.evil.example" } });
    expect(lookalike.status).toBe(403);
    const httpVariant = await fetch(`${base}/api/runs`, { headers: { ...H, origin: "http://pc.tail1234.ts.net" } });
    expect(httpVariant.status).toBe(403);
    // Host as the tunnel rewrites it (no port), with the tunnel Origin
    const hostStatus = await new Promise<number>((resolve, reject) => {
      const req = http.request({ host: "127.0.0.1", port: started.policy.port, path: "/api/runs", headers: { ...H, host: "pc.tail1234.ts.net", origin: tunnel } }, (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      });
      req.on("error", reject);
      req.end();
    });
    expect(hostStatus).toBe(200);
    // token is still required through the tunnel
    const noToken = await fetch(`${base}/api/runs`, { headers: { origin: tunnel } });
    expect(noToken.status).toBe(401);
    // WebSocket with the tunnel Origin + token subprotocol
    const first = await new Promise<string>((resolve, reject) => {
      const ws = new WebSocket(`ws://127.0.0.1:${started.policy.port}/ws/overview`, [`tnf-token.${TOKEN}`], { headers: { origin: tunnel } });
      ws.on("error", reject);
      ws.on("message", (d) => {
        resolve((JSON.parse(String(d)) as { type: string }).type);
        ws.close();
      });
    });
    expect(first).toBe("runs");
    const wsBad = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${started.policy.port}/ws/overview`, [`tnf-token.${TOKEN}`], { headers: { origin: "https://other.ts.net" } });
      ws.on("error", () => resolve(true));
      ws.on("open", () => { ws.close(); resolve(false); });
    });
    expect(wsBad).toBe(true);
    // CSP of the UI shell names the tunnel for fetch and WebSocket; token never appears in headers
    const page = await fetch(`${base}/`);
    const csp = page.headers.get("content-security-policy") ?? "";
    expect(csp).toContain(`connect-src 'self' blob: ws://127.0.0.1:* ws://localhost:* ${tunnel} wss://pc.tail1234.ts.net`);
    expect(csp).not.toContain(TOKEN);
  });
  it("POST /api/runs with max_role_calls over the ceiling returns 400 with a Vietnamese message", async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "sửa mã", kind: "coding", max_role_calls: 31 }) });
    expect(r.status).toBe(400);
    const j = (await r.json()) as { error: string; message: string };
    expect(j.error).toBe("start_failed");
    expect(j.message).toContain("Số lượt gọi vai tối đa phải là số nguyên từ 1 đến 30.");
  });
  it("POST /api/runs rejects a non-boolean scout with a Vietnamese 400 and accepts scout:true", async () => {
    const bad = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "x", scout: "yes" }) });
    expect(bad.status).toBe(400);
    const j = (await bad.json()) as { error: string; message: string };
    expect(j.error).toBe("bad_request");
    expect(j.message).toBe("scout phải là true/false.");
    // scout only matters for coding runs; a research run with scout:true is accepted and unchanged
    const ok = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "Phân tích", kind: "research", scout: true }) });
    expect(ok.status).toBe(201);
    const { run } = (await ok.json()) as { run: { id: string; kind: string } };
    expect(run.kind).toBe("research");
    await started.manager.waitFor(run.id);
  });
  it("blocks path traversal in artifacts", async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "x" }) });
    const { run } = (await r.json()) as { run: { id: string } };
    await started.manager.waitFor(run.id);
    const bad = await fetch(`${base}/api/runs/${run.id}/artifacts/..%2F..%2Fpackage.json`, { headers: H });
    expect(bad.status).toBe(404);
  });
  it("WebSocket without token is refused; with token subprotocol it syncs", async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "ws test" }) });
    const { run } = (await r.json()) as { run: { id: string } };
    await started.manager.waitFor(run.id);

    const refused = await new Promise<boolean>((resolve) => {
      const ws = new WebSocket(`ws://127.0.0.1:${started.policy.port}/ws/runs/${run.id}`, { headers: { origin: base } });
      ws.on("error", () => resolve(true));
      ws.on("open", () => {
        ws.close();
        resolve(false);
      });
    });
    expect(refused).toBe(true);

    const msgs = await new Promise<string[]>((resolve, reject) => {
      const got: string[] = [];
      const ws = new WebSocket(`ws://127.0.0.1:${started.policy.port}/ws/runs/${run.id}`, [`tnf-token.${TOKEN}`], { headers: { origin: base } });
      ws.on("error", reject);
      ws.on("message", (d) => {
        const m = JSON.parse(String(d)) as { type: string };
        got.push(m.type);
        if (m.type === "synced") {
          ws.close();
          resolve(got);
        }
      });
    });
    expect(msgs[0]).toBe("run");
    expect(msgs).toContain("event");
    expect(msgs.at(-1)).toBe("synced");
  });
});

describe("API behaviour", () => {
  it("creates a run, lists it, serves report and events, refuses cancel when done", async () => {
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "Phân tích", budget_usd: 1, max_turns: 5 }) });
    expect(r.status).toBe(201);
    const { run } = (await r.json()) as { run: { id: string } };
    await started.manager.waitFor(run.id);

    const one = (await (await fetch(`${base}/api/runs/${run.id}`, { headers: H })).json()) as { run: { status: string }; artifacts: { rel_path: string }[] };
    expect(one.run.status).toBe("done");
    expect(one.artifacts.map((a) => a.rel_path)).toContain("report.md");

    const rep = await fetch(`${base}/api/runs/${run.id}/report`, { headers: H });
    expect(rep.status).toBe(200);
    expect(await rep.text()).toContain("Báo cáo");

    const ev = (await (await fetch(`${base}/api/runs/${run.id}/events`, { headers: H })).json()) as { events: unknown[] };
    expect(ev.events.length).toBeGreaterThan(5);

    const c = await fetch(`${base}/api/runs/${run.id}/cancel`, { method: "POST", headers: H });
    expect(c.status).toBe(409);

    const list = (await (await fetch(`${base}/api/runs?q=Phân`, { headers: H })).json()) as { runs: unknown[] };
    expect(list.runs.length).toBeGreaterThanOrEqual(1);

    const fu = await fetch(`${base}/api/runs/${run.id}/followup`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "tiếp" }) });
    expect(fu.status).toBe(201);
  });
  it("no project: research works with roles and single; coding is refused with a Vietnamese 400", async () => {
    for (const roles of [true, false]) {
      const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "việc ngoài môi trường", kind: "research", roles }) });
      expect(r.status).toBe(201);
      const { run } = (await r.json()) as { run: { id: string; kind: string } };
      expect(run.kind).toBe("research");
      await started.manager.waitFor(run.id);
    }
    const bad = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "sửa mã", kind: "coding" }) });
    expect(bad.status).toBe(400);
    const j = (await bad.json()) as { message: string };
    expect(j.message).toMatch(/project|repo/i);
  });
  it("extra agents and skills: valid -> 201 with the agent in roles.json; bad input -> 400 Vietnamese; no token -> 401", async () => {
    fs.writeFileSync(path.join(root, "roles.json"), JSON.stringify({ searcher: { description: "s", prompt: "p", tools: ["WebSearch"] } }), "utf8");
    const post = (b: unknown, headers: Record<string, string> = H) => fetch(`${base}/api/runs`, { method: "POST", headers, body: JSON.stringify(b) });
    const agent = { description: "Reviews wording", prompt: "You review wording.", tools: ["Read"] };
    const ok = await post({ prompt: "x", agents: { "wording-reviewer": agent }, skills: ["foo"] });
    expect(ok.status).toBe(201);
    const { run } = (await ok.json()) as { run: { id: string } };
    await started.manager.waitFor(run.id);
    const roles = JSON.parse(fs.readFileSync(path.join(root, "data", "runs", run.id, "roles.json"), "utf8")) as Record<string, unknown>;
    expect(Object.keys(roles)).toEqual(["searcher", "wording-reviewer"]);
    for (const bad of [
      { agents: { "Bad Name": agent } },
      { agents: { searcher: agent } },
      { agents: { x: { ...agent, tools: ["Bash"] } } },
      { agents: [agent] },
      { skills: ["bad name"] },
      { skills: "foo" },
      { roles: false, agents: { x: agent } },
    ]) {
      const r = await post({ prompt: "x", ...bad });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { message: string }).message).toMatch(/[ạăâêôơưđ]|agent|skill|single/i);
    }
    const single = await post({ prompt: "x", roles: false, agents: { x: agent } });
    expect(((await single.json()) as { message: string }).message).toMatch(/single/);
    expect((await post({ prompt: "x", skills: ["foo"] }, { "content-type": "application/json" })).status).toBe(401);
  });
  it("library API: roles and items CRUD, Vietnamese errors, token required", async () => {
    fs.writeFileSync(path.join(root, "roles.json"), JSON.stringify({ searcher: { description: "s", prompt: "p", tools: ["WebSearch"] } }), "utf8");
    const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = H) =>
      fetch(`${base}${url}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    expect((await call("GET", "/api/library", undefined, { "content-type": "application/json" })).status).toBe(401);
    const r = await call("POST", "/api/library/roles", { id: "wording", description: "Soát câu chữ", prompt: "Soát.", tools: ["Read"] });
    expect(r.status).toBe(201);
    expect((await call("POST", "/api/library/roles", { id: "x", description: "d", prompt: "p", tools: ["Bash"] })).status).toBe(400);
    expect((await call("POST", "/api/library/roles", { id: "searcher", description: "d", prompt: "p" })).status).toBe(400);
    const it1 = await call("POST", "/api/library/items", { name: "Quy tắc", type: "skill", content: "nội dung", roleIds: ["wording", "searcher"] });
    expect(it1.status).toBe(201);
    const item = ((await it1.json()) as { item: { id: string } }).item;
    const bad = await call("POST", "/api/library/items", { name: "x", type: "skill", content: "y", roleIds: ["ghost"] });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { message: string }).message).toMatch(/không tồn tại/);
    expect((await call("PUT", `/api/library/items/${item.id}`, { roleIds: ["searcher"] })).status).toBe(200);
    const list = (await (await call("GET", "/api/library")).json()) as { roles: { id: string }[]; items: { id: string; roleIds: string[] }[]; builtinRoles: string[] };
    expect(list.roles.map((x) => x.id)).toEqual(["wording"]);
    expect(list.items.find((x) => x.id === item.id)!.roleIds).toEqual(["searcher"]);
    expect(list.builtinRoles).toContain("searcher");
    expect((await call("DELETE", `/api/library/items/${item.id}`)).status).toBe(200);
    expect((await call("DELETE", "/api/library/roles/wording")).status).toBe(200);
    expect((await call("DELETE", "/api/library/roles/wording")).status).toBe(404);
  });
  describe("skills API", () => {
    const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = H) =>
      fetch(`${base}${url}`, { method, headers, ...(body === undefined ? {} : { body: typeof body === "string" ? body : JSON.stringify(body) }) });
    const files = { "SKILL.md": "# Skill\nNội dung" };
    it("CRUD with Vietnamese errors, token required", async () => {
      expect((await call("GET", "/api/skills", undefined, { "content-type": "application/json" })).status).toBe(401);
      const c = await call("POST", "/api/skills", { slug: "bao-gia", title: "Báo giá", goal: "g", files });
      expect(c.status).toBe(201);
      expect((await call("POST", "/api/skills", { slug: "bao-gia", title: "Báo giá", goal: "g", files })).status).toBe(409);
      const auto = await call("POST", "/api/skills", { title: "Báo giá thang máy", goal: "g", files });
      expect(auto.status).toBe(201);
      expect(((await auto.json()) as { meta: { slug: string } }).meta.slug).toBe("bao-gia-thang-may");
      const bad = await call("POST", "/api/skills", { title: "!!!", goal: "g", files });
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { message: string }).message).toMatch(/slug/i);
      const list = (await (await call("GET", "/api/skills")).json()) as { skills: { slug: string }[] };
      expect(list.skills.map((s) => s.slug)).toContain("bao-gia");
      expect((await call("GET", "/api/skills/bao-gia")).status).toBe(200);
      expect((await call("GET", "/api/skills/khong-co")).status).toBe(404);
      const badSlug = await call("GET", "/api/skills/Bad_Slug");
      expect(badSlug.status).toBe(400);
      expect(((await badSlug.json()) as { message: string }).message).toMatch(/không hợp lệ/);
      const put = await call("PUT", "/api/skills/bao-gia", { title: "Báo giá 2", files: { "SKILL.md": "# v2", "rules.md": "r" } });
      expect(put.status).toBe(200);
      expect(((await put.json()) as { meta: { version: number } }).meta.version).toBe(2);
      const put2 = await call("PUT", "/api/skills/bao-gia", { files: { "SKILL.md": "# v3" } });
      expect(Object.keys(((await put2.json()) as { files: object }).files)).not.toContain("rules.md");
      expect(await (await call("DELETE", "/api/skills/bao-gia")).json()).toEqual({ ok: true });
      expect((await call("GET", "/api/skills/bao-gia")).status).toBe(404);
      await call("DELETE", "/api/skills/bao-gia-thang-may");
    });
    it("zip download: excludes holdout and rounds, 404 unknown, token required", async () => {
      const f = {
        "SKILL.md": "# Zip skill",
        "examples/train-1.json": JSON.stringify({ a: 1 }),
        "examples/holdout-1.json": JSON.stringify({ b: 2 }),
        "rounds.json": JSON.stringify({ version: 1, rounds: [] }),
      };
      expect((await call("POST", "/api/skills", { slug: "zip-skill", title: "Zip", goal: "g", files: f })).status).toBe(201);
      const z = await call("GET", "/api/skills/zip-skill/zip");
      expect(z.status).toBe(200);
      expect(z.headers.get("content-type")).toBe("application/zip");
      expect(z.headers.get("content-disposition")).toContain("zip-skill.zip");
      const buf = Buffer.from(await z.arrayBuffer());
      expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
      const text = buf.toString("latin1");
      expect(text).toContain("SKILL.md");
      expect(text).toContain("examples/train-1.json");
      expect(text).not.toContain("holdout-1");
      expect(text).not.toContain("rounds.json");
      expect((await call("GET", "/api/skills/ghost/zip")).status).toBe(404);
      expect((await call("GET", "/api/skills/zip-skill/zip", undefined, { "content-type": "application/json" })).status).toBe(401);
      await call("DELETE", "/api/skills/zip-skill");
    });
    it("bad JSON and oversized body -> 400 Vietnamese", async () => {
      const bad = await call("POST", "/api/skills", "{not json");
      expect(bad.status).toBe(400);
      expect(((await bad.json()) as { message: string }).message).toBe("JSON không hợp lệ.");
      const big = await call("POST", "/api/skills", JSON.stringify({ slug: "big", title: "t", goal: "g", files: { "SKILL.md": "x".repeat(2.6 * 1024 * 1024) } }));
      expect(big.status).toBe(400);
      expect(((await big.json()) as { message: string }).message).toBe("Nội dung quá lớn.");
    });
  });
  it("role catalog API: search without accents, add to library, 409 twice, 404 unknown, token required", async () => {
    fs.writeFileSync(path.join(root, "roles.json"), JSON.stringify({ searcher: { description: "s", prompt: "p", tools: ["WebSearch"] } }), "utf8");
    fs.mkdirSync(path.join(root, "config"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "config", "roles-catalog.json"),
      JSON.stringify([
        { id: "qa-tester", name: "QA tester", description: "Kiểm thử chấp nhận", tags: ["qa", "kiểm thử"], prompt: "Kiểm thử.", tools: ["Read"] },
        { id: "translator-vi", name: "Translator", description: "Dịch Việt-Anh", tags: ["dịch"], prompt: "Dịch.", tools: ["Read"] },
      ]),
      "utf8",
    );
    const call = (method: string, url: string, headers: Record<string, string> = H) => fetch(`${base}${url}`, { method, headers });
    expect((await call("GET", "/api/role-catalog", { "content-type": "application/json" })).status).toBe(401);
    const all = (await (await call("GET", "/api/role-catalog")).json()) as { roles: { id: string }[]; in_library: string[] };
    expect(all.roles.map((r) => r.id)).toEqual(["qa-tester", "translator-vi"]);
    const found = (await (await call("GET", "/api/role-catalog?q=kiem%20thu")).json()) as { roles: { id: string }[] };
    expect(found.roles.map((r) => r.id)).toEqual(["qa-tester"]);
    const add = await call("POST", "/api/library/roles/from-catalog/qa-tester");
    expect(add.status).toBe(201);
    expect(((await add.json()) as { role: { id: string; tools: string[] } }).role.tools).toEqual(["Read"]);
    expect((await call("POST", "/api/library/roles/from-catalog/qa-tester")).status).toBe(409);
    expect((await call("POST", "/api/library/roles/from-catalog/ghost")).status).toBe(404);
    const after = (await (await call("GET", "/api/role-catalog")).json()) as { in_library: string[] };
    expect(after.in_library).toContain("qa-tester");
    await call("DELETE", "/api/library/roles/qa-tester");
  });
  it("projects: validate, create (repo + label), list; rejects bad allowed_commands and non-repos", async () => {
    // throwaway repo
    const repo = path.join(root, "proj-repo");
    fs.mkdirSync(repo, { recursive: true });
    const g = (args: string[]) => {
      const res = runGit(repo, args);
      if (res.code !== 0) throw new Error(res.stderr);
    };
    g(["init", "-b", "main"]);
    g(["config", "user.name", "T"]);
    g(["config", "user.email", "t@example.com"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "a");
    g(["add", "-A"]);
    g(["commit", "-m", "init"]);

    const bad = (await (await fetch(`${base}/api/projects/validate`, { method: "POST", headers: H, body: JSON.stringify({ repo_path: root, base_branch: "main" }) })).json()) as { ok: boolean; error: string };
    expect(bad.ok).toBe(false);
    expect(bad.error).toMatch(/git repo/);
    const good = (await (await fetch(`${base}/api/projects/validate`, { method: "POST", headers: H, body: JSON.stringify({ repo_path: repo, base_branch: "main" }) })).json()) as { ok: boolean; head_sha: string; dirty: boolean; branches: string[] };
    expect(good.ok).toBe(true);
    expect(good.head_sha).toMatch(/^[0-9a-f]{40}$/);
    expect(good.branches).toContain("main");

    const created = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "spike", repo_path: repo, base_branch: "main", allowed_commands: ["Bash(node *)"] }) });
    expect(created.status).toBe(201);
    expect(((await created.json()) as { project: { repo_path: string } }).project.repo_path).toBe(repo);
    const label = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "nhãn" }) });
    expect(label.status).toBe(201);
    const invalid = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "x", repo_path: repo, allowed_commands: ["Bash(a && b*)"] }) });
    expect(invalid.status).toBe(400);
    expect(((await invalid.json()) as { message: string }).message).toMatch(/allowed_commands/);
    const notRepo = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ name: "y", repo_path: root }) });
    expect(notRepo.status).toBe(400);
    const noName = await fetch(`${base}/api/projects`, { method: "POST", headers: H, body: JSON.stringify({ repo_path: repo }) });
    expect(noName.status).toBe(400);

    const list = (await (await fetch(`${base}/api/projects`, { headers: H })).json()) as { projects: { name: string; repo_path: string | null; allowed_commands: string[] }[] };
    const spike = list.projects.find((p) => p.name === "spike")!;
    expect(spike.repo_path).toBe(repo);
    expect(spike.allowed_commands).toEqual(["Bash(node *)"]);
    expect(list.projects.find((p) => p.name === "nhãn")!.repo_path).toBeNull();

    // a coding run through the API lands in a worktree
    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "sửa", project: "spike" }) });
    expect(r.status).toBe(201);
    const { run } = (await r.json()) as { run: { id: string; kind: string; branch: string } };
    expect(run.kind).toBe("coding");
    expect(run.branch).toBe(`tnf/spike/${run.id}`);
    await started.manager.waitFor(run.id);
    // the client's kind is ignored when the project has a repo
    const research = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "x", project: "spike", kind: "research" }) });
    const researchRun = ((await research.json()) as { run: { id: string; kind: string } }).run;
    expect(researchRun.kind).toBe("coding");
    await started.manager.waitFor(researchRun.id);
    const noKind = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "x", project: "spike" }) });
    expect(((await noKind.json()) as { run: { id: string; kind: string } }).run.kind).toBe("coding");
    // a repo-less project is research (used below for the research-only API checks)
    const labelRun = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "x", project: "nhãn" }) });
    const researchRun2 = ((await labelRun.json()) as { run: { id: string; kind: string } }).run;
    expect(researchRun2.kind).toBe("research");
    await started.manager.waitFor(researchRun2.id);
    // a repo-less label project asked for coding still fails
    const noRepo = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "x", project: "nhãn", kind: "coding" }) });
    expect(noRepo.status).toBe(400);
    expect(((await noRepo.json()) as { message: string }).message).toMatch(/chưa gắn repo/);

    // GET /api/runs/:id carries the environment the UI shows (repo, base branch, worktree existence, stream path)
    const meta = (await (await fetch(`${base}/api/runs/${run.id}`, { headers: H })).json()) as { run: { worktree_path: string; run_dir: string }; worktree_exists: boolean; repo_path: string; base_branch: string; stream_path: string };
    expect(meta.repo_path).toBe(repo);
    expect(meta.base_branch).toBe("main");
    expect(meta.worktree_exists).toBe(true);
    expect(meta.stream_path.endsWith(path.join(run.id, "stream.jsonl"))).toBe(true);

    // open-dir only ever opens the two paths stored in the DB (never a path from the request)
    opened.length = 0;
    const od = await fetch(`${base}/api/runs/${run.id}/open-dir`, { method: "POST", headers: H, body: JSON.stringify({ target: "worktree", path: "C:\\Windows" }) });
    expect(od.status).toBe(200);
    expect(opened).toEqual([meta.run.worktree_path]);
    await fetch(`${base}/api/runs/${run.id}/open-dir`, { method: "POST", headers: H, body: JSON.stringify({}) });
    expect(opened[1]).toBe(meta.run.run_dir);
    const odNone = await fetch(`${base}/api/runs/${researchRun2.id}/open-dir`, { method: "POST", headers: H, body: JSON.stringify({ target: "worktree" }) });
    expect(odNone.status).toBe(400);

    // cleanup-worktree: refused for a research run; removes worktree + tnf/ branch for the finished coding run
    const cwBad = await fetch(`${base}/api/runs/${researchRun2.id}/cleanup-worktree`, { method: "POST", headers: H });
    expect(cwBad.status).toBe(400);
    const cw = await fetch(`${base}/api/runs/${run.id}/cleanup-worktree`, { method: "POST", headers: H });
    expect(cw.status).toBe(200);
    const cwBody = (await cw.json()) as { worktree_removed: boolean; branch_deleted: boolean };
    expect(cwBody.worktree_removed).toBe(true);
    expect(cwBody.branch_deleted).toBe(true);
    expect(fs.existsSync(meta.run.worktree_path)).toBe(false);
    expect(runGit(repo, ["for-each-ref", "--format=%(refname:short)", "refs/heads/"]).stdout).not.toContain(`tnf/spike/${run.id}`);
    const after = (await (await fetch(`${base}/api/runs/${run.id}`, { headers: H })).json()) as { worktree_exists: boolean };
    expect(after.worktree_exists).toBe(false);
    const odGone = await fetch(`${base}/api/runs/${run.id}/open-dir`, { method: "POST", headers: H, body: JSON.stringify({ target: "worktree" }) });
    expect(odGone.status).toBe(400);
  }, 120_000);
  it("inbox: stage before the run, attach to an existing run, prompt carries the inbox path, zip of all artifacts", async () => {
    const raw = { "x-controller-token": TOKEN, "content-type": "application/octet-stream" };
    // stage a file before the run exists
    const st = await fetch(`${base}/api/inbox`, { method: "POST", headers: { ...raw, "x-file-name": "spec.md" }, body: "# spec" });
    expect(st.status).toBe(201);
    const { stage_id } = (await st.json()) as { stage_id: string };
    const st2 = await fetch(`${base}/api/inbox?stage=${stage_id}`, { method: "POST", headers: { ...raw, "x-file-name": "data.csv" }, body: "a,b" });
    expect(((await st2.json()) as { files: unknown[] }).files.length).toBe(2);
    // refused names / sizes / stage ids
    expect((await fetch(`${base}/api/inbox`, { method: "POST", headers: { ...raw, "x-file-name": "../x.txt" }, body: "x" })).status).toBe(400);
    expect((await fetch(`${base}/api/inbox`, { method: "POST", headers: { ...raw, "x-file-name": "a b.txt" }, body: "x" })).status).toBe(400);
    expect((await fetch(`${base}/api/inbox?stage=../etc`, { method: "POST", headers: { ...raw, "x-file-name": "a.txt" }, body: "x" })).status).toBe(400);
    const big = await fetch(`${base}/api/inbox`, { method: "POST", headers: { ...raw, "x-file-name": "big.bin" }, body: new Uint8Array(5 * 1024 * 1024 + 1) }).catch(() => null);
    expect(big === null || big.status === 400).toBe(true);

    const r = await fetch(`${base}/api/runs`, { method: "POST", headers: H, body: JSON.stringify({ prompt: "đọc tệp", inbox_stage: stage_id }) });
    expect(r.status).toBe(201);
    const { run } = (await r.json()) as { run: { id: string; run_dir: string } };
    await started.manager.waitFor(run.id);
    const inboxDir = path.join(run.run_dir, "inbox");
    expect(fs.readdirSync(inboxDir).sort()).toEqual(["data.csv", "spec.md"]);
    expect(fs.existsSync(path.join(started.manager.config.workspaceDir, "inbox-staging", stage_id))).toBe(false);
    // the fake CLI echoes the first 80 chars of the prompt it received into notes/searcher-site.md
    const echoed = fs.readFileSync(path.join(run.run_dir, "notes", "searcher-site.md"), "utf8");
    expect(echoed).toContain("[Tệp đính kèm]");
    const meta = (await (await fetch(`${base}/api/runs/${run.id}`, { headers: H })).json()) as { inbox: { name: string }[]; artifacts: { rel_path: string }[] };
    expect(meta.inbox.map((f) => f.name)).toEqual(["data.csv", "spec.md"]);
    expect(meta.artifacts.some((a) => a.rel_path.startsWith("inbox/"))).toBe(false);

    // attach to the existing run
    const at = await fetch(`${base}/api/runs/${run.id}/inbox`, { method: "POST", headers: { ...raw, "x-file-name": "more.txt" }, body: "more" });
    expect(at.status).toBe(201);
    expect(((await at.json()) as { inbox: unknown[] }).inbox.length).toBe(3);
    expect(fs.readFileSync(path.join(inboxDir, "more.txt"), "utf8")).toBe("more");
    expect((await fetch(`${base}/api/runs/${run.id}/inbox`, { method: "POST", headers: { ...raw, "x-file-name": "..\\..\\x" }, body: "x" })).status).toBe(400);

    // zip of all artifacts
    const z = await fetch(`${base}/api/runs/${run.id}/artifacts.zip`, { headers: H });
    expect(z.status).toBe(200);
    expect(z.headers.get("content-type")).toBe("application/zip");
    const buf = Buffer.from(await z.arrayBuffer());
    expect(buf.readUInt32LE(0)).toBe(0x04034b50);
    expect(buf.readUInt16LE(buf.length - 22 + 10)).toBe(meta.artifacts.length);
    expect(buf.includes(Buffer.from("report.md"))).toBe(true);
    expect((await fetch(`${base}/api/runs/${run.id}/artifacts.zip`)).status).toBe(401);
  });
  it("reports status and billing", async () => {
    const s = (await (await fetch(`${base}/api/status`, { headers: H })).json()) as { auth: { authMethod: string } };
    expect(s.auth.authMethod).toBe("claude.ai");
    const b = (await (await fetch(`${base}/api/billing/status`, { headers: H })).json()) as { ok: boolean };
    expect(b.ok).toBe(true);
  });
});

describe("Claude CLI presence (Phase 5.6)", () => {
  it("status reports the resolved CLI path and version", async () => {
    const s = (await (await fetch(`${base}/api/status`, { headers: H })).json()) as { claude_path: string | null; claude_version: string | null; claude_error: string | null };
    expect(s.claude_path).toBe(process.execPath);
    expect(s.claude_version).toBe("0.0.0");
    expect(s.claude_error).toBeNull();
  });
  it("status reports claude_error (and auth_error) when the CLI cannot be found", async () => {
    const missing = path.join(root, "no-such-claude.exe");
    const cfg = { ...started.manager.config, claudePath: missing, dataDir: path.join(root, "data2") };
    const s2 = await startServer({ config: cfg, port: 0, token: TOKEN, env: { ...process.env, PATH: root + path.delimiter + path.join(process.env["SystemRoot"] ?? "C:\\Windows", "System32"), Path: undefined } });
    try {
      const s = (await (await fetch(`http://127.0.0.1:${s2.policy.port}/api/status`, { headers: H })).json()) as { claude_path: string | null; claude_error: string | null; auth_error: string | null; auth: unknown };
      expect(s.claude_path).toBeNull();
      expect(s.claude_error).toMatch(/Không tìm thấy Claude Code CLI/);
      expect(s.auth_error).toMatch(/Không tìm thấy Claude Code CLI/);
      expect(s.auth).toBeNull();
    } finally {
      await s2.close();
    }
  });
});

describe("git presence (Phase 5.6)", () => {
  it("status reports git_version when git is on PATH", async () => {
    const s = (await (await fetch(`${base}/api/status`, { headers: H })).json()) as { git_version: string | null; git_error: string | null };
    expect(s.git_version).toMatch(/^\d+\.\d+/);
    expect(s.git_error).toBeNull();
  });
  it("status reports git_error when PATH has no git", async () => {
    const cfg = { ...started.manager.config, dataDir: path.join(root, "data3") };
    const s2 = await startServer({ config: cfg, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, PATH: root, Path: undefined } });
    try {
      const s = (await (await fetch(`http://127.0.0.1:${s2.policy.port}/api/status`, { headers: H })).json()) as { git_version: string | null; git_error: string | null };
      expect(s.git_version).toBeNull();
      expect(s.git_error).toMatch(/Không tìm thấy `git`/);
    } finally {
      await s2.close();
    }
  });
});

describe("cleanup preview API", () => {
  it("requires a token, validates olderThan and deletes nothing", async () => {
    const keep = path.join(testConfig.worktreesDir, "fake-proj", "fake-run");
    fs.mkdirSync(keep, { recursive: true });
    const url = `${base}/api/cleanup/preview`;
    expect((await fetch(url)).status).toBe(401);
    const bad = await fetch(`${url}?olderThan=abc`, { headers: H });
    expect(bad.status).toBe(400);
    expect(((await bad.json()) as { error: string }).error).toBe("bad_request");
    const ok = await fetch(`${url}?olderThan=14`, { headers: H });
    expect(ok.status).toBe(200);
    const j = (await ok.json()) as { olderThan: number; plan: { candidates: unknown[] }; inboxRemoved: unknown[] };
    expect(j.olderThan).toBe(14);
    expect(Array.isArray(j.plan.candidates)).toBe(true);
    expect(Array.isArray(j.inboxRemoved)).toBe(true);
    expect(fs.existsSync(keep)).toBe(true);
  });
});

describe("cleanup POST API", () => {
  const post = (b: unknown) => fetch(`${base}/api/cleanup`, { method: "POST", headers: { ...H, "content-type": "application/json" }, body: JSON.stringify(b) });
  it("requires confirm:true and valid olderThan", async () => {
    const keep = path.join(testConfig.worktreesDir, "fake-proj", "fake-run2");
    fs.mkdirSync(keep, { recursive: true });
    expect((await fetch(`${base}/api/cleanup`, { method: "POST" })).status).toBe(401);
    for (const b of [{}, { confirm: false }, { confirm: "true" }]) {
      const r = await post(b);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("confirm_required");
    }
    for (const o of [0, "abc", true]) {
      const r = await post({ confirm: true, olderThan: o });
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("bad_request");
    }
    expect(fs.existsSync(keep)).toBe(true);
  });
  it("runs with confirm:true, empty results when nothing is a candidate", async () => {
    const r7 = await post({ confirm: true, olderThan: 7 });
    expect(r7.status).toBe(200);
    const r = await post({ confirm: true });
    expect(r.status).toBe(200);
    const j = (await r.json()) as { results: unknown[]; plan: unknown; inboxRemoved: unknown[] };
    expect(j.results).toEqual([]);
  });
  it("409 still_running while a run is running; nothing deleted", async () => {
    const keep = path.join(testConfig.worktreesDir, "fake-proj", "fake-run3");
    fs.mkdirSync(keep, { recursive: true });
    const id = "cleanup-busy";
    started.manager.store.createRun({ id, status: "running", prompt: "p", mode: "coding", model: "sonnet", session_id: null, parent_run_id: null, project: "default", claude_version: null, run_dir: root, kind: "research" });
    try {
      const r = await post({ confirm: true });
      expect(r.status).toBe(409);
      expect(((await r.json()) as { error: string }).error).toBe("still_running");
      expect(fs.existsSync(keep)).toBe(true);
    } finally {
      started.manager.store.updateRun(id, { status: "done" });
    }
  });
});

describe("usage blocks API", () => {
  it("requires a token, returns scan result, survives a scan error", async () => {
    const fake = { blocks: [], marker: "x" } as never;
    let fail = false;
    const cfg = { ...started.manager.config, dataDir: path.join(root, "data-usage") };
    const s2 = await startServer({ config: cfg, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], usageScan: (async () => { if (fail) throw new Error("boom"); return fake; }) as never });
    const u = `http://127.0.0.1:${s2.policy.port}/api/usage/blocks`;
    try {
      expect((await fetch(u)).status).toBe(401);
      const ok = await fetch(u, { headers: H });
      expect(ok.status).toBe(200);
      expect(await ok.json()).toEqual(fake);
      fail = true;
      const bad = await fetch(u, { headers: H });
      expect(bad.status).toBe(500);
      expect(((await bad.json()) as { error: string }).error).toBe("usage_failed");
      fail = false;
      expect((await fetch(u, { headers: H })).status).toBe(200);
    } finally {
      await s2.close();
    }
  });
});
