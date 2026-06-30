/**
 * Derive expected goals (Poisson lambdas) for a soccer match from Elo ratings
 * alone — no game history required (national teams play too rarely for the
 * NHL-style recent-form model to work).
 *
 * Uses the standard "supremacy + total" decomposition used in football models:
 *   - `total`      = expected combined goals in the match (both teams)
 *   - `supremacy`  = expected goal difference (home - away), driven by the Elo gap
 * then splits the total around the supremacy:
 *   lambdaHome = (total + supremacy) / 2
 *   lambdaAway = (total - supremacy) / 2
 */

// Average combined goals in an international match (~2.5-2.7 historically).
export const SOCCER_BASE_TOTAL = 2.6;

// Goal supremacy per Elo point. ~0.0035 means a 300-Elo edge ≈ +1.0 goal
// supremacy, which matches observed favourite/underdog scorelines.
export const SOCCER_ELO_GOAL_SCALE = 0.0035;

export function soccerExpectedGoals(
  homeElo: number,
  awayElo: number,
  homeAdv = 0,
  baseTotal = SOCCER_BASE_TOTAL,
  eloGoalScale = SOCCER_ELO_GOAL_SCALE
): { lambdaHome: number; lambdaAway: number } {
  const supremacy = (homeElo + homeAdv - awayElo) * eloGoalScale;

  const lambdaHome = Math.max(0.05, (baseTotal + supremacy) / 2);
  const lambdaAway = Math.max(0.05, (baseTotal - supremacy) / 2);

  return { lambdaHome, lambdaAway };
}
