import axios from "axios";
import NodeCache from "node-cache";
import { GameRecord, UpcomingGame } from "../utils/types";
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

interface NhlSeason {
  games: GameRecord[];
  upcoming: UpcomingGame[];
}

const NHL_TZ = "America/New_York";

/**
 * The stats feed gives each game's `easternStartTime` as a New York
 * wall-clock time with no offset ("2026-10-02T20:00:00"). Returns that
 * instant as a UTC ISO string, or null when the value is not of that shape.
 */
export function easternToIso(wall: unknown): string | null {
  if (typeof wall !== "string") return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/.exec(wall);
  if (!m) return null;
  const [y, mo, d, h, mi, s] = m.slice(1).map(Number);
  const asUtc = Date.UTC(y, mo - 1, d, h, mi, s);
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone: NHL_TZ,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
  // Milliseconds New York is ahead of UTC at instant `t` (negative).
  const offsetAt = (t: number) => {
    const parts = fmt.formatToParts(new Date(t));
    const get = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value);
    const local = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second")
    );
    return local - t;
  };
  // Two passes so a time within an hour of a DST switch lands on the
  // offset in force at the game's own instant.
  let t = asUtc - offsetAt(asUtc);
  t = asUtc - offsetAt(t);
  return new Date(t).toISOString();
}

async function fetchSeasonData(season: string): Promise<NhlSeason> {
  try {
    const cacheKey = `schedule_${season}`;
    const cached = cache.get<NhlSeason>(cacheKey);
    if (cached) return cached;

    // Use season filtering instead of date filtering
    const url = `https://api.nhle.com/stats/rest/en/game?cayenneExp=season=${season}&limit=-1`;
    const resp = await axios.get(url);
    const gameData = resp.data.data as any[];
    const games: GameRecord[] = [];
    const upcoming: UpcomingGame[] = [];

    // Get team mapping for abbreviations
    const teamMap = await getTeamMapping();

    for (const g of gameData) {
      const gamePk = g.id as number;
      const gameDate = g.gameDate as string;
      const homeTeamId = g.homeTeamId as number;
      const awayTeamId = g.visitingTeamId as number;
      const homeGoals = g.homeScore as number;
      const awayGoals = g.visitingScore as number;

      // Get team abbreviations from mapping
      const homeAbbr = teamMap.get(homeTeamId) || `T${homeTeamId}`;
      const awayAbbr = teamMap.get(awayTeamId) || `T${awayTeamId}`;

      // The feed includes the full schedule; keep only finished games
      // (gameStateId 6 = final, 7 = official final) as results. Scheduled /
      // postponed games carry a 0-0 score and must not count, but their
      // start time is the schedule: the Eastern puck drop as a UTC instant,
      // or the bare calendar date when the feed has no start time (that
      // reads as midnight UTC, which is before the real start). gameType 1
      // = preseason, which never belongs in either list.
      if (g.gameStateId !== 6 && g.gameStateId !== 7) {
        const kickoff = easternToIso(g.easternStartTime) ?? gameDate;
        if (g.gameType !== 1 && kickoff) {
          upcoming.push({ homeAbbr, awayAbbr, date: kickoff });
        }
        continue;
      }

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

    const result: NhlSeason = { games, upcoming };
    cache.set(cacheKey, result);
    return result;
  } catch (error) {
    console.error(`Error fetching season games for ${season}:`, error);
    throw error;
  }
}

async function fetchSeasonGames(season: string): Promise<GameRecord[]> {
  return (await fetchSeasonData(season)).games;
}

/** NHL season id ("20262027") for a date; the season starting in October belongs to that year. */
export function nhlSeasonFor(date = new Date()): string {
  const start =
    date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
  return `${start}${start + 1}`;
}

/** Games from the two previous seasons plus the current one. */
export async function fetchNhlGames(): Promise<GameRecord[]> {
  return (await fetchNhlData()).games;
}

/** Played games plus the remaining schedule, over the same three seasons. */
export async function fetchNhlData(): Promise<{
  games: GameRecord[];
  upcoming: UpcomingGame[];
}> {
  const start = parseInt(nhlSeasonFor().slice(0, 4), 10);
  const seasons = [start - 2, start - 1, start].map((y) => `${y}${y + 1}`);
  const games: GameRecord[] = [];
  const upcoming: UpcomingGame[] = [];
  for (const s of seasons) {
    const season = await fetchSeasonData(s);
    games.push(...season.games);
    upcoming.push(...season.upcoming);
  }
  games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  upcoming.sort(
    (a, b) => new Date(a.date).getTime() - new Date(b.date).getTime()
  );
  return { games, upcoming };
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
