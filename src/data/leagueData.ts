import { GameRecord, TeamElo } from "../utils/types";
import { LeagueId, LEAGUES } from "../utils/leagues";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";
import { fetchNhlGames } from "./nhlFetcher";
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
    case "nhl":
      return {
        games: await fetchNhlGames(),
        currentTeams: CURRENT_NHL_TEAMS,
      };
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
