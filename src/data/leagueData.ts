import { GameRecord, TeamElo } from "../utils/types";
import { LeagueId, LEAGUES } from "../utils/leagues";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";
import { fetchNhlGames } from "./nhlFetcher";
import { fetchLiigaData } from "./liigaFetcher";
import { fetchEplData } from "./eplFetcher";
import { computeElosFromGames } from "../elo/calculator";
import {
  fitDrawFactor,
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
  loadedAt: number;
}

function drawFactorFor(
  league: LeagueId,
  games: GameRecord[],
  elos: TeamElo[]
): number {
  if (LEAGUES[league].sport === "soccer") return SOCCER_DRAW_FACTOR;
  return fitDrawFactor(games, elos, isRegulationDraw);
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
      const elos = computeElosFromGames(data.games, {
        currentTeams: data.currentTeams,
      });
      const drawFactor = drawFactorFor(league, data.games, elos);
      const state: LeagueState = {
        ...data,
        elos,
        drawFactor,
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
