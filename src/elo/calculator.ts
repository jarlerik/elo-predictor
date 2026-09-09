import { GameRecord, TeamElo } from "../utils/types";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";

const BASE_ELO = 1500;
const BASE_K = 20; // per-game base
const HOME_ADV = 60; // chosen as per earlier decision

export interface EloOptions {
  /** Only these abbreviations are returned (teams that left the league are dropped). */
  currentTeams?: Set<string>;
  homeAdv?: number;
  /** Starting rating per abbreviation (e.g. an external seed); others start at 1500. */
  initialElos?: Record<string, number>;
}

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

export function computeElosFromGames(
  games: GameRecord[],
  options: EloOptions = {}
): TeamElo[] {
  const currentTeams = options.currentTeams ?? CURRENT_NHL_TEAMS;
  const homeAdv = options.homeAdv ?? HOME_ADV;
  const initial = options.initialElos ?? {};

  // Keyed by abbreviation: a franchise can change upstream id when it is
  // renamed (e.g. Utah Hockey Club -> Utah Mammoth) but keeps its history.
  const elos = new Map<string, number>();
  const ids = new Map<string, number | string>();

  function ensureTeam(id: number | string, abbr: string) {
    if (!elos.has(abbr)) elos.set(abbr, initial[abbr] ?? BASE_ELO);
    ids.set(abbr, id); // latest id wins
  }

  for (const g of games) {
    ensureTeam(g.homeTeamId, g.homeAbbr);
    ensureTeam(g.awayTeamId, g.awayAbbr);

    const homeElo = elos.get(g.homeAbbr)!;
    const awayElo = elos.get(g.awayAbbr)!;

    const homeRating = homeElo + homeAdv;
    const awayRating = awayElo;

    const expectedHome =
      1 / (1 + Math.pow(10, (awayRating - homeRating) / 400));

    // actual result: win 1, loss 0, draw 0.5 (soccer only; hockey always has a
    // winner incl. OT/SO -- the regulation-time draw lives in probabilities.ts)
    let actualHome = 0.5;
    if (g.homeGoals > g.awayGoals) actualHome = 1;
    else if (g.awayGoals > g.homeGoals) actualHome = 0;

    const goalDiff = Math.abs(g.homeGoals - g.awayGoals);
    const eloDiff = Math.abs(homeElo - awayElo);
    const marginMult = marginMultiplier(goalDiff || 1, eloDiff);

    // OT/SO -> reduce impact
    const otFactor = g.decidedInOTorSO ? 0.75 : 1.0;

    const k = BASE_K * marginMult * timeWeight(g.date) * otFactor;

    const deltaHome = k * (actualHome - expectedHome);
    const deltaAway = -deltaHome; // zero-sum

    elos.set(g.homeAbbr, homeElo + deltaHome);
    elos.set(g.awayAbbr, awayElo + deltaAway);
  }

  const res: TeamElo[] = [];
  for (const [abbr, e] of elos.entries()) {
    // Only include teams currently in the league
    if (currentTeams.has(abbr)) {
      res.push({
        teamId: ids.get(abbr) ?? abbr,
        abbr: abbr,
        elo: Math.round(e * 100) / 100,
      });
    }
  }
  return res.sort((a, b) => b.elo - a.elo);
}
