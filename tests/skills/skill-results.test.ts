import { describe, expect, it } from "vitest";
import { defaultSkillTab, resultsRoundList } from "../../ui/src/skills/skillResults";

describe("skillResults", () => {
  it("defaults to results only when awaiting score", () => {
    expect(defaultSkillTab("awaiting_score")).toBe("results");
    expect(defaultSkillTab("idle")).toBe("overview");
    expect(defaultSkillTab("training")).toBe("overview");
  });
  it("marks the best graded round", () => {
    const l = resultsRoundList([{ n: 2, score: 80 }, { n: 1, score: 50 }], 2);
    expect(l.map((x) => x.n)).toEqual([1, 2]);
    expect(l[1]).toEqual({ n: 2, isBest: true, awaiting: false });
    expect(l[0]!.isBest).toBe(false);
  });
  it("never marks an ungraded round as best", () => {
    const l = resultsRoundList([{ n: 1, score: null }], 1);
    expect(l[0]).toEqual({ n: 1, isBest: false, awaiting: true });
  });
  it("ignores a best round missing from rounds", () => {
    expect(resultsRoundList([{ n: 1, score: 10 }], 5).some((x) => x.isBest)).toBe(false);
  });
  it("returns [] for no rounds", () => {
    expect(resultsRoundList([], 1)).toEqual([]);
  });
});
