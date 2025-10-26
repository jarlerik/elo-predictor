export type TeamRecentStats = {
  abbr: string;
  homeGoalsForPerGame: number; // last N home games
  awayGoalsForPerGame: number; // last N away games
  homeGoalsAgainstPerGame: number;
  awayGoalsAgainstPerGame: number;
  powerPlayPct?: number; // optional, 0..100
  penaltyKillPct?: number; // optional, 0..100
  gamesConsidered?: number;
};

/**
 * Compute expected goals (lambda) for home and away teams using Model B:
 * - Uses recent goals for / against (home/away split) averaged between team's attack and opponent's defense
 * - Applies ELO-based adjustment (small) and home advantage in goals
 * - Optionally incorporates special teams (if provided)
 */
export function computeExpectedGoals(
  homeStats: TeamRecentStats,
  awayStats: TeamRecentStats,
  homeElo: number,
  awayElo: number
): { lambdaHome: number; lambdaAway: number } {
  // baseline using recent G/GP
  // use home team's recent home GF and away team's recent away GA
  const homeAttack =
    homeStats.homeGoalsForPerGame ||
    average([homeStats.homeGoalsForPerGame, homeStats.awayGoalsForPerGame]);
  const awayDefense =
    awayStats.awayGoalsAgainstPerGame ||
    average([
      awayStats.awayGoalsAgainstPerGame,
      awayStats.homeGoalsAgainstPerGame,
    ]);
  let lambdaHome = (homeAttack + awayDefense) / 2.0;

  // away team's expected goals: away team's away GF vs home team's home GA
  const awayAttack =
    awayStats.awayGoalsForPerGame ||
    average([awayStats.awayGoalsForPerGame, awayStats.homeGoalsForPerGame]);
  const homeDefense =
    homeStats.homeGoalsAgainstPerGame ||
    average([
      homeStats.homeGoalsAgainstPerGame,
      homeStats.awayGoalsAgainstPerGame,
    ]);
  let lambdaAway = (awayAttack + homeDefense) / 2.0;

  // home advantage in goals (empiric NHL ~ +0.2..0.4 goals)
  const HOME_GOAL_ADV = 0.28; // tunable
  lambdaHome += HOME_GOAL_ADV;

  // small ELO adjustment -> convert elo diff to goal bump
  // scale: 400 elo difference ~ ~0.5 goals (tunable), so factor = 0.5/400 = 0.00125
  const ELO_GOAL_SCALE = 0.00125;
  const eloDiff = homeElo - awayElo;
  lambdaHome += eloDiff * ELO_GOAL_SCALE;
  lambdaAway -= eloDiff * ELO_GOAL_SCALE; // symmetric

  // optional special teams influence (if both provided)
  if (homeStats.powerPlayPct && awayStats.penaltyKillPct) {
    // If home team has strong PP and away team weak PK -> small bump
    const ppEffect = (homeStats.powerPlayPct - awayStats.penaltyKillPct) / 1000; // small
    lambdaHome += ppEffect;
  }
  if (awayStats.powerPlayPct && homeStats.penaltyKillPct) {
    const ppEffect = (awayStats.powerPlayPct - homeStats.penaltyKillPct) / 1000;
    lambdaAway += ppEffect;
  }

  // guard min
  lambdaHome = Math.max(0.05, lambdaHome);
  lambdaAway = Math.max(0.05, lambdaAway);

  return { lambdaHome, lambdaAway };
}

function average(arr: (number | undefined)[]): number {
  const vals = arr.filter((v) => typeof v === "number") as number[];
  if (vals.length === 0) return 0;
  return vals.reduce((a, b) => a + b, 0) / vals.length;
}
