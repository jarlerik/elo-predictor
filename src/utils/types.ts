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

export type TeamElo = {
  teamId: number | string;
  abbr: string;
  elo: number;
};
