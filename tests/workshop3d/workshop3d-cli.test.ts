import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { runW3DCli } from "../../src/cli-w3d.js";
import type { ControllerConfig } from "../../src/core/app/config.js";
import type { RunManager } from "../../src/core/run/run-manager.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import { CAD_PYTHON_MISSING_MSG } from "../../src/core/design3d/cad-tools.js";
import { writeTokenFile } from "../../src/server/auth.js";

let dir: string;
let config: ControllerConfig;
const out: string[] = [];
const errs: string[] = [];
const run = (args: string[]): Promise<number> =>
  runW3DCli(args, { config, fake: true, getManager: () => { throw new Error("no manager"); }, log: (l) => out.push(l), err: (l) => errs.push(l) });

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-cli-"));
  config = { dataDir: dir, server: { host: "127.0.0.1", port: 1, allowedOrigins: [] } } as unknown as ControllerConfig;
});
afterAll(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("tnf w3d", () => {
  it("lists and shows sessions without a server", async () => {
    expect(await run(["list"])).toBe(0);
    expect(out.join("\n")).toMatch(/Chưa có phiên/);
    const store = createW3DStore(dir);
    const slug = store.create({ title: "Hop go", object: "hop go", params: {}, detail: "high", attachments: [] });
    store.writeFile(slug, "outputs/model.glb", "x");
    out.length = 0;
    expect(await run(["list"])).toBe(0);
    expect(out.join("\n")).toContain(slug);
    out.length = 0;
    expect(await run(["show", slug])).toBe(0);
    const text = out.join("\n");
    expect(text).toContain("intake");
    expect(text).toContain("outputs/model.glb");
  });

  it("pause and stop in direct mode warn that only the state was written", async () => {
    const fakeManager = { store: { getProject: () => ({}), upsertProject: () => ({}) }, lastRateLimit: null } as unknown as RunManager;
    const slug = createW3DStore(dir).create({ title: "Ke", object: "ke", params: {}, detail: "high", attachments: [] });
    out.length = 0;
    errs.length = 0;
    const code = await runW3DCli(["pause", slug], { config, fake: true, getManager: () => fakeManager, log: (l) => out.push(l), err: (l) => errs.push(l) });
    expect(code).toBe(0);
    expect([...out, ...errs].join("\n")).toContain("Không có máy chủ đang chạy: chỉ ghi trạng thái");
    expect(createW3DStore(dir).get(slug)!.snapshot.state).toBe("paused");
    // unknown slug: nothing written, non-zero exit
    expect(await runW3DCli(["stop", "20200101-000000-abcdef"], { config, fake: true, getManager: () => fakeManager, log: (l) => out.push(l), err: (l) => errs.push(l) })).toBe(1);
  });

  it("rejects bad usage", async () => {
    expect(await run(["show", "20200101-000000-abcdef"])).toBe(1);
    expect(await run(["bogus"])).toBe(1);
    expect(await run(["run"])).toBe(1);
    expect(await run(["pause"])).toBe(1);
  });

  it("run without the CAD python: exit 1 with the setup message, no session, no manager", async () => {
    const before = createW3DStore(dir).list().length;
    errs.length = 0;
    let managers = 0;
    const code = await runW3DCli(["run", "hop go nho", "--yes"], {
      config, fake: true, findPython: () => null,
      getManager: () => { managers++; throw new Error("no manager"); },
      log: (l) => out.push(l), err: (l) => errs.push(l),
    });
    expect(code).toBe(1);
    expect(errs.join("\n")).toContain(CAD_PYTHON_MISSING_MSG);
    expect(managers).toBe(0);
    expect(createW3DStore(dir).list()).toHaveLength(before);
  });

  it("run through a server that refuses (503 preflight): exit 1 with the server's message", async () => {
    const tokenDir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-cli-srv-"));
    try {
      const cfg = { ...config, dataDir: tokenDir } as ControllerConfig;
      writeTokenFile(tokenDir, "t".repeat(48));
      errs.length = 0;
      const fakeFetch = (async () => new Response(JSON.stringify({ error: "cad_unavailable", message: CAD_PYTHON_MISSING_MSG }), { status: 503 })) as typeof fetch;
      const code = await runW3DCli(["run", "hop"], { config: cfg, fake: true, fetch: fakeFetch, getManager: () => { throw new Error("no"); }, log: (l) => out.push(l), err: (l) => errs.push(l) });
      expect(code).toBe(1);
      expect(errs.join("\n")).toContain(CAD_PYTHON_MISSING_MSG);
    } finally {
      fs.rmSync(tokenDir, { recursive: true, force: true });
    }
  });
});
