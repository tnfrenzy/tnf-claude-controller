import { describe, expect, it } from "vitest";
import { briefStatus, validateBriefDraft, validateScore, type BriefDraft } from "../../ui/src/skills/skillBrief";

function good(): BriefDraft {
  return { description: "Tóm tắt báo cáo bán hàng tuần.", keywords: ["bán hàng", "báo cáo"], costUsd: 1.5, timeMinutes: 30 };
}

describe("validateBriefDraft", () => {
  it("accepts a good draft and an empty keyword list", () => {
    expect(validateBriefDraft(good()).issues).toEqual([]);
    expect(validateBriefDraft({ description: "x", keywords: [] }).issues).toEqual([]);
  });

  it("rejects empty and too long description (2000 is ok)", () => {
    expect(validateBriefDraft({ ...good(), description: "   " }).byKey.description).toContain("mô tả");
    expect(validateBriefDraft({ ...good(), description: "a".repeat(2000) }).issues).toEqual([]);
    expect(validateBriefDraft({ ...good(), description: "a".repeat(2001) }).byKey.description).toContain("2000");
  });

  it("checks keywords", () => {
    expect(validateBriefDraft({ ...good(), keywords: ["a", " "] }).byKey.keywords).toContain("trống");
    expect(validateBriefDraft({ ...good(), keywords: ["Abc", "abc"] }).byKey.keywords).toContain("trùng");
    expect(validateBriefDraft({ ...good(), keywords: Array.from({ length: 11 }, (_, i) => `k${i}`) }).byKey.keywords).toContain("10");
    expect(validateBriefDraft({ ...good(), keywords: ["a".repeat(40)] }).issues).toEqual([]);
    expect(validateBriefDraft({ ...good(), keywords: ["a".repeat(41)] }).byKey.keywords).toContain("40");
  });

  it("checks costUsd", () => {
    expect(validateBriefDraft({ ...good(), costUsd: -1 }).byKey.costUsd).toContain("USD");
    expect(validateBriefDraft({ ...good(), costUsd: NaN }).byKey.costUsd).toContain("USD");
    expect(validateBriefDraft({ ...good(), costUsd: 100.5 }).byKey.costUsd).toContain("USD");
    expect(validateBriefDraft({ ...good(), costUsd: 0 }).issues).toEqual([]);
    expect(validateBriefDraft({ ...good(), costUsd: 100 }).issues).toEqual([]);
  });

  it("checks timeMinutes", () => {
    for (const t of [0, 1.5, 241]) expect(validateBriefDraft({ ...good(), timeMinutes: t }).byKey.timeMinutes).toContain("phút");
    expect(validateBriefDraft({ ...good(), timeMinutes: 1 }).issues).toEqual([]);
    expect(validateBriefDraft({ ...good(), timeMinutes: 240 }).issues).toEqual([]);
  });

  it("firstKey follows field order and byKey keeps the first message", () => {
    const v = validateBriefDraft({ description: "", keywords: ["a", "A"], costUsd: -1, timeMinutes: 0 });
    expect(v.firstKey).toBe("description");
    expect(v.issues.map((i) => i.key)).toEqual(["description", "keywords", "costUsd", "timeMinutes"]);
    expect(Object.keys(v.byKey)).toEqual(["description", "keywords", "costUsd", "timeMinutes"]);
    expect(validateBriefDraft(good()).firstKey).toBeUndefined();
  });
});

describe("validateScore and briefStatus", () => {
  it("rejects invalid scores", () => {
    for (const s of [-1, 101, 50.5, NaN]) {
      expect(validateScore(s, "ok").byKey.score).toContain("0 đến 100");
      expect(briefStatus(s, "ok").status).toBeNull();
    }
  });

  it("100 is completed without feedback", () => {
    const r = briefStatus(100, "");
    expect(r.status).toBe("completed");
    expect(r.validation.issues).toEqual([]);
  });

  it("below 100 needs feedback", () => {
    const r = briefStatus(80, "  ");
    expect(r.validation.firstKey).toBe("feedback");
    expect(r.validation.byKey.feedback).toContain("nhận xét");
    expect(briefStatus(80, "Thiếu số liệu").validation.issues).toEqual([]);
  });

  it("80 with feedback needs training; passScore 80 completes", () => {
    expect(briefStatus(80, "Thiếu số liệu").status).toBe("needs_training");
    expect(briefStatus(80, "Thiếu số liệu", 80).status).toBe("completed");
    expect(briefStatus(0, "Sai hết").status).toBe("needs_training");
  });

  it("rejects invalid passScore", () => {
    for (const p of [NaN, -1, 101, 80.5]) {
      const r = briefStatus(90, "ok", p);
      expect(r.status).toBeNull();
      expect(r.validation.byKey.passScore).toContain("Điểm đạt");
    }
  });
});
