import axios from "axios";
import fs from "fs";
import path from "path";
import { GameRecord, TeamElo } from "../utils/types";
import { UCL_TEAMS, apiNameToAbbr } from "../utils/leagues";
import { computeElosFromGames } from "../elo/calculator";

/**
 * Champions League ratings = clubelo.com seed (data/ucl/ratings.json) plus
 * Elo updates from every Champions League game played since, pulled from
 * fixturedownload.com. Clubs come from ~15 domestic leagues, so a seed that
 * is already calibrated across leagues is essential; the live updates keep
 * it current through the season.
 */

const API = "https://fixturedownload.com/feed/json/champions-league-";
const REFRESH_MS = 6 * 60 * 60 * 1000;

const nameToAbbr = apiNameToAbbr(UCL_TEAMS);

export interface UclTeam extends TeamElo {
  seedElo: number;
  played: number;
}

export interface UclState {
  teams: UclTeam[];
  ratings: Record<string, number>; // current, by abbr
  games: GameRecord[];
  seedRefreshed: string;
  loadedAt: number;
}

function loadSeed(): { ratings: Record<string, number>; refreshed: string } {
  const p = path.join(process.cwd(), "data", "ucl", "ratings.json");
  const raw = JSON.parse(fs.readFileSync(p, "utf-8"));
  return {
    ratings: (raw.ratings ?? raw) as Record<string, number>,
    refreshed: String(raw._refreshed ?? ""),
  };
}

function abbrFor(apiName: string): string {
  const known = nameToAbbr.get(apiName);
  if (known) return known;
  const generated = apiName.replace(/[^A-Za-z]/g, "").slice(0, 3).toUpperCase();
  console.warn(`ucl: unknown team "${apiName}", using ${generated}`);
  return generated;
}

/** Start year of the Champions League season a date falls in. */
export function uclSeasonFor(date = new Date()): number {
  return date.getMonth() >= 6 ? date.getFullYear() : date.getFullYear() - 1;
}

async function fetchPlayedGames(startYear: number): Promise<GameRecord[]> {
  const resp = await axios.get(`${API}${startYear}`, {
    headers: { Accept: "application/json", "User-Agent": "elo-predictor" },
    timeout: 60_000,
  });
  const raw = resp.data as any[];
  if (!Array.isArray(raw)) throw new Error(`ucl: unexpected payload for ${startYear}`);

  const games: GameRecord[] = [];
  for (const m of raw) {
    if (m.HomeTeamScore == null || m.AwayTeamScore == null) continue;
    const homeAbbr = abbrFor(m.HomeTeam);
    const awayAbbr = abbrFor(m.AwayTeam);
    games.push({
      gamePk: startYear * 1000 + m.MatchNumber,
      season: `${startYear}${startYear + 1}`,
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
  games.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  return games;
}

let cached: UclState | null = null;
let inflight: Promise<UclState> | null = null;

export async function ensureUcl(): Promise<UclState> {
  if (cached && Date.now() - cached.loadedAt < REFRESH_MS) return cached;
  if (inflight) return inflight;

  inflight = (async () => {
    const seed = loadSeed();
    let games: GameRecord[] = [];
    try {
      games = await fetchPlayedGames(uclSeasonFor());
    } catch (e) {
      // Seed alone is still useful; log and carry on without updates.
      console.error("ucl: failed to fetch results, using seed only", e);
    }

    const seededTeams = new Set(Object.keys(seed.ratings));
    const updated = computeElosFromGames(games, {
      currentTeams: seededTeams,
      initialElos: seed.ratings,
    });
    const updatedByAbbr = new Map(updated.map((t) => [t.abbr, t.elo]));

    const played = new Map<string, number>();
    for (const g of games) {
      played.set(g.homeAbbr, (played.get(g.homeAbbr) ?? 0) + 1);
      played.set(g.awayAbbr, (played.get(g.awayAbbr) ?? 0) + 1);
    }

    const teams: UclTeam[] = Object.entries(seed.ratings)
      .map(([abbr, seedElo]) => ({
        teamId: abbr,
        abbr,
        seedElo,
        elo: updatedByAbbr.get(abbr) ?? seedElo,
        played: played.get(abbr) ?? 0,
      }))
      .sort((a, b) => b.elo - a.elo);

    const state: UclState = {
      teams,
      ratings: Object.fromEntries(teams.map((t) => [t.abbr, t.elo])),
      games,
      seedRefreshed: seed.refreshed,
      loadedAt: Date.now(),
    };
    cached = state;
    inflight = null;
    return state;
  })().catch((e) => {
    inflight = null;
    if (cached) return cached;
    throw e;
  });
  return inflight;
}
