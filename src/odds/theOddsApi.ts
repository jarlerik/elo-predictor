/**
 * The Odds API (the-odds-api.com): historical bookmaker prices for the
 * hockey leagues and the NBA, which football-data does not cover.
 *
 * One call per game day at ten minutes before the day's first puck drop:
 *
 *   GET /v4/historical/sports/{sport}/odds?regions=eu&markets=h2h&date=<ISO>
 *
 * returns every event not yet started at that snapshot with each
 * bookmaker's head-to-head prices. 10 credits per call (per market and
 * region), so a season is 1,500–1,800 credits and the $30 plan's 20,000
 * cover several. The three-way market key is only served per event at the
 * same price per game, but the European books' h2h lines already carry the
 * Draw, so one snapshot gives both markets:
 *
 * - `moneyline` (winner incl. OT/SO): Pinnacle's two-way price is the sharp
 *   reference; average and best across the two-way books alongside.
 * - `regulation` (60-minute 1X2, the app's main hockey market): Pinnacle
 *   does not price it here, so the sharp reference is the median of the
 *   three-way books' de-vigged probabilities (`sharpBook: "consensus"`),
 *   with the average and best closing price across those books.
 *
 * Basketball has no draw, so an NBA record's own market is the two-way
 * `moneyline` with Pinnacle as the sharp price (the books' average when
 * Pinnacle is absent) and no `regulation` trio.
 *
 * Checked live on 2026-10-18: NHL archive from the 2020 restart, Liiga from
 * March 2025; Pinnacle present on both; 6–13 books carry the Draw on an NHL
 * day, 10 on a Liiga day. Team names: "St Louis Blues", "Montréal
 * Canadiens", "Utah Mammoth"; Liiga uses the short club names ("Ilves",
 * "Kärpät"); the NBA uses the full club names with "LA Clippers" (live
 * board, 2026-10-23; the archive start is the provider's June 2020 one and
 * is UNVERIFIED for the NBA). Raw snapshots are kept under data/odds/raw/
 * (ignored) so a rerun costs nothing.
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { LeagueId, LEAGUES, NBA_TEAM_NAMES } from "../utils/leagues";
import { NHL_TEAM_NAMES } from "../utils/teamData";
import { OddsProvider, OddsRecord, PriceTrio, TwoWay, UnmatchedName } from "./types";
import { resolveAbbr } from "./aliases";
import { resolveOddspapiAbbr } from "./oddspapiAliases";
import { readOddsSeason, writeOddsSeason, seasonLabelFor } from "./store";
import { readGameSeason, currentStartYear } from "../data/gameStore";
import { GameRecord } from "../utils/types";

const BASE = "https://api.the-odds-api.com/v4";
const SPORT: Partial<Record<LeagueId, string>> = { nhl: "icehockey_nhl", liiga: "icehockey_liiga", nba: "basketball_nba" };
const REGIONS = "eu";
const MARKETS = "h2h";
const SNAPSHOT_LEAD_MS = 10 * 60 * 1000;
/** First day with data per league (checked 2026-10-18); earlier days are skipped unpaid. */
const ARCHIVE_START: Partial<Record<LeagueId, string>> = { nhl: "2020-07-01", liiga: "2025-03-01", nba: "2020-07-01" };
/** Stop before the month's credits are gone; live checks need some too. */
const CREDIT_FLOOR = 300;
const SHARP = "pinnacle";

export function isConfigured(): boolean {
  return !!process.env.THE_ODDS_API_KEY;
}

// ---------------------------------------------------------------------------
// Team names
// ---------------------------------------------------------------------------

const fold = (s: string) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[.’']/g, "")
    .toLowerCase()
    .trim();

const NHL_BY_NAME = new Map<string, string>();
for (const [abbr, name] of Object.entries(NHL_TEAM_NAMES)) NHL_BY_NAME.set(fold(name), abbr);
for (const [name, abbr] of Object.entries({
  "Arizona Coyotes": "ARI",
  "Utah Hockey Club": "UTA",
  "St Louis Blues": "STL",
  "Montreal Canadiens": "MTL",
})) NHL_BY_NAME.set(fold(name), abbr);

const NBA_BY_NAME = new Map<string, string>();
for (const [abbr, name] of Object.entries(NBA_TEAM_NAMES)) NBA_BY_NAME.set(fold(name), abbr);
for (const [name, abbr] of Object.entries({
  "Los Angeles Clippers": "LAC",
  "L.A. Clippers": "LAC",
  "L.A. Lakers": "LAL",
})) NBA_BY_NAME.set(fold(name), abbr);

export function resolveTheOddsApiAbbr(league: LeagueId, name: string): string | null {
  if (league === "nhl") return NHL_BY_NAME.get(fold(name)) ?? null;
  if (league === "nba") return NBA_BY_NAME.get(fold(name)) ?? null;
  if (league === "liiga") return resolveAbbr(league, name) ?? resolveOddspapiAbbr("liiga", name);
  return resolveAbbr(league, name);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------

interface Outcome {
  name: string;
  price: number;
}
interface Snapshot {
  timestamp: string;
  data: {
    id: string;
    commence_time: string;
    home_team: string;
    away_team: string;
    bookmakers: { key: string; last_update: string; markets: { key: string; outcomes: Outcome[] }[] }[];
  }[];
}

function rawDir(league: LeagueId, season: string): string {
  return path.join(process.cwd(), "data", "odds", "raw", "the-odds-api", league, season);
}

let remaining: number | null = null;
export const creditsRemaining = () => remaining;

async function snapshotAt(league: LeagueId, season: string, day: string, at: string): Promise<Snapshot> {
  const dir = rawDir(league, season);
  const file = path.join(dir, `${day}.json`);
  if (fs.existsSync(file)) return JSON.parse(fs.readFileSync(file, "utf8")) as Snapshot;
  const key = process.env.THE_ODDS_API_KEY;
  if (!key) throw new Error("THE_ODDS_API_KEY is not set");
  if (remaining !== null && remaining < CREDIT_FLOOR) {
    throw new Error(`the-odds-api: only ${remaining} credits left this month; stopping (floor ${CREDIT_FLOOR})`);
  }
  // A timed-out or 5xx call is retried a few times; a 4xx is not (it is
  // not charged and will not change).
  let lastError: unknown;
  for (let attempt = 0; attempt < 4; attempt++) {
    if (attempt) await new Promise((r) => setTimeout(r, 5_000 * attempt));
    try {
      const resp = await axios.get<Snapshot>(`${BASE}/historical/sports/${SPORT[league]}/odds`, {
        params: { regions: REGIONS, markets: MARKETS, date: at, apiKey: key },
        timeout: 60_000,
        validateStatus: () => true,
      });
      const left = Number(resp.headers?.["x-requests-remaining"]);
      if (Number.isFinite(left)) remaining = left;
      if (resp.status >= 500 || resp.status === 429) {
        lastError = new Error(`the-odds-api: HTTP ${resp.status} for ${day}`);
        continue;
      }
      if (resp.status !== 200) {
        throw new Error(`the-odds-api: HTTP ${resp.status} for ${day}: ${JSON.stringify(resp.data).slice(0, 200)}`);
      }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(resp.data));
      return resp.data;
    } catch (e) {
      if (!axios.isAxiosError(e)) throw e;
      lastError = e;
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

// ---------------------------------------------------------------------------
// Parsing one event into an OddsRecord
// ---------------------------------------------------------------------------

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};
const round3 = (v: number) => Math.round(v * 1000) / 1000;

function eventRecord(
  league: LeagueId,
  season: string,
  game: GameRecord,
  ev: Snapshot["data"][number]
): OddsRecord | null {
  const threeWay: Record<string, PriceTrio> = {};
  const twoWay: Record<string, TwoWay> = {};
  for (const b of ev.bookmakers) {
    const m = b.markets.find((x) => x.key === "h2h");
    if (!m) continue;
    const home = m.outcomes.find((o) => o.name === ev.home_team)?.price;
    const away = m.outcomes.find((o) => o.name === ev.away_team)?.price;
    const draw = m.outcomes.find((o) => o.name === "Draw")?.price;
    if (!(home && away && home > 1 && away > 1)) continue;
    if (draw && draw > 1) threeWay[b.key] = { home, draw, away };
    else twoWay[b.key] = { home, away };
  }
  const three = Object.values(threeWay);
  const two = Object.values(twoWay);

  if (LEAGUES[league].sport === "basketball") {
    // No draw line: the record's own market is the two-way winner incl.
    // overtime. Pinnacle is the sharp price; without it, the books' mean
    // probability as odds.
    if (!two.length) return null;
    const pin = twoWay[SHARP];
    const sharp: TwoWay = pin ?? {
      home: round3(two.length / two.reduce((s, x) => s + 1 / x.home, 0)),
      away: round3(two.length / two.reduce((s, x) => s + 1 / x.away, 0)),
    };
    return {
      league,
      season,
      date: game.date,
      home: game.homeAbbr,
      away: game.awayAbbr,
      market: "moneyline",
      sharp,
      sharpBook: pin ? "pinnacle" : "avg",
      avg: {
        home: round3(two.reduce((s, x) => s + x.home, 0) / two.length),
        away: round3(two.reduce((s, x) => s + x.away, 0) / two.length),
      },
      max: { home: Math.max(...two.map((x) => x.home)), away: Math.max(...two.map((x) => x.away)) },
      book: twoWay,
      result: { homeGoals: game.homeGoals, awayGoals: game.awayGoals },
      snapshotAt: ev.bookmakers[0]?.last_update,
      source: "the-odds-api",
    };
  }

  if (!three.length && !twoWay[SHARP]) return null;

  // Consensus: median de-vigged probability per side, renormalised.
  let sharp: PriceTrio | null = null;
  let avg: PriceTrio | undefined;
  let max: PriceTrio | undefined;
  if (three.length) {
    const probs = three.map((t) => {
      const s = 1 / t.home + 1 / t.draw! + 1 / t.away;
      return [1 / t.home / s, 1 / t.draw! / s, 1 / t.away / s];
    });
    const p = [0, 1, 2].map((i) => median(probs.map((q) => q[i])));
    const t = p[0] + p[1] + p[2];
    sharp = { home: round3(t / p[0]), draw: round3(t / p[1]), away: round3(t / p[2]) };
    const mean = (f: (x: PriceTrio) => number) => round3(three.reduce((s, x) => s + f(x), 0) / three.length);
    avg = { home: mean((x) => x.home), draw: mean((x) => x.draw!), away: mean((x) => x.away) };
    max = {
      home: Math.max(...three.map((x) => x.home)),
      draw: Math.max(...three.map((x) => x.draw!)),
      away: Math.max(...three.map((x) => x.away)),
    };
  }

  let moneyline: OddsRecord["moneyline"];
  if (two.length) {
    const pin = twoWay[SHARP];
    const mlSharp = pin ?? {
      home: round3(two.length / two.reduce((s, x) => s + 1 / x.home, 0)),
      away: round3(two.length / two.reduce((s, x) => s + 1 / x.away, 0)),
    };
    moneyline = {
      sharp: mlSharp,
      sharpBook: pin ? "pinnacle" : "avg",
      avg: {
        home: round3(two.reduce((s, x) => s + x.home, 0) / two.length),
        away: round3(two.reduce((s, x) => s + x.away, 0) / two.length),
      },
      max: { home: Math.max(...two.map((x) => x.home)), away: Math.max(...two.map((x) => x.away)) },
      book: twoWay,
    };
  }

  if (!sharp) {
    // No three-way book on this game: keep the moneyline only, with a
    // regulation trio derived nowhere. Callers treat `sharp` as required,
    // so skip the record rather than invent a draw price.
    return null;
  }
  return {
    league,
    season,
    date: game.date,
    home: game.homeAbbr,
    away: game.awayAbbr,
    market: "regulation",
    sharp,
    sharpBook: "consensus",
    avg,
    max,
    book: threeWay,
    moneyline,
    result: { homeGoals: game.homeGoals, awayGoals: game.awayGoals },
    snapshotAt: ev.bookmakers[0]?.last_update,
    source: "the-odds-api",
  };
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

const utcDay = (iso: string) => iso.slice(0, 10);

export const theOddsApiProvider: OddsProvider = {
  id: "the-odds-api",
  supports: (league) => league in SPORT,
  async fetchSeason(league, startYear, opts = {}) {
    const season = seasonLabelFor(league, startYear);
    const cached = readOddsSeason(league, season);
    const stale = !cached || opts.force || (!cached.complete && Date.now() - new Date(cached.fetchedAt).getTime() > 86_400_000);
    if (cached && !stale) return { records: cached.records, unmatched: cached.unmatched };

    const games = readGameSeason(league, season);
    if (!games) throw new Error(`no stored games for ${league} ${season}; run npm run games:fetch -- ${league} ${startYear}`);
    const byDay = new Map<string, GameRecord[]>();
    for (const g of games.games) {
      const d = utcDay(g.date);
      const list = byDay.get(d);
      if (list) list.push(g);
      else byDay.set(d, [g]);
    }

    const records: OddsRecord[] = [...(cached?.records ?? [])];
    const have = new Set(records.map((r) => `${utcDay(r.date)}|${r.home}|${r.away}`));
    const unmatched: UnmatchedName[] = [];
    const seenUnmatched = new Set<string>();
    let days = 0;
    let noOdds = 0;
    let skippedDays = 0;
    for (const [day, list] of [...byDay].sort()) {
      if (list.every((g) => have.has(`${day}|${g.homeAbbr}|${g.awayAbbr}`))) continue;
      const start = ARCHIVE_START[league];
      if (start && day < start) {
        skippedDays++;
        continue;
      }
      const first = Math.min(...list.map((g) => new Date(g.date).getTime()));
      const at = new Date(first - SNAPSHOT_LEAD_MS).toISOString().replace(/\.\d{3}Z$/, "Z");
      const snap = await snapshotAt(league, season, day, at);
      days++;
      const events = new Map<string, Snapshot["data"][number]>();
      for (const ev of snap.data) {
        const h = resolveTheOddsApiAbbr(league, ev.home_team);
        const a = resolveTheOddsApiAbbr(league, ev.away_team);
        if (!h || !a) {
          const k = `${ev.home_team}|${ev.away_team}`;
          if (!seenUnmatched.has(k)) {
            seenUnmatched.add(k);
            unmatched.push({ row: 0, home: ev.home_team, away: ev.away_team });
          }
          continue;
        }
        events.set(`${h}|${a}`, ev);
      }
      for (const g of list) {
        if (have.has(`${day}|${g.homeAbbr}|${g.awayAbbr}`)) continue;
        const ev = events.get(`${g.homeAbbr}|${g.awayAbbr}`);
        const rec = ev ? eventRecord(league, season, g, ev) : null;
        if (rec) {
          records.push(rec);
          have.add(`${day}|${g.homeAbbr}|${g.awayAbbr}`);
        } else noOdds++;
      }
    }
    records.sort((a, b) => a.date.localeCompare(b.date));
    const complete = startYear < currentStartYear(league) && games.complete;
    writeOddsSeason(league, season, {
      source: "the-odds-api",
      fetchedAt: new Date().toISOString(),
      startYear,
      complete,
      records,
      unmatched,
      skipped: { noResult: 0, noSharp: noOdds },
    });
    if (days || skippedDays)
      console.log(
        `  the-odds-api: ${days} snapshots fetched${skippedDays ? `, ${skippedDays} days before the archive start skipped` : ""}, ${remaining ?? "?"} credits left`
      );
    return { records, unmatched };
  },
};
