/**
 * Today's prices from every bookmaker The Odds API carries in the
 * European and Finnish regions, for the morning scan.
 *
 *   GET /v4/sports/{sport}/odds?regions=eu,fi&markets=h2h
 *
 * costs one credit per region per market, so two credits per league per
 * call, and returns every event that has not started with each book's
 * head-to-head line. The Finnish region (checked 2026-10-19) holds
 * `veikkaus_fi` (two-way only on hockey: the winner including overtime),
 * `unibet_fi` and `leovegas_fi` (three-way 60-minute line on hockey). On
 * basketball every book quotes the two-way winner incl. overtime. The
 * European region holds Pinnacle, the Betfair Exchange, Betsson, NordicBet,
 * Coolbet, William Hill, Unibet, Marathonbet, 1xBet, Tipico, Winamax and a
 * few more: 12 two-way and 14 three-way books on an NHL game.
 *
 * Responses are cached under data/odds/raw/the-odds-api/live/<league>/ and
 * reused within `maxAgeMinutes`, so a rerun of the scan costs nothing.
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { PriceTrio, TwoWay } from "./types";
import { resolveTheOddsApiAbbr } from "./theOddsApi";
import { resolveOddspapiAbbr } from "./oddspapiAliases";
import { LeagueId, LEAGUE_IDS, LEAGUES, Sport, isLeagueId } from "../utils/leagues";

export type ScanLeague = LeagueId | "ucl";
export const SCAN_LEAGUES: ScanLeague[] = [...LEAGUE_IDS, "ucl"];
export const isScanLeague = (v: unknown): v is ScanLeague => isLeagueId(v) || v === "ucl";

/** The sport of a scanned league; the Champions League is soccer. */
export const scanSport = (league: ScanLeague): Sport =>
  league === "ucl" ? "soccer" : LEAGUES[league].sport;

export const SPORT_KEY: Record<ScanLeague, string> = {
  nhl: "icehockey_nhl",
  liiga: "icehockey_liiga",
  epl: "soccer_epl",
  nba: "basketball_nba",
  ucl: "soccer_uefa_champs_league",
};

/** Books a Finnish bettor can hold an account with, as the API keys them. */
export const FI_BOOKS = ["veikkaus_fi", "unibet_fi", "leovegas_fi"] as const;
export const DEFAULT_REGIONS = "eu,fi";

const BASE = "https://api.the-odds-api.com/v4";

/** The Odds API spellings that differ from the OddsPapi and display names. */
const UCL_NAMES: Record<string, string> = {
  "Paris Saint Germain": "PSG",
  "Inter Milan": "INT",
  "Sporting Lisbon": "SCP",
  "Bayern Munich": "BAY",
  "AS Roma": "ROM",
  "ŠK Slovan Bratislava": "SLB",
  "Viking FK": "VIK",
  "Sabah FK": "SAB",
  "RC Lens": "RCL",
  Fenerbahce: "FEN",
  Porto: "FCP",
  "Atletico Madrid": "ATM",
  "Bodo/Glimt": "BOD",
};

export function resolveScanAbbr(league: ScanLeague, name: string): string | null {
  if (league === "ucl") return UCL_NAMES[name.trim()] ?? resolveOddspapiAbbr("ucl", name);
  const hit = resolveTheOddsApiAbbr(league, name);
  if (hit) return hit;
  return league === "epl" ? resolveOddspapiAbbr("epl", name) : null;
}

interface RawEvent {
  id: string;
  commence_time: string;
  home_team: string;
  away_team: string;
  bookmakers: {
    key: string;
    title: string;
    last_update: string;
    markets: { key: string; last_update: string; outcomes: { name: string; price: number }[] }[];
  }[];
}

export interface BoardEvent {
  id: string;
  league: ScanLeague;
  /** ISO kickoff. */
  commence: string;
  homeName: string;
  awayName: string;
  /** App codes, null when the provider's name is not in the alias tables. */
  home: string | null;
  away: string | null;
  /** Books quoting a draw line: soccer 1X2, hockey 60-minute 1X2. */
  threeWay: Record<string, PriceTrio>;
  /** Books quoting two sides: hockey winner including overtime. */
  twoWay: Record<string, TwoWay>;
  /** Latest `last_update` across the books, ISO. */
  updatedAt: string | null;
}

export interface Board {
  league: ScanLeague;
  fetchedAt: string;
  /** True when served from the disk cache. */
  cached: boolean;
  creditsLeft: number | null;
  events: BoardEvent[];
  unmatched: string[];
}

function cacheDir(league: ScanLeague): string {
  return path.join(process.cwd(), "data", "odds", "raw", "the-odds-api", "live", league);
}

interface CacheFile {
  fetchedAt: string;
  regions: string;
  creditsLeft: number | null;
  data: RawEvent[];
}

function latestCached(league: ScanLeague, regions: string, maxAgeMs: number): CacheFile | null {
  const dir = cacheDir(league);
  if (!fs.existsSync(dir)) return null;
  const files = fs.readdirSync(dir).filter((f) => f.endsWith(".json")).sort();
  for (let i = files.length - 1; i >= 0; i--) {
    try {
      const c = JSON.parse(fs.readFileSync(path.join(dir, files[i]), "utf-8")) as CacheFile;
      if (c.regions !== regions) continue;
      if (Date.now() - new Date(c.fetchedAt).getTime() <= maxAgeMs) return c;
      return null;
    } catch {
      continue;
    }
  }
  return null;
}

export function isConfigured(): boolean {
  return Boolean(process.env.THE_ODDS_API_KEY);
}

async function fetchRaw(league: ScanLeague, regions: string): Promise<CacheFile> {
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) throw new Error("THE_ODDS_API_KEY is not set");
  const resp = await axios.get<RawEvent[]>(`${BASE}/sports/${SPORT_KEY[league]}/odds`, {
    params: { regions, markets: "h2h", oddsFormat: "decimal", apiKey: key },
    timeout: 60_000,
    validateStatus: () => true,
  });
  const left = Number(resp.headers?.["x-requests-remaining"]);
  if (resp.status !== 200) {
    throw new Error(`the-odds-api: HTTP ${resp.status} for ${league}: ${JSON.stringify(resp.data).slice(0, 200)}`);
  }
  const file: CacheFile = {
    fetchedAt: new Date().toISOString(),
    regions,
    creditsLeft: Number.isFinite(left) ? left : null,
    data: resp.data,
  };
  const dir = cacheDir(league);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, `${file.fetchedAt.replace(/[:.]/g, "-")}.json`), JSON.stringify(file));
  return file;
}

function parseEvent(league: ScanLeague, ev: RawEvent, unmatched: Set<string>): BoardEvent {
  const threeWay: Record<string, PriceTrio> = {};
  const twoWay: Record<string, TwoWay> = {};
  let updatedAt: string | null = null;
  for (const b of ev.bookmakers) {
    const m = b.markets.find((x) => x.key === "h2h");
    if (!m) continue;
    const home = m.outcomes.find((o) => o.name === ev.home_team)?.price;
    const away = m.outcomes.find((o) => o.name === ev.away_team)?.price;
    const draw = m.outcomes.find((o) => o.name === "Draw")?.price;
    if (!(home && away && home > 1 && away > 1)) continue;
    if (draw && draw > 1) threeWay[b.key] = { home, draw, away };
    else twoWay[b.key] = { home, away };
    if (!updatedAt || b.last_update > updatedAt) updatedAt = b.last_update;
  }
  const home = resolveScanAbbr(league, ev.home_team);
  const away = resolveScanAbbr(league, ev.away_team);
  if (!home) unmatched.add(ev.home_team);
  if (!away) unmatched.add(ev.away_team);
  return {
    id: ev.id,
    league,
    commence: ev.commence_time,
    homeName: ev.home_team,
    awayName: ev.away_team,
    home,
    away,
    threeWay,
    twoWay,
    updatedAt,
  };
}

export interface BoardOptions {
  /** Reuse a cached response younger than this (default 30 minutes). */
  maxAgeMinutes?: number;
  regions?: string;
  /** Never call the API; return the latest cache of any age, or null. */
  offline?: boolean;
}

/** Every unstarted event of the league with each book's line. */
export async function fetchLiveBoard(league: ScanLeague, opts: BoardOptions = {}): Promise<Board | null> {
  const regions = opts.regions ?? DEFAULT_REGIONS;
  const maxAge = opts.offline ? Infinity : (opts.maxAgeMinutes ?? 30) * 60_000;
  let raw = latestCached(league, regions, maxAge);
  let cached = true;
  if (!raw) {
    if (opts.offline) return null;
    raw = await fetchRaw(league, regions);
    cached = false;
  }
  const unmatched = new Set<string>();
  const events = raw.data
    .map((ev) => parseEvent(league, ev, unmatched))
    .sort((a, b) => a.commence.localeCompare(b.commence));
  return {
    league,
    fetchedAt: raw.fetchedAt,
    cached,
    creditsLeft: raw.creditsLeft,
    events,
    unmatched: [...unmatched].sort(),
  };
}
