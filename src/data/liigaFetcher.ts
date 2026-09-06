import axios from "axios";
import NodeCache from "node-cache";
import { GameRecord } from "../utils/types";
import { LIIGA_TEAMS, apiNameToAbbr } from "../utils/leagues";
import { LeagueData } from "./leagueData";

const cache = new NodeCache({ stdTTL: 60 * 60 * 6 }); // 6h

// Liiga's public JSON API. `season` is the year the season ENDS in
// (2027 = 2026-27). `runkosarja` = regular season.
const API = "https://liiga.fi/api/v2/games";

const nameToAbbr = apiNameToAbbr(LIIGA_TEAMS);

// Fallback for a team missing from LIIGA_TEAMS: derive a code from the
// teamId ("55786244:hpk" -> "HPK") so the game still counts.
function abbrFor(team: { teamId: string; teamName: string }): string {
  const known = nameToAbbr.get(team.teamName);
  if (known) return known;
  const slug = String(team.teamId).split(":")[1] ?? team.teamName;
  console.warn(`liiga: unknown team "${team.teamName}", using ${slug}`);
  return slug.toUpperCase();
}

function teamIdOf(team: { teamId: string }): number | string {
  const n = parseInt(String(team.teamId).split(":")[0], 10);
  return Number.isNaN(n) ? team.teamId : n;
}

type LiigaSeason = { games: GameRecord[]; teams: Set<string> };

async function fetchSeason(season: number): Promise<LiigaSeason> {
  const cacheKey = `liiga_${season}`;
  const cached = cache.get<LiigaSeason>(cacheKey);
  if (cached) return cached;

  const url = `${API}?tournament=runkosarja&season=${season}`;
  const resp = await axios.get(url, {
    headers: { Accept: "application/json" },
    timeout: 60_000,
  });
  const raw = resp.data as any[];
  if (!Array.isArray(raw)) throw new Error(`liiga: unexpected payload for ${season}`);

  const games: GameRecord[] = [];
  const teams = new Set<string>();

  for (const g of raw) {
    const homeAbbr = abbrFor(g.homeTeam);
    const awayAbbr = abbrFor(g.awayTeam);
    teams.add(homeAbbr);
    teams.add(awayAbbr);

    // Skip fixtures not yet played (also guards against live games).
    if (!g.ended) continue;

    const finished = String(g.finishedType ?? "");
    const decidedInOTorSO =
      finished === "ENDED_DURING_EXTENDED_GAME_TIME" ||
      finished === "ENDED_DURING_WINNING_SHOT_COMPETITION";

    games.push({
      gamePk: g.id,
      season: String(season),
      date: g.start,
      homeTeamId: teamIdOf(g.homeTeam),
      awayTeamId: teamIdOf(g.awayTeam),
      homeAbbr,
      awayAbbr,
      homeGoals: g.homeTeam.goals ?? 0,
      awayGoals: g.awayTeam.goals ?? 0,
      decidedInOTorSO,
    });
  }

  const result = { games, teams };
  cache.set(cacheKey, result);
  return result;
}

/** Liiga season id for a date: the season starting in September belongs to next year. */
export function liigaSeasonFor(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() + 1 : date.getFullYear();
}

export async function fetchLiigaData(): Promise<LeagueData> {
  const current = liigaSeasonFor();
  const seasons = [current - 2, current - 1, current];
  const all: GameRecord[] = [];
  let currentTeams = new Set<string>();
  for (const s of seasons) {
    const { games, teams } = await fetchSeason(s);
    all.push(...games);
    // The newest season with any fixtures defines the current roster.
    if (teams.size > 0) currentTeams = teams;
  }
  all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return { games: all, currentTeams };
}
