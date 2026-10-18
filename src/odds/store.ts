/**
 * Disk cache of historical odds, one file per league and season:
 *
 *   data/odds/<league>/<season>.json
 *
 * Reads are synchronous so the model backtest (served by the API) can pick
 * the odds up without changing its call shape. The files are committed:
 * they are the backtest's fixtures and make a run reproducible.
 */
import fs from "fs";
import path from "path";
import { LeagueId, LEAGUES } from "../utils/leagues";
import { GameRecord } from "../utils/types";
import { OddsRecord, OddsSource, UnmatchedName } from "./types";

export interface OddsSeasonFile {
  source: OddsSource;
  fetchedAt: string;
  startYear: number;
  /** True once the season is over and fully stored; never refetched. */
  complete: boolean;
  records: OddsRecord[];
  unmatched: UnmatchedName[];
  skipped?: { noResult: number; noSharp: number };
}

export function oddsDir(league?: LeagueId): string {
  const root = path.join(process.cwd(), "data", "odds");
  return league ? path.join(root, league) : root;
}

/** Season label in the league's convention: "20242025" for all three. */
export function seasonLabelFor(league: LeagueId, startYear: number): string {
  void league;
  return `${startYear}${startYear + 1}`;
}

export function readOddsSeason(league: LeagueId, season: string): OddsSeasonFile | null {
  const file = path.join(oddsDir(league), `${season}.json`);
  if (!fs.existsSync(file)) return null;
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as OddsSeasonFile;
  } catch (e) {
    console.warn(`odds: cannot read ${file}: ${e}`);
    return null;
  }
}

export function writeOddsSeason(league: LeagueId, season: string, data: OddsSeasonFile): void {
  const dir = oddsDir(league);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `${season}.json`);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(data, null, 1));
  fs.renameSync(tmp, file);
}

export function listOddsSeasons(league: LeagueId): string[] {
  const dir = oddsDir(league);
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir)
    .filter((f) => /^\d{8}\.json$/.test(f))
    .map((f) => f.slice(0, 8))
    .sort();
}

/** Every stored record of a league, oldest first. Empty without a cache. */
export function readAllOdds(league: LeagueId): OddsRecord[] {
  const out: OddsRecord[] = [];
  for (const season of listOddsSeasons(league)) {
    const file = readOddsSeason(league, season);
    if (file) out.push(...file.records);
  }
  out.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

// ---------------------------------------------------------------------------
// Join to the game history
// ---------------------------------------------------------------------------

const DAY_MS = 24 * 60 * 60 * 1000;
export const utcDay = (iso: string) => iso.slice(0, 10);

function shiftDay(day: string, days: number): string {
  return new Date(new Date(`${day}T00:00:00Z`).getTime() + days * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export interface OddsJoin {
  /** Odds per game, keyed by gamePk. */
  matched: Map<number, OddsRecord>;
  unmatchedGames: GameRecord[];
  unmatchedOdds: OddsRecord[];
  /** Pairs that appeared more than once inside the tolerance window. */
  duplicates: string[];
}

/**
 * Pair games with odds by (UTC day, home, away). The exact day is tried
 * first, then the days either side, so a late kickoff logged on the next
 * UTC day still matches. A pair seen twice within the window is left
 * unmatched and reported rather than guessed.
 */
export function joinOdds(
  games: GameRecord[],
  odds: OddsRecord[],
  toleranceDays = 1
): OddsJoin {
  const byKey = new Map<string, OddsRecord[]>();
  const key = (day: string, home: string, away: string) => `${day}|${home}|${away}`;
  for (const o of odds) {
    const k = key(utcDay(o.date), o.home, o.away);
    const list = byKey.get(k);
    if (list) list.push(o);
    else byKey.set(k, [o]);
  }
  const used = new Set<OddsRecord>();
  const matched = new Map<number, OddsRecord>();
  const unmatchedGames: GameRecord[] = [];
  const duplicates: string[] = [];
  const offsets = [0];
  for (let d = 1; d <= toleranceDays; d++) offsets.push(-d, d);

  for (const g of games) {
    const day = utcDay(g.date);
    const candidates: OddsRecord[] = [];
    for (const off of offsets) {
      const list = byKey.get(key(shiftDay(day, off), g.homeAbbr, g.awayAbbr));
      if (list) for (const o of list) if (!used.has(o)) candidates.push(o);
      if (off === 0 && candidates.length) break;
    }
    if (candidates.length === 1) {
      matched.set(g.gamePk, candidates[0]);
      used.add(candidates[0]);
    } else {
      if (candidates.length > 1) duplicates.push(`${day} ${g.homeAbbr}-${g.awayAbbr}`);
      unmatchedGames.push(g);
    }
  }
  const unmatchedOdds = odds.filter((o) => !used.has(o));
  return { matched, unmatchedGames, unmatchedOdds, duplicates };
}

export function leagueName(league: LeagueId): string {
  return LEAGUES[league].name;
}
