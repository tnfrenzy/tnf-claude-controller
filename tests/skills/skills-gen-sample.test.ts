import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import type { RunStep } from "../../src/core/skill-workshop/runner.js";
import { createSkillsGen } from "../../src/server/skills-gen.js";

let dir: string;
const req = {} as IncomingMessage;
const base = ["api", "skills-gen", "sessions"];

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sgs-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const GOOD = '```json\n' + JSON.stringify({
  title: "Báo cáo mẫu",
  inputSummary: "Đầu vào mẫu",
  sections: [{ heading: "Tổng quan", paragraphs: ["Nội dung & kết quả"] }],
  tables: [{ name: "Bảng 1", columns: ["A", "B"], rows: [["1", "2"]] }],
  summary: "Đã làm được X",
}) + "\n```";

async function setup(slug: string, runStep: RunStep, extra: Record<string, unknown> = {}) {
  const store = createSkillStore(dir);
  let finderCalls = 0;
  const gen = createSkillsGen({
    store,
    dataDir: dir,
    readBody: async () => ({ slug, brief: "Làm báo cáo", ...extra }),
    listRoles: () => [],
    finder: async () => {
      finderCalls++;
      return { ok: false, text: "" };
    },
    runStep,
  });
  await store.create({ slug, title: "T", goal: "g", files: { "SKILL.md": "# S" } });
  const started = await gen.handle(req, base, "POST");
  return { gen, finderCalls: () => finderCalls, started };
}

async function waitIdle(gen: Awaited<ReturnType<typeof setup>>["gen"], slug: string) {
  for (let i = 0; i < 100; i++) {
    const g = await gen.readGen(slug);
    if (g.sample.status !== "running") return g;
    await new Promise((r) => setTimeout(r, 30));
  }
  return gen.readGen(slug);
}

const ok = (text: string, costUsd = 0.1) => async () => ({ runId: "r", costUsd, text, ok: true });

describe("generate-sample", () => {
  it("builds both files, moves to awaiting_score, and start never calls the finder", async () => {
    const { gen, finderCalls, started } = await setup("s1", ok(GOOD));
    expect(started?.status).toBe(201);
    expect((started?.body as { status: string }).status).toBe("generating");
    const r = await gen.handle(req, [...base, "s1", "steps", "generate-sample"], "POST");
    expect(r?.status).toBe(202);
    const g = await waitIdle(gen, "s1");
    expect(g.sample.status).toBe("done");
    expect(g.costUsd).toBeCloseTo(0.1);
    const session = await gen.sessions.get("s1");
    expect(session?.status).toBe("awaiting_score");
    expect(session?.rounds[0]?.sample?.files.map((f) => f.format)).toEqual(["docx", "xlsx"]);
    for (const f of ["sample.docx", "sample.xlsx"]) {
      expect(fs.readFileSync(path.join(dir, "skills-gen", "s1", "round-1", f)).subarray(0, 2).toString("latin1")).toBe("PK");
    }
    const dl = await gen.handle(req, [...base, "s1", "rounds", "1", "sample", "docx"], "GET");
    expect(dl?.file?.data.subarray(0, 2).toString("latin1")).toBe("PK");
    expect(finderCalls()).toBe(0);
    const again = await gen.handle(req, [...base, "s1", "steps", "generate-sample"], "POST").catch((e) => e);
    expect(again.code ?? again.status).toBeTruthy();
    expect(again.status).toBe(409);
  });

  it("rejects a second parallel call with 409 already_running", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((res) => (release = res));
    const { gen } = await setup("s2", async () => {
      await gate;
      return { runId: "r", costUsd: 0, text: GOOD, ok: true };
    });
    expect((await gen.handle(req, [...base, "s2", "steps", "generate-sample"], "POST"))?.status).toBe(202);
    const second = await gen.handle(req, [...base, "s2", "steps", "generate-sample"], "POST").catch((e) => e);
    expect(second.status).toBe(409);
    expect(second.code).toBe("already_running");
    release();
    expect((await waitIdle(gen, "s2")).sample.status).toBe("done");
  });

  it("pauses on a failed step and can be called again", async () => {
    let fail = true;
    const { gen } = await setup("s3", async () => (fail ? { runId: "r", costUsd: 0, text: "", ok: false, error: "boom" } : { runId: "r", costUsd: 0, text: GOOD, ok: true }));
    await gen.handle(req, [...base, "s3", "steps", "generate-sample"], "POST");
    const g = await waitIdle(gen, "s3");
    expect(g.sample.status).toBe("failed");
    expect((await gen.sessions.get("s3"))?.status).toBe("paused");
    fail = false;
    await gen.handle(req, [...base, "s3", "steps", "generate-sample"], "POST");
    expect((await waitIdle(gen, "s3")).sample.status).toBe("done");
    expect((await gen.sessions.get("s3"))?.status).toBe("awaiting_score");
  });

  it("pauses when cost exceeds the cap", async () => {
    const { gen } = await setup("s4", ok(GOOD, 5), { costCapUsd: 1 });
    await gen.handle(req, [...base, "s4", "steps", "generate-sample"], "POST");
    const g = await waitIdle(gen, "s4");
    expect(g.sample.status).toBe("failed");
    expect((await gen.sessions.get("s4"))?.status).toBe("paused");
  });

  it("retries once on unparsable output", async () => {
    let calls = 0;
    const { gen } = await setup("s5", async (_role, prompt) => {
      calls++;
      return { runId: "r", costUsd: 0, text: calls === 1 ? "không có json" : GOOD, ok: true, ...(prompt ? {} : {}) };
    });
    await gen.handle(req, [...base, "s5", "steps", "generate-sample"], "POST");
    expect((await waitIdle(gen, "s5")).sample.status).toBe("done");
    expect(calls).toBe(2);
  });

  it("rejects a bad costCapUsd on start and a non-generating session", async () => {
    const store = createSkillStore(dir);
    await store.create({ slug: "s6", title: "T", goal: "g", files: { "SKILL.md": "# S" } });
    const bad = createSkillsGen({ store, dataDir: dir, readBody: async () => ({ slug: "s6", brief: "b", costCapUsd: 99 }), listRoles: () => [], finder: async () => ({ ok: false, text: "" }) });
    const e = await bad.handle(req, base, "POST").catch((x) => x);
    expect(e.status).toBe(400);
    const { gen } = await setup("s7", ok(GOOD));
    await gen.handle(req, [...base, "s7", "steps", "generate-sample"], "POST");
    await waitIdle(gen, "s7");
    const notGen = await gen.handle(req, [...base, "s7", "steps", "generate-sample"], "POST").catch((x) => x);
    expect(notGen.code).toBe("session_not_generating");
  });
});
