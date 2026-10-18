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

export interface GameSeasonFile {
  fetchedAt: string;
  source: "fixturedownload" | "nhl-api" | "liiga-api" | "football-data";
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
