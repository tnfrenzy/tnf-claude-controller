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

async function createSkill(slug: string): Promise<void> {
  const c = await call("POST", "/api/skills", { slug, title: slug, goal: "g", files: { "SKILL.md": "# S" } });
  expect(c.status).toBe(201);
}

interface Round {
  n: number;
  feedbackIn?: string;
}
interface Sess {
  status: string;
  rounds: Round[];
}

describe("skills-gen flow", () => {
  function markSample(slug: string): void {
    const f = path.join(root, "data", "skills", slug, "session.json");
    const s = JSON.parse(fs.readFileSync(f, "utf8"));
    s.rounds[s.rounds.length - 1].sample = { files: [], summary: "s", costUsd: 0 };
    s.status = "awaiting_score";
    fs.writeFileSync(f, JSON.stringify(s));
  }

  it("luồng đầy đủ", async () => {
    await createSkill("flow1");
    const s = await call("POST", "/api/skills-gen/sessions", { slug: "flow1", brief: "Làm X" });
    expect(s.status).toBe(201);
    const s1 = (await s.json()) as Sess;
    expect(s1.status).toBe("generating");
    markSample("flow1");
    expect(s1.rounds.length).toBe(1);

    const early = await call("GET", "/api/skills-gen/sessions/flow1/zip");
    expect(early.status).toBe(409);
    expect(((await early.json()) as { error: string }).error).toBe("session_not_completed");

    const g1 = await call("POST", "/api/skills-gen/sessions/flow1/grade", { score: 60, feedback: "thêm ví dụ" });
    expect(g1.status).toBe(200);
    const s2 = (await g1.json()) as Sess;
    expect(s2.rounds.length).toBe(2);
    expect(s2.status).toBe("generating");
    expect(s2.rounds[1]!.feedbackIn).toBe("thêm ví dụ");
    markSample("flow1");

    const g2 = await call("POST", "/api/skills-gen/sessions/flow1/grade", { score: 100 });
    expect(g2.status).toBe(200);
    expect(((await g2.json()) as Sess).status).toBe("completed");

    const f = path.join(root, "data", "skills-gen", "flow1.json");
    for (let i = 0; i < 1200; i++) {
      try {
        const g = JSON.parse(fs.readFileSync(f, "utf8"));
        if (g.final && g.final.status !== "running") break;
      } catch {
        // not written yet
      }
      await new Promise((res) => setTimeout(res, 50));
    }
    const gen = JSON.parse(fs.readFileSync(f, "utf8"));
    gen.final = { status: "done" };
    fs.writeFileSync(f, JSON.stringify(gen));
    fs.mkdirSync(path.join(root, "data", "skills-gen", "flow1", "final"), { recursive: true });
    fs.writeFileSync(path.join(root, "data", "skills-gen", "flow1", "final", "SKILL.md"), "# SKILL.md final\n");

    const z = await call("GET", "/api/skills-gen/sessions/flow1/zip");
    expect(z.status).toBe(200);
    expect(z.headers.get("content-type")).toBe("application/zip");
    expect(z.headers.get("content-disposition")).toBe('attachment; filename="flow1.zip"');
    const buf = Buffer.from(await z.arrayBuffer());
    expect(buf.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(buf.includes(Buffer.from("SKILL.md"))).toBe(true);
  });

  it("brief sai", async () => {
    await createSkill("flow2");
    for (const body of [{ slug: "flow2", brief: "   " }, { slug: "flow2" }, { slug: "flow2", brief: 123 }]) {
      const r = await call("POST", "/api/skills-gen/sessions", body);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("session_invalid");
    }
    const g = await call("GET", "/api/skills-gen/sessions/flow2");
    expect(g.status).toBe(404);
    expect(((await g.json()) as { error: string }).error).toBe("session_missing");
  });

  it("slug sai", async () => {
    const cases: Array<[string, string, unknown?]> = [
      ["POST", "/api/skills-gen/sessions", { slug: "BAD_Slug", brief: "b" }],
      ["GET", "/api/skills-gen/sessions/BAD_Slug"],
      ["POST", "/api/skills-gen/sessions/BAD_Slug/grade", { score: 60, feedback: "x" }],
      ["GET", "/api/skills-gen/sessions/BAD_Slug/zip"]
    ];
    for (const [m, u, b] of cases) {
      const r = await call(m, u, b);
      expect(r.status).toBe(400);
      expect(((await r.json()) as { error: string }).error).toBe("skill_bad_slug");
    }
    const nf = await call("POST", "/api/skills-gen/sessions", { slug: "chua-co-flow", brief: "b" });
    expect(nf.status).toBe(404);
    expect(((await nf.json()) as { error: string }).error).toBe("skill_not_found");
  });
});
