import { TeamElo } from "../utils/types";

export function eloToWinProb(
  homeElo: number,
  awayElo: number,
  homeAdv = 60
): { homeWin: number; awayWin: number; draw: number } {
  const homeRating = homeElo + homeAdv;
  const awayRating = awayElo;
  const homeWin = 1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
  const awayWin = 1 - homeWin;
  // NHL: no final draws (OT/SO decide). In this API version we return draw=0.
  return { homeWin, awayWin, draw: 0 };
}

export function findTeamElo(
  abbr: string,
  teams: TeamElo[]
): TeamElo | undefined {
  return teams.find((t) => t.abbr.toUpperCase() === abbr.toUpperCase());
}
