import { TeamRecentStats } from "./expectedGoals";

export type GameRecordForStats = {
  gamePk: number;
  season: string;
  date: string; // ISO
  homeTeamId: number;
  awayTeamId: number;
  homeAbbr: string;
  awayAbbr: string;
  homeGoals: number;
  awayGoals: number;
  decidedInOTorSO: boolean;
};

/**
 * Compute time decay weight for a game based on days ago.
 * Uses exponential decay: weight = exp(-days_ago / decay_constant)
 * @param gameDate ISO date string
 * @param referenceDate ISO date string (typically most recent game date)
 * @param decayConstant Days for weight to decay to ~0.368 (1/e). Default 30 days (half-life ~21 days)
 */
function timeDecayWeight(
  gameDate: string,
  referenceDate: string,
  decayConstant = 30
): number {
  const gameTime = new Date(gameDate).getTime();
  const refTime = new Date(referenceDate).getTime();
  const daysAgo = (refTime - gameTime) / (1000 * 60 * 60 * 24);
  return Math.exp(-daysAgo / decayConstant);
}

/**
 * Compute recent stats for a team (home/away splits) from games array.
 * games must be sorted ascending by date.
 * @param useTimeDecay If true, applies exponential time decay weighting (default: true)
 * @param decayConstant Days for weight to decay to ~0.368. Default 30 days
 */
export function computeRecentStatsForTeam(
  abbr: string,
  games: GameRecordForStats[],
  lookback = 20,
  useTimeDecay = true,
  decayConstant = 30
): TeamRecentStats {
  const up = abbr.toUpperCase();
  // collect last N home games where this team was home
  const homeGames = games.filter((g) => g.homeAbbr.toUpperCase() === up);
  const awayGames = games.filter((g) => g.awayAbbr.toUpperCase() === up);

  const recentHome = homeGames.slice(-lookback);
  const recentAway = awayGames.slice(-lookback);

  // Use most recent game date as reference for time decay
  const allRecentGames = [...recentHome, ...recentAway];
  const referenceDate =
    allRecentGames.length > 0
      ? allRecentGames[allRecentGames.length - 1].date
      : new Date().toISOString();

  let homeGF = 0;
  let homeGA = 0;
  let homeWeightSum = 0;
  let awayGF = 0;
  let awayGA = 0;
  let awayWeightSum = 0;

  if (useTimeDecay) {
    // Apply time decay weighting
    for (const g of recentHome) {
      const weight = timeDecayWeight(g.date, referenceDate, decayConstant);
      homeGF += (g.homeGoals ?? 0) * weight;
      homeGA += (g.awayGoals ?? 0) * weight;
      homeWeightSum += weight;
    }
    for (const g of recentAway) {
      const weight = timeDecayWeight(g.date, referenceDate, decayConstant);
      awayGF += (g.awayGoals ?? 0) * weight;
      awayGA += (g.homeGoals ?? 0) * weight;
      awayWeightSum += weight;
    }
  } else {
    // Original unweighted calculation
    homeGF = recentHome.reduce((s, g) => s + (g.homeGoals ?? 0), 0);
    homeGA = recentHome.reduce((s, g) => s + (g.awayGoals ?? 0), 0);
    awayGF = recentAway.reduce((s, g) => s + (g.awayGoals ?? 0), 0);
    awayGA = recentAway.reduce((s, g) => s + (g.homeGoals ?? 0), 0);
    homeWeightSum = recentHome.length || 1;
    awayWeightSum = recentAway.length || 1;
  }

  const homeCount = homeWeightSum || 1;
  const awayCount = awayWeightSum || 1;

  const stats: TeamRecentStats = {
    abbr: up,
    homeGoalsForPerGame: +(homeGF / homeCount).toFixed(3),
    homeGoalsAgainstPerGame: +(homeGA / homeCount).toFixed(3),
    awayGoalsForPerGame: +(awayGF / awayCount).toFixed(3),
    awayGoalsAgainstPerGame: +(awayGA / awayCount).toFixed(3),
    gamesConsidered: Math.max(recentHome.length, recentAway.length),
  };

  return stats;
}
