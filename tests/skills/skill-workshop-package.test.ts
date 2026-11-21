import { describe, expect, it } from "vitest";
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";
import {
  SkillError, validateSlug, validateRelPath, validatePackageInput, validateMetaInput, resolveInside, isZippable
} from "../../src/core/skill-workshop/package.js";

const crit = (n: number, w: number) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, kind: i % 2 ? "ai" : "code", weight: w }));
const rubric = (criteria: unknown[]) => JSON.stringify({ version: 1, criteria });
const status = (fn: () => unknown) => {
  try { fn(); } catch (e) { return e instanceof SkillError ? e.status : -1; }
  return 0;
};

describe("slug", () => {
  it("accepts valid", () => {
    expect(validateSlug("bao-gia-1")).toBe("bao-gia-1");
    expect(validateSlug("a".repeat(40))).toBeTruthy();
  });
  it.each(["Abc", "a".repeat(41), "", "a/b", "..", "a_b"])("rejects %s", (s) => {
    expect(status(() => validateSlug(s))).toBe(400);
  });
});

describe("relPath", () => {
  it.each(["SKILL.md", "rules.md", "inputs.json", "meta.json", "eval/rubric.json", "scripts/check.js", "examples/train-1.json", "examples/holdout-12.json", "rounds.json"])("allows %s", (p) => {
    expect(validateRelPath(p)).toBe(p);
  });
  it.each(["", "../x", "a/../SKILL.md", "C:\\x", "/abs", "a:b", "a\\b", "versions/1/SKILL.md", "scripts/a/b.js", "examples/other.json", "examples/train-0.json", "SKILL.md\0"])("rejects %j", (p) => {
    expect(status(() => validateRelPath(p))).toBe(400);
  });
});

describe("size limits", () => {
  const big = (n: number) => "x".repeat(n);
  it("SKILL.md must be < 64KB", () => {
    expect(status(() => validatePackageInput({ "SKILL.md": big(64 * 1024) }))).toBe(400);
    expect(status(() => validatePackageInput({ "SKILL.md": big(64 * 1024 - 1) }))).toBe(0);
  });
  it("per file limits", () => {
    expect(status(() => validatePackageInput({ "rules.md": big(16 * 1024 + 1) }))).toBe(400);
    expect(status(() => validatePackageInput({ "scripts/a.js": big(32 * 1024 + 1) }))).toBe(400);
    expect(status(() => validatePackageInput({ "examples/train-1.json": big(64 * 1024 + 1) }))).toBe(400);
    expect(status(() => validatePackageInput({ "inputs.json": big(32 * 1024 + 1) }))).toBe(400);
  });
  it("file counts", () => {
    const s: Record<string, string> = {};
    for (let i = 0; i < 11; i++) s[`scripts/s${i}.js`] = "x";
    expect(status(() => validatePackageInput(s))).toBe(400);
    const e: Record<string, string> = {};
    for (let i = 1; i <= 31; i++) e[`examples/train-${i}.json`] = "{}";
    expect(status(() => validatePackageInput(e))).toBe(400);
  });
  it("total over 2MB", () => {
    const f: Record<string, string> = {};
    for (let i = 1; i <= 30; i++) f[`examples/train-${i}.json`] = big(64 * 1024);
    f["rounds.json"] = JSON.stringify({ version: 1, rounds: [], pad: big(900 * 1024) });
    expect(status(() => validatePackageInput(f))).toBe(400);
  });
  it("rounds.json over 1MB", () => {
    expect(status(() => validatePackageInput({ "rounds.json": JSON.stringify({ version: 1, rounds: [], pad: big(1024 * 1024) }) }))).toBe(400);
  });
});

describe("inputs.json", () => {
  const f = (o: unknown) => ({ "inputs.json": typeof o === "string" ? o : JSON.stringify(o) });
  it("valid", () => {
    expect(status(() => validatePackageInput(f({ description: "d", fields: [{ name: "a_1", label: "A", type: "choice", choices: ["x"] }] })))).toBe(0);
  });
  it("invalid cases", () => {
    const fields = Array.from({ length: 21 }, (_, i) => ({ name: `f${i}`, label: "L", type: "text" }));
    expect(status(() => validatePackageInput(f({ description: "d", fields })))).toBe(400);
    expect(status(() => validatePackageInput(f({ description: "d", fields: [{ name: "a", label: "A", type: "weird" }] })))).toBe(400);
    expect(status(() => validatePackageInput(f({ description: "d", fields: [{ name: "a", label: "A", type: "choice" }] })))).toBe(400);
    expect(status(() => validatePackageInput(f("{not json")))).toBe(400);
    expect(status(() => validatePackageInput(f({ fields: [] })))).toBe(400);
  });
});

describe("rubric", () => {
  const f = (c: unknown[]) => ({ "eval/rubric.json": rubric(c) });
  it("valid sums to 100", () => {
    expect(status(() => validatePackageInput(f([{ id: "a", kind: "code", weight: 50 }, { id: "b", kind: "ai", weight: 30 }, { id: "c", kind: "ai", weight: 20 }])))).toBe(0);
  });
  it("count 2 and 13", () => {
    expect(status(() => validatePackageInput(f(crit(2, 50))))).toBe(400);
    expect(status(() => validatePackageInput(f(crit(13, 100 / 13))))).toBe(400);
  });
  it("duplicate id, zero weight, bad kind, sum != 100", () => {
    expect(status(() => validatePackageInput(f([{ id: "a", kind: "code", weight: 40 }, { id: "a", kind: "ai", weight: 30 }, { id: "c", kind: "ai", weight: 30 }])))).toBe(400);
    expect(status(() => validatePackageInput(f([{ id: "a", kind: "code", weight: 0 }, { id: "b", kind: "ai", weight: 50 }, { id: "c", kind: "ai", weight: 50 }])))).toBe(400);
    expect(status(() => validatePackageInput(f([{ id: "a", kind: "human", weight: 40 }, { id: "b", kind: "ai", weight: 30 }, { id: "c", kind: "ai", weight: 30 }])))).toBe(400);
    expect(status(() => validatePackageInput(f(crit(3, 30))))).toBe(400);
    expect(status(() => validatePackageInput(f(crit(3, 40))))).toBe(400);
  });
});

describe("rounds.json schema", () => {
  it("requires version and rounds", () => {
    expect(status(() => validatePackageInput({ "rounds.json": JSON.stringify({ version: 1, rounds: [] }) }))).toBe(0);
    expect(status(() => validatePackageInput({ "rounds.json": JSON.stringify({ rounds: [] }) }))).toBe(400);
    expect(status(() => validatePackageInput({ "rounds.json": JSON.stringify({ version: 1 }) }))).toBe(400);
  });
});

describe("meta input", () => {
  it("title and goal", () => {
    expect(status(() => validateMetaInput({ title: "t", goal: "g" }))).toBe(0);
    expect(status(() => validateMetaInput({ title: "t".repeat(81), goal: "g" }))).toBe(400);
    expect(status(() => validateMetaInput({ title: "t", goal: "g".repeat(1001) }))).toBe(400);
    expect(status(() => validateMetaInput({ title: "", goal: "g" }))).toBe(400);
  });
});

describe("isZippable / resolveInside", () => {
  it("zip filter", () => {
    expect(isZippable("examples/holdout-1.json")).toBe(false);
    expect(isZippable("examples/train-1.json")).toBe(true);
    expect(isZippable("rounds.json")).toBe(false);
    expect(isZippable("SKILL.md")).toBe(true);
    expect(isZippable("versions/1/SKILL.md")).toBe(false);
  });
  it("attachment paths are not valid pack paths and never zipped", async () => {
    for (const rel of ["examples/train-1/input/a.txt", "examples/holdout-1/expected/a.txt"]) {
      expect(status(() => validateRelPath(rel))).toBe(400);
    }
    expect(isZippable("SKILL.md")).toBe(true);
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "skillpkg-"));
    try {
      const store = createSkillStore(dir, { retryDelayMs: 1 });
      await store.create({ slug: "p", title: "P", goal: "g", files: { "SKILL.md": "x" } });
      await store.attachExamples("p", [
        { pair: "train-1", side: "input", name: "a.txt", data: Buffer.from("hi") },
        { pair: "holdout-1", side: "expected", name: "b.dwg", data: Buffer.from([0, 255, 1]) }
      ]);
      const names = (await store.readZipEntries("p")).map((e) => e.name);
      expect(names.some((n) => /examples\/[^/]+\/(input|expected)\//.test(n))).toBe(false);
      expect(Object.keys((await store.get("p")).files)).toEqual(["SKILL.md"]);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
  it("blocks escapes", () => {
    const root = path.resolve("tmp-root/skills/a");
    expect(resolveInside(root, "SKILL.md")).toBe(path.join(root, "SKILL.md"));
    expect(status(() => resolveInside(root, "../x"))).toBe(400);
    expect(status(() => resolveInside(root, "../a-evil/x"))).toBe(400);
  });
});
