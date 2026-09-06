import axios from "axios";
import NodeCache from "node-cache";
import { GameRecord } from "../utils/types";
import { EPL_TEAMS, apiNameToAbbr } from "../utils/leagues";
import { LeagueData } from "./leagueData";

const cache = new NodeCache({ stdTTL: 60 * 60 * 6 }); // 6h

// Free fixture + result feed, no API key. `epl-2026` = the 2026-27 season.
const API = "https://fixturedownload.com/feed/json/epl-";

const nameToAbbr = apiNameToAbbr(EPL_TEAMS);

function abbrFor(apiName: string): string {
  const known = nameToAbbr.get(apiName);
  if (known) return known;
  const generated = apiName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  console.warn(`epl: unknown team "${apiName}", using ${generated}`);
  return generated;
}

type EplSeason = { games: GameRecord[]; teams: Set<string> };

async function fetchSeason(startYear: number): Promise<EplSeason> {
  const cacheKey = `epl_${startYear}`;
  const cached = cache.get<EplSeason>(cacheKey);
  if (cached) return cached;

  const resp = await axios.get(`${API}${startYear}`, {
    headers: { Accept: "application/json", "User-Agent": "elo-predictor" },
    timeout: 60_000,
  });
  const raw = resp.data as any[];
  if (!Array.isArray(raw)) throw new Error(`epl: unexpected payload for ${startYear}`);

  const games: GameRecord[] = [];
  const teams = new Set<string>();

  for (const m of raw) {
    const homeAbbr = abbrFor(m.HomeTeam);
    const awayAbbr = abbrFor(m.AwayTeam);
    teams.add(homeAbbr);
    teams.add(awayAbbr);

    // Unplayed fixtures have null scores.
    if (m.HomeTeamScore == null || m.AwayTeamScore == null) continue;

    games.push({
      gamePk: startYear * 1000 + m.MatchNumber,
      season: `${startYear}${startYear + 1}`,
      // "2026-08-21 19:00:00Z" -> ISO
      date: String(m.DateUtc).replace(" ", "T"),
      homeTeamId: homeAbbr,
      awayTeamId: awayAbbr,
      homeAbbr,
      awayAbbr,
      homeGoals: m.HomeTeamScore,
      awayGoals: m.AwayTeamScore,
      decidedInOTorSO: false,
    });
  }

  const result = { games, teams };
  cache.set(cacheKey, result);
  return result;
}

/** Start year of the Premier League season a date falls in (August kick-off). */
export function eplSeasonFor(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

export async function fetchEplData(): Promise<LeagueData> {
  const current = eplSeasonFor();
  const seasons = [current - 2, current - 1, current];
  const all: GameRecord[] = [];
  let currentTeams = new Set<string>();
  for (const s of seasons) {
    const { games, teams } = await fetchSeason(s);
    all.push(...games);
    if (teams.size > 0) currentTeams = teams;
  }
  all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return { games: all, currentTeams };
}
