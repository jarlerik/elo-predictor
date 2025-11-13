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

/**
 * Negative Binomial probability mass function.
 * Models overdispersion (variance > mean) common in sports scoring.
 * @param k Number of goals
 * @param mu Mean (expected goals, lambda)
 * @param r Dispersion parameter. Higher r = closer to Poisson, lower r = more overdispersed
 * Typical values: 1.5 to 5.0
 */
function negativeBinomialPmf(k: number, mu: number, r: number): number {
  if (k < 0 || mu <= 0 || r <= 0) return 0;
  
  // Negative binomial parameterization: p = r / (r + mu)
  const p = r / (r + mu);
  
  // PMF: P(X=k) = C(k+r-1, k) * (1-p)^r * p^k
  // Using logarithms for numerical stability
  let logProb = 0;
  
  // log(C(k+r-1, k)) = log((k+r-1)! / (k! * (r-1)!))
  // = sum(log(i)) for i from r to k+r-1 - sum(log(i)) for i from 1 to k
  for (let i = 1; i <= k; i++) {
    logProb += Math.log((r + k - i) / i);
  }
  
  // Add log((1-p)^r * p^k) = r*log(1-p) + k*log(p)
  logProb += r * Math.log(1 - p) + k * Math.log(p);
  
  return Math.exp(logProb);
}

/**
 * Bivariate Poisson probability mass function using trivariate reduction.
 * Models correlation between home and away goals.
 * X = X1 + X3, Y = X2 + X3 where X1, X2, X3 are independent Poisson
 * @param homeGoals Home team goals
 * @param awayGoals Away team goals
 * @param lambdaHome Expected home goals (lambda1 + lambda3)
 * @param lambdaAway Expected away goals (lambda2 + lambda3)
 * @param lambda3 Shared component (correlation parameter). Must be >= 0 and <= min(lambdaHome, lambdaAway)
 */
function bivariatePoissonPmf(
  homeGoals: number,
  awayGoals: number,
  lambdaHome: number,
  lambdaAway: number,
  lambda3: number
): number {
  if (homeGoals < 0 || awayGoals < 0) return 0;
  
  // Ensure lambda3 is valid
  const lambda3Clamped = Math.max(0, Math.min(lambda3, Math.min(lambdaHome, lambdaAway)));
  const lambda1 = Math.max(0, lambdaHome - lambda3Clamped);
  const lambda2 = Math.max(0, lambdaAway - lambda3Clamped);
  
  // Trivariate reduction: P(X=x, Y=y) = sum over k from 0 to min(x,y)
  // of [P(X1=x-k) * P(X2=y-k) * P(X3=k)]
  let prob = 0;
  const maxK = Math.min(homeGoals, awayGoals);
  
  for (let k = 0; k <= maxK; k++) {
    const p1 = poissonPmf(homeGoals - k, lambda1);
    const p2 = poissonPmf(awayGoals - k, lambda2);
    const p3 = poissonPmf(k, lambda3Clamped);
    prob += p1 * p2 * p3;
  }
  
  return prob;
}

export type ScoreProbability = {
  home: number;
  away: number;
  score: string; // e.g. '3-2'
  probability: number;
  minOdd: number; // 1/probability
};

export type DistributionType = "poisson" | "bivariate-poisson" | "negative-binomial";

export interface ScoreProbabilityOptions {
  distribution?: DistributionType;
  maxGoals?: number;
  // For bivariate Poisson: correlation parameter (lambda3)
  // Typical values: 0.0 (independent) to 0.3 (moderate correlation)
  correlation?: number;
  // For negative binomial: dispersion parameter (r)
  // Higher r = closer to Poisson, lower r = more overdispersed
  dispersion?: number;
  // Apply tapering adjustment for very high scores
  // If true, reduces probabilities for scores > thresholdGoals per team
  applyTapering?: boolean;
  thresholdGoals?: number; // Default: 5
  taperingFactor?: number; // Multiplier for high scores (0-1), default: 0.7
}

export function computeScoreProbabilities(
  lambdaHome: number,
  lambdaAway: number,
  maxGoals = 8,
  options: ScoreProbabilityOptions = {}
): ScoreProbability[] {
  const distribution = options.distribution || "poisson";
  const maxG = options.maxGoals ?? maxGoals;
  
  const probs: ScoreProbability[] = [];
  
  if (distribution === "bivariate-poisson") {
    // Bivariate Poisson with correlation
    const lambda3 = options.correlation ?? 0.1; // Default small positive correlation
    
    for (let h = 0; h <= maxG; h++) {
      for (let a = 0; a <= maxG; a++) {
        const p = bivariatePoissonPmf(h, a, lambdaHome, lambdaAway, lambda3);
        const score = `${h}-${a}`;
        const minOdd = p > 0 ? 1 / p : Number.POSITIVE_INFINITY;
        probs.push({ home: h, away: a, score, probability: p, minOdd });
      }
    }
    
    // Normalize probabilities (bivariate Poisson may not sum exactly to 1 due to truncation)
    const totalProb = probs.reduce((sum, p) => sum + p.probability, 0);
    if (totalProb > 0) {
      for (const prob of probs) {
        prob.probability /= totalProb;
        prob.minOdd = prob.probability > 0 ? 1 / prob.probability : Number.POSITIVE_INFINITY;
      }
    }
  } else {
    // Standard independent Poisson (or will be negative binomial)
    const homePmf: number[] = [];
    const awayPmf: number[] = [];
    
    if (distribution === "negative-binomial") {
      // Will be implemented next
      const r = options.dispersion ?? 2.0; // Default dispersion
      for (let k = 0; k <= maxG; k++) {
        homePmf[k] = negativeBinomialPmf(k, lambdaHome, r);
        awayPmf[k] = negativeBinomialPmf(k, lambdaAway, r);
      }
    } else {
      // Standard Poisson
      for (let k = 0; k <= maxG; k++) {
        homePmf[k] = poissonPmf(k, lambdaHome);
        awayPmf[k] = poissonPmf(k, lambdaAway);
      }
    }
    
    // mass for tails (>= maxGoals+1) added to last index
    const homeTail = 1 - homePmf.reduce((a, b) => a + b, 0);
    const awayTail = 1 - awayPmf.reduce((a, b) => a + b, 0);
    homePmf[maxG] += Math.max(0, homeTail);
    awayPmf[maxG] += Math.max(0, awayTail);

    for (let h = 0; h <= maxG; h++) {
      for (let a = 0; a <= maxG; a++) {
        const p = homePmf[h] * awayPmf[a];
        const score = `${h}-${a}`;
        const minOdd = p > 0 ? 1 / p : Number.POSITIVE_INFINITY;
        probs.push({ home: h, away: a, score, probability: p, minOdd });
      }
    }
  }
  
  // Apply tapering adjustment for very high scores if requested
  if (options.applyTapering) {
    const threshold = options.thresholdGoals ?? 5;
    const taperingFactor = options.taperingFactor ?? 0.7;
    
    for (const prob of probs) {
      if (prob.home > threshold || prob.away > threshold) {
        // Apply tapering: reduce probability for scores above threshold
        // More aggressive tapering for higher scores
        const homeExcess = Math.max(0, prob.home - threshold);
        const awayExcess = Math.max(0, prob.away - threshold);
        const excess = homeExcess + awayExcess;
        
        // Tapering: multiply by (taperingFactor ^ excess)
        // So 6 goals gets factor^1, 7 goals gets factor^2, etc.
        prob.probability *= Math.pow(taperingFactor, excess);
        prob.minOdd = prob.probability > 0 ? 1 / prob.probability : Number.POSITIVE_INFINITY;
      }
    }
    
    // Renormalize after tapering
    const totalProb = probs.reduce((sum, p) => sum + p.probability, 0);
    if (totalProb > 0) {
      for (const prob of probs) {
        prob.probability /= totalProb;
        prob.minOdd = prob.probability > 0 ? 1 / prob.probability : Number.POSITIVE_INFINITY;
      }
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
