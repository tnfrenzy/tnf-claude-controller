import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";

let dir: string;
let store: ReturnType<typeof createSkillStore>;
beforeEach(async () => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillsession-"));
  store = createSkillStore(dir, { retryDelayMs: 1 });
  await store.create({ slug: "demo", title: "Demo", goal: "Goal", files: { "SKILL.md": "v1" } });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

describe("skill store session", () => {
  it("defaults to null and round-trips", async () => {
    expect(await store.readSession("demo")).toBeNull();
    await store.writeSession("demo", { version: 1, brief: "x" });
    expect(await store.readSession("demo")).toEqual({ version: 1, brief: "x" });
  });

  it("throws on corrupt JSON", async () => {
    fs.writeFileSync(path.join(dir, "skills", "demo", "session.json"), "{oops");
    await expect(store.readSession("demo")).rejects.toThrow();
    fs.writeFileSync(path.join(dir, "skills", "demo", "session.json"), "[1]");
    await expect(store.readSession("demo")).rejects.toThrow();
  });

  it("does not leak into files or bump version", async () => {
    await store.writeSession("demo", { version: 1 });
    const rec = await store.get("demo");
    expect(Object.keys(rec.files)).not.toContain("session.json");
    expect(rec.meta.version).toBe(1);
  });

  it("rejects unknown skill", async () => {
    await expect(store.readSession("nope")).rejects.toThrow();
    await expect(store.writeSession("nope", {})).rejects.toThrow();
  });
});
