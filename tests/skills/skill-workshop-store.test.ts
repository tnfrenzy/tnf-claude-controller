import { afterEach, beforeEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import { SkillError } from "../../src/core/skill-workshop/package.js";

let dir: string;
let store: ReturnType<typeof createSkillStore>;
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillstore-"));
  store = createSkillStore(dir, { retryDelayMs: 1 });
});
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

const skillDir = (slug: string) => path.join(dir, "skills", slug);
const mk = (slug = "demo", files: Record<string, string> = { "SKILL.md": "v1", "rules.md": "r" }) =>
  store.create({ slug, title: "Demo", goal: "Goal", files });
const status = async (p: Promise<unknown>) => {
  try { await p; } catch (e) { return e instanceof SkillError ? `${e.status}:${e.code}` : "other"; }
  return "ok";
};

describe("skill store", () => {
  it("creates and reads back", async () => {
    const c = await mk();
    expect(c.meta.version).toBe(1);
    expect(c.meta.state).toBe("idle");
    expect(c.meta.bestScore).toBe(0);
    expect(c.meta.costUsdEstimate).toBe(0);
    const g = await store.get("demo");
    expect(g.files).toEqual({ "SKILL.md": "v1", "rules.md": "r" });
    expect(g.meta.title).toBe("Demo");
  });

  it("duplicate 409, missing 404, bad slug 400 without touching outside", async () => {
    await mk();
    expect(await status(mk())).toBe("409:skill_exists");
    expect(await status(store.get("nope"))).toBe("404:skill_not_found");
    expect(await status(store.create({ slug: "../x", title: "t", goal: "g", files: { "SKILL.md": "a" } }))).toBe("400:skill_bad_slug");
    expect(fs.existsSync(path.join(dir, "x"))).toBe(false);
    expect(fs.readdirSync(dir)).toEqual(["skills"]);
  });

  it("rejects evil file path and oversize total", async () => {
    expect(await status(mk("a", { "SKILL.md": "a", "../evil": "x" }))).toBe("400:skill_bad_path");
    const files: Record<string, string> = { "SKILL.md": "a" };
    for (let i = 1; i <= 30; i++) files[`examples/train-${i}.json`] = "x".repeat(64 * 1024);
    files["rounds.json"] = JSON.stringify({ version: 1, rounds: [], pad: "y".repeat(500 * 1024) });
    expect(await status(mk("big", files))).toBe("400:skill_bad_schema");
    expect(fs.existsSync(skillDir("big"))).toBe(false);
  });

  it("update bumps version, snapshots, replaces file set", async () => {
    await mk();
    const u = await store.update("demo", { files: { "SKILL.md": "v2" } });
    expect(u.meta.version).toBe(2);
    expect(fs.existsSync(path.join(skillDir("demo"), "versions", "1", "SKILL.md"))).toBe(true);
    const g = await store.get("demo");
    expect(g.files).toEqual({ "SKILL.md": "v2" });
    expect(await store.listVersions("demo")).toEqual([1]);
  });

  it("title-only update keeps files", async () => {
    await mk();
    const u = await store.update("demo", { title: "New" });
    expect(u.meta.title).toBe("New");
    expect(u.files["rules.md"]).toBe("r");
  });

  it("keeps at most 20 versions", async () => {
    await mk();
    for (let i = 0; i < 22; i++) await store.update("demo", { files: { "SKILL.md": `n${i}` } });
    const v = await store.listVersions("demo");
    expect(v.length).toBe(20);
    expect(v[0]).toBe(3);
    expect((await store.get("demo")).meta.version).toBe(23);
  });

  it("restoreVersion restores, bumps, snapshots current, removes extras", async () => {
    await mk();
    await store.update("demo", { files: { "SKILL.md": "v2", "scripts/x.js": "x" } });
    const r = await store.restoreVersion("demo", 1);
    expect(r.meta.version).toBe(3);
    expect(r.files).toEqual({ "SKILL.md": "v1", "rules.md": "r" });
    expect(fs.readFileSync(path.join(skillDir("demo"), "versions", "2", "scripts", "x.js"), "utf8")).toBe("x");
    expect(await status(store.restoreVersion("demo", 99))).toBe("404:skill_version_not_found");
  });

  it("remove then get is 404", async () => {
    await mk();
    await store.remove("demo");
    expect(await status(store.get("demo"))).toBe("404:skill_not_found");
    expect(await status(store.remove("demo"))).toBe("404:skill_not_found");
  });

  it("corrupt meta: get 400 skill_corrupt, list still works", async () => {
    await mk("good");
    await mk("bad");
    fs.writeFileSync(path.join(skillDir("bad"), "meta.json"), "{broken");
    expect(await status(store.get("bad"))).toBe("400:skill_corrupt");
    const list = await store.list();
    expect(list.map((x) => x.slug)).toEqual(["bad", "good"]);
    expect((list[0] as any).broken).toBe(true);
    expect((list[1] as any).broken).toBeUndefined();
  });

  it("corrupt inputs.json is skill_corrupt", async () => {
    await mk("inp", { "SKILL.md": "a", "inputs.json": JSON.stringify({ description: "d", fields: [] }) });
    fs.writeFileSync(path.join(skillDir("inp"), "inputs.json"), "{x");
    expect(await status(store.get("inp"))).toBe("400:skill_corrupt");
  });

  it("drops unknown meta keys and defaults state", async () => {
    await mk();
    const p = path.join(skillDir("demo"), "meta.json");
    const raw = JSON.parse(fs.readFileSync(p, "utf8"));
    delete raw.state;
    raw.evil = "x";
    fs.writeFileSync(p, JSON.stringify(raw));
    const g = await store.get("demo");
    expect(g.meta.state).toBe("idle");
    expect((g.meta as any).evil).toBeUndefined();
    await store.update("demo", { title: "T2" });
    expect(JSON.parse(fs.readFileSync(p, "utf8")).evil).toBeUndefined();
  });

  it("client meta.json in files is ignored", async () => {
    await mk("m", { "SKILL.md": "a", "meta.json": JSON.stringify({ slug: "hack", version: 99 }) });
    expect((await store.get("m")).meta.version).toBe(1);
  });

  it("leaves no .tmp files", async () => {
    await mk();
    await store.update("demo", { files: { "SKILL.md": "z" } });
    const all = fs.readdirSync(skillDir("demo"), { recursive: true }) as string[];
    expect(all.some((f) => String(f).endsWith(".tmp"))).toBe(false);
  });

  it("refuses symlink in pack", async () => {
    await mk();
    try {
      fs.symlinkSync(path.join(dir, "skills"), path.join(skillDir("demo"), "scripts"), "junction");
    } catch {
      return; // cannot create symlink on this machine
    }
    expect(await status(store.get("demo"))).toBe("400:skill_symlink");
  });

  it("readZipEntries filters holdout, rounds, versions", async () => {
    await mk("z", {
      "SKILL.md": "a", "examples/train-1.json": "{}", "examples/holdout-1.json": "{}",
      "rounds.json": JSON.stringify({ version: 1, rounds: [] })
    });
    await store.update("z", { title: "t2" });
    const names = (await store.readZipEntries("z")).map((e) => e.name).sort();
    expect(names).toEqual(["SKILL.md", "examples/train-1.json"]);
  });

  it("retries rename on EPERM twice then succeeds", async () => {
    let calls = 0;
    const s = createSkillStore(dir, {
      retryDelayMs: 1,
      renameImpl: async (a, b) => {
        calls++;
        if (calls <= 2) throw Object.assign(new Error("busy"), { code: "EPERM" });
        fs.renameSync(a, b);
      }
    });
    await s.create({ slug: "r", title: "t", goal: "g", files: { "SKILL.md": "a" } });
    expect(calls).toBeGreaterThanOrEqual(3);
    expect((await s.get("r")).files["SKILL.md"]).toBe("a");
  });
});

describe("skill store attachments", () => {
  const bin = Buffer.from([0, 255, 128, 1, 2, 250, 0, 9]);
  const exDir = () => path.join(skillDir("demo"), "examples");
  const tmpFiles = () => (fs.existsSync(exDir()) ? (fs.readdirSync(exDir(), { recursive: true }) as string[]).filter((f) => f.endsWith(".tmp")) : []);

  it("stores text and binary outside the text pack", async () => {
    await mk();
    await store.attachExamples("demo", [
      { pair: "train-1", side: "input", name: "a.txt", data: Buffer.from("hello") },
      { pair: "holdout-1", side: "expected", name: "p.dwg", data: bin }
    ]);
    const list = await store.listAttachments("demo");
    expect(list).toEqual([
      { pair: "holdout-1", side: "expected", name: "p.dwg", size: bin.length },
      { pair: "train-1", side: "input", name: "a.txt", size: 5 }
    ]);
    expect(Object.keys((await store.get("demo")).files).sort()).toEqual(["rules.md", "SKILL.md"].sort());
    expect((await store.readAttachment("demo", "holdout-1", "expected", "p.dwg")).equals(bin)).toBe(true);
    expect((await store.readZipEntries("demo")).map((e) => e.name).some((n) => n.includes("/input/") || n.includes("/expected/"))).toBe(false);
    expect(tmpFiles()).toEqual([]);
  });

  it("survives update and restoreVersion", async () => {
    await mk();
    await store.attachExamples("demo", [{ pair: "train-1", side: "input", name: "a.txt", data: Buffer.from("x") }]);
    await store.update("demo", { files: { "SKILL.md": "v2" } });
    expect(await store.listAttachments("demo")).toHaveLength(1);
    await store.restoreVersion("demo", 1);
    expect(await store.listAttachments("demo")).toHaveLength(1);
  });

  it("rejects bad name, bad pair, bad side and leaves no files", async () => {
    await mk();
    const ok = { pair: "train-1", side: "input", name: "a.txt", data: Buffer.from("x") };
    for (const bad of [{ ...ok, name: "../a.txt" }, { ...ok, name: "tệp.txt" }, { ...ok, pair: "x" }, { ...ok, side: "other" }]) {
      expect(await status(store.attachExamples("demo", [ok, bad]))).toMatch(/^400:attach_/);
    }
    expect(await store.listAttachments("demo")).toEqual([]);
    expect(fs.existsSync(exDir())).toBe(false);
  });

  it("rejects over 1 MB file, over 4 MB total, 11 files on one side", async () => {
    await mk();
    const big = Buffer.alloc(1024 * 1024 + 1);
    expect(await status(store.attachExamples("demo", [{ pair: "train-1", side: "input", name: "b.bin", data: big }]))).toBe("400:attach_too_big");
    const mb = Buffer.alloc(1024 * 1024);
    const five = ["a", "b", "c", "d", "e"].map((n) => ({ pair: "train-1", side: "input", name: `${n}.bin`, data: mb }));
    expect(await status(store.attachExamples("demo", five))).toBe("400:attach_total_too_big");
    const eleven = Array.from({ length: 11 }, (_, i) => ({ pair: "train-2", side: "expected", name: `f${i}.txt`, data: Buffer.from("x") }));
    expect(await status(store.attachExamples("demo", eleven))).toBe("400:attach_too_many");
    expect(await store.listAttachments("demo")).toEqual([]);
    // total also counts files already stored
    await store.attachExamples("demo", five.slice(0, 4));
    expect(await status(store.attachExamples("demo", [{ pair: "train-2", side: "input", name: "z.bin", data: Buffer.from("x") }]))).toBe("400:attach_total_too_big");
    expect(await store.listAttachments("demo")).toHaveLength(4);
  });

  it("removes written files when a later write fails", async () => {
    await mk();
    let n = 0;
    const s = createSkillStore(dir, {
      retryDelayMs: 1,
      renameImpl: async (a, b) => {
        if (++n === 2) throw Object.assign(new Error("boom"), { code: "EIO" });
        fs.renameSync(a, b);
      }
    });
    const items = [1, 2].map((i) => ({ pair: "train-1", side: "input", name: `f${i}.txt`, data: Buffer.from("x") }));
    expect(await status(s.attachExamples("demo", items))).toBe("other");
    expect(await s.listAttachments("demo")).toEqual([]);
    expect(tmpFiles()).toEqual([]);
  });

  it("remove deletes attachments too", async () => {
    await mk();
    await store.attachExamples("demo", [{ pair: "train-1", side: "input", name: "a.txt", data: Buffer.from("x") }]);
    await store.remove("demo");
    expect(fs.existsSync(skillDir("demo"))).toBe(false);
  });
});
