import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { makeWorkshop3DEngine } from "../../src/core/workshop3d/index.js";
import { createW3DStore, type W3DStore } from "../../src/core/workshop3d/store.js";
import { initialSnapshot } from "../../src/core/workshop3d/state.js";
import type { W3DRunner } from "../../src/core/workshop3d/runner.js";
import { startServer, type StartedServer } from "../../src/server/index.js";
import { w3dCanDelete, w3dDeleteConfirmText } from "../../ui/src/office/workshop3d-session.js";

// "Xóa bản dựng": DELETE /api/workshop3d/:slug removes the whole session folder and nothing else.
const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = "d".repeat(48);
const H = { "x-controller-token": TOKEN };
const J = { ...H, "content-type": "application/json" };
const brief = { title: "Cabin xoa", object: "cabin", params: {}, detail: "standard" as const, attachments: [] };

let started: StartedServer;
let base: string;
let root: string;
let dataDir: string;
let store: W3DStore;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-del-"));
  dataDir = path.join(root, "data");
  store = createW3DStore(dataDir);
  const noop = () => undefined;
  const runner: W3DRunner = { start: () => "", answer: noop, pause: noop, resume: noop, stop: noop, rebuild: noop, recover: () => [], idle: async () => undefined };
  const engine = makeWorkshop3DEngine({ store, runner });
  const config: ControllerConfig = {
    repoRoot: REPO,
    claudePath: null,
    models: [{ id: "sonnet", label: "sonnet" }],
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir,
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
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env }, workshop3d: engine });
  base = `http://127.0.0.1:${started.policy.port}`;
});
afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const del = (p: string, headers: Record<string, string> = H): Promise<Response> => fetch(`${base}${p}`, { method: "DELETE", headers });
const make = (state: string): string => {
  const slug = store.create(brief, { ...initialSnapshot({}), state: state as "done" });
  fs.mkdirSync(path.join(store.dir(slug), "outputs"), { recursive: true });
  fs.writeFileSync(path.join(store.dir(slug), "outputs", "model.glb"), Buffer.alloc(4096));
  return slug;
};

describe("DELETE /api/workshop3d/:slug", () => {
  it("needs the token and a good Origin", async () => {
    const slug = make("done");
    expect((await del(`/api/workshop3d/${slug}`, {})).status).toBe(401);
    expect((await del(`/api/workshop3d/${slug}`, { ...H, origin: "http://evil.example" })).status).toBe(403);
    expect(fs.existsSync(store.dir(slug))).toBe(true);
  });
  it("deletes the whole session folder of a finished session, keeps everything else", async () => {
    const keep = make("done");
    const slug = make("done");
    const sibling = path.join(dataDir, "workshop3d", "notes.txt");
    fs.writeFileSync(sibling, "x");
    const detail = (await (await fetch(`${base}/api/workshop3d/${slug}`, { headers: H })).json()) as { diskBytes?: number };
    expect(detail.diskBytes).toBeGreaterThanOrEqual(4096);
    const r = await del(`/api/workshop3d/${slug}`);
    expect(r.status).toBe(200);
    expect(((await r.json()) as { bytes: number }).bytes).toBeGreaterThanOrEqual(4096);
    expect(fs.existsSync(store.dir(slug))).toBe(false);
    expect(fs.existsSync(store.dir(keep))).toBe(true);
    expect(fs.existsSync(sibling)).toBe(true);
    const list = (await (await fetch(`${base}/api/workshop3d`, { headers: H })).json()) as { sessions: { slug: string }[] };
    expect(list.sessions.map((s) => s.slug)).not.toContain(slug);
    expect((await del(`/api/workshop3d/${slug}`)).status).toBe(404);
  });
  it("refuses a running session (409, Vietnamese) and a session rendering", async () => {
    const slug = make("modeling");
    const r = await del(`/api/workshop3d/${slug}`);
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toMatch(/đang chạy/);
    const hq = make("done");
    fs.mkdirSync(path.join(store.dir(hq), "renders", "hq"), { recursive: true });
    fs.writeFileSync(path.join(store.dir(hq), "renders", "hq", "progress.json"), JSON.stringify({ running: true, updatedAt: new Date().toISOString() }));
    expect((await del(`/api/workshop3d/${hq}`)).status).toBe(409);
    // a progress file left running by a crash hours ago does not block forever
    fs.writeFileSync(path.join(store.dir(hq), "renders", "hq", "progress.json"), JSON.stringify({ running: true, updatedAt: new Date(Date.now() - 3 * 3600_000).toISOString() }));
    expect((await del(`/api/workshop3d/${hq}`)).status).toBe(200);
  });
  it("odd slugs and escaping paths never delete anything", async () => {
    const outside = path.join(root, "victim");
    fs.mkdirSync(outside);
    for (const p of ["..", "..%2F..%2Fvictim", "%2E%2E", "x", "20261112-031730-04304", "20261112-031730-04304b%2F..", "data"]) {
      const r = await del(`/api/workshop3d/${p}`);
      expect([400, 404]).toContain(r.status);
    }
    expect(fs.existsSync(outside)).toBe(true);
    expect(fs.existsSync(path.join(dataDir, "workshop3d"))).toBe(true);
    expect(() => store.remove("../victim")).toThrow();
  });
  it("store.remove refuses a junction pointing out of the workshop folder", () => {
    const target = path.join(root, "elsewhere");
    fs.mkdirSync(target);
    fs.writeFileSync(path.join(target, "keep.txt"), "x");
    const slug = "20261112-000000-abcdef";
    try {
      fs.symlinkSync(target, path.join(dataDir, "workshop3d", slug), "junction");
    } catch {
      return; // no junction rights on this machine
    }
    expect(() => store.remove(slug)).toThrow(/không xóa/);
    expect(fs.existsSync(path.join(target, "keep.txt"))).toBe(true);
    fs.rmSync(path.join(dataDir, "workshop3d", slug), { force: true, recursive: false });
  });
});

describe("delete UI helpers", () => {
  it("only idle states offer the button", () => {
    for (const s of ["done", "failed", "stopped", "paused"]) expect(w3dCanDelete(s)).toBe(true);
    for (const s of ["intake", "modeling", "hqrender", "presenting", "waiting_quota", "awaiting_user"]) expect(w3dCanDelete(s)).toBe(false);
  });
  it("confirmation names the session and the space freed", () => {
    const tpl = 'Xóa "{title}"? {size}. Không khôi phục được.';
    expect(w3dDeleteConfirmText(tpl, "Cabin E30", 338 * 1048576)).toBe('Xóa "Cabin E30"? 338,0 MB. Không khôi phục được.');
    expect(w3dDeleteConfirmText(tpl, "X", undefined)).toContain("? ?.");
  });
});
