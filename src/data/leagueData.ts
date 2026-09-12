import { GameRecord, TeamElo, UpcomingGame } from "../utils/types";
import { LeagueId, LEAGUES } from "../utils/leagues";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";
import { fetchNhlData } from "./nhlFetcher";
import { fetchLiigaData } from "./liigaFetcher";
import { fetchEplData } from "./eplFetcher";
import { computeElosFromGames } from "../elo/calculator";
import {
  fitDrawFactorFromHistory,
  HOCKEY_DRAW_FACTOR,
  isFullTimeDraw,
  isRegulationDraw,
  SOCCER_DRAW_FACTOR,
} from "../elo/probabilities";

/** Raw game history plus the teams that make up the league right now. */
export interface LeagueData {
  games: GameRecord[]; // sorted ascending by date, played games only
  currentTeams: Set<string>;
  /** Fixtures still to be played, sorted ascending by date. */
  upcoming: UpcomingGame[];
}

/** How long after its start time a fixture still resolves as "the next one". */
const KICKOFF_GRACE_MS = 12 * 60 * 60 * 1000;

/**
 * Scheduled start of the next game between two teams, ISO, or null when the
 * pairing is not on the schedule. A game that started within the last
 * `KICKOFF_GRACE_MS` still counts, so a bet saved during a game is stamped
 * with that game rather than the next meeting.
 */
export function kickoffOf(
  upcoming: UpcomingGame[],
  home: string,
  away: string,
  now = Date.now()
): string | null {
  const h = home.toUpperCase();
  const a = away.toUpperCase();
  let best: { date: string; t: number } | null = null;
  for (const g of upcoming) {
    if (g.homeAbbr.toUpperCase() !== h || g.awayAbbr.toUpperCase() !== a)
      continue;
    const t = new Date(g.date).getTime();
    if (!Number.isFinite(t) || t < now - KICKOFF_GRACE_MS) continue;
    if (!best || t < best.t) best = { date: g.date, t };
  }
  return best?.date ?? null;
}

export interface LeagueState extends LeagueData {
  elos: TeamElo[];
  /**
   * Davidson draw factor for the league's 1X2 market. Soccer: full-time
   * draws. Hockey: regulation-time draws (games that went to OT/SO), fitted
   * from the league's own history.
   */
  drawFactor: number;
  /** Elo home advantage the ratings and probabilities use (LEAGUES[id].homeAdv). */
  homeAdv: number;
  loadedAt: number;
}

/**
 * Davidson draw factor fitted from the league's own games, using the
 * ratings as they stood before each game: full-time draws for soccer,
 * games that went to OT/SO for hockey. Falls back to the sport constant
 * with too little history.
 */
export function drawFactorFor(
  league: LeagueId,
  games: GameRecord[],
  currentTeams: Set<string>,
  homeAdv: number
): number {
  const soccer = LEAGUES[league].sport === "soccer";
  return fitDrawFactorFromHistory(
    games,
    soccer ? isFullTimeDraw : isRegulationDraw,
    {
      homeAdv,
      currentTeams,
      fallback: soccer ? SOCCER_DRAW_FACTOR : HOCKEY_DRAW_FACTOR,
    }
  );
}

async function loadLeagueData(league: LeagueId): Promise<LeagueData> {
  switch (league) {
    case "nhl": {
      const { games, upcoming } = await fetchNhlData();
      return { games, currentTeams: CURRENT_NHL_TEAMS, upcoming };
    }
    case "liiga":
      return fetchLiigaData();
    case "epl":
      return fetchEplData();
  }
}

const REFRESH_MS = 6 * 60 * 60 * 1000; // re-pull results every 6h
const cache = new Map<LeagueId, LeagueState>();
const inflight = new Map<LeagueId, Promise<LeagueState>>();

/**
 * Games + Elo ratings for a league, computed once and refreshed every 6h so
 * newly played rounds show up without restarting the server.
 */
export async function ensureLeague(league: LeagueId): Promise<LeagueState> {
  const cached = cache.get(league);
  if (cached && Date.now() - cached.loadedAt < REFRESH_MS) return cached;

  const pending = inflight.get(league);
  if (pending) return pending;

  const p = (async () => {
    try {
      const data = await loadLeagueData(league);
      const homeAdv = LEAGUES[league].homeAdv;
      const elos = computeElosFromGames(data.games, {
        currentTeams: data.currentTeams,
        homeAdv,
      });
      const drawFactor = drawFactorFor(
        league,
        data.games,
        data.currentTeams,
        homeAdv
      );
      const state: LeagueState = {
        ...data,
        elos,
        drawFactor,
        homeAdv,
        loadedAt: Date.now(),
      };
      cache.set(league, state);
      return state;
    } catch (e) {
      // Serve stale data rather than failing if a refresh breaks.
      if (cached) return cached;
      throw e;
    } finally {
      inflight.delete(league);
    }
  })();
  inflight.set(league, p);
  return p;
}
