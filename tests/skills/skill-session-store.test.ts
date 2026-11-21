import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { inflateRawSync } from "node:zlib";
import { makeExportOnCompleted } from "../../src/core/skill-workshop/export.js";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import { createSessionStore } from "../../src/core/roles/skill-session.js";

let dir: string;
let store: ReturnType<typeof createSkillStore>;
let tick = 0;
const now = () => `2026-01-01T00:00:${String(tick++).padStart(2, "0")}.000Z`;
const mk = () => createSessionStore(store, { now });
const sample = { files: [{ format: "docx" as const, name: "sample.docx" }], summary: "s", costUsd: 0 };
/** give the current (generating) round a sample so it can be graded */
async function smp(s: ReturnType<typeof mk>, slug = "demo") {
  const cur = await s.get(slug);
  await s.attachSample(slug, { n: cur!.rounds.length, sample });
}

beforeEach(async () => {
  tick = 0;
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillsessstore-"));
  store = createSkillStore(dir, { retryDelayMs: 1 });
  await store.create({ slug: "demo", title: "Demo", goal: "Goal", files: { "SKILL.md": "v1" } });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("session store", () => {
  it("starts and reads back from skills/demo/session.json", async () => {
    const s = mk();
    const started = await s.start("demo", { brief: "  Làm X ", agents: [] });
    expect(fs.existsSync(path.join(dir, "skills", "demo", "session.json"))).toBe(true);
    expect(await s.get("demo")).toEqual(started);
    expect(started.brief).toBe("Làm X");
    expect(await mk().get("demo")).toEqual(started);
  });

  it("returns null when no session", async () => {
    expect(await mk().get("demo")).toBeNull();
  });

  it("grades 60 -> 85 -> 100 and persists across store instances", async () => {
    const s = mk();
    await s.start("demo", { brief: "b", agents: [] });
    await smp(s);
    await s.grade("demo", { score: 60, feedback: "fix a" });
    await smp(s);
    await s.grade("demo", { score: 85, feedback: "fix b" });
    await smp(s);
    await s.grade("demo", { score: 100, feedback: "" });
    const got = await createSessionStore(createSkillStore(dir, { retryDelayMs: 1 })).get("demo");
    expect(got?.status).toBe("completed");
    expect(got?.rounds).toHaveLength(3);
    expect(got?.rounds[1].feedbackIn).toBe("fix a");
    expect(got?.rounds[2].feedbackIn).toBe("fix b");
  });

  it("serializes concurrent grades", async () => {
    const s = mk();
    await s.start("demo", { brief: "b", agents: [] });
    await smp(s);
    const results = await Promise.allSettled([
      s.grade("demo", { score: 10, feedback: "a" }),
      s.attachSample("demo", { n: 2, sample }).then(() => s.grade("demo", { score: 20, feedback: "b" })),
    ]);
    expect(results.every((r) => r.status === "fulfilled")).toBe(true);
    const got = await s.get("demo");
    expect(got?.rounds[0].score).toBe(10);
    expect(got?.rounds[1].score).toBe(20);
  });

  it("goes past maxRounds without exhausting", async () => {
    const s = mk();
    await s.start("demo", { brief: "b", agents: [], maxRounds: 2 });
    await smp(s);
    await s.grade("demo", { score: 50, feedback: "a" });
    await smp(s);
    const next = await s.grade("demo", { score: 60, feedback: "b" });
    expect(next.status).toBe("generating");
    expect(next.rounds).toHaveLength(3);
  });

  it("rejects start while open, allows restart after close", async () => {
    const s = mk();
    await s.start("demo", { brief: "b", agents: [] });
    await expect(s.start("demo", { brief: "c", agents: [] })).rejects.toMatchObject({ code: "session_exists" });
    await smp(s);
    await s.grade("demo", { score: 100, feedback: "" });
    const again = await s.start("demo", { brief: "c", agents: [] });
    expect(again.brief).toBe("c");
    expect(again.rounds).toHaveLength(1);
  });

  it("does not touch meta or files", async () => {
    const s = mk();
    await s.start("demo", { brief: "b", agents: [] });
    await smp(s);
    await s.grade("demo", { score: 100, feedback: "" });
    const rec =await store.get("demo");
    expect(Object.keys(rec.files)).not.toContain("session.json");
    expect(rec.meta.version).toBe(1);
    expect((rec.meta as Record<string, unknown>).bestScore).toBe(0);
  });

  it("reports corrupt files as session_corrupt", async () => {
    const s = mk();
    await s.start("demo", { brief: "b", agents: [] });
    const file = path.join(dir, "skills", "demo", "session.json");
    const good = JSON.parse(fs.readFileSync(file, "utf8"));
    for (const bad of [
      { ...good, status: "weird" },
      { ...good, rounds: [{ n: 2, startedAt: "x" }] },
      { ...good, rounds: [{ n: 1, startedAt: "x", score: 101 }] },
    ]) {
      fs.writeFileSync(file, JSON.stringify(bad));
      await expect(s.get("demo")).rejects.toMatchObject({ code: "session_corrupt" });
    }
    // more rounds than maxRounds is now readable (maxRounds is only a reminder)
    fs.writeFileSync(file, JSON.stringify({ ...good, maxRounds: 1, rounds: [{ n: 1, startedAt: "x" }, { n: 2, startedAt: "x" }] }));
    expect((await s.get("demo"))?.rounds).toHaveLength(2);
  });

  describe("onCompleted hook", () => {
    const quiet = () => vi.spyOn(console, "warn").mockImplementation(() => undefined);

    it("fires once on 80 then 100, not on closed re-grade", async () => {
      const calls: string[] = [];
      const s = createSessionStore(store, { now, onCompleted: async (_slug, sess) => void calls.push(sess.status) });
      await s.start("demo", { brief: "b", agents: [] });
      await smp(s);
      await s.grade("demo", { score: 80, feedback: "x" });
      expect(calls).toEqual([]);
      await smp(s);
      const done = await s.grade("demo", { score: 100, feedback: "" });
      expect(done.status).toBe("completed");
      expect(calls).toEqual(["completed"]);
      await expect(s.grade("demo", { score: 100, feedback: "" })).rejects.toMatchObject({ code: "session_closed" });
      expect(calls).toHaveLength(1);
    });

    it("does not fire when score is below 100", async () => {
      let n = 0;
      const s = createSessionStore(store, { now, onCompleted: async () => void n++ });
      await s.start("demo", { brief: "b", agents: [], maxRounds: 1 });
      await smp(s);
      expect((await s.grade("demo", { score: 50, feedback: "a" })).status).toBe("generating");
      expect(n).toBe(0);
    });

    it("swallows hook errors", async () => {
      const warn = quiet();
      const s = createSessionStore(store, { now, onCompleted: async () => { throw new Error("boom"); } });
      await s.start("demo", { brief: "b", agents: [] });
      await smp(s);
      expect((await s.grade("demo", { score: 100, feedback: "" })).status).toBe("completed");
      warn.mockRestore();
    });

    it("makeExportOnCompleted saves a zip containing SKILL.md", async () => {
      const saved: Array<{ slug: string; zip: Buffer }> = [];
      const hook = makeExportOnCompleted(store, () => ({ references: [], sources: [] }), (slug, zip) => void saved.push({ slug, zip }));
      const s = createSessionStore(store, { now, onCompleted: hook });
      await s.start("demo", { brief: "b", agents: [] });
      await smp(s);
      await s.grade("demo", { score: 100, feedback: "" });
      expect(saved).toHaveLength(1);
      expect(saved[0].slug).toBe("demo");
      const zip = saved[0].zip;
      expect(zip.readUInt32LE(0)).toBe(0x04034b50);
      const nameLen = zip.readUInt16LE(26);
      const extraLen = zip.readUInt16LE(28);
      const csize = zip.readUInt32LE(18);
      const name = zip.subarray(30, 30 + nameLen).toString("utf8");
      expect(name).toBe("SKILL.md");
      const raw = zip.subarray(30 + nameLen + extraLen, 30 + nameLen + extraLen + csize);
      const method = zip.readUInt16LE(8);
      const text = (method === 0 ? raw : inflateRawSync(raw)).toString("utf8");
      expect(text).toContain("v1");
    });

    it("grade still returns completed when save throws", async () => {
      const warn = quiet();
      const hook = makeExportOnCompleted(store, () => ({ references: [], sources: [] }), () => { throw new Error("disk"); });
      const s = createSessionStore(store, { now, onCompleted: hook });
      await s.start("demo", { brief: "b", agents: [] });
      await smp(s);
      expect((await s.grade("demo", { score: 100, feedback: "" })).status).toBe("completed");
      expect(warn).toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  it("fails for unknown skill", async () => {
    await expect(mk().start("nope", { brief: "b", agents: [] })).rejects.toThrow();
    await expect(mk().grade("nope", { score: 1, feedback: "x" })).rejects.toThrow();
    await expect(mk().attachSample("nope", { n: 1, sample })).rejects.toThrow();
  });
});
