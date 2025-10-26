export type GameRecord = {
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

export type TeamElo = {
  teamId: number;
  abbr: string;
  elo: number;
};
