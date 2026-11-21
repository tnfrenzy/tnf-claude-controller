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
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const call = (method: string, url: string, body?: unknown, headers: Record<string, string> = H) =>
  fetch(`${base}${url}`, { method, headers, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

/** Simulates a finished sample round by editing session.json (the HTTP server uses the real runner). */
function markSample(slug: string): void {
  const f = path.join(root, "data", "skills", slug, "session.json");
  const s = JSON.parse(fs.readFileSync(f, "utf8"));
  s.rounds[s.rounds.length - 1].sample = { files: [], summary: "s", costUsd: 0 };
  s.status = "awaiting_score";
  fs.writeFileSync(f, JSON.stringify(s));
}

/** Waits for the background finalize that grade=100 starts, then forces a finished final SKILL.md. */
async function forceFinalDone(slug: string): Promise<void> {
  const f = path.join(root, "data", "skills-gen", `${slug}.json`);
  for (let i = 0; i < 1200; i++) {
    try {
      const g = JSON.parse(fs.readFileSync(f, "utf8"));
      if (g.final && g.final.status !== "running") break;
    } catch {
      // not written yet
    }
    await new Promise((res) => setTimeout(res, 50));
  }
  const g = JSON.parse(fs.readFileSync(f, "utf8"));
  g.final = { status: "done" };
  fs.writeFileSync(f, JSON.stringify(g));
  fs.mkdirSync(path.join(root, "data", "skills-gen", slug, "final"), { recursive: true });
  fs.writeFileSync(path.join(root, "data", "skills-gen", slug, "final", "SKILL.md"), "# SKILL.md final\n");
}

describe("skills-gen sessions", () => {
  it("requires a token", async () => {
    expect((await call("POST", "/api/skills-gen/sessions", {}, { "content-type": "application/json" })).status).toBe(401);
  });
  it("404 skill_not_found for unknown slug", async () => {
    const r = await call("POST", "/api/skills-gen/sessions", { slug: "chua-co", brief: "b" });
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("skill_not_found");
  });
  it("creates, reads and resets sessions", async () => {
    expect((await call("POST", "/api/skills", { slug: "gen1", title: "Gen", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    const empty = await call("POST", "/api/skills-gen/sessions", { slug: "gen1", brief: "   " });
    expect(empty.status).toBe(400);
    const miss = await call("GET", "/api/skills-gen/sessions/gen1");
    expect(miss.status).toBe(404);
    expect((await miss.json()).error).toBe("session_missing");

    const c = await call("POST", "/api/skills-gen/sessions", { slug: "gen1", brief: "Làm X" });
    expect(c.status).toBe(201);
    const s = await c.json();
    expect(s.status).toBe("generating");
    expect(s.agents).toEqual([]);
    const again = await call("POST", "/api/skills-gen/sessions", { slug: "gen1", brief: "Làm Y" });
    expect(again.status).toBe(409);
    expect((await again.json()).error).toBe("session_exists");

    const g = await call("GET", "/api/skills-gen/sessions/gen1");
    expect(g.status).toBe(200);
    const gb = await g.json();
    expect(gb.session.brief).toBe("Làm X");
    expect(gb.gen.finder.status).toBe("idle");
  });
  it("writes default gen on create (reset)", async () => {
    expect((await call("POST", "/api/skills", { slug: "gen2", title: "Gen2", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    fs.mkdirSync(path.join(root, "data", "skills-gen"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "skills-gen", "gen2.json"), JSON.stringify({ roles: [{ id: "x", score: 1, reasons: [] }], repos: [], finder: { status: "failed", error: "e" } }));
    expect((await call("POST", "/api/skills-gen/sessions", { slug: "gen2", brief: "b" })).status).toBe(201);
    const gb = await (await call("GET", "/api/skills-gen/sessions/gen2")).json();
    expect(gb.gen).toEqual({ roles: [], repos: [], finder: { status: "idle" }, sample: { status: "idle" }, final: { status: "idle" }, costUsd: 0, costCapUsd: 3 });
  });
  it("grades rounds", async () => {
    expect((await call("POST", "/api/skills", { slug: "gen3", title: "Gen3", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    const none = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 60, feedback: "x" });
    expect(none.status).toBe(404);
    expect((await none.json()).error).toBe("session_missing");
    expect((await call("POST", "/api/skills-gen/sessions", { slug: "gen3", brief: "b" })).status).toBe(201);
    const early = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 60, feedback: "x" });
    expect(early.status).toBe(400);
    expect((await early.json()).error).toBe("session_no_sample");
    markSample("gen3");
    const ok = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 60, feedback: "thêm ví dụ" });
    expect(ok.status).toBe(200);
    const s = await ok.json();
    expect(s.rounds.length).toBe(2);
    expect(s.status).toBe("generating");
    markSample("gen3");
    const nofb = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 60 });
    expect(nofb.status).toBe(400);
    expect((await nofb.json()).error).toBe("session_invalid");
    expect((await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 101, feedback: "x" })).status).toBe(400);
    const bad = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: "x", feedback: "x" });
    expect(bad.status).toBe(400);
    expect((await bad.json()).error).toBe("session_invalid");
    const done = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 100 });
    expect(done.status).toBe(200);
    expect((await done.json()).status).toBe("completed");
    const closed = await call("POST", "/api/skills-gen/sessions/gen3/grade", { score: 50, feedback: "x" });
    expect(closed.status).toBe(400);
    expect((await closed.json()).error).toBe("session_closed");
  });
  it("find-roles and create-agents", async () => {
    fs.writeFileSync(path.join(root, "roles.json"), JSON.stringify({ researcher: { description: "research web sources" } }));
    expect((await call("POST", "/api/skills", { slug: "gen4", title: "Gen4", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    const miss = await call("POST", "/api/skills-gen/sessions/gen4/steps/find-roles", {});
    expect(miss.status).toBe(404);
    expect((await call("POST", "/api/skills-gen/sessions", { slug: "gen4", brief: "research web sources" })).status).toBe(201);
    const fr = await call("POST", "/api/skills-gen/sessions/gen4/steps/find-roles", {});
    expect(fr.status).toBe(200);
    const { matches } = await fr.json();
    expect(matches.some((m: { id: string }) => m.id === "researcher")).toBe(true);
    expect((await call("POST", "/api/skills-gen/sessions/gen4/steps/nope", {})).status).toBe(404);

    const notArr = await call("POST", "/api/skills-gen/sessions/gen4/steps/create-agents", { newAgents: "x" });
    expect(notArr.status).toBe(400);
    expect((await notArr.json()).error).toBe("bad_request");
    const badTool = await call("POST", "/api/skills-gen/sessions/gen4/steps/create-agents", { newAgents: [{ id: "evil", description: "d", prompt: "p", tools: ["Bash"] }] });
    expect(badTool.status).toBe(400);
    expect((await badTool.json()).error).toBe("bad_agents");

    const plain = await call("POST", "/api/skills-gen/sessions/gen4/steps/create-agents", {});
    expect(plain.status).toBe(200);
    const pb = await plain.json();
    expect(pb.session.agents.find((a: { id: string }) => a.id === "researcher").source).toBe("existing");
    const withNew = await call("POST", "/api/skills-gen/sessions/gen4/steps/create-agents", { newAgents: [{ id: "helper", description: "help", prompt: "do it", tools: ["Read"] }] });
    expect(withNew.status).toBe(200);
    const wb = await withNew.json();
    expect(wb.session.agents.find((a: { id: string }) => a.id === "helper").source).toBe("new");
  });
  it("find-github over HTTP returns 202 and never stays running", async () => {
    await call("POST", "/api/skills", { slug: "gen5", title: "Gen", goal: "g", files: { "SKILL.md": "# S" } });
    await call("POST", "/api/skills-gen/sessions", { slug: "gen5", brief: "research web sources" });
    const r = await call("POST", "/api/skills-gen/sessions/gen5/steps/find-github");
    expect(r.status).toBe(202);
    let status = "running";
    for (let i = 0; i < 100 && status === "running"; i++) {
      await new Promise((res) => setTimeout(res, 100));
      status = (await (await call("GET", "/api/skills-gen/sessions/gen5")).json()).gen.finder.status;
    }
    expect(["done", "failed"]).toContain(status);
  });
  it("zip: 409 while open, 200 zip once completed, 400 for bad slug", async () => {
    await call("POST", "/api/skills", { slug: "gen6", title: "Gen", goal: "g", files: { "SKILL.md": "# S" } });
    await call("POST", "/api/skills-gen/sessions", { slug: "gen6", brief: "b" });
    markSample("gen6");
    const open =await call("GET", "/api/skills-gen/sessions/gen6/zip");
    expect(open.status).toBe(409);
    expect((await open.json()).error).toBe("session_not_completed");
    expect((await call("POST", "/api/skills-gen/sessions/gen6/grade", { score: 100 })).status).toBe(200);
    await forceFinalDone("gen6");
    const z =await call("GET", "/api/skills-gen/sessions/gen6/zip");
    expect(z.status).toBe(200);
    expect(z.headers.get("content-type")).toBe("application/zip");
    expect(z.headers.get("content-disposition")).toContain("gen6.zip");
    const buf = Buffer.from(await z.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
    expect(buf.includes("SKILL.md")).toBe(true);
    expect((await call("GET", "/api/skills-gen/sessions/BAD_Slug/zip")).status).toBe(400);
  });
  it("404 for unknown path", async () => {
    const r = await call("GET", "/api/skills-gen/xyz");
    expect(r.status).toBe(404);
    expect((await r.json()).error).toBe("not_found");
  });
});

