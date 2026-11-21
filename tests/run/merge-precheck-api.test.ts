import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { AGENT_GIT_ENV, git, gitVersion } from "../../src/core/git/git.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const G = (cwd: string, args: string[]) => git(cwd, args, { ...process.env, ...AGENT_GIT_ENV });

const real = gitVersion(os.tmpdir());
const hasMergeTree = !!real && (real.major > 2 || (real.major === 2 && real.minor >= 38));

type Pre ={ status: string; files: string[]; base_sha_checked?: string | null };

describe("POST /api/runs/:id/merge-precheck", () => {
  let started: StartedServer;
  let root: string;
  let repo: string;
  const TOKEN = "e".repeat(48);
  const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
  const base = () => `http://127.0.0.1:${started.policy.port}`;

  beforeAll(async () => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-mp-api-"));
    const cfg = {
      repoRoot: root,
      claudePath: null,
      models: [{ id: "sonnet", label: "sonnet" }],
      workspaceDir: path.join(root, "ws"),
      worktreesDir: path.join(root, "ws", "worktrees"),
      dataDir: path.join(root, "data"),
      server: { host: "127.0.0.1", port: 0, allowedOrigins: [] },
      defaults: {
        authMode: "subscription", model: "sonnet", maxTurns: 40, maxBudgetUsd: 3, timeoutMs: 60_000, allowedTools: ["Agent"],
        agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), maxConcurrentSubagents: 3, maxSubagentSpawnDepth: 1, extraArgs: [],
        research: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles.json"), systemPromptFile: path.join(root, "coord.md"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
        coding: { allowedTools: ["Agent"], agentsFile: path.join(root, "roles-coding.json"), systemPromptFile: path.join(root, "coord-coding.md"), settingsFile: path.join(root, "deny.json"), disallowedTools: [], extraArgs: [], maxRoleCalls: 8 },
      },
      limits: { maxTurnsCeiling: 100, maxBudgetUsdCeiling: 10 },
      queue: { maxParallel: 3, maxBudgetUsd: 10, replan: { enabled: false }, hotspots: [] },
    } as unknown as ControllerConfig;
    started = await startServer({ config: cfg, port: 0, token: TOKEN });

    repo = path.join(root, "repo");
    fs.mkdirSync(repo);
    G(repo, ["init", "-b", "main"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\ntwo\nthree\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "init"]);
    G(repo, ["branch", "tnf/c1"]);
    G(repo, ["branch", "tnf/c2"]);
    G(repo, ["checkout", "-q", "tnf/c1"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\nTWO from c1\nthree\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "c1 edit"]);
    G(repo, ["checkout", "-q", "tnf/c2"]);
    fs.writeFileSync(path.join(repo, "a.txt"), "one\nTWO from c2\nthree\n");
    G(repo, ["add", "-A"]);
    G(repo, ["commit", "-m", "c2 edit"]);
    G(repo, ["checkout", "-q", "main"]);
    G(repo, ["merge", "--no-ff", "-m", "merge c1", "tnf/c1"]);

    const store = started.manager.store;
    store.upsertProject({ name: "rp", repo_path: repo, base_branch: "main", allowed_commands: [] });
    const mk = (id: string, extra: Record<string, unknown>) =>
      store.createRun({ id, status: "done", prompt: "p", mode: "roles", model: "sonnet", session_id: null, parent_run_id: null, project: "rp", claude_version: null, run_dir: path.join(root, id), ...extra } as never);
    mk("c2", { kind: "coding", worktree_path: path.join(root, "wt2"), branch: "tnf/c2" });
    mk("r1", { kind: "research" });
  });
  afterAll(async () => {
    await started.close();
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("401 without token, 404 for unknown run, 400 for non-coding run", async () => {
    expect((await fetch(`${base()}/api/runs/c2/merge-precheck`, { method: "POST" })).status).toBe(401);
    expect((await fetch(`${base()}/api/runs/nope/merge-precheck`, { method: "POST", headers: H, body: "{}" })).status).toBe(404);
    expect((await fetch(`${base()}/api/runs/r1/merge-precheck`, { method: "POST", headers: H, body: "{}" })).status).toBe(400);
    const d = (await (await fetch(`${base()}/api/runs/r1`, { headers: H })).json()) as { run: { merge_precheck: Pre | null } };
    expect(d.run.merge_precheck ?? null).toBeNull();
  });

  it.skipIf(!hasMergeTree)("reports the conflict, ignores a branch sent by the client, and exposes it in run detail and queue", async () => {
    const detail0 = (await (await fetch(`${base()}/api/runs/c2`, { headers: H })).json()) as { run: { merge_precheck: Pre | null } };
    expect(detail0.run.merge_precheck).toBeNull();

    const res = await fetch(`${base()}/api/runs/c2/merge-precheck`, { method: "POST", headers: H, body: JSON.stringify({ branch: "main" }) });
    expect(res.status).toBe(200);
    const body = (await res.json()) as Pre;
    expect(body.status).toBe("conflict");
    expect(body.files).toEqual(["a.txt"]);
    expect(body.base_sha_checked).toMatch(/^[0-9a-f]{40}$/);

    const detail = (await (await fetch(`${base()}/api/runs/c2`, { headers: H })).json()) as { run: { merge_precheck: Pre | null } };
    expect(detail.run.merge_precheck?.status).toBe("conflict");

    started.manager.queue.addCommands("rp", [{ id: "q1", title: "q1", body: "làm q1" }], { hasRepo: true });
    started.manager.queue.addCommands("rp", [{ id: "q2", title: "q2", body: "làm q2" }], { hasRepo: true });
    started.manager.queue.transition("rp", "q1", "đã duyệt");
    started.manager.queue.transition("rp", "q1", "đang chạy", { runId: "c2" });
    const list = (await (await fetch(`${base()}/api/projects/rp/queue`, { headers: H })).json()) as { commands: { id: string; mergePrecheck: Pre | null }[] };
    expect(list.commands.find((c) => c.id === "q1")!.mergePrecheck?.status).toBe("conflict");
    expect(list.commands.find((c) => c.id === "q2")!.mergePrecheck).toBeNull();
  });
});
