// Pure chart data builder for the skill training score chart. No React/DOM.

export interface ChartRound {
  n: number;
  score?: number;
}

export interface ChartPoint {
  x: number;
  y: number;
  n: number;
  score: number;
}

export interface SkillChart {
  empty: boolean;
  points: ChartPoint[];
  polyline: string;
  passY: number;
  bestRound: number | null;
  bestScore: number | null;
}

export function buildSkillChart(
  rounds: ChartRound[],
  opts: { width: number; height: number; passScore?: number; pad?: number },
): SkillChart {
  const { width, height } = opts;
  const passScore = opts.passScore ?? 90;
  const pad = opts.pad ?? 8;
  const innerW = Math.max(0, width - 2 * pad);
  const innerH = Math.max(0, height - 2 * pad);
  const yOf = (s: number): number => pad + innerH * (1 - Math.min(100, Math.max(0, s)) / 100);

  const valid = rounds.filter((r): r is { n: number; score: number } => typeof r.score === "number" && Number.isFinite(r.score));
  const passY = yOf(passScore);
  if (valid.length === 0) {
    return { empty: true, points: [], polyline: "", passY, bestRound: null, bestScore: null };
  }
  const points: ChartPoint[] = valid.map((r, i) => ({
    x: valid.length === 1 ? width / 2 : pad + (innerW * i) / (valid.length - 1),
    y: yOf(r.score),
    n: r.n,
    score: r.score,
  }));
  let best = points[0]!;
  for (const p of points) if (p.score > best.score) best = p;
  return {
    empty: false,
    points,
    polyline: points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" "),
    passY,
    bestRound: best.n,
    bestScore: best.score,
  };
}
