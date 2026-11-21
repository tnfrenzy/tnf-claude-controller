export type SkillTab = "overview" | "results";

export interface ResultsRoundItem {
  n: number;
  isBest: boolean;
  awaiting: boolean;
}

/** Open the results tab by default while the skill waits for the user's grade. */
export function defaultSkillTab(state: string): SkillTab {
  return state === "awaiting_score" ? "results" : "overview";
}

/** Rounds in ascending order; only a graded round can be best, an ungraded one is awaiting. */
export function resultsRoundList(
  rounds: { n: number; score?: number | null | undefined }[],
  bestRound: number | null | undefined
): ResultsRoundItem[] {
  return [...rounds]
    .sort((a, b) => a.n - b.n)
    .map((r) => {
      const graded = r.score !== null && r.score !== undefined;
      return { n: r.n, isBest: graded && bestRound === r.n, awaiting: !graded };
    });
}
