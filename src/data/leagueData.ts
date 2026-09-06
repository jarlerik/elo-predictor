import { GameRecord, TeamElo } from "../utils/types";
import { LeagueId } from "../utils/leagues";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";
import { fetchMultipleSeasons } from "./nhlFetcher";
import { fetchLiigaData } from "./liigaFetcher";
import { fetchEplData } from "./eplFetcher";
import { computeElosFromGames } from "../elo/calculator";

/** Raw game history plus the teams that make up the league right now. */
export interface LeagueData {
  games: GameRecord[]; // sorted ascending by date, played games only
  currentTeams: Set<string>;
}

export interface LeagueState extends LeagueData {
  elos: TeamElo[];
  loadedAt: number;
}

// seasons: 2 previous + current
const NHL_SEASONS = ["20222023", "20232024", "20242025"];

async function loadLeagueData(league: LeagueId): Promise<LeagueData> {
  switch (league) {
    case "nhl":
      return {
        games: await fetchMultipleSeasons(NHL_SEASONS),
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
      const state: LeagueState = { ...data, elos, loadedAt: Date.now() };
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
