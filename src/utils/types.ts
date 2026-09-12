export type GameRecord = {
  gamePk: number;
  season: string;
  date: string; // ISO
  homeTeamId: number | string;
  awayTeamId: number | string;
  homeAbbr: string;
  awayAbbr: string;
  homeGoals: number;
  awayGoals: number;
  decidedInOTorSO: boolean;
};

/**
 * A scheduled game that has not been played yet. Kept alongside the played
 * games so a bet can be stamped with the kickoff it refers to.
 */
export type UpcomingGame = {
  homeAbbr: string;
  awayAbbr: string;
  /** ISO timestamp of the scheduled start. */
  date: string;
};

export type TeamElo = {
  teamId: number | string;
  abbr: string;
  elo: number;
};
