import axios from "axios";
import NodeCache from "node-cache";
import { GameRecord } from "../utils/types";
import { CURRENT_NHL_TEAMS } from "../utils/teamData";

const cache = new NodeCache({ stdTTL: 60 * 60 * 6 }); // 6h

// Team ID to abbreviation mapping
let teamMapping: Map<number, string> | null = null;

async function getTeamMapping(): Promise<Map<number, string>> {
  if (teamMapping) return teamMapping;

  const cached = cache.get<Map<number, string>>("team_mapping");
  if (cached) {
    teamMapping = cached;
    return teamMapping;
  }

  const resp = await axios.get("https://api.nhle.com/stats/rest/en/team");
  const teams = resp.data.data as any[];
  const mapping = new Map<number, string>();

  for (const team of teams) {
    // Only include current NHL teams
    if (CURRENT_NHL_TEAMS.has(team.triCode)) {
      mapping.set(team.id, team.triCode);
    }
  }

  teamMapping = mapping;
  cache.set("team_mapping", mapping);
  return mapping;
}

async function fetchSeasonGames(season: string): Promise<GameRecord[]> {
  try {
    const cacheKey = `schedule_${season}`;
    const cached = cache.get<GameRecord[]>(cacheKey);
    if (cached) return cached;

    // Use season filtering instead of date filtering
    const url = `https://api.nhle.com/stats/rest/en/game?cayenneExp=season=${season}&limit=-1`;
    const resp = await axios.get(url);
    const gameData = resp.data.data as any[];
    const games: GameRecord[] = [];

    // Get team mapping for abbreviations
    const teamMap = await getTeamMapping();

    for (const g of gameData) {
      // The feed includes the full schedule; keep only finished games
      // (gameStateId 6 = final, 7 = official final). Scheduled / postponed
      // games carry a 0-0 score and must not count.
      if (g.gameStateId !== 6 && g.gameStateId !== 7) continue;

      const gamePk = g.id as number;
      const gameDate = g.gameDate as string;
      const homeTeamId = g.homeTeamId as number;
      const awayTeamId = g.visitingTeamId as number;
      const homeGoals = g.homeScore as number;
      const awayGoals = g.visitingScore as number;

      // Get team abbreviations from mapping
      const homeAbbr = teamMap.get(homeTeamId) || `T${homeTeamId}`;
      const awayAbbr = teamMap.get(awayTeamId) || `T${awayTeamId}`;

      // period 4 = overtime, 5 = shootout (gameType is preseason/regular/playoffs)
      const decidedInOTorSO = (g.period as number) >= 4;

      games.push({
        gamePk,
        season,
        date: gameDate,
        homeTeamId,
        awayTeamId,
        homeAbbr,
        awayAbbr,
        homeGoals,
        awayGoals,
        decidedInOTorSO,
      });
    }

    cache.set(cacheKey, games);
    return games;
  } catch (error) {
    console.error(`Error fetching season games for ${season}:`, error);
    throw error;
  }
}

/** NHL season id ("20262027") for a date; the season starting in October belongs to that year. */
export function nhlSeasonFor(date = new Date()): string {
  const start =
    date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}${start + 1}`;
}

/** Games from the two previous seasons plus the current one. */
export async function fetchNhlGames(): Promise<GameRecord[]> {
  const start = parseInt(nhlSeasonFor().slice(0, 4), 10);
  const seasons = [start - 2, start - 1, start].map((y) => `${y}${y + 1}`);
  return fetchMultipleSeasons(seasons);
}

export async function fetchMultipleSeasons(
  seasons: string[]
): Promise<GameRecord[]> {
  const all: GameRecord[] = [];
  for (const s of seasons) {
    const g = await fetchSeasonGames(s);
    all.push(...g);
  }
  // Sort by date ascending
  all.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return all;
}
