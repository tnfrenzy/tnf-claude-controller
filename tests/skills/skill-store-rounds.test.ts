import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";

let dir: string;
let store: ReturnType<typeof createSkillStore>;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillrounds-"));
  store = createSkillStore(dir, { retryDelayMs: 1 });
  await store.create({ slug: "demo", title: "Demo", goal: "Goal", files: { "SKILL.md": "v1" } });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("skill store trial files", () => {
  it("writes, lists and reads trial files outside SkillFiles; rejects bad names", async () => {
    await store.writeTrialOutput("demo", 1, 0, "hello");
    await store.writeTrialOutput("demo", 1, 1, "world");
    expect((await store.listTrialFiles("demo", 1)).map((f) => f.name)).toEqual(["sample-1.md", "sample-2.md"]);
    expect(await store.readTrialFile("demo", 1, "sample-2.md")).toBe("world");
    expect(Object.keys((await store.get("demo")).files).some((k) => k.startsWith("trials"))).toBe(false);
    await expect(store.readTrialFile("demo", 1, "../x.md")).rejects.toMatchObject({ status: 400, code: "bad_file" });
    await expect(store.readTrialFile("demo", 1, "..%2Fmeta.json")).rejects.toMatchObject({ status: 400 });
    await expect(store.readTrialFile("demo", 1, "sample-9.md")).rejects.toMatchObject({ status: 404 });
    expect(await store.listTrialFiles("demo", 7)).toEqual([]);
  });
});

describe("skill store updateMeta and rounds", () => {
  it("updateMeta keeps version and does not snapshot", async () => {
    const before = await store.listVersions("demo");
    const meta = await store.updateMeta("demo", { state: "trial", bestScore: 62, paused: true });
    expect(meta.version).toBe(1);
    expect(meta.state).toBe("trial");
    expect(meta.bestScore).toBe(62);
    expect(meta.paused).toBe(true);
    expect(await store.listVersions("demo")).toEqual(before);
    expect((await store.get("demo")).meta.version).toBe(1);
  });

  it("drops unknown keys and protected keys", async () => {
    const meta: any = await store.updateMeta("demo", { evil: 1, version: 9, slug: "x", createdAt: "z" } as any);
    expect(meta.evil).toBeUndefined();
    expect(meta.version).toBe(1);
    expect(meta.slug).toBe("demo");
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "skills", "demo", "meta.json"), "utf8"));
    expect(onDisk.evil).toBeUndefined();
  });

  it("sanitizes paused and lastError", async () => {
    let meta: any = await store.updateMeta("demo", { paused: "yes", lastError: 42 } as any);
    expect(meta.paused).toBeUndefined();
    expect(meta.lastError).toBeUndefined();
    meta = await store.updateMeta("demo", { lastError: "x".repeat(900) });
    expect(meta.lastError).toHaveLength(500);
    meta = await store.updateMeta("demo", { paused: true });
    expect(meta.paused).toBe(true);
    meta = await store.updateMeta("demo", { paused: undefined, lastError: undefined });
    expect(meta.paused).toBeUndefined();
    expect(meta.lastError).toBeUndefined();
  });

  it("rounds default to empty and round-trip", async () => {
    expect(await store.readRounds("demo")).toEqual({ version: 1, rounds: [] });
    await store.writeRounds("demo", { version: 1, rounds: [{ n: 1, score: 62 }, { n: 2, score: 81 }] });
    const r = await store.readRounds("demo");
    expect(r.rounds.map((x: any) => x.score)).toEqual([62, 81]);
  });
});
