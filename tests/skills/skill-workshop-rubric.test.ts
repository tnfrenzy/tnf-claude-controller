import { describe, expect, it } from "vitest";
import { computeScore, validateRubric, type Rubric } from "../../src/core/skill-workshop/rubric.js";

function code(id: string, weight: number): any {
  return { id, label: `Tiêu chí ${id}`, kind: "code", weight, check: { type: "contains", value: "x" } };
}
function ai(id: string, weight: number): any {
  return { id, label: `Tiêu chí ${id}`, kind: "ai", weight, prompt: "Chấm?" };
}
function base(): any {
  return { version: 1, criteria: [code("a", 20), code("b", 20), code("c", 20), ai("d", 20), ai("e", 20)] };
}
const codes = (r: { errors: { code: string }[] }) => r.errors.map((e) => e.code);

describe("validateRubric", () => {
  it("accepts a valid rubric", () => {
    const r = validateRubric(base());
    expect(r.ok).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it.each([
    [99, "weight-sum"],
    [101, "weight-sum"]
  ])("rejects weight sum %s", (w, c) => {
    const r = base();
    r.criteria[4].weight = w - 80;
    const res = validateRubric(r);
    expect(res.ok).toBe(false);
    expect(codes(res)).toContain(c);
  });

  it("code weight 59 fails, 60 passes", () => {
    const r = base();
    r.criteria[2].weight = 19;
    r.criteria[3].weight = 21;
    const res = validateRubric(r);
    expect(codes(res)).toEqual(["code-weight"]);
    expect(validateRubric(base()).ok).toBe(true);
  });

  it("rejects duplicate and badly formatted ids", () => {
    const r = base();
    r.criteria[1].id = "a";
    r.criteria[2].id = "Bad Id";
    const res = validateRubric(r);
    expect(codes(res)).toEqual(expect.arrayContaining(["id-duplicate", "id-format"]));
    expect(res.errors.find((e) => e.code === "id-duplicate")?.path).toBe("criteria[1].id");
  });

  it.each([[0], [-5], [NaN], ["20"], [Infinity]])("rejects weight %s", (w) => {
    const r = base();
    r.criteria[0].weight = w;
    const res = validateRubric(r);
    expect(res.errors.some((e) => e.path === "criteria[0].weight")).toBe(true);
  });

  it("rejects empty label and bad kind", () => {
    const r = base();
    r.criteria[0].label = "  ";
    r.criteria[1].kind = "human";
    const res = validateRubric(r);
    expect(codes(res)).toEqual(expect.arrayContaining(["label-empty", "kind"]));
  });

  it("rejects code without check and ai without prompt", () => {
    const r = base();
    delete r.criteria[0].check;
    r.criteria[3].prompt = "";
    const res = validateRubric(r);
    expect(codes(res)).toEqual(expect.arrayContaining(["check-missing", "prompt-missing"]));
  });

  it.each([
    [{ type: "nope" }, "check-type"],
    [{ type: "contains" }, "check-param"],
    [{ type: "regex", pattern: "(" }, "regex-invalid"],
    [{ type: "max-length" }, "check-param"],
    [{ type: "min-length", min: -1 }, "check-param"],
    [{ type: "json-schema", schema: "x" }, "check-param"],
    [{ type: "section-present" }, "check-param"]
  ])("rejects bad check %j", (chk, c) => {
    const r = base();
    r.criteria[0].check = chk;
    expect(codes(validateRubric(r))).toContain(c);
  });

  it("accepts valid checks of each type", () => {
    const r = base();
    r.criteria[0].check = { type: "regex", pattern: "^a+$", flags: "i" };
    r.criteria[1].check = { type: "max-length", max: 100 };
    r.criteria[2].check = { type: "json-schema", schema: { type: "object" } };
    expect(validateRubric(r).ok).toBe(true);
  });

  it.each([
    [49, false],
    [50, true],
    [100, true],
    [101, false]
  ])("passScore %s ok=%s", (p, ok) => {
    const r = base();
    r.passScore = p;
    expect(validateRubric(r).ok).toBe(ok);
  });

  it("enforces criteria count 3..12", () => {
    const two: any = { version: 1, criteria: [code("a", 60), ai("b", 40)] };
    expect(codes(validateRubric(two))).toContain("criteria-count");
    const many: any = { version: 1, criteria: [] };
    for (let i = 0; i < 13; i++) many.criteria.push(code(`c${i}`, 100 / 13));
    expect(codes(validateRubric(many))).toContain("criteria-count");
  });

  it.each([[null], [[]], ["x"], [42]])("handles non-object input %j", (v) => {
    const res = validateRubric(v);
    expect(res.ok).toBe(false);
    expect(res.errors.length).toBeGreaterThan(0);
  });

  it("criteria not an array", () => {
    expect(codes(validateRubric({ version: 1, criteria: "x" }))).toContain("criteria-not-array");
  });

  it.each([[undefined], [2], [1.5], ["1"]])("version %s is rejected", (v) => {
    const r = base();
    if (v === undefined) delete r.version;
    else r.version = v;
    const res = validateRubric(r);
    expect(res.errors.map((e) => e.path)).toContain("version");
  });

  it("lists all problems at once", () => {
    const r = base();
    r.version = 2;
    r.passScore = 10;
    r.criteria[0].id = "BAD";
    r.criteria[1].weight = -1;
    r.criteria[3].prompt = "";
    const res = validateRubric(r);
    expect(res.errors.length).toBeGreaterThanOrEqual(5);
  });
});

describe("computeScore", () => {
  const rubric: Rubric = base();
  const all = (v: number) => ({ a: v, b: v, c: v, d: v, e: v });

  it("all ones is 100 and passes", () => {
    const r = computeScore(rubric, all(1));
    expect(r.total).toBe(100);
    expect(r.passed).toBe(true);
    expect(r.errors).toEqual([]);
  });

  it("all zeros is 0 and fails", () => {
    const r = computeScore(rubric, all(0));
    expect(r.total).toBe(0);
    expect(r.passed).toBe(false);
  });

  it("clamps ratios", () => {
    const r = computeScore(rubric, { ...all(1), a: 1.5, b: -1 });
    expect(r.perCriterion[0].ratio).toBe(1);
    expect(r.perCriterion[1].ratio).toBe(0);
    expect(r.total).toBe(80);
  });

  it("missing id, NaN and extra id are reported and counted as 0", () => {
    const r = computeScore(rubric, { a: 1, b: NaN, c: 1, d: 1, z: 1 } as any);
    expect(r.errors.length).toBe(3);
    expect(r.total).toBe(60);
    expect(Number.isNaN(r.total)).toBe(false);
  });

  it("rounds to one decimal", () => {
    const r = computeScore(rubric, { a: 1.6665, b: 0, c: 0, d: 0, e: 0 });
    expect(r.total).toBe(20);
    const r2 = computeScore(rubric, { a: 0.5, b: 0.5, c: 0.33333, d: 0, e: 0 });
    expect(r2.total).toBe(26.7);
    const third: Rubric = { version: 1, criteria: [code("a", 100)] };
    expect(computeScore(third, { a: 0.33333 }).total).toBe(33.3);
  });

  it("passed uses threshold on the rounded total", () => {
    const r1 = computeScore(rubric, { a: 1, b: 1, c: 1, d: 1, e: 0.5 });
    expect(r1.total).toBe(90);
    expect(r1.passed).toBe(true);
    const r2 = computeScore(rubric, { a: 1, b: 1, c: 1, d: 1, e: 0.4 });
    expect(r2.total).toBe(88);
    expect(r2.passed).toBe(false);
    const near = computeScore(rubric, { a: 1, b: 1, c: 1, d: 1, e: 0.4998 });
    expect(near.total).toBe(90);
    expect(near.passed).toBe(true);
    const custom = computeScore({ ...rubric, passScore: 60 }, all(0.6));
    expect(custom.passed).toBe(true);
  });
});
