import { GameRecord, TeamElo } from "../utils/types";

const BASE_ELO = 1500;
const BASE_K = 20; // per-game base
const HOME_ADV = 60; // chosen as per earlier decision

function marginMultiplier(goalDiff: number, eloDiff: number): number {
  // from common implementations
  return (
    Math.log(Math.abs(goalDiff) + 1) * (2.2 / (Math.abs(eloDiff) * 0.001 + 2.2))
  );
}

function timeWeight(gameDateStr: string): number {
  const gameDate = new Date(gameDateStr).getTime();
  const now = Date.now();
  const daysAgo = (now - gameDate) / (1000 * 60 * 60 * 24);
  // newer games -> weight closer to 2, older -> closer to 1
  const weight = 1 + Math.exp(-daysAgo / 365); // ~2 for very recent, ~1 for very old
  return weight;
}

export function computeElosFromGames(games: GameRecord[]): TeamElo[] {
  const elos = new Map<number, number>();
  const abbrs = new Map<number, string>();

  function ensureTeam(id: number, abbr: string) {
    if (!elos.has(id)) {
      elos.set(id, BASE_ELO);
      abbrs.set(id, abbr);
    }
  }

  for (const g of games) {
    ensureTeam(g.homeTeamId, g.homeAbbr);
    ensureTeam(g.awayTeamId, g.awayAbbr);

    const homeElo = elos.get(g.homeTeamId)!;
    const awayElo = elos.get(g.awayTeamId)!;

    const homeRating = homeElo + HOME_ADV;
    const awayRating = awayElo;

    const expectedHome =
      1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));
    const expectedAway = 1 - expectedHome;

    // actual results: winner 1, loser 0
    let actualHome = 0;
    let actualAway = 0;
    if (g.homeGoals > g.awayGoals) actualHome = 1;
    else if (g.awayGoals > g.homeGoals) actualAway = 1;

    const goalDiff = Math.abs(g.homeGoals - g.awayGoals);
    const eloDiff = Math.abs(homeElo - awayElo);
    const marginMult = marginMultiplier(goalDiff || 1, eloDiff);

    // OT/SO -> reduce impact
    const otFactor = g.decidedInOTorSO ? 0.75 : 1.0;

    const k = BASE_K * marginMult * timeWeight(g.date) * otFactor;

    const deltaHome = k * (actualHome - expectedHome);
    const deltaAway = -deltaHome; // zero-sum

    elos.set(g.homeTeamId, homeElo + deltaHome);
    elos.set(g.awayTeamId, awayElo + deltaAway);
  }

  const res: TeamElo[] = [];
  for (const [id, e] of elos.entries()) {
    res.push({
      teamId: id,
      abbr: abbrs.get(id) ?? String(id),
      elo: Math.round(e * 100) / 100,
    });
  }
  return res.sort((a, b) => b.elo - a.elo);
}
