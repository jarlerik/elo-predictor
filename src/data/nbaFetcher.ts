import axios from "axios";
import NodeCache from "node-cache";
import { GameRecord, UpcomingGame } from "../utils/types";
import { NBA_TEAMS, apiNameToAbbr } from "../utils/leagues";
import { LeagueData } from "./leagueData";

const cache = new NodeCache({ stdTTL: 60 * 60 * 6 }); // 6h

// Free fixture + result feed, no API key, the same site as the EPL and the
// Champions League. `nba-2026` = the 2026-27 regular season (82 games a
// team, 1,230 in all, plus the NBA Cup final); playoffs are not in the
// feed. Checked 2026-10-23: seasons 2018-19 onwards are served, 2017-18 is
// not. The 2020-21 file has 1,079 played games (the pandemic season).
const API = "https://fixturedownload.com/feed/json/nba-";

/**
 * NBA Cup knockout games are listed before the teams are known, with
 * "To be announced" on both sides; they are skipped until the feed names
 * the teams.
 */
const PLACEHOLDER = "To be announced";

const nameToAbbr = apiNameToAbbr(NBA_TEAMS);
for (const [name, abbr] of Object.entries({ "Los Angeles Clippers": "LAC" })) {
  nameToAbbr.set(name, abbr);
}

function abbrFor(apiName: string, onUnknown?: (name: string) => void): string {
  const known = nameToAbbr.get(apiName);
  if (known) return known;
  const generated = apiName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  if (onUnknown) onUnknown(apiName);
  else console.warn(`nba: unknown team "${apiName}", using ${generated}`);
  return generated;
}

export type NbaSeason = {
  games: GameRecord[];
  teams: Set<string>;
  upcoming: UpcomingGame[];
};

/**
 * One regular season of the feed by its start year. `onUnknown` receives
 * team names missing from NBA_TEAMS (scripts report them); without it a
 * code is generated with a warning. A basketball game cannot end level,
 * so `decidedInOTorSO` is always false: the feed does not say whether a
 * game went to overtime, and the only market is the winner including it.
 */
export async function fetchNbaSeason(
  startYear: number,
  onUnknown?: (name: string) => void
): Promise<NbaSeason> {
  const cacheKey = `nba_${startYear}`;
  const cached = cache.get<NbaSeason>(cacheKey);
  if (cached && !onUnknown) return cached;

  const resp = await axios.get(`${API}${startYear}`, {
    headers: { Accept: "application/json", "User-Agent": "elo-predictor" },
    timeout: 60_000,
  });
  const raw = resp.data as any[];
  if (!Array.isArray(raw)) throw new Error(`nba: unexpected payload for ${startYear}`);

  const games: GameRecord[] = [];
  const teams = new Set<string>();
  const upcoming: UpcomingGame[] = [];

  for (const m of raw) {
    if (m.HomeTeam === PLACEHOLDER || m.AwayTeam === PLACEHOLDER) continue;
    const homeAbbr = abbrFor(m.HomeTeam, onUnknown);
    const awayAbbr = abbrFor(m.AwayTeam, onUnknown);
    teams.add(homeAbbr);
    teams.add(awayAbbr);

    // "2026-10-20 19:00:00Z" -> ISO
    const tipOff = String(m.DateUtc).replace(" ", "T");

    // Unplayed games have null scores: keep them as the schedule.
    if (m.HomeTeamScore == null || m.AwayTeamScore == null) {
      upcoming.push({ homeAbbr, awayAbbr, date: tipOff });
      continue;
    }

    games.push({
      gamePk: startYear * 10000 + m.MatchNumber,
      season: `${startYear}${startYear + 1}`,
      date: tipOff,
      homeTeamId: homeAbbr,
      awayTeamId: awayAbbr,
      homeAbbr,
      awayAbbr,
      homeGoals: m.HomeTeamScore,
      awayGoals: m.AwayTeamScore,
      decidedInOTorSO: false,
    });
  }
  games.sort((a, b) => a.date.localeCompare(b.date) || a.gamePk - b.gamePk);
  upcoming.sort((a, b) => a.date.localeCompare(b.date));

  const result = { games, teams, upcoming };
  cache.set(cacheKey, result);
  return result;
}

/** Start year of the NBA season a date falls in (October tip-off). */
export function nbaSeasonFor(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

/** Played games plus the remaining schedule over the two previous seasons and the current one. */
export async function fetchNbaData(): Promise<LeagueData> {
  const current = nbaSeasonFor();
  const seasons = [current - 2, current - 1, current];
  const all: GameRecord[] = [];
  const upcoming: UpcomingGame[] = [];
  let currentTeams = new Set<string>();
  for (const s of seasons) {
    const season = await fetchNbaSeason(s);
    all.push(...season.games);
    upcoming.push(...season.upcoming);
    if (season.teams.size > 0) currentTeams = season.teams;
  }
  all.sort((a, b) => a.date.localeCompare(b.date) || a.gamePk - b.gamePk);
  upcoming.sort((a, b) => a.date.localeCompare(b.date));
  return { games: all, currentTeams, upcoming };
}
