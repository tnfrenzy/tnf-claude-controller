import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { createWorkshop3D, makeWorkshop3DEngine } from "../../src/core/workshop3d/index.js";
import { createW3DStore } from "../../src/core/workshop3d/store.js";
import { W3DError } from "../../src/core/workshop3d/state.js";
import type { W3DRunner } from "../../src/core/workshop3d/runner.js";
import type { W3DBrief } from "../../src/core/workshop3d/types.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const REPO = path.resolve(__dirname, "..", "..");
const TOKEN = "e".repeat(48);
const H = { "x-controller-token": TOKEN };
const J = { ...H, "content-type": "application/json" };

let started: StartedServer;
let base: string;
let root: string;
const calls: string[] = [];
const recovered = { n: 0 };
const startedFiles: Record<string, Buffer | string>[] = [];

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-w3d-api-"));
  const dataDir = path.join(root, "data");
  const store = createW3DStore(dataDir);
  const runner: W3DRunner = {
    start(brief: W3DBrief, files = {}) {
      startedFiles.push(files);
      const slug = store.create(brief);
      calls.push(`start:${brief.title}`);
      return slug;
    },
    answer(slug, text) {
      const s = store.get(slug)!.snapshot;
      if (s.state !== "awaiting_user") throw new W3DError("Phiên không chờ câu trả lời.");
      calls.push(`answer:${slug}:${text}`);
    },
    pause: (slug) => void calls.push(`pause:${slug}`),
    resume: (slug) => void calls.push(`resume:${slug}`),
    stop: (slug) => void calls.push(`stop:${slug}`),
    rebuild: (slug, p) => void calls.push(`rebuild:${slug}:${JSON.stringify(p ?? null)}`),
    recover: () => {
      recovered.n++;
      return [];
    },
    idle: async () => undefined,
  };
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
  started = await startServer({ config, port: 0, token: TOKEN, claudePath: process.execPath, claudeArgsPrefix: [FAKE], env: { ...process.env, FAKE_CLAUDE_FIXTURE: "roles" }, workshop3d: engine });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const post = (p: string, body: unknown, headers: Record<string, string> = J): Promise<Response> =>
  fetch(`${base}${p}`, { method: "POST", headers, body: JSON.stringify(body) });

describe("workshop3d API", () => {
  it("requires the token", async () => {
    expect((await fetch(`${base}/api/workshop3d`)).status).toBe(401);
    expect((await post("/api/workshop3d", { prompt: "hop" }, { "content-type": "application/json" })).status).toBe(401);
  });

  it("creates a session from a prompt and lists it", async () => {
    const r = await post("/api/workshop3d", { prompt: "mot cai hop go nho" });
    expect(r.status).toBe(201);
    const { slug } = (await r.json()) as { slug: string };
    expect(slug).toMatch(/^\d{8}-\d{6}-[0-9a-f]{6}$/);
    expect(calls).toContain("start:mot cai hop go nho");
    const list = (await (await fetch(`${base}/api/workshop3d`, { headers: H })).json()) as { sessions: { slug: string }[]; kit: unknown };
    expect(list.sessions.map((s) => s.slug)).toContain(slug);
    expect(list).toHaveProperty("kit");
    const detail = (await (await fetch(`${base}/api/workshop3d/${slug}`, { headers: H })).json()) as { brief: W3DBrief; snapshot: { state: string }; files: string[]; renders: string[]; report: string | null };
    expect(detail.brief.object).toBe("mot cai hop go nho");
    expect(detail.brief.detail).toBe("high");
    expect(detail.snapshot.state).toBe("intake");
    expect(detail.files).toEqual([]);
    expect(detail.report).toBeNull();
  });

  it("accepts a full brief and validates input", async () => {
    const ok = await post("/api/workshop3d", { brief: { title: "Ke", object: "ke sach", params: { width: 800 }, detail: "standard" } });
    expect(ok.status).toBe(201);
    expect((await post("/api/workshop3d", { prompt: "x".repeat(4001) })).status).toBe(400);
    expect((await post("/api/workshop3d", {})).status).toBe(400);
    expect((await post("/api/workshop3d", { brief: { title: "", object: "x", detail: "high" } })).status).toBe(400);
    expect((await post("/api/workshop3d", { brief: { title: "a", object: "b", detail: "huge" } })).status).toBe(400);
    const att = await post("/api/workshop3d", { prompt: "hop", attachments: [{ name: "a.png" }] });
    expect(att.status).toBe(400);
    expect(((await att.json()) as { message: string }).message).toMatch(/đính kèm/);
    expect((await post("/api/workshop3d", { prompt: "hop", attachments: [] })).status).toBe(201);
  });

  it("a 4000-character description is accepted whole, 4001 is refused (never cut silently)", async () => {
    const object = "o".repeat(4000);
    const ok = await post("/api/workshop3d", { brief: { title: "Dai", object, detail: "high" } });
    expect(ok.status).toBe(201);
    const { slug } = (await ok.json()) as { slug: string };
    const detail = (await (await fetch(`${base}/api/workshop3d/${slug}`, { headers: H })).json()) as { brief: W3DBrief };
    expect(detail.brief.object).toBe(object);
    const long = await post("/api/workshop3d", { brief: { title: "Dai", object: `${object}x`, detail: "high" } });
    expect(long.status).toBe(400);
    expect(((await long.json()) as { message: string }).message).toMatch(/4000/);
  });

  describe("reference images via POST /api/inbox + inbox_stage", () => {
    const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from([0x00, 0xff, 0xfe, 0x80])]);
    const JPG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x81]);
    const stageFile = async (name: string, data: Buffer, stage?: string): Promise<string> => {
      const r = await fetch(`${base}/api/inbox${stage ? `?stage=${stage}` : ""}`, { method: "POST", headers: { ...H, "content-type": "application/octet-stream", "x-file-name": name }, body: data });
      expect(r.status).toBe(201);
      return ((await r.json()) as { stage_id: string }).stage_id;
    };
    it("passes the exact bytes to the runner and removes the staging dir", async () => {
      const stage = await stageFile("mau-cabin.png", PNG);
      await stageFile("cop.jpg", JPG, stage);
      startedFiles.length = 0;
      const r = await post("/api/workshop3d", { brief: { title: "Cabin", object: "cabin theo ảnh", detail: "high" }, inbox_stage: stage });
      expect(r.status).toBe(201);
      const files = startedFiles[0]!;
      expect(Object.keys(files).sort()).toEqual(["cop.jpg", "mau-cabin.png"]);
      expect(Buffer.isBuffer(files["mau-cabin.png"])).toBe(true);
      expect((files["mau-cabin.png"] as Buffer).equals(PNG)).toBe(true);
      expect((files["cop.jpg"] as Buffer).equals(JPG)).toBe(true);
      expect(fs.existsSync(started.manager.stageDir(stage))).toBe(false);
      // The stage id is used up: sending it again is an error, not an empty session.
      expect((await post("/api/workshop3d", { prompt: "lai", inbox_stage: stage })).status).toBe(400);
    });
    it("refuses non-images, mismatched content and more than 5 images (400, Vietnamese message)", async () => {
      const txt = await stageFile("ghi-chu.txt", Buffer.from("chu"));
      const a = await post("/api/workshop3d", { prompt: "hop", inbox_stage: txt });
      expect(a.status).toBe(400);
      expect(((await a.json()) as { message: string }).message).toMatch(/PNG, JPG hoặc WebP/);
      const fake = await stageFile("gia.png", Buffer.from("not a png at all"));
      const b = await post("/api/workshop3d", { prompt: "hop", inbox_stage: fake });
      expect(b.status).toBe(400);
      expect(((await b.json()) as { message: string }).message).toMatch(/không phải ảnh PNG/);
      let many = await stageFile("a1.png", PNG);
      for (let i = 2; i <= 6; i++) many = await stageFile(`a${i}.png`, PNG, many);
      const c = await post("/api/workshop3d", { prompt: "hop", inbox_stage: many });
      expect(c.status).toBe(400);
      expect(((await c.json()) as { message: string }).message).toMatch(/Tối đa 5 ảnh/);
      expect((await post("/api/workshop3d", { prompt: "hop", inbox_stage: "../x" })).status).toBe(400);
    });
  });

  it("answer: 409 when not awaiting, 400 on bad text", async () => {
    const { slug } = (await (await post("/api/workshop3d", { prompt: "hop 2" })).json()) as { slug: string };
    const r = await post(`/api/workshop3d/${slug}/answer`, { text: "ok" });
    expect(r.status).toBe(409);
    expect(((await r.json()) as { message: string }).message).toBe("Phiên không chờ câu trả lời.");
    expect((await post(`/api/workshop3d/${slug}/answer`, { text: "y".repeat(4001) })).status).toBe(400);
    expect((await post(`/api/workshop3d/${slug}/answer`, {})).status).toBe(400);
    const s = createW3DStore(path.join(root, "data"));
    const rec = s.get(slug)!;
    s.saveSnapshot(slug, { ...rec.snapshot, state: "awaiting_user", questions: ["q?"] });
    expect((await post(`/api/workshop3d/${slug}/answer`, { text: "ok" })).status).toBe(200);
    expect(calls).toContain(`answer:${slug}:ok`);
  });

  it("pause, resume, stop and rebuild call the runner", async () => {
    const { slug } = (await (await post("/api/workshop3d", { prompt: "hop 3" })).json()) as { slug: string };
    for (const a of ["pause", "resume", "stop"]) expect((await post(`/api/workshop3d/${slug}/${a}`, {})).status).toBe(200);
    expect(calls).toEqual(expect.arrayContaining([`pause:${slug}`, `resume:${slug}`, `stop:${slug}`]));
    const before = calls.filter((c) => c.startsWith("rebuild:")).length;
    const r = await post(`/api/workshop3d/${slug}/rebuild`, { params: { width: 900 } });
    expect(r.status).toBe(200);
    expect(calls.filter((c) => c.startsWith("rebuild:"))).toHaveLength(before + 1);
    expect(calls).toContain(`rebuild:${slug}:{"width":900}`);
    expect((await post(`/api/workshop3d/${slug}/rebuild`, { params: [1] })).status).toBe(400);
  });

  it("unknown slug is 404", async () => {
    const bogus = "20200101-000000-abcdef";
    expect((await fetch(`${base}/api/workshop3d/${bogus}`, { headers: H })).status).toBe(404);
    expect((await post(`/api/workshop3d/${bogus}/pause`, {})).status).toBe(404);
    expect((await fetch(`${base}/api/workshop3d/not-a-slug`, { headers: H })).status).toBe(404);
  });

  it("serves files only under outputs/ and renders/", async () => {
    const { slug } = (await (await post("/api/workshop3d", { prompt: "hop 4" })).json()) as { slug: string };
    const s = createW3DStore(path.join(root, "data"));
    s.writeFile(slug, "outputs/model.glb", Buffer.from("glTF"));
    s.writeFile(slug, "outputs/model.usdz", Buffer.from("PK"));
    s.writeFile(slug, "outputs/model.step", "ISO-10303");
    s.writeFile(slug, "renders/iso.png", Buffer.from([0x89, 0x50]));
    s.writeFile(slug, "REPORT.md", "# bao cao");
    s.writeFile(slug, "outputs/notes.txt", "no");
    const get = (p: string): Promise<Response> => fetch(`${base}/api/workshop3d/${slug}/file?path=${encodeURIComponent(p)}`, { headers: H });
    const glb = await get("outputs/model.glb");
    expect(glb.status).toBe(200);
    expect(glb.headers.get("content-type")).toBe("model/gltf-binary");
    expect(glb.headers.get("content-disposition") ?? "").not.toMatch(/attachment/);
    expect(Buffer.from(await glb.arrayBuffer()).toString()).toBe("glTF");
    const png = await get("renders/iso.png");
    expect(png.headers.get("content-type")).toBe("image/png");
    expect(png.headers.get("content-disposition") ?? "").not.toMatch(/attachment/);
    expect((await get("outputs/model.usdz")).headers.get("content-type")).toBe("model/vnd.usdz+zip");
    expect((await get("outputs/model.step")).headers.get("content-type")).toBe("application/octet-stream");
    expect((await get("../x")).status).toBe(400);
    expect((await get("outputs/../state.json")).status).toBe(400);
    expect((await get("outputs\\..\\state.json")).status).toBe(400);
    expect((await get("C:/Windows/win.ini")).status).toBe(400);
    expect((await get("/etc/passwd")).status).toBe(400);
    expect((await get("brief.json")).status).toBe(400);
    expect((await get("REPORT.md")).status).toBe(400);
    expect((await get("outputs/notes.txt")).status).toBe(400);
    expect((await get("outputs/missing.glb")).status).toBe(404);
    expect((await fetch(`${base}/api/workshop3d/${slug}/file`, { headers: H })).status).toBe(400);
    expect((await fetch(`${base}/api/workshop3d/${slug}/file?path=outputs/model.glb`)).status).toBe(401);
    const d = (await (await fetch(`${base}/api/workshop3d/${slug}`, { headers: H })).json()) as { files: string[]; renders: string[]; report: string };
    expect(d.files).toEqual(expect.arrayContaining(["outputs/model.glb", "outputs/model.usdz"]));
    expect(d.renders).toEqual(["renders/iso.png"]);
    expect(d.report).toBe("# bao cao");
  });

  it("413 above 50 MB", async () => {
    const { slug } = (await (await post("/api/workshop3d", { prompt: "hop 5" })).json()) as { slug: string };
    const s = createW3DStore(path.join(root, "data"));
    s.writeFile(slug, "outputs/big.glb", "x");
    fs.truncateSync(path.join(s.dir(slug), "outputs", "big.glb"), 50 * 1024 * 1024 + 1);
    const r = await fetch(`${base}/api/workshop3d/${slug}/file?path=outputs/big.glb`, { headers: H });
    expect(r.status).toBe(413);
  });

  it("recovers sessions once at startup", () => {
    expect(recovered.n).toBe(1);
  });

  it("createWorkshop3D creates the workshop3d project, hidden from /api/projects", async () => {
    expect(started.manager.store.getProject("workshop3d")).toBeNull();
    createWorkshop3D({ manager: started.manager, dataDir: path.join(root, "data2"), config: started.manager.config });
    expect(started.manager.store.getProject("workshop3d")).not.toBeNull();
    const r = (await (await fetch(`${base}/api/projects`, { headers: H })).json()) as { projects: { name: string }[] };
    expect(r.projects.map((p) => p.name)).not.toContain("workshop3d");
  });

  it("malformed percent-encoding in the slug is 404, not 500", async () => {
    expect((await fetch(`${base}/api/workshop3d/%E0%A4%A`, { headers: H })).status).toBe(404);
    expect((await post("/api/workshop3d/%E0%A4%A/pause", {})).status).toBe(404);
  });
});
