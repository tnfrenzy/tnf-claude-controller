import { describe, expect, it } from "vitest";
import { buildSeedSkillMd, canDownload, canTrainMore, composeBrief, isFinderBusy, slugFromTitle, validateMaxRounds } from "../../ui/src/skills/skillGenForm";
import type { GenState } from "../../ui/src/types";

const gen = (status: GenState["finder"]["status"]): GenState => ({ roles: [], repos: [], finder: { status } });

describe("skillGenForm helpers", () => {
  it("slugFromTitle", () => {
    expect(slugFromTitle("Soạn báo giá!")).toBe("soan-bao-gia");
    const long = slugFromTitle("a".repeat(30) + " " + "b".repeat(30));
    expect(long.length).toBeLessThanOrEqual(40);
    expect(long).toMatch(/^[a-z0-9-]{1,40}$/);
    expect(slugFromTitle("!!! ???")).toBe("");
  });
  it("composeBrief", () => {
    const s = composeBrief({ description: " Viết mail ", keywords: ["a", "b"], costUsd: 2, timeMinutes: 10 });
    expect(s).toContain("Viết mail");
    expect(s).toContain("Từ khoá: a, b");
    expect(s).toContain("2");
    expect(s).toContain("10");
    expect(composeBrief({ description: "x", keywords: [] })).toBe("x");
  });
  it("validateMaxRounds", () => {
    for (const n of [0, 21, 1.5, NaN]) expect(validateMaxRounds(n)).not.toBe("");
    for (const n of [1, 5, 20]) expect(validateMaxRounds(n)).toBe("");
  });
  it("buildSeedSkillMd", () => {
    const md = buildSeedSkillMd("my-skill", "Brief dòng một\ndòng hai");
    expect(md.startsWith("---")).toBe(true);
    expect(md).toContain("name: my-skill");
    expect(md).not.toContain("Brief dòng một");
    expect(md).toContain("đang huấn luyện");
  });
  it("status predicates", () => {
    expect(canDownload({ status: "completed" })).toBe(true);
    expect(canDownload({ status: "awaiting_score" })).toBe(false);
    expect(canDownload(null)).toBe(false);
    expect(canTrainMore({ status: "awaiting_score" })).toBe(true);
    expect(canTrainMore({ status: "exhausted" })).toBe(false);
    for (const s of ["completed", "generating", "paused"] as const) expect(canTrainMore({ status: s })).toBe(false);
    expect(isFinderBusy(gen("running"))).toBe(true);
    expect(isFinderBusy(gen("done"))).toBe(false);
  });
});
