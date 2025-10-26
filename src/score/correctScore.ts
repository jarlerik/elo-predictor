/* Poisson pmf
 * Compute full matrix of score probabilities up to maxGoals each side (inclusive)
 * and return flattened sorted list (descending probability) with minOdd
 */

/** Poisson pmf */
export function poissonPmf(k: number, lambda: number): number {
  if (k < 0) return 0;
  // use iterative factorial-safe approach
  let res = Math.exp(-lambda);
  for (let i = 1; i <= k; i++) res *= lambda / i;
  return res;
}

export type ScoreProbability = {
  home: number;
  away: number;
  score: string; // e.g. '3-2'
  probability: number;
  minOdd: number; // 1/probability
};

export function computeScoreProbabilities(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals = 8
): ScoreProbability[] {
  const probs: ScoreProbability[] = [];
  // precompute pmf arrays
  const homePmf: number[] = [];
  const awayPmf: number[] = [];
  for (let k = 0; k <= maxGoals; k++) {
    homePmf[k] = poissonPmf(k, lambdaHome);
    awayPmf[k] = poissonPmf(k, lambdaAway);
  }
  // mass for tails (>= maxGoals+1) added to last index
  const homeTail = 1 - homePmf.reduce((a, b) => a + b, 0);
  const awayTail = 1 - awayPmf.reduce((a, b) => a + b, 0);
  homePmf[maxGoals] += Math.max(0, homeTail);
  awayPmf[maxGoals] += Math.max(0, awayTail);

  for (let h = 0; h <= maxGoals; h++) {
    for (let a = 0; a <= maxGoals; a++) {
      const p = homePmf[h] * awayPmf[a];
      const score = `${h}-${a}`;
      const minOdd = p > 0 ? 1 / p : Number.POSITIVE_INFINITY;
      probs.push({ home: h, away: a, score, probability: p, minOdd });
    }
  }
  // sort by probability desc
  probs.sort((x, y) => y.probability - x.probability);
  return probs;
}

/**
 * Convenience: return top-N value bets sorted by EV descending (only where EV>1.0), or by minOdd if no market
 */
export function topValueBets(
  probs: ScoreProbability[],
  topN = 10
): ScoreProbability[] {
  return probs.slice(0, topN);
}
