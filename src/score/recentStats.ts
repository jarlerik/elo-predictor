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
 * Compute recent stats for a team (home/away splits) from games array.
 * games must be sorted ascending by date.
 */
export function computeRecentStatsForTeam(
  abbr: string,
  games: GameRecordForStats[],
  lookback = 20
): TeamRecentStats {
  const up = abbr.toUpperCase();
  // collect last N home games where this team was home
  const homeGames = games.filter((g) => g.homeAbbr.toUpperCase() === up);
  const awayGames = games.filter((g) => g.awayAbbr.toUpperCase() === up);

  const recentHome = homeGames.slice(-lookback);
  const recentAway = awayGames.slice(-lookback);

  const homeGF = recentHome.reduce((s, g) => s + (g.homeGoals ?? 0), 0);
  const homeGA = recentHome.reduce((s, g) => s + (g.awayGoals ?? 0), 0);
  const awayGF = recentAway.reduce((s, g) => s + (g.awayGoals ?? 0), 0);
  const awayGA = recentAway.reduce((s, g) => s + (g.homeGoals ?? 0), 0);

  const homeCount = recentHome.length || 1;
  const awayCount = recentAway.length || 1;

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
