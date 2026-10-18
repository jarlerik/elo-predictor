/**
 * OddsPapi client: live sharp (Pinnacle) prices for the bet forms and the
 * closing prices that give the ledger its CLV. Not a historical provider;
 * the market backtest uses football-data.co.uk (src/odds/footballData.ts).
 *
 * Configuration: ODDSPAPI_API_KEY (required), ODDSPAPI_BASE_URL (optional).
 * Without a key every call returns null and nothing is requested.
 *
 * Budget: the free tier is a monthly request allowance (250 at the time of
 * writing). Billable calls are counted in data/odds/oddspapi/budget.json;
 * above SOFT_LIMIT the client refuses unless `force`, so a stuck loop can
 * never burn the month. /v4/historical-odds is free per the docs and is
 * not counted.
 *
 * Verified against https://oddspapi.io/en/docs (October 2026):
 *   base URL, apiKey query parameter, /v4/tournaments, /v4/fixtures,
 *   /v4/odds, /v4/historical-odds, /v4/account, quota rules, soccer market
 *   101 "Full Time Result" (outcomes 101/102/103), EPL tournamentId 17,
 *   NHL tournamentId 234 and sportId 15, bookmaker slug "pinnacle".
 * Taken from the OddsPapi blog (oddspapi.io/blog/nhl-regulation-overtime-
 * markets): hockey market 153 "Regular Time Result" (153/154/155) and 151
 * "Winner (incl. overtime and penalties)" (151/152). Marked UNVERIFIED
 * below where the docs showed no example: Liiga and Champions League
 * tournament ids (discovered at runtime from /v4/tournaments and cached),
 * and the exact leaf shape of /v4/odds (handled tolerantly).
 */
import axios from "axios";
import fs from "fs";
import path from "path";
import { LiveSharpPrices, PriceTrio } from "./types";
import { OddsLeague, resolveOddspapiAbbr } from "./oddspapiAliases";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export const ENDPOINTS = {
  // https://oddspapi.io/en/docs : "https://api.oddspapi.io", apiKey as a query parameter
  baseUrl: process.env.ODDSPAPI_BASE_URL || "https://api.oddspapi.io",
  tournaments: "/v4/tournaments", // ?sportId=  (billable)
  fixtures: "/v4/fixtures", // ?tournamentId=&from=&to=  (billable)
  odds: "/v4/odds", // ?fixtureId=&bookmakers=  (billable)
  historicalOdds: "/v4/historical-odds", // ?fixtureId=&bookmakers=  (free)
  account: "/v4/account", // unmetered
} as const;

export const IDS = {
  sport: { soccer: 10, hockey: 15 },
  bookmaker: "pinnacle",
  /** Known tournament ids; null = discover from /v4/tournaments (cached). */
  tournament: {
    epl: 17, // docs example (get-fixtures): Liverpool v Man United, tournamentId 17
    nhl: 234, // oddspapi.io/sports/ice-hockey
    liiga: null as number | null, // UNVERIFIED: not listed on the public pages
    ucl: null as number | null, // UNVERIFIED
  },
  /** Slug fragments used to discover the unknown tournaments. */
  tournamentSlug: {
    liiga: ["liiga"], // UNVERIFIED: expected slug like "liiga" under category "finland"
    ucl: ["uefa-champions-league", "champions-league"], // UNVERIFIED
  },
  markets: {
    soccer1x2: { id: 101, home: 101, draw: 102, away: 103 },
    hockeyRegulation: { id: 153, home: 153, draw: 154, away: 155 },
    hockeyMoneyline: { id: 151, home: 151, away: 152 },
  },
} as const;

export const MONTHLY_LIMIT = 250;
export const SOFT_LIMIT = 200;

const LIVE_TTL_MS = 15 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const SOURCE = "Pinnacle (OddsPapi)";

export function isConfigured(): boolean {
  return Boolean(process.env.ODDSPAPI_API_KEY);
}

// ---------------------------------------------------------------------------
// Budget
// ---------------------------------------------------------------------------

export interface Budget {
  month: string;
  used: number;
  limit: number;
  softLimit: number;
}

const dataDir = () => path.join(process.cwd(), "data", "odds", "oddspapi");
const budgetPath = () => path.join(dataDir(), "budget.json");
const monthOf = (d = new Date()) => d.toISOString().slice(0, 7);

export function budget(): Budget {
  const month = monthOf();
  try {
    const raw = JSON.parse(fs.readFileSync(budgetPath(), "utf-8"));
    if (raw && raw.month === month && Number.isFinite(raw.used))
      return { month, used: raw.used, limit: MONTHLY_LIMIT, softLimit: SOFT_LIMIT };
  } catch {
    // no file yet
  }
  return { month, used: 0, limit: MONTHLY_LIMIT, softLimit: SOFT_LIMIT };
}

function spend(n = 1): void {
  const b = budget();
  fs.mkdirSync(dataDir(), { recursive: true });
  fs.writeFileSync(
    budgetPath(),
    JSON.stringify({ month: b.month, used: b.used + n }, null, 2) + "\n"
  );
}

export class BudgetExceeded extends Error {
  constructor(public readonly used: number) {
    super(`OddsPapi monthly budget reached (${used} requests used)`);
  }
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

async function call<T>(
  endpoint: string,
  params: Record<string, string | number>,
  opts: { billable: boolean; force?: boolean }
): Promise<T> {
  const key = process.env.ODDSPAPI_API_KEY;
  if (!key) throw new Error("ODDSPAPI_API_KEY is not set");
  if (opts.billable) {
    const b = budget();
    if (b.used >= MONTHLY_LIMIT || (b.used >= SOFT_LIMIT && !opts.force))
      throw new BudgetExceeded(b.used);
    spend(1);
  }
  const resp = await axios.get(`${ENDPOINTS.baseUrl}${endpoint}`, {
    params: { ...params, apiKey: key },
    headers: { Accept: "application/json", "User-Agent": "elo-predictor" },
    timeout: 30_000,
  });
  return resp.data as T;
}

// ---------------------------------------------------------------------------
// Tournaments (discovery for the leagues without a known id)
// ---------------------------------------------------------------------------

interface Tournament {
  tournamentId: number;
  tournamentSlug: string;
  tournamentName: string;
  categorySlug: string;
  categoryName: string;
}

const sportOf = (league: OddsLeague) =>
  league === "nhl" || league === "liiga" ? IDS.sport.hockey : IDS.sport.soccer;

async function tournamentIdFor(
  league: OddsLeague,
  force?: boolean
): Promise<number | null> {
  const known = IDS.tournament[league];
  if (known) return known;
  const sportId = sportOf(league);
  const file = path.join(dataDir(), `tournaments-${sportId}.json`);
  let list: Tournament[] | null = null;
  try {
    list = JSON.parse(fs.readFileSync(file, "utf-8")).tournaments;
  } catch {
    // not cached
  }
  if (!list) {
    list = await call<Tournament[]>(
      ENDPOINTS.tournaments,
      { sportId },
      { billable: true, force }
    );
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({ fetchedAt: new Date().toISOString(), tournaments: list }, null, 2) + "\n"
    );
  }
  const slugs = IDS.tournamentSlug[league as "liiga" | "ucl"] ?? [];
  const wantFinland = league === "liiga";
  const hit = list.find(
    (t) =>
      slugs.some((s) => t.tournamentSlug === s) ||
      (wantFinland &&
        t.categorySlug === "finland" &&
        slugs.some((s) => t.tournamentSlug.includes(s)))
  );
  return hit?.tournamentId ?? null;
}

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

interface Fixture {
  fixtureId: string;
  participant1Id: number;
  participant2Id: number;
  participant1Name: string;
  participant2Name: string;
  tournamentId: number;
  startTime: string;
  sportId: number;
}

const fixtureCache = new Map<string, { at: number; list: Fixture[] }>();
/** Names the alias table could not place, per league, for the report. */
export const unmatchedNames = new Map<OddsLeague, Set<string>>();

function noteUnmatched(league: OddsLeague, name: string) {
  let set = unmatchedNames.get(league);
  if (!set) {
    set = new Set();
    unmatchedNames.set(league, set);
  }
  set.add(name);
}

const isoDay = (t: number) => new Date(t).toISOString().slice(0, 10);

async function findFixture(
  league: OddsLeague,
  home: string,
  away: string,
  kickoff: string | null,
  force?: boolean
): Promise<Fixture | null> {
  const tournamentId = await tournamentIdFor(league, force);
  if (!tournamentId) return null;
  const centre = kickoff ? new Date(kickoff).getTime() : Date.now();
  // kickoff ±1 day; without a kickoff, from yesterday to three days ahead.
  const fromT = centre - DAY_MS;
  const toT = kickoff ? centre + DAY_MS : centre + 3 * DAY_MS;
  const from = `${isoDay(fromT)}T00:00:00Z`;
  const to = `${isoDay(toT)}T23:59:59Z`;
  const cacheKey = `${tournamentId}:${from}:${to}`;
  const hit = fixtureCache.get(cacheKey);
  let list: Fixture[];
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) list = hit.list;
  else {
    list = await call<Fixture[]>(
      ENDPOINTS.fixtures,
      { tournamentId, from, to },
      { billable: true, force }
    );
    if (!Array.isArray(list)) list = [];
    fixtureCache.set(cacheKey, { at: Date.now(), list });
  }
  const H = home.toUpperCase();
  const A = away.toUpperCase();
  let best: Fixture | null = null;
  for (const f of list) {
    const h = resolveOddspapiAbbr(league, f.participant1Name);
    const a = resolveOddspapiAbbr(league, f.participant2Name);
    if (!h) noteUnmatched(league, f.participant1Name);
    if (!a) noteUnmatched(league, f.participant2Name);
    if (h !== H || a !== A) continue;
    if (
      !best ||
      Math.abs(new Date(f.startTime).getTime() - centre) <
        Math.abs(new Date(best.startTime).getTime() - centre)
    )
      best = f;
  }
  return best;
}

// ---------------------------------------------------------------------------
// Price extraction (tolerant of the nesting variants the docs show)
// ---------------------------------------------------------------------------

type Any = Record<string, any>;

/** The outcome map of a market from a /v4/odds or /v4/historical-odds body. */
function outcomesOf(body: Any, marketId: number): Any | null {
  const books: Any =
    body?.bookmakerOdds ?? body?.bookmakers ?? body?.odds ?? null;
  const book: Any = books?.[IDS.bookmaker] ?? null;
  const markets: Any = book?.markets ?? book ?? null;
  const market: Any = markets?.[String(marketId)] ?? null;
  if (!market) return null;
  return market.outcomes ?? market;
}

/** Latest price of an outcome at or before `before` (any time when null). */
function priceOf(outcome: Any, before: number | null): number | null {
  if (!outcome) return null;
  // Live shape: {price} directly, or players -> "0" -> {price}.
  let leaf: Any = outcome;
  if (outcome.players) {
    leaf = outcome.players["0"] ?? Object.values(outcome.players)[0];
  }
  if (Array.isArray(leaf)) {
    // Historical shape: array of {createdAt, price, active}, newest first.
    let best: { t: number; price: number } | null = null;
    for (const e of leaf) {
      const t = new Date(e?.createdAt).getTime();
      const p = Number(e?.price);
      if (!Number.isFinite(t) || !(p > 1)) continue;
      if (before !== null && t > before) continue;
      if (!best || t > best.t) best = { t, price: p };
    }
    return best?.price ?? null;
  }
  const p = Number(leaf?.price);
  return p > 1 ? p : null;
}

function trioOf(
  body: Any,
  market: { id: number; home: number; draw?: number; away: number },
  before: number | null
): PriceTrio | null {
  const outcomes = outcomesOf(body, market.id);
  if (!outcomes) return null;
  const home = priceOf(outcomes[String(market.home)], before);
  const away = priceOf(outcomes[String(market.away)], before);
  if (home === null || away === null) return null;
  if (market.draw === undefined) return { home, away };
  const draw = priceOf(outcomes[String(market.draw)], before);
  if (draw === null) return null;
  return { home, draw, away };
}

const r2 = (x: number) => Math.round(x * 100) / 100;
const roundTrio = (t: PriceTrio): PriceTrio =>
  t.draw === undefined
    ? { home: r2(t.home), away: r2(t.away) }
    : { home: r2(t.home), draw: r2(t.draw), away: r2(t.away) };

function pricesFrom(
  league: OddsLeague,
  body: Any,
  before: number | null
): Omit<LiveSharpPrices, "fetchedAt" | "sharpSource"> | null {
  const hockey = league === "nhl" || league === "liiga";
  if (!hockey) {
    const trio = trioOf(body, IDS.markets.soccer1x2, before);
    return trio ? { sharpOdds: roundTrio(trio) } : null;
  }
  const reg = trioOf(body, IDS.markets.hockeyRegulation, before);
  const ml = trioOf(body, IDS.markets.hockeyMoneyline, before);
  if (!reg && !ml) return null;
  // The regulation 1X2 is the main market; fall back to the moneyline as
  // the two-way sharp list when the 3-way is not priced.
  const out: Omit<LiveSharpPrices, "fetchedAt" | "sharpSource"> = {
    sharpOdds: roundTrio(reg ?? ml!),
  };
  if (ml) out.moneyline = { home: r2(ml.home), away: r2(ml.away) };
  return out;
}

// ---------------------------------------------------------------------------
// Disk cache per game
// ---------------------------------------------------------------------------

interface GameFile {
  fixtureId: string | null;
  kickoff: string | null;
  live?: LiveSharpPrices | null;
  close?: LiveSharpPrices | null;
}

function gameFile(league: OddsLeague, home: string, away: string, kickoff: string | null) {
  const day = kickoff ? kickoff.slice(0, 10) : "undated";
  return path.join(dataDir(), league, `${day}_${home.toUpperCase()}_${away.toUpperCase()}.json`);
}

function readGame(file: string): GameFile | null {
  try {
    return JSON.parse(fs.readFileSync(file, "utf-8"));
  } catch {
    return null;
  }
}

function writeGame(file: string, g: GameFile) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, JSON.stringify(g, null, 2) + "\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export interface GameQuery {
  league: OddsLeague;
  home: string;
  away: string;
  /** ISO kickoff when known; narrows the fixture search to ±1 day. */
  kickoff: string | null;
  /** Spend past the soft limit. */
  force?: boolean;
}

const liveCache = new Map<string, { at: number; value: LiveSharpPrices | null }>();

/**
 * Pinnacle's current prices for an upcoming game, or null when the client
 * is not configured, the league/teams are unknown to the API, or the game
 * is not priced. Throws BudgetExceeded past the soft limit; any other
 * failure is logged and returns null.
 */
export async function fetchSharpOdds(
  q: GameQuery
): Promise<{ value: LiveSharpPrices | null; cached: boolean }> {
  if (!isConfigured()) return { value: null, cached: false };
  const key = `${q.league}:${q.home}:${q.away}:${q.kickoff ?? ""}`.toUpperCase();
  const hit = liveCache.get(key);
  if (hit && Date.now() - hit.at < LIVE_TTL_MS) return { value: hit.value, cached: true };
  try {
    const fixture = await findFixture(q.league, q.home, q.away, q.kickoff, q.force);
    if (!fixture) {
      liveCache.set(key, { at: Date.now(), value: null });
      return { value: null, cached: false };
    }
    const body = await call<Any>(
      ENDPOINTS.odds,
      { fixtureId: fixture.fixtureId, bookmakers: IDS.bookmaker },
      { billable: true, force: q.force }
    );
    const prices = pricesFrom(q.league, body, null);
    const value: LiveSharpPrices | null = prices
      ? { ...prices, sharpSource: SOURCE, fetchedAt: new Date().toISOString() }
      : null;
    liveCache.set(key, { at: Date.now(), value });
    const file = gameFile(q.league, q.home, q.away, fixture.startTime ?? q.kickoff);
    writeGame(file, { ...(readGame(file) ?? {}), fixtureId: fixture.fixtureId, kickoff: fixture.startTime ?? q.kickoff, live: value });
    return { value, cached: false };
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    console.error("oddspapi: live prices failed for", q.league, q.home, q.away, (e as Error).message);
    return { value: null, cached: false };
  }
}

/**
 * Pinnacle's last prices before kickoff, from the (free) price history.
 * Cached on disk for good once found, since a closing price never changes.
 * The fixture lookup still costs one billable request per game unless the
 * game's file already holds its fixtureId.
 */
export async function fetchClosingOdds(
  q: GameQuery
): Promise<{ value: LiveSharpPrices | null; cached: boolean }> {
  if (!isConfigured()) return { value: null, cached: false };
  if (!q.kickoff) return { value: null, cached: false };
  const file = gameFile(q.league, q.home, q.away, q.kickoff);
  const stored = readGame(file);
  if (stored?.close) return { value: stored.close, cached: true };
  try {
    let fixtureId = stored?.fixtureId ?? null;
    if (!fixtureId) {
      const fixture = await findFixture(q.league, q.home, q.away, q.kickoff, q.force);
      if (!fixture) return { value: null, cached: false };
      fixtureId = fixture.fixtureId;
      writeGame(file, { ...(stored ?? {}), fixtureId, kickoff: q.kickoff });
    }
    const body = await call<Any>(
      ENDPOINTS.historicalOdds,
      { fixtureId, bookmakers: IDS.bookmaker },
      { billable: false }
    );
    const before = new Date(q.kickoff).getTime();
    const prices = pricesFrom(q.league, body, before);
    const value: LiveSharpPrices | null = prices
      ? { ...prices, sharpSource: `${SOURCE} close`, fetchedAt: new Date().toISOString() }
      : null;
    if (value) writeGame(file, { ...(readGame(file) ?? { fixtureId, kickoff: q.kickoff }), fixtureId, kickoff: q.kickoff, close: value });
    return { value, cached: false };
  } catch (e) {
    if (e instanceof BudgetExceeded) throw e;
    console.error("oddspapi: closing prices failed for", q.league, q.home, q.away, (e as Error).message);
    return { value: null, cached: false };
  }
}

/** Account usage as the API sees it (unmetered call); null when not configured. */
export async function accountUsage(): Promise<{ limit: number; count: number } | null> {
  if (!isConfigured()) return null;
  try {
    const body = await call<Any>(ENDPOINTS.account, {}, { billable: false });
    const limit = Number(body?.request_limit);
    const count = Number(body?.request_count);
    if (Number.isFinite(limit) && Number.isFinite(count)) return { limit, count };
  } catch (e) {
    console.error("oddspapi: account lookup failed", (e as Error).message);
  }
  return null;
}
