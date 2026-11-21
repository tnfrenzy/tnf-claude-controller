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
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sgf-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

const GOOD =
  "```json\n" +
  JSON.stringify({
    title: "Báo cáo mẫu",
    inputSummary: "Đầu vào mẫu",
    sections: [{ heading: "Tổng quan", paragraphs: ["Nội dung"] }],
    tables: [{ name: "Bảng 1", columns: ["A"], rows: [["1"]] }],
    summary: "Đã làm được X",
  }) +
  "\n```";
const FINAL_MD =
  "```markdown\n---\nname: s\ndescription: Soạn báo cáo\n---\n\n# Mục đích\n" +
  "Hướng dẫn chi tiết để agent khác làm báo cáo theo mẫu đã duyệt. ".repeat(40) +
  "\n```";

async function setup(slug: string, runStep: RunStep) {
  const store = createSkillStore(dir);
  const gen = createSkillsGen({
    store,
    dataDir: dir,
    readBody: async () => ({ slug, brief: "Làm báo cáo" }),
    listRoles: () => [],
    finder: async () => ({ ok: false, text: "" }),
    runStep,
  });
  await store.create({ slug, title: "T", goal: "g", files: { "SKILL.md": "Làm báo cáo" } });
  await gen.handle(req, base, "POST");
  return gen;
}

async function until(fn: () => Promise<boolean>) {
  for (let i = 0; i < 150; i++) {
    if (await fn()) return;
    await new Promise((r) => setTimeout(r, 30));
  }
}
const grade = (gen: Awaited<ReturnType<typeof setup>>, slug: string, score: number, feedback = "") =>
  gen.handle({ } as IncomingMessage, [...base, slug, "grade"], "POST");

function withBody(slug: string, runStep: RunStep) {
  let body: Record<string, unknown> = { slug, brief: "Làm báo cáo" };
  const store = createSkillStore(dir);
  const gen = createSkillsGen({
    store,
    dataDir: dir,
    readBody: async () => body,
    listRoles: () => [],
    finder: async () => ({ ok: false, text: "" }),
    runStep,
  });
  return { gen, store, setBody: (b: Record<string, unknown>) => (body = b) };
}

describe("grade -> next round / finalize", () => {
  it("low score starts round 2 with feedback in prompt; 100 finalizes into the zip", async () => {
    const prompts: string[] = [];
    const runStep: RunStep = async (_role, prompt) => {
      prompts.push(prompt);
      const isFinal = prompt.includes("SKILL.md HOÀN CHỈNH");
      return { runId: "r", costUsd: 0.1, text: isFinal ? FINAL_MD : GOOD, ok: true };
    };
    const { gen, store, setBody } = withBody("f1", runStep);
    await store.create({ slug: "f1", title: "T", goal: "g", files: { "SKILL.md": "Làm báo cáo" } });
    await gen.handle(req, base, "POST");
    await gen.handle(req, [...base, "f1", "steps", "generate-sample"], "POST");
    await until(async () => (await gen.sessions.get("f1"))?.status === "awaiting_score");
    setBody({ score: 60, feedback: "Thiếu số liệu quý" });
    await gen.handle(req, [...base, "f1", "grade"], "POST");
    await until(async () => (await gen.sessions.get("f1"))?.rounds.length === 2 && (await gen.sessions.get("f1"))?.status === "awaiting_score");
    expect(fs.existsSync(path.join(dir, "skills-gen", "f1", "round-2", "sample.docx"))).toBe(true);
    expect(prompts.some((p) => p.includes("Thiếu số liệu quý"))).toBe(true);

    const early = await gen.handle(req, [...base, "f1", "zip"], "GET").catch((e) => e);
    expect(early.status).toBe(409);

    setBody({ score: 100, feedback: "" });
    await gen.handle(req, [...base, "f1", "grade"], "POST");
    await until(async () => (await gen.readGen("f1")).final?.status === "done");
    expect((await gen.readGen("f1")).final?.status).toBe("done");
    const zip = await gen.handle(req, [...base, "f1", "zip"], "GET");
    expect(zip?.status).toBe(200);
    const text = zip!.zip!.data.toString("latin1");
    expect(text).toContain("samples/round-2.docx");
    expect(fs.readFileSync(path.join(dir, "skills-gen", "f1", "final", "SKILL.md"), "utf8")).toContain("Hướng dẫn chi tiết");
  });

  it("final failure can be retried via steps/finalize", async () => {
    let failFinal = true;
    const runStep: RunStep = async (_r, prompt) => {
      if (prompt.includes("SKILL.md HOÀN CHỈNH")) {
        return failFinal ? { runId: "r", costUsd: 0, text: "", ok: false, error: "boom" } : { runId: "r", costUsd: 0, text: FINAL_MD, ok: true };
      }
      return { runId: "r", costUsd: 0, text: GOOD, ok: true };
    };
    const { gen, store, setBody } = withBody("f2", runStep);
    await store.create({ slug: "f2", title: "T", goal: "g", files: { "SKILL.md": "Làm báo cáo" } });
    await gen.handle(req, base, "POST");
    await gen.handle(req, [...base, "f2", "steps", "generate-sample"], "POST");
    await until(async () => (await gen.sessions.get("f2"))?.status === "awaiting_score");
    setBody({ score: 100, feedback: "" });
    await gen.handle(req, [...base, "f2", "grade"], "POST");
    await until(async () => (await gen.readGen("f2")).final?.status === "failed");
    expect((await gen.readGen("f2")).final?.status).toBe("failed");
    const blocked = await gen.handle(req, [...base, "f2", "zip"], "GET").catch((e) => e);
    expect(blocked.status).toBe(409);
    failFinal = false;
    expect((await gen.handle(req, [...base, "f2", "steps", "finalize"], "POST"))?.status).toBe(202);
    await until(async () => (await gen.readGen("f2")).final?.status === "done");
    expect((await gen.handle(req, [...base, "f2", "zip"], "GET"))?.status).toBe(200);
  });
});

void setup;
void grade;
