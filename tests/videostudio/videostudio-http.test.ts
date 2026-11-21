import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { RunManager } from "../../src/core/run/run-manager.js";
import { RunStore } from "../../src/core/run/run-store.js";
import type { VideoStudio } from "../../src/core/videostudio/index.js";
import type { AuthPolicy } from "../../src/server/auth.js";
import { createServer } from "../../src/server/http.js";

const TOKEN = "t".repeat(32);
const cleanups: Array<() => void | Promise<void>> = [];

afterEach(async () => {
  while (cleanups.length) await cleanups.pop()!();
});

async function start(extra: Record<string, unknown>) {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-http-"));
  const config = { ...loadConfig(), dataDir };
  const store = new RunStore(":memory:");
  const manager = new RunManager({ config, store });
  const policy: AuthPolicy = { token: TOKEN, host: "127.0.0.1", port: 0 };
  const server = createServer({
    manager,
    policy,
    staticDir: path.join(dataDir, "no-ui"),
    materialLibrary: null,
    workshop3d: null,
    ...extra,
  } as Parameters<typeof createServer>[0]);
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const addr = server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  policy.port = port;
  cleanups.push(async () => {
    await new Promise<void>((r) => server.close(() => r()));
    store.close();
    fs.rmSync(dataDir, { recursive: true, force: true });
  });
  const get = (p: string) =>
    new Promise<{ status: number; body: any }>((resolve, reject) => {
      const req = http.request(
        { host: "127.0.0.1", port, path: p, method: "GET", headers: { "X-Controller-Token": TOKEN, Host: `127.0.0.1:${port}` } },
        (res) => {
          let s = "";
          res.on("data", (c) => (s += c));
          res.on("end", () => {
            let body: any = s;
            try {
              body = JSON.parse(s);
            } catch {
              /* keep text */
            }
            resolve({ status: res.statusCode ?? 0, body });
          });
        },
      );
      req.on("error", reject);
      req.end();
    });
  return { store, get };
}

const fakeStudio = (recover: () => number): VideoStudio =>
  ({ recover, store: { list: () => [] } }) as unknown as VideoStudio;

describe("videostudio wiring in http server", () => {
  it("GET /api/videostudio lists projects with the studio created by default", async () => {
    const { get } = await start({});
    const r = await get("/api/videostudio");
    expect(r.status).toBe(200);
    expect(Array.isArray(r.body.projects)).toBe(true);
  });

  it("hides the videostudio project from GET /api/projects", async () => {
    const { store, get } = await start({ videoStudio: fakeStudio(() => 0) });
    store.upsertProject({ name: "videostudio", repo_path: null, base_branch: null, allowed_commands: [] });
    expect(store.listProjects().some((p) => p.name === "videostudio")).toBe(true);
    const r = await get("/api/projects");
    expect(r.status).toBe(200);
    expect(r.body.projects.some((p: { name: string }) => p.name === "videostudio")).toBe(false);
  });

  it("answers 503 when videoStudio is null, server keeps running", async () => {
    const { get } = await start({ videoStudio: null });
    expect((await get("/api/videostudio")).status).toBe(503);
    expect((await get("/api/projects")).status).toBe(200);
  });

  it("answers 503 when the studio factory throws, server keeps running", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    cleanups.push(() => warn.mockRestore());
    const { get } = await start({
      videoStudioFactory: () => {
        throw new Error("boom");
      },
    });
    expect((await get("/api/videostudio")).status).toBe(503);
    expect((await get("/api/projects")).status).toBe(200);
  });

  it("calls recover exactly once for a studio built by the factory", async () => {
    const recover = vi.fn(() => 0);
    const { get } = await start({ videoStudioFactory: () => fakeStudio(recover) });
    expect(recover).toHaveBeenCalledTimes(1);
    expect((await get("/api/videostudio")).status).toBe(200);
    expect(recover).toHaveBeenCalledTimes(1);
  });
});
