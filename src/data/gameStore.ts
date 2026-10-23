/**
 * Disk cache of played games per league and season, for offline and
 * repeatable backtests:
 *
 *   data/games/<league>/<season>.json
 *
 * The live server keeps using the fetchers directly; this store is what
 * the scripts read, filled by `npm run games:fetch`.
 */
import fs from "fs";
import path from "path";
import { LeagueId } from "../utils/leagues";
import { GameRecord } from "../utils/types";
import { OddsRecord } from "../odds/types";
import { seasonLabelFor } from "../odds/store";
import { fetchEplSeason, eplSeasonFor } from "./eplFetcher";
import { fetchNhlSeason, nhlSeasonFor } from "./nhlFetcher";
import { fetchLiigaSeason, liigaSeasonFor } from "./liigaFetcher";
import { fetchNbaSeason, nbaSeasonFor } from "./nbaFetcher";

export interface GameSeasonFile {
  fetchedAt: string;
  source: "fixturedownload" | "nhl-api" | "liiga-api" | "football-data";
  /** Extra per-league notes, e.g. NHL game types kept. */
  note?: string;
  /** True once the season is over and fully stored. */
  complete: boolean;
  games: GameRecord[];
  currentTeams: string[];
}

export function gamesDir(league: LeagueId): string {
  return path.join(process.cwd(), "data", "games", league);
}

export function readGameSeason(league: LeagueId, season: string): GameSeasonFile | null {
  const file = path.join(gamesDir(league), `${season}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as GameSeasonFile;
  } catch (e) {
    console.warn(`games: cannot read ${file}: ${e}`);
    return null;
  }
}

export function writeGameSeason(league: LeagueId, season: string, data: GameSeasonFile): void {
  const dir = gamesDir(league);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${season}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export function listGameSeasons(league: LeagueId): string[] {
  const dir = gamesDir(league);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => f.slice(0, 8))
    .sort();
}

/** All stored games of a league in date order, with the seasons found. */
export function readStoredGames(
  league: LeagueId,
  fromStartYear?: number,
  toStartYear?: number
): { games: GameRecord[]; seasons: string[] } {
  const games: GameRecord[] = [];
  const seasons: string[] = [];
  for (const season of listGameSeasons(league)) {
    const start = Number(season.slice(0, 4));
    if (fromStartYear !== undefined && start < fromStartYear) continue;
    if (toStartYear !== undefined && start > toStartYear) continue;
    const file = readGameSeason(league, season);
    if (!file) continue;
    seasons.push(season);
    games.push(...file.games);
  }
  games.sort((a, b) => a.date.localeCompare(b.date) || a.gamePk - b.gamePk);
  return { games, seasons };
}

/** Start year of the current season in each league's convention. */
export function currentStartYear(league: LeagueId): number {
  switch (league) {
    case "epl":
      return eplSeasonFor();
    case "nhl":
      return Number(nhlSeasonFor().slice(0, 4));
    case "liiga":
      return liigaSeasonFor() - 1;
    case "nba":
      return nbaSeasonFor();
  }
}

/**
 * One season from the league's live feed, as a store file. `onUnknown`
 * gets team names the league table cannot place (EPL and NBA; the hockey
 * feeds carry codes). Liiga seasons are keyed by end year upstream, so a
 * start year of 2024 fetches `season=2025`.
 */
export async function fetchSeasonFromFeed(
  league: LeagueId,
  startYear: number,
  onUnknown?: (name: string) => void
): Promise<GameSeasonFile | null> {
  const complete = startYear < currentStartYear(league);
  const now = new Date().toISOString();
  switch (league) {
    case "epl": {
      const s = await fetchEplSeason(startYear, onUnknown);
      if (!s.games.length) return null;
      return { fetchedAt: now, source: "fixturedownload", complete: complete && s.games.length >= 380, games: s.games, currentTeams: [...s.teams] };
    }
    case "nhl": {
      const s = await fetchNhlSeason(`${startYear}${startYear + 1}`);
      if (!s.games.length) return null;
      const teams = new Set<string>();
      for (const g of s.games) {
        teams.add(g.homeAbbr);
        teams.add(g.awayAbbr);
      }
      return { fetchedAt: now, source: "nhl-api", complete, games: s.games, currentTeams: [...teams], note: "regular season and playoffs; preseason dropped" };
    }
    case "liiga": {
      const s = await fetchLiigaSeason(startYear + 1);
      if (!s.games.length) return null;
      return { fetchedAt: now, source: "liiga-api", complete, games: s.games, currentTeams: [...s.teams], note: "regular season (runkosarja) only" };
    }
    case "nba": {
      const s = await fetchNbaSeason(startYear, onUnknown);
      if (!s.games.length) return null;
      // 1,230 games a season; the pandemic 2020-21 season stored 1,079.
      return { fetchedAt: now, source: "fixturedownload", complete: complete && s.games.length >= 1000, games: s.games, currentTeams: [...s.teams], note: "regular season only (the feed has no playoffs); NBA Cup placeholder games dropped" };
    }
  }
}

/**
 * Games derived from an odds file that carries results (football-data), for
 * seasons the fixture feed does not cover. Kickoff times are the odds
 * source's (UK clock kept as UTC), and ids are positional.
 */
export function gamesFromOdds(league: LeagueId, startYear: number, odds: OddsRecord[]): GameRecord[] {
  const season = seasonLabelFor(league, startYear);
  const sorted = [...odds].filter((o) => o.result).sort((a, b) => a.date.localeCompare(b.date));
  return sorted.map((o, i) => ({
    gamePk: startYear * 1000 + i + 1,
    season,
    date: o.date,
    homeTeamId: o.home,
    awayTeamId: o.away,
    homeAbbr: o.home,
    awayAbbr: o.away,
    homeGoals: o.result!.homeGoals,
    awayGoals: o.result!.awayGoals,
    decidedInOTorSO: false,
  }));
}
