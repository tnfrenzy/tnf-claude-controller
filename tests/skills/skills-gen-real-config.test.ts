import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { loadConfig } from "../../src/core/app/config.js";
import { startServer, type StartedServer } from "../../src/server/index.js";

/**
 * Regression: skill-generation steps (sample, finalize) run through RunManager with the REAL config/controller.json.
 * Each step must be a plain text run: no coordinator system prompt, no --agents file, no Agent tool
 * (otherwise the model tries to delegate to searcher/analyzer/synthesizer and never returns the JSON block).
 */
const FAKE = path.resolve(__dirname, "..", "..", "fixtures", "fake-claude.mjs");
const TOKEN = "s".repeat(48);
let started: StartedServer;
let base: string;
let root: string;

const SAMPLE = {
  title: "Báo giá mẫu",
  inputSummary: "Khách cần báo giá",
  sections: [{ heading: "Tổng quan", paragraphs: ["Nội dung mẫu."] }],
  tables: [{ name: "Bảng", columns: ["A", "B"], rows: [["1", "2"]] }],
  summary: "Đã tạo mẫu.",
};
const FINAL_MD = "---\nname: bao-gia\ndescription: Soạn báo giá\n---\n# Mục đích\n" + "Hướng dẫn chi tiết cho agent làm báo giá cho khách hàng example.com. ".repeat(40) + "\n# Quy trình\n1. Đọc yêu cầu\n2. Soạn bảng giá\n";

function stream(text: string): string {
  const sid = "11111111-2222-4333-8444-555555555555";
  return [
    { type: "system", subtype: "init", session_id: sid, model: "fake", claude_code_version: "0.0.0-fake", tools: [], agents: [] },
    { type: "assistant", message: { id: "m1", type: "message", role: "assistant", model: "fake", content: [{ type: "text", text }], stop_reason: "end_turn", usage: { input_tokens: 3, output_tokens: 20 } }, session_id: sid },
    { type: "result", subtype: "success", is_error: false, duration_ms: 10, num_turns: 1, result: text, total_cost_usd: 0.01, session_id: sid, usage: { input_tokens: 3, output_tokens: 20 } },
  ].map((o) => JSON.stringify(o)).join("\n") + "\n";
}

beforeAll(async () => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sgreal-"));
  const real = loadConfig();
  const config = {
    ...real,
    workspaceDir: path.join(root, "ws"),
    worktreesDir: path.join(root, "ws", "worktrees"),
    dataDir: path.join(root, "data"),
    server: { ...real.server, port: 0, allowedOrigins: [] },
  };
  fs.writeFileSync(path.join(root, "sample.stream.jsonl"), stream("```json\n" + JSON.stringify(SAMPLE) + "\n```"));
  fs.writeFileSync(path.join(root, "final.stream.jsonl"), stream("```markdown\n" + FINAL_MD + "\n```"));
  started = await startServer({
    config,
    port: 0,
    token: TOKEN,
    claudePath: process.execPath,
    claudeArgsPrefix: [FAKE],
    env: {
      ...process.env,
      FAKE_CLAUDE_FIXTURE: path.join(root, "sample.stream.jsonl"),
      FAKE_CLAUDE_ARGS_FILE: path.join(root, "args.json"),
    },
  });
  base = `http://127.0.0.1:${started.policy.port}`;
});

afterAll(async () => {
  await started.close();
  fs.rmSync(root, { recursive: true, force: true });
});

const H = { "x-controller-token": TOKEN, "content-type": "application/json" };
const call = (method: string, url: string, body?: unknown) =>
  fetch(`${base}${url}`, { method, headers: H, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });

async function waitFor<T>(fn: () => Promise<T | null>, ms = 15000): Promise<T> {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > ms) throw new Error("timeout");
    await new Promise((r) => setTimeout(r, 50));
  }
}

describe("skills-gen với config thật", () => {
  it("luồng UI: tạo -> bắt đầu -> chọn vai -> mẫu -> chấm 100 -> SKILL.md -> zip", async () => {
    const slug = "bao-gia";
    // Same order as GenerativeTrainForm.start()
    expect((await call("POST", "/api/skills", { slug, title: "Báo giá", goal: "g", files: { "SKILL.md": "# S" } })).status).toBe(201);
    const s = await call("POST", "/api/skills-gen/sessions", { slug, brief: "Soạn báo giá cho khách example.com", maxRounds: 5 });
    expect(s.status).toBe(201);
    expect((await call("POST", `/api/skills-gen/sessions/${slug}/steps/find-roles`)).status).toBe(200);
    const ag = await call("POST", `/api/skills-gen/sessions/${slug}/steps/create-agents`, {});
    expect(ag.status).toBe(200);
    const gs = await call("POST", `/api/skills-gen/sessions/${slug}/steps/generate-sample`);
    expect(gs.status).toBe(202);

    const sess = await waitFor(async () => {
      const r = (await (await call("GET", `/api/skills-gen/sessions/${slug}`)).json()) as { session: { status: string; rounds: { sample?: unknown }[] }; gen: { sample: { status: string; error?: string } } };
      if (r.gen.sample.status === "failed") throw new Error(`sample failed: ${r.gen.sample.error}`);
      return r.gen.sample.status === "done" ? r : null;
    });
    expect(sess.session.status).toBe("awaiting_score");

    // The step must be a plain text run (no coordinator, no agents, no Agent tool).
    const args = JSON.parse(fs.readFileSync(path.join(root, "args.json"), "utf8")) as string[];
    expect(args).not.toContain("--agents");
    expect(args).not.toContain("--append-system-prompt-file");
    const at = args.indexOf("--allowedTools");
    const allowed = at < 0 ? [] : args.slice(at + 1, args.findIndex((a, i) => i > at && a.startsWith("--")) < 0 ? undefined : args.findIndex((a, i) => i > at && a.startsWith("--")));
    expect(allowed).not.toContain("Agent");
    expect(allowed.some((t) => /^(Bash|Write|Edit)/.test(t))).toBe(false);

    // sample download
    const dl = await call("GET", `/api/skills-gen/sessions/${slug}/rounds/1/sample/docx`);
    expect(dl.status).toBe(200);

    // grade 100 -> finalize
    fs.writeFileSync(path.join(root, "args.json"), "");
    const prevFixture = path.join(root, "final.stream.jsonl");
    // switch the fake CLI's stream for the finalize step via a counter-less approach: replace the sample stream file content
    fs.copyFileSync(prevFixture, path.join(root, "sample.stream.jsonl"));
    const g = await call("POST", `/api/skills-gen/sessions/${slug}/grade`, { score: 100, feedback: "tốt" });
    expect(g.status).toBe(200);
    await waitFor(async () => {
      const r = (await (await call("GET", `/api/skills-gen/sessions/${slug}`)).json()) as { gen: { final?: { status: string; error?: string } } };
      if (r.gen.final?.status === "failed") throw new Error(`final failed: ${r.gen.final.error}`);
      return r.gen.final?.status === "done" ? r : null;
    });
    const zip = await call("GET", `/api/skills-gen/sessions/${slug}/zip`);
    expect(zip.status).toBe(200);
    const buf = Buffer.from(await zip.arrayBuffer());
    expect(buf.subarray(0, 2).toString()).toBe("PK");
  });

  it("project skill-workshop ẩn khỏi /api/projects nhưng vẫn chạy được", async () => {
    const r = (await (await call("GET", "/api/projects")).json()) as { projects: { name: string }[] };
    expect(r.projects.some((p) => p.name === "skill-workshop")).toBe(false);
    expect(started.manager.store.getProject("skill-workshop")).toBeTruthy();
  });
});
