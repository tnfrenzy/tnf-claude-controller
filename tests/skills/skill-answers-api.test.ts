import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { ControllerConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "a".repeat(48);
let started: StartedServer;
let base: string;
let root: string;

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-ska-"));
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
const call = (method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

const SCHEMA = {
  version: 2,
  fields: [
    { id: "ten", label: "Tên", kind: "text", required: true, reason: "Cần để đặt tên", group: "Chung" },
    { id: "ghi_chu", label: "Ghi chú", kind: "text", required: false, reason: "Tùy chọn", group: "Chung" },
    { id: "bang_gia", label: "Bảng giá", kind: "file", required: false, reason: "Để tính giá", group: "Dữ liệu" }
  ]
};

async function mkSkill(slug: string, inputs: unknown) {
  const res = await call("POST", "/api/skills", { slug, title: slug, goal: "g", files: { "SKILL.md": "# x", "inputs.json": JSON.stringify(inputs) } });
  expect(res.status).toBe(201);
}

describe("skill answers API", () => {
  it("saves valid answers without bumping version; get/zip do not expose them", async () => {
    await mkSkill("ok-skill", SCHEMA);
    const before = (await (await call("GET", "/api/skills/ok-skill")).json()) as any;
    const res = await call("POST", "/api/skills/ok-skill/answers", { answers: { ten: "A" } });
    expect(res.status).toBe(200);
    expect(fs.existsSync(path.join(root, "data", "skills", "ok-skill", "answers.json"))).toBe(true);
    const after = (await (await call("GET", "/api/skills/ok-skill")).json()) as any;
    expect(after.meta.version).toBe(before.meta.version);
    expect(Object.keys(after.files)).not.toContain("answers.json");
    const got = (await (await call("GET", "/api/skills/ok-skill/answers")).json()) as any;
    expect(got.answers).toEqual({ ten: "A" });
    expect(got.schema.fields).toHaveLength(3);
    const zip = Buffer.from(await (await call("GET", "/api/skills/ok-skill/zip")).arrayBuffer());
    expect(zip.includes(Buffer.from("answers"))).toBe(false);
  });

  it("400 answers_invalid with per-field errors when a required field is missing", async () => {
    const res = await call("POST", "/api/skills/ok-skill/answers", { answers: {} });
    expect(res.status).toBe(400);
    const j = (await res.json()) as any;
    expect(j.error).toBe("answers_invalid");
    expect(j.fields.ten).toBeTruthy();
    expect(j.errors.ten).toBeTruthy();
  });

  it("404 for unknown slug", async () => {
    expect((await call("POST", "/api/skills/khong-co/answers", { answers: {} })).status).toBe(404);
    expect((await call("GET", "/api/skills/khong-co/answers")).status).toBe(404);
  });

  it("legacy inputs.json -> 409, missing inputs.json -> 400", async () => {
    await mkSkill("legacy", { description: "d", fields: [{ name: "a_1", label: "A", type: "choice", choices: ["x"] }] });
    const r1 = await call("POST", "/api/skills/legacy/answers", { answers: {} });
    expect(r1.status).toBe(409);
    expect(((await r1.json()) as any).message).toMatch(/inputs/);
    const mk = await call("POST", "/api/skills", { slug: "no-inputs", title: "n", goal: "g", files: { "SKILL.md": "# x" } });
    expect(mk.status).toBe(201);
    expect((await call("POST", "/api/skills/no-inputs/answers", { answers: {} })).status).toBe(400);
  });

  it("bad stage id -> 400 (not 500)", async () => {
    expect((await call("POST", "/api/skills/ok-skill/answers", { answers: { ten: "A" }, stageId: "../x" })).status).toBe(400);
    expect((await call("POST", "/api/skills/ok-skill/answers", { answers: { ten: "A" }, stageId: "khong-ton-tai" })).status).toBe(400);
  });

  it("moves staged files into answers-files and cleans up on re-save", async () => {
    const up = await fetch(`${base}/api/inbox?stage=stg-1`, { method: "POST", headers: { "x-controller-token": TOKEN, "x-file-name": "gia.csv", "content-type": "application/octet-stream" }, body: "a,b\n1,2\n" });
    expect(up.status).toBe(201);
    const res = await call("POST", "/api/skills/ok-skill/answers", { answers: { ten: "A", bang_gia: ["gia.csv"] }, stageId: "stg-1" });
    expect(res.status).toBe(200);
    const dir = path.join(root, "data", "skills", "ok-skill", "answers-files");
    expect(fs.readFileSync(path.join(dir, "gia.csv"), "utf8")).toContain("1,2");
    expect(fs.existsSync(path.join(root, "ws", "inbox-staging", "stg-1"))).toBe(false);
    const bad = await call("POST", "/api/skills/ok-skill/answers", { answers: { ten: "A", bang_gia: ["la.csv"] } });
    expect(bad.status).toBe(400);
    const again = await call("POST", "/api/skills/ok-skill/answers", { answers: { ten: "A" } });
    expect(again.status).toBe(200);
    expect(fs.existsSync(path.join(dir, "gia.csv"))).toBe(false);
  });
});

describe("POST /api/skills with attachments", () => {
  const upload = (stage: string, name: string, body: string | Buffer) =>
    fetch(`${base}/api/inbox?stage=${stage}`, { method: "POST", headers: { "x-controller-token": TOKEN, "x-file-name": name, "content-type": "application/octet-stream" }, body });
  const create = (slug: string, attachments: unknown) => call("POST", "/api/skills", { slug, title: slug, goal: "g", files: { "SKILL.md": "# x" }, attachments });
  const exists = async (slug: string) => (await call("GET", `/api/skills/${slug}`)).status === 200;

  it("creates the skill with staged attachments (text and binary)", async () => {
    expect((await upload("att-1", "in.csv", "a,b\n1,2\n")).status).toBe(201);
    expect((await upload("att-1", "p.dwg", Buffer.from([0, 255, 1, 2]))).status).toBe(201);
    const res = await create("att-ok", [{ pair: "train-1", side: "input", stageId: "att-1", names: ["in.csv", "p.dwg"] }]);
    expect(res.status).toBe(201);
    const dir = path.join(root, "data", "skills", "att-ok", "examples", "train-1", "input");
    expect(fs.readFileSync(path.join(dir, "in.csv"), "utf8")).toContain("1,2");
    expect(fs.readFileSync(path.join(dir, "p.dwg")).length).toBe(4);
    const got = (await (await call("GET", "/api/skills/att-ok")).json()) as any;
    expect(Object.keys(got.files)).toEqual(["SKILL.md"]);
  });

  it("400 for bad stageId, bad names, bad pair/side, missing stage", async () => {
    expect((await create("att-b1", [{ pair: "train-1", side: "input", stageId: "../x", names: ["a.txt"] }])).status).toBe(400);
    expect((await create("att-b2", [{ pair: "train-1", side: "input", stageId: "att-2", names: ["../a.txt"] }])).status).toBe(400);
    expect((await create("att-b3", [{ pair: "x-1", side: "input", stageId: "att-2", names: ["a.txt"] }])).status).toBe(400);
    expect((await create("att-b4", [{ pair: "train-1", side: "mid", stageId: "att-2", names: ["a.txt"] }])).status).toBe(400);
    const missing = await create("att-b5", [{ pair: "train-1", side: "input", stageId: "khong-co-stage", names: ["a.txt"] }]);
    expect(missing.status).toBe(400);
    expect(((await missing.json()) as any).message).toMatch(/[ạăâêôơưđ]/i);
    for (const s of ["att-b1", "att-b2", "att-b3", "att-b4", "att-b5"]) expect(await exists(s)).toBe(false);
  });

  it("400 when the stage exists but the file name is not in inbox/; skill not created", async () => {
    expect((await upload("att-3", "real.txt", "x")).status).toBe(201);
    const res = await create("att-nofile", [{ pair: "train-1", side: "input", stageId: "att-3", names: ["other.txt"] }]);
    expect(res.status).toBe(400);
    expect(await exists("att-nofile")).toBe(false);
  });

  it("400 when a file is over the 1 MB cap; skill not created", async () => {
    expect((await upload("att-4", "big.txt", Buffer.alloc(1024 * 1024 + 1, 65))).status).toBe(201);
    const res = await create("att-big", [{ pair: "train-1", side: "input", stageId: "att-4", names: ["big.txt"] }]);
    expect(res.status).toBe(400);
    expect(await exists("att-big")).toBe(false);
  });
});
