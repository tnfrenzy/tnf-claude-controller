import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { validateRubric, type Rubric, type RubricCheck } from "../../src/core/skill-workshop/rubric.js";
import { createSkillStore } from "../../src/core/skill-workshop/store.js";

const FILE = path.resolve(__dirname, "..", "..", "fixtures", "skill-workshop", "elevator-bom.skill.json");
const fx = JSON.parse(fs.readFileSync(FILE, "utf8")) as { slug: string; title: string; goal: string; files: Record<string, string> };

// Mirrors the contains/regex branches of evalCheck (private in runner.ts).
function evalCheck(check: RubricCheck, out: string): number {
  if (check.type === "contains") return out.includes(check.value) ? 1 : 0;
  if (check.type === "regex") return new RegExp(check.pattern, check.flags).test(out) ? 1 : 0;
  throw new Error("unsupported");
}

let root: string;
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), "tnf-skfix-"));
});
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true });
});

describe("fixture elevator-bom", () => {
  const rubric = JSON.parse(fx.files["eval/rubric.json"] as string) as Rubric;
  const train1 = JSON.parse(fx.files["examples/train-1.json"] as string);
  const train2 = JSON.parse(fx.files["examples/train-2.json"] as string);

  it("creates a skill through the store", async () => {
    const store = createSkillStore(path.join(root, "data"));
    const rec = await store.create({ slug: fx.slug, title: fx.title, goal: fx.goal, files: fx.files });
    expect(rec.meta.slug).toBe("elevator-bom");
  });

  it("has 2 train and 1 holdout sample with string expected on train", () => {
    const keys = Object.keys(fx.files).filter((k) => k.startsWith("examples/"));
    expect(keys.filter((k) => k.includes("train-")).length).toBe(2);
    expect(keys.filter((k) => k.includes("holdout-")).length).toBe(1);
    expect(typeof train1.expected).toBe("string");
    expect(typeof train2.expected).toBe("string");
    expect(fx.files["examples/holdout-1.json"]).toContain("HOLDOUT-EX-SECRET");
  });

  it("has a valid rubric with weights 40/40/20 and one ai criterion", () => {
    expect(validateRubric(rubric).ok).toBe(true);
    expect(rubric.criteria.map((c) => c.weight)).toEqual([40, 40, 20]);
    expect(rubric.criteria.filter((c) => c.kind === "ai").map((c) => c.id)).toEqual(["quy-cach"]);
  });

  it("code checks pass on sample tables and fail on a wrong quantity", () => {
    const code = rubric.criteria.filter((c) => c.kind === "code");
    for (const s of [train1.expected, train2.expected]) {
      for (const c of code) expect(evalCheck(c.check as RubricCheck, s)).toBe(1);
    }
    const so = rubric.criteria.find((c) => c.id === "so-luong")!;
    expect(evalCheck(so.check as RubricCheck, "EX-MAT-001 x4; EX-MAT-002 x3")).toBe(0);
  });

  it("uses only example.com and no real company names", () => {
    const text = JSON.stringify(fx);
    const hosts = text.match(/[\w.-]+@[\w.-]+|https?:\/\/[^/"\s]+/g) ?? [];
    for (const h of hosts) expect(h).toMatch(/example\.com$/);
    expect(text).not.toMatch(new RegExp(["b" + "ke", "bach\\s*" + "khoa", "tn" + "f"].join("|"), "i"));
  });
});
