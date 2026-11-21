import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import { createSkillsGen, buildSourceNotes } from "../../src/server/skills-gen.js";

let dir: string;
const req = {} as IncomingMessage;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-sgf-"));
});
afterAll(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

function make(finder: (p: string) => Promise<{ ok: boolean; text: string }>, body: Record<string, unknown> = {}) {
  const store = createSkillStore(dir);
  const gen = createSkillsGen({ store, dataDir: dir, readBody: async () => body, listRoles: () => [], finder });
  return { store, gen };
}

async function poll(gen: ReturnType<typeof make>["gen"], slug: string) {
  for (let i = 0; i < 40; i++) {
    const g = await gen.readGen(slug);
    if (g.finder.status !== "running") return g;
    await new Promise((r) => setTimeout(r, 50));
  }
  return gen.readGen(slug);
}

const GOOD = '```json\n{"repos":[{"url":"https://github.com/example/agent-kit","name":"agent-kit","reason":"fits","features":["a"]}]}\n```';

async function setup(slug: string, finder: (p: string) => Promise<{ ok: boolean; text: string }>) {
  const m = make(finder, { slug, brief: "build agents" });
  await m.store.create({ slug, title: "T", goal: "g", files: { "SKILL.md": "# S" } });
  await m.gen.handle(req, ["api", "skills-gen", "sessions"], "POST");
  return m;
}
const step = ["api", "skills-gen", "sessions"];

describe("buildSourceNotes", () => {
  const base = { name: "n", reason: "why", features: ["f1"] };
  it("keeps excerpt for MIT and drops it for empty or copyleft license; every repo has a note", () => {
    const repos = [
      { ...base, url: "https://github.com/e/a", license: "MIT", excerpt: "text", agentPrompt: "P" },
      { ...base, url: "https://github.com/e/b", excerpt: "leak", agentPrompt: "leak" },
      { ...base, url: "https://github.com/e/c", license: "GPL-3.0", excerpt: "leak" },
    ];
    const notes = buildSourceNotes(repos);
    expect(notes).toHaveLength(3);
    expect(notes[0]).toMatchObject({ url: "https://github.com/e/a", license: "MIT", excerpt: "text", agentPrompt: "P" });
    expect(notes[0]!.used).toContain("why");
    expect(notes[1]!.excerpt).toBe("");
    expect(notes[1]!.agentPrompt).toBeUndefined();
    expect(notes[2]!.excerpt).toBe("");
    expect(repos.map((r) => r.url)).toEqual(notes.map((n) => n.url));
  });
});

describe("find-github step", () => {
  it("stores repos when the finder returns valid JSON", async () => {
    const { gen } = await setup("fa", async () => ({ ok: true, text: GOOD }));
    const r = await gen.handle(req, [...step, "fa", "steps", "find-github"], "POST");
    expect(r?.status).toBe(202);
    const g = await poll(gen, "fa");
    expect(g.finder.status).toBe("done");
    expect(g.repos.length).toBeGreaterThanOrEqual(1);
  });
  it("marks failed on garbage output", async () => {
    const { gen } = await setup("fb", async () => ({ ok: true, text: "nothing useful" }));
    await gen.handle(req, [...step, "fb", "steps", "find-github"], "POST");
    const g = await poll(gen, "fb");
    expect(g.finder.status).toBe("failed");
    expect(g.finder.error).toBeTruthy();
  });
  it("marks failed when the finder throws", async () => {
    const { gen } = await setup("fc", async () => {
      throw new Error("boom");
    });
    await gen.handle(req, [...step, "fc", "steps", "find-github"], "POST");
    expect((await poll(gen, "fc")).finder.status).toBe("failed");
  });
  it("409 already_running on a second call", async () => {
    let release: () => void = () => undefined;
    const gate = new Promise<void>((r) => (release = r));
    const { gen } = await setup("fd", async () => {
      await gate;
      return { ok: true, text: GOOD };
    });
    expect((await gen.handle(req, [...step, "fd", "steps", "find-github"], "POST"))?.status).toBe(202);
    await expect(gen.handle(req, [...step, "fd", "steps", "find-github"], "POST")).rejects.toMatchObject({ status: 409, code: "already_running" });
    release();
    expect((await poll(gen, "fd")).finder.status).toBe("done");
  });
});
