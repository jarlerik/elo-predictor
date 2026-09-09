import { GameRecord, TeamElo } from "../utils/types";
import { computeElosFromGames } from "./calculator";

/**
 * Draw factor (ν) for the Davidson tie model.
 *
 * Controls how likely a draw is. At rating parity, P(draw) = ν / (2 + ν):
 *   ν = 0    -> 0%   draws (two-way markets, e.g. hockey incl. OT/SO)
 *   ν = 0.60 -> ~23% draws (typical soccer group stage)
 *   ν = 0.80 -> ~29% draws (low-scoring / defensive leagues)
 *
 * World Cup group games draw ~20-25% of the time, so ~0.6 is a sensible start.
 * Knockout games can't draw (extra time / penalties decide) — use 0 there.
 *
 * Hockey has no draws once OT/SO is included, but the common 1X2 market is
 * settled on the 60-minute score, where a game tied after regulation is a
 * draw. Roughly a quarter of NHL / Liiga regular-season games go to OT/SO.
 *
 * Leagues with a game history (NHL, Liiga, EPL) fit the factor from their
 * own games with `fitDrawFactor`; the constants are the fallbacks when
 * there is no history to fit against and the values for the seeded
 * competitions (World Cup, Champions League).
 */
export const NO_DRAW = 0;
export const SOCCER_DRAW_FACTOR = 0.6;
export const HOCKEY_DRAW_FACTOR = 0.6;

/** Regulation-time draw: the game needed OT or a shootout. */
export const isRegulationDraw = (g: GameRecord) => g.decidedInOTorSO;

/** Full-time draw (soccer). */
export const isFullTimeDraw = (g: GameRecord) => g.homeGoals === g.awayGoals;

/**
 * Fit the Davidson draw factor so that the model's expected number of draws
 * over the played games equals the number actually observed.
 *
 * `fitDrawFactor` approximates the ratings at the time of each game with
 * the current ones; `fitDrawFactorFromHistory` walks the games and uses
 * the ratings as they stood before each game, which is what the backtest
 * and the live model see. Both return `fallback` with too few games.
 */
export function fitDrawFactor(
  games: GameRecord[],
  elos: TeamElo[],
  isDraw: (g: GameRecord) => boolean,
  options: { homeAdv?: number; fallback?: number; minGames?: number } = {}
): number {
  const homeAdv = options.homeAdv ?? 60;
  const rating = new Map(elos.map((t) => [t.abbr, t.elo]));
  const diffs: number[] = [];
  let observed = 0;
  for (const g of games) {
    const h = rating.get(g.homeAbbr);
    const a = rating.get(g.awayAbbr);
    if (h === undefined || a === undefined) continue;
    diffs.push(h + homeAdv - a);
    if (isDraw(g)) observed++;
  }
  return fitDrawFactorToDiffs(diffs, observed, options);
}

export function fitDrawFactorFromHistory(
  games: GameRecord[],
  isDraw: (g: GameRecord) => boolean,
  options: {
    homeAdv?: number;
    fallback?: number;
    minGames?: number;
    currentTeams?: Set<string>;
  } = {}
): number {
  const homeAdv = options.homeAdv ?? 60;
  const diffs: number[] = [];
  let observed = 0;
  computeElosFromGames(games, {
    currentTeams: options.currentTeams ?? new Set(),
    homeAdv,
    onGame: (g, homeElo, awayElo) => {
      diffs.push(homeElo + homeAdv - awayElo);
      if (isDraw(g)) observed++;
    },
  });
  return fitDrawFactorToDiffs(diffs, observed, options);
}

/** Bisection on ν: expected draws over the rating gaps is monotonic in ν. */
function fitDrawFactorToDiffs(
  diffs: number[],
  observed: number,
  options: { fallback?: number; minGames?: number }
): number {
  const fallback = options.fallback ?? HOCKEY_DRAW_FACTOR;
  const minGames = options.minGames ?? 50;
  if (diffs.length < minGames || observed === 0) return fallback;
  if (observed === diffs.length) return fallback;

  const expectedDraws = (nu: number) => {
    let sum = 0;
    for (const d of diffs) {
      const home = Math.pow(10, d / 400);
      const draw = nu * Math.pow(10, d / 800);
      sum += draw / (home + 1 + draw);
    }
    return sum;
  };

  let lo = 0;
  let hi = 10;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (expectedDraws(mid) < observed) lo = mid;
    else hi = mid;
  }
  return Math.round(((lo + hi) / 2) * 10000) / 10000;
}

/**
 * Convert two Elo ratings into 1X2 (home / draw / away) probabilities.
 *
 * Uses the Davidson (1970) model for ties, which extends the standard Elo
 * logistic to a three-way outcome with a single draw parameter `drawFactor`.
 * When drawFactor = 0 this reduces *exactly* to the classic two-way Elo
 * formula (hockey incl. OT/SO, knockout soccer).
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
