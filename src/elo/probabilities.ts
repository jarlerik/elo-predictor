import { TeamElo } from "../utils/types";

/**
 * Draw factor (ν) for the Davidson tie model.
 *
 * Controls how likely a draw is. At rating parity, P(draw) = ν / (2 + ν):
 *   ν = 0    -> 0%   draws (hockey / no-draw sports — current NHL behavior)
 *   ν = 0.60 -> ~23% draws (typical soccer group stage)
 *   ν = 0.80 -> ~29% draws (low-scoring / defensive leagues)
 *
 * World Cup group games draw ~20-25% of the time, so ~0.6 is a sensible start.
 * Knockout games can't draw (extra time / penalties decide) — use 0 there.
 */
export const NO_DRAW = 0;
export const SOCCER_DRAW_FACTOR = 0.6;

/**
 * Convert two Elo ratings into 1X2 (home / draw / away) probabilities.
 *
 * Uses the Davidson (1970) model for ties, which extends the standard Elo
 * logistic to a three-way outcome with a single draw parameter `drawFactor`.
 * When drawFactor = 0 this reduces *exactly* to the classic two-way Elo
 * formula, so existing hockey callers are unaffected.
 *
 * The draw probability is highest when teams are evenly matched and shrinks
 * as the rating gap grows — matching real match data.
 */
export function eloToWinProb(
  homeElo: number,
  awayElo: number,
  homeAdv = 60,
  drawFactor = NO_DRAW
): { homeWin: number; awayWin: number; draw: number } {
  const ratingDiff = homeElo + homeAdv - awayElo;

  // Davidson model terms (all relative to the away team, so they're unitless):
  //   home  ∝ 10^(diff/400)
  //   away  ∝ 1
  //   draw  ∝ ν · 10^(diff/800)   (geometric mean of the two strengths)
  const homeTerm = Math.pow(10, ratingDiff / 400);
  const awayTerm = 1;
  const drawTerm = drawFactor * Math.pow(10, ratingDiff / 800);

  const total = homeTerm + awayTerm + drawTerm;

  return {
    homeWin: homeTerm / total,
    awayWin: awayTerm / total,
    draw: drawTerm / total,
  };
}

export function findTeamElo(
  abbr: string,
  teams: TeamElo[]
): TeamElo | undefined {
  return teams.find((t) => t.abbr.toUpperCase() === abbr.toUpperCase());
}
