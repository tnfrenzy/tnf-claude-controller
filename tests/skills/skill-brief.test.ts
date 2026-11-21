import { describe, it, expect } from "vitest";
import {
  BRIEF_DEFAULT_PASS_SCORE,
  BRIEF_GOAL_MAX,
  BRIEF_INPUTS_MAX,
  BRIEF_INPUT_KEY_MAX,
  BRIEF_INPUT_VALUE_MAX,
  normalizeBrief,
  validateBrief
} from "../../src/core/skill-workshop/brief.js";

const errs = (raw: unknown): string[] => {
  const r = validateBrief(raw);
  return r.ok ? [] : r.errors;
};

describe("training brief", () => {
  it("minimal brief is valid with defaults", () => {
    const r = validateBrief({ goal: "x" });
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.brief).toEqual({ goal: "x", inputs: {}, passScore: 100 });
    }
    expect(BRIEF_DEFAULT_PASS_SCORE).toBe(100);
  });

  it("does not require an expected output", () => {
    expect(validateBrief({ goal: "x", inputs: { a: "b" } }).ok).toBe(true);
  });

  it("trims goal", () => {
    const r = validateBrief({ goal: "  hello  " });
    expect(r.ok && r.brief.goal).toBe("hello");
    expect(normalizeBrief({ goal: " a " }).goal).toBe("a");
  });

  it("goal empty / whitespace / not a string", () => {
    expect(errs({ goal: "" })).toContain("Mục tiêu không được để trống.");
    expect(errs({ goal: "   " })).toContain("Mục tiêu không được để trống.");
    expect(errs({})).toContain("Mục tiêu phải là chuỗi.");
    expect(errs({ goal: 5 })).toContain("Mục tiêu phải là chuỗi.");
  });

  it("goal length limit", () => {
    expect(validateBrief({ goal: "a".repeat(BRIEF_GOAL_MAX) }).ok).toBe(true);
    expect(errs({ goal: "a".repeat(BRIEF_GOAL_MAX + 1) })).toContain("Mục tiêu tối đa 1000 ký tự.");
  });

  it("inputs count limit", () => {
    const mk = (n: number) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`k${i}`, "v"]));
    expect(validateBrief({ goal: "x", inputs: mk(BRIEF_INPUTS_MAX) }).ok).toBe(true);
    expect(errs({ goal: "x", inputs: mk(BRIEF_INPUTS_MAX + 1) })).toContain("Tối đa 20 thông tin đầu vào.");
  });

  it("inputs must be a plain object", () => {
    for (const bad of [null, [], "s", 3]) {
      expect(errs({ goal: "x", inputs: bad })).toContain("Thông tin đầu vào phải là một đối tượng.");
    }
  });

  it("bad keys", () => {
    expect(errs({ goal: "x", inputs: { Abc: "v" } })).toContain("Khoá đầu vào `Abc` phải khớp [a-z][a-z0-9_]{0,39}.");
    expect(errs({ goal: "x", inputs: { "1a": "v" } })).toHaveLength(1);
    expect(errs({ goal: "x", inputs: { ["a".repeat(BRIEF_INPUT_KEY_MAX + 1)]: "v" } })).toHaveLength(1);
    expect(validateBrief({ goal: "x", inputs: { ["a".repeat(BRIEF_INPUT_KEY_MAX)]: "v" } }).ok).toBe(true);
  });

  it("values: empty, too long, not a string", () => {
    expect(errs({ goal: "x", inputs: { a: "  " } })).toContain("Giá trị của `a` không được để trống.");
    expect(errs({ goal: "x", inputs: { a: "v".repeat(BRIEF_INPUT_VALUE_MAX + 1) } })).toContain("Giá trị của `a` tối đa 500 ký tự.");
    expect(validateBrief({ goal: "x", inputs: { a: "v".repeat(BRIEF_INPUT_VALUE_MAX) } }).ok).toBe(true);
    expect(errs({ goal: "x", inputs: { a: 1 } })).toContain("Giá trị của `a` phải là chuỗi.");
  });

  it("passScore rules", () => {
    const msg = "Điểm đạt phải là số nguyên từ 1 đến 100.";
    for (const bad of [0, 101, 99.5, "100", NaN, null]) {
      expect(errs({ goal: "x", passScore: bad })).toContain(msg);
    }
    expect(validateBrief({ goal: "x", passScore: 1 }).ok).toBe(true);
    expect(validateBrief({ goal: "x", passScore: 100 }).ok).toBe(true);
  });

  it("raw must be an object", () => {
    for (const bad of [null, [], "s", undefined, 1]) {
      expect(errs(bad)).toEqual(["Brief phải là một đối tượng."]);
    }
  });

  it("reports all errors at once", () => {
    const e = errs({ goal: "", inputs: { A: "" }, passScore: 0 });
    expect(e).toEqual([
      "Mục tiêu không được để trống.",
      "Khoá đầu vào `A` phải khớp [a-z][a-z0-9_]{0,39}.",
      "Giá trị của `A` không được để trống.",
      "Điểm đạt phải là số nguyên từ 1 đến 100."
    ]);
  });
});
