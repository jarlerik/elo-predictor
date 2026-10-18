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
  /**
   * Called for every game with both teams' ratings as they stand before the
   * game is applied. Lets a backtest score predictions in the same walk that
   * produces the live ratings.
   */
  onGame?: (
    game: GameRecord,
    homeElo: number,
    awayElo: number,
    played: GamesPlayed
  ) => void;
  /**
   * Reference instant for the age-based K weight (default Date.now()). A
   * backtest passes a fixed instant so the walk does not depend on the day
   * it is run.
   */
  now?: number;
  /** false -> K ignores the game's age (strict walk-forward). Default true. */
  timeWeighting?: boolean;
  /** Base K per game, default 20. Exposed for sensitivity grids. */
  baseK?: number;
  /**
   * Share of each rating's distance from 1500 given back at a season
   * boundary (0 = none, the default; 1/3 is the common choice). Squads
   * change over the summer, so last spring's rating overstates what is
   * known in August.
   */
  seasonRegression?: number;
  /**
   * Starting rating for a team seen for the first time, or returning
   * after a season out of the league (promoted sides are usually below
   * average). Default 1500. `initialElos` wins for a first appearance.
   */
  newTeamElo?: number;
}

/** Games each side had already played in the game's season before it. */
export interface GamesPlayed {
  home: number;
  away: number;
}

function marginMultiplier(goalDiff: number, eloDiff: number): number {
  // from common implementations
  return (
    Math.log(Math.abs(goalDiff) + 1) * (2.2 / (Math.abs(eloDiff) * 0.001 + 2.2))
  );
}

function timeWeight(gameDateStr: string, now: number): number {
  const gameDate = new Date(gameDateStr).getTime();
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
  const now = options.now ?? Date.now();
  const timeWeighting = options.timeWeighting ?? true;
  const baseK = options.baseK ?? BASE_K;
  const regression = options.seasonRegression ?? 0;
  const newTeamElo = options.newTeamElo ?? BASE_ELO;
  // Only when asked: by default a returning team keeps its old rating.
  const resetReturning = options.newTeamElo !== undefined;

  // Keyed by abbreviation: a franchise can change upstream id when it is
  // renamed (e.g. Utah Hockey Club -> Utah Mammoth) but keeps its history.
  const elos = new Map<string, number>();
  const ids = new Map<string, number | string>();
  // Games played per team in the season being walked, for the early-season
  // signal passed to onGame. Reset whenever the season label changes.
  let season: string | null = null;
  const played = new Map<string, number>();

  function ensureTeam(id: number | string, abbr: string) {
    if (!elos.has(abbr)) elos.set(abbr, initial[abbr] ?? newTeamElo);
    ids.set(abbr, id); // latest id wins
  }

  // Teams that played in the season just finished; the others are back
  // from a spell outside the league and restart at newTeamElo.
  let lastSeasonTeams = new Set<string>();
  let thisSeasonTeams = new Set<string>();
  function startSeason() {
    if (regression > 0) {
      for (const [abbr, e] of elos) elos.set(abbr, e + (BASE_ELO - e) * regression);
    }
    if (resetReturning && lastSeasonTeams.size > 0) {
      for (const abbr of elos.keys()) {
        if (!lastSeasonTeams.has(abbr)) elos.set(abbr, newTeamElo);
      }
    }
    lastSeasonTeams = thisSeasonTeams;
    thisSeasonTeams = new Set();
  }

  for (const g of games) {
    if (g.season !== season) {
      if (season !== null) startSeason();
      season = g.season;
      played.clear();
    }
    ensureTeam(g.homeTeamId, g.homeAbbr);
    ensureTeam(g.awayTeamId, g.awayAbbr);
    thisSeasonTeams.add(g.homeAbbr);
    thisSeasonTeams.add(g.awayAbbr);

    const homeElo = elos.get(g.homeAbbr)!;
    const awayElo = elos.get(g.awayAbbr)!;
    const homePlayed = played.get(g.homeAbbr) ?? 0;
    const awayPlayed = played.get(g.awayAbbr) ?? 0;
    options.onGame?.(g, homeElo, awayElo, { home: homePlayed, away: awayPlayed });
    played.set(g.homeAbbr, homePlayed + 1);
    played.set(g.awayAbbr, awayPlayed + 1);

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

    const age = timeWeighting ? timeWeight(g.date, now) : 1;
    const k = baseK * marginMult * age * otFactor;

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
