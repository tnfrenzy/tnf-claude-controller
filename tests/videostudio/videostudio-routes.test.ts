import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import http from "node:http";
import type { AddressInfo } from "node:net";
import os from "node:os";
import path from "node:path";
import { createVideoStudio, type VideoStudio } from "../../src/core/videostudio/index.js";
import type { VsStepManager } from "../../src/core/videostudio/agent.js";
import { handleVideoStudioRoute } from "../../src/server/videostudio-routes.js";

const manager: VsStepManager = {
  startRun: async () => ({ id: "r1" }),
  waitFor: async () => ({ status: "done", result_text: "", cost_usd_est: 0 }),
  cancel: () => true,
  store: { getProject: () => ({}), upsertProject: () => ({}) },
};

let dir: string;
let studio: VideoStudio | null;
let viaTunnel: boolean;
let server: http.Server;
let base: string;
let release: (() => void) | null;

beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "vs-routes-"));
  studio = createVideoStudio({ manager, dataDir: dir, env: { PATH: "" } });
  viaTunnel = false;
  release = null;
  server = http.createServer((req, res) => {
    const p = new URL(req.url ?? "/", "http://x").pathname;
    handleVideoStudioRoute(req, res, p, req.method ?? "GET", { studio, viaTunnel }).then((handled) => {
      if (!handled) {
        res.writeHead(418);
        res.end("unhandled");
      }
    });
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});

afterEach(async () => {
  release?.();
  await new Promise<void>((r) => server.close(() => r()));
  fs.rmSync(dir, { recursive: true, force: true });
});

async function call(method: string, url: string, body?: unknown, headers: Record<string, string> = {}) {
  const init: RequestInit = { method, headers: { ...headers } };
  if (body !== undefined) {
    if (Buffer.isBuffer(body)) init.body = body;
    else {
      init.body = JSON.stringify(body);
      (init.headers as Record<string, string>)["content-type"] = "application/json";
    }
  }
  const res = await fetch(base + url, init);
  const text = await res.text();
  let json: any = null;
  try {
    json = JSON.parse(text);
  } catch {
    /* not json */
  }
  return { res, status: res.status, text, json };
}

async function createProject(): Promise<string> {
  const r = await call("POST", "/api/videostudio", { title: "Demo", brief: "b", styleId: "news", aspect: "16:9" });
  expect(r.status).toBe(201);
  return r.json.slug as string;
}

const style = {
  name: "Mau thu",
  transition: "fade",
  transitionSec: 0.5,
  shotSec: 3,
  font: "Arial",
  textColor: "#ffffff",
  visualPrompt: "x",
};

describe("videostudio routes", () => {
  it("duong dan la tra false", async () => {
    const r = await call("GET", "/api/other");
    expect(r.status).toBe(418);
    const r2 = await call("GET", "/api/videostudiox");
    expect(r2.status).toBe(418);
  });

  it("studio null thi 503", async () => {
    studio = null;
    const r = await call("GET", "/api/videostudio");
    expect(r.status).toBe(503);
  });

  it("tao du an, tai tu lieu, luu plan, lay chi tiet, xoa", async () => {
    const slug = await createProject();
    const list = await call("GET", "/api/videostudio");
    expect(list.status).toBe(200);
    expect(list.json.projects.length).toBe(1);

    const up = await call("POST", `/api/videostudio/${slug}/assets`, Buffer.from("png-bytes"), { "x-file-name": "a.png" });
    expect(up.status).toBe(201);

    const detail0 = await call("GET", `/api/videostudio/${slug}`);
    expect(detail0.status).toBe(200);
    const plan = { ...detail0.json.plan, title: "Moi" };
    const saved = await call("PUT", `/api/videostudio/${slug}/plan`, plan);
    expect(saved.status).toBe(200);

    const detail = await call("GET", `/api/videostudio/${slug}`);
    expect(detail.json.slug).toBe(slug);
    expect(detail.json.assets.length).toBe(1);
    expect(detail.json.plan).toBeTruthy();

    const del = await call("DELETE", `/api/videostudio/${slug}`);
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ ok: true });
    expect((await call("GET", `/api/videostudio/${slug}`)).status).toBe(404);
  });

  it("tai tu lieu thieu ten 400, rong 400", async () => {
    const slug = await createProject();
    expect((await call("POST", `/api/videostudio/${slug}/assets`, Buffer.from("x"))).status).toBe(400);
    expect((await call("POST", `/api/videostudio/${slug}/assets`, Buffer.alloc(0), { "x-file-name": "a.png" })).status).toBe(400);
  });

  it("GET file: path co .. thi 400, thieu path 400, ok tra tep", async () => {
    const slug = await createProject();
    expect((await call("GET", `/api/videostudio/${slug}/file?path=${encodeURIComponent("../x")}`)).status).toBe(400);
    expect((await call("GET", `/api/videostudio/${slug}/file`)).status).toBe(400);
    const up = await call("POST", `/api/videostudio/${slug}/assets`, Buffer.from("png-bytes"), { "x-file-name": "a.png" });
    const detail = await call("GET", `/api/videostudio/${slug}`);
    const asset = detail.json.assets[0];
    const rel: string = asset.path ?? asset.file ?? asset.rel ?? up.json.path;
    expect(typeof rel).toBe("string");
    const f = await call("GET", `/api/videostudio/${slug}/file?path=${encodeURIComponent(rel)}`);
    expect(f.status).toBe(200);
    expect(f.res.headers.get("content-type")).toBe("image/png");
    expect(f.text).toBe("png-bytes");
  });

  it("GET file voi Range tra 206", async () => {
    const slug = await createProject();
    const abs = studio!.store.filePath(slug, "renders/t.mp4");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "0123456789");
    const r = await call("GET", `/api/videostudio/${slug}/file?path=renders/t.mp4`, undefined, { range: "bytes=2-5" });
    expect(r.status).toBe(206);
    expect(r.res.headers.get("content-range")).toBe("bytes 2-5/10");
    expect(r.res.headers.get("accept-ranges")).toBe("bytes");
    expect(r.text).toBe("2345");
  });

  it("GET file voi Range sai thi 416", async () => {
    const slug = await createProject();
    const abs = studio!.store.filePath(slug, "renders/t.mp4");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "0123456789");
    const r = await call("GET", `/api/videostudio/${slug}/file?path=renders/t.mp4`, undefined, { range: "bytes=50-60" });
    expect(r.status).toBe(416);
    expect(r.res.headers.get("content-range")).toBe("bytes */10");
  });

  it("than JSON qua 1 MB thi 413", async () => {
    const big = Buffer.from(JSON.stringify({ title: "x".repeat(1024 * 1024 + 10) }));
    const r = await fetch(base + "/api/videostudio", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: big,
    });
    expect(r.status).toBe(413);
    await r.text();
  });

  it("phan hoi JSON co Cache-Control no-store", async () => {
    const r = await call("GET", "/api/videostudio");
    expect(r.status).toBe(200);
    expect(r.res.headers.get("cache-control")).toBe("no-store");
    const e = await call("GET", "/api/videostudio/20200101-000000-abcdef");
    expect(e.status).toBe(404);
    expect(e.res.headers.get("cache-control")).toBe("no-store");
  });

  it("dang ban thi 409 cho generate/narrate/render/edit-segment", async () => {
    const slug = await createProject();
    const hold = new Promise<void>((r) => {
      release = r;
    });
    void studio!.runExclusive(slug, "planning", () => hold);
    for (const a of ["generate", "narrate", "render"]) {
      expect((await call("POST", `/api/videostudio/${slug}/${a}`, {})).status).toBe(409);
    }
    const e = await call("POST", `/api/videostudio/${slug}/edit-segment`, { start: 0, end: 1, instruction: "i" });
    expect(e.status).toBe(409);
  });

  it("edit-segment thieu than 400; slug khong ton tai 404", async () => {
    const slug = await createProject();
    expect((await call("POST", `/api/videostudio/${slug}/edit-segment`, { start: "a" })).status).toBe(400);
    expect((await call("POST", "/api/videostudio/20200101-000000-abcdef/generate", {})).status).toBe(404);
    expect((await call("GET", "/api/videostudio/20200101-000000-abcdef")).status).toBe(404);
  });

  it("generate ranh thi 202 kem state", async () => {
    const slug = await createProject();
    const r = await call("POST", `/api/videostudio/${slug}/generate`, {});
    expect(r.status).toBe(202);
    expect(typeof r.json.state).toBe("string");
    // wait for the background job to settle so the temp dir can be removed
    for (let i = 0; i < 100 && studio!.isBusy(slug); i++) await new Promise((x) => setTimeout(x, 20));
  });

  it("download khi lastRender null thi 404", async () => {
    const slug = await createProject();
    expect((await call("GET", `/api/videostudio/${slug}/download`)).status).toBe(404);
  });

  it("download tra tep voi ten tu title da lam sach", async () => {
    const slug = await createProject();
    const abs = studio!.store.filePath(slug, "renders/out.mp4");
    fs.mkdirSync(path.dirname(abs), { recursive: true });
    fs.writeFileSync(abs, "mp4data");
    studio!.store.update(slug, { lastRender: "renders/out.mp4" });
    const r = await call("GET", `/api/videostudio/${slug}/download`);
    expect(r.status).toBe(200);
    expect(r.res.headers.get("content-disposition")).toContain('filename="Demo.mp4"');
    expect(r.text).toBe("mp4data");
  });

  it("settings: PUT qua tunnel 403, GET khong chua token", async () => {
    viaTunnel = true;
    expect((await call("PUT", "/api/videostudio/settings", { media: { token: "SECRET-TOKEN" } })).status).toBe(403);
    viaTunnel = false;
    const put = await call("PUT", "/api/videostudio/settings", { media: { token: "SECRET-TOKEN" } });
    expect(put.status).toBe(200);
    expect(put.text).not.toContain("SECRET-TOKEN");
    const get = await call("GET", "/api/videostudio/settings");
    expect(get.status).toBe(200);
    expect(get.text).not.toContain("SECRET-TOKEN");
    expect(get.json.media.hasToken).toBe(true);
  });

  it("styles: tao, xoa, khong xoa builtin, id la 404", async () => {
    const list = await call("GET", "/api/videostudio/styles");
    expect(list.status).toBe(200);
    const builtin = (list.json as Array<{ id: string; builtin: boolean }>).find((s) => s.builtin);
    expect(builtin).toBeTruthy();

    const created = await call("POST", "/api/videostudio/styles", style);
    expect(created.status).toBe(201);
    const id = created.json.id as string;
    expect(created.json.builtin).toBe(false);

    expect((await call("DELETE", `/api/videostudio/styles/${builtin!.id}`)).status).toBe(400);
    expect((await call("DELETE", "/api/videostudio/styles/khong-co")).status).toBe(404);
    const del = await call("DELETE", `/api/videostudio/styles/${id}`);
    expect(del.status).toBe(200);
    expect(del.json).toEqual({ ok: true });
  });

  it("styles POST sai thi 400; JSON hong 400", async () => {
    expect((await call("POST", "/api/videostudio/styles", { name: "" })).status).toBe(400);
    const bad = await fetch(base + "/api/videostudio/styles", { method: "POST", body: "{nope" });
    expect(bad.status).toBe(400);
  });
});
