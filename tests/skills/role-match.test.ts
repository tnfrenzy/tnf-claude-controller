import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { fold, matchRoles, withSource, type MatchRole } from "../../src/core/roles/role-match.js";
import type { TrainingBrief } from "../../src/core/skill-workshop/brief.js";

const ROOT = path.resolve(__dirname, "..", "..");
const role = (id: string, extra: Partial<MatchRole> = {}): MatchRole => ({ id, description: "", ...extra });

describe("matchRoles", () => {
  it("(a) tag match scores 5 with a keyword reason", () => {
    const r = matchRoles("please write a test", [role("x", { tags: ["test"] })]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(5);
    expect(r[0].reasons.join(" ")).toContain("từ khóa");
  });

  it("(b) description matches accented and unaccented text", () => {
    expect(fold("Đánh giá")).toBe("danh gia");
    const r = matchRoles("viet bao cao", [role("w", { description: "Viết báo cáo ngắn" })]);
    expect(r[0].score).toBe(6);
    expect(r[0].reasons.join(" ")).toContain("Mô tả");
  });

  it("(c) group match via withSource", () => {
    const roles = withSource([role("a"), role("b", { group: "other" })], "coding");
    expect(roles[0].group).toBe("coding");
    expect(roles[1].group).toBe("other");
    const r = matchRoles("coding work", roles);
    expect(r.map((m) => m.id)).toEqual(["a"]);
    expect(r[0].score).toBe(3);
    expect(r[0].reasons.join(" ")).toContain("nhóm");
  });

  it("(d) sorts by score desc then id asc", () => {
    const r = matchRoles("alpha beta", [
      role("c", { tags: ["alpha"] }),
      role("b", { tags: ["alpha"] }),
      role("a", { tags: ["alpha", "beta"] })
    ]);
    expect(r.map((m) => m.id)).toEqual(["a", "b", "c"]);
    expect(r.map((m) => m.score)).toEqual([10, 5, 5]);
  });

  it("(e) drops zero-score roles; empty brief gives []", () => {
    expect(matchRoles("alpha", [role("a", { tags: ["alpha"] }), role("z", { tags: ["zzz"] })]).map((m) => m.id)).toEqual(["a"]);
    expect(matchRoles("", [role("a", { tags: ["alpha"] })])).toEqual([]);
    expect(matchRoles("   ", [role("a", { tags: ["alpha"] })])).toEqual([]);
  });

  it("(f) duplicate ids keep the first", () => {
    const r = matchRoles("alpha", [role("a", { tags: ["alpha"] }), role("a", { tags: ["alpha"], description: "alpha" })]);
    expect(r).toHaveLength(1);
    expect(r[0].score).toBe(5);
  });

  it("(g) accepts a string and a TrainingBrief", () => {
    const brief: TrainingBrief = { goal: "alpha", inputs: { x: "beta" }, passScore: 100 };
    const roles = [role("a", { tags: ["alpha"] }), role("b", { tags: ["beta"] })];
    expect(matchRoles(brief, roles).map((m) => m.id)).toEqual(["a", "b"]);
    expect(matchRoles("alpha beta", roles)).toEqual(matchRoles(brief, roles));
  });

  it("(h) whole-token matching, single keyword credit, stopwords ignored", () => {
    expect(matchRoles("latest build", [role("t", { tags: ["test"] })])).toEqual([]);
    const r = matchRoles("review", [role("review", { name: "Review" })]);
    expect(r[0].score).toBe(5);
    expect(matchRoles("the and for to of", [role("a", { description: "the and for to of" })])).toEqual([]);
  });

  it("(i) real config roles: analyst ranks first", () => {
    const load = (file: string): MatchRole[] => {
      const cfg = JSON.parse(fs.readFileSync(path.join(ROOT, "config", file), "utf8")) as Record<string, { description: string }>;
      return Object.entries(cfg).map(([id, d]) => ({ id, description: d.description }));
    };
    const roles = [...withSource(load("roles-coding.json"), "coding"), ...withSource(load("roles-training.json"), "training")];
    const list = matchRoles("repository risks affected files", roles);
    expect(list.length).toBeGreaterThan(0);
    expect(list[0].id).toBe("analyst");
    expect(list[0].reasons.join(" ")).toContain("Mô tả");
    for (let i = 1; i < list.length; i++) expect(list[i].score).toBeLessThanOrEqual(list[i - 1].score);
  });
});
