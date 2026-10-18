/**
 * football-data.co.uk: free per-season CSVs of results and bookmaker odds.
 *
 *   https://football-data.co.uk/mmz4281/<yy><yy+1>/E0.csv   (E0 = Premier League)
 *
 * Column notes (checked on the 2012-13 to 2026-27 files, October 2026):
 * - `Date` is dd/mm/yy up to 2014-15 and in 2016-17, dd/mm/yyyy otherwise;
 *   `Time` (UK local) exists from 2019-20.
 * - Pinnacle pre-match `PSH/PSD/PSA` and close `PSCH/PSCD/PSCA` exist from
 *   2012-13 until mid-January 2026, after which the site stopped carrying
 *   Pinnacle. The Betfair Exchange close `BFECH/BFECD/BFECA` (from 2019-20)
 *   stands in for it, and the market average close `AvgC*` after that.
 * - Market-wide `MaxH/AvgH` and closing `MaxCH/AvgCH` exist from 2019-20;
 *   older files have Betbrain `BbMxH/BbAvH` (pre-match only).
 * - Files start with a UTF-8 BOM, use CRLF, and may end with an empty row.
 *
 * The site redirects www. to the bare host, and rate-limits (HTTP 429 seen);
 * completed seasons are fetched once and kept under data/odds/.
 */
import axios from "axios";
import fs from "fs";
import { LeagueId } from "../utils/leagues";
import { OddsProvider, OddsRecord, PriceTrio, SharpBook, UnmatchedName } from "./types";
import { resolveAbbr } from "./aliases";
import { readOddsSeason, writeOddsSeason, seasonLabelFor } from "./store";

const BASE = "https://football-data.co.uk/mmz4281";
const DIVISION: Partial<Record<LeagueId, string>> = { epl: "E0" };
const USER_AGENT = "elo-predictor backtest (contact: jarl-erik.malmstrom@proton.me)";
const RETRY_DELAYS_MS = [30_000, 60_000, 120_000];

export function seasonCode(startYear: number): string {
  const yy = (y: number) => String(y % 100).padStart(2, "0");
  return `${yy(startYear)}${yy(startYear + 1)}`;
}

export function seasonUrl(league: LeagueId, startYear: number): string {
  const div = DIVISION[league];
  if (!div) throw new Error(`football-data: no division for ${league}`);
  return `${BASE}/${seasonCode(startYear)}/${div}.csv`;
}

// ---------------------------------------------------------------------------
// CSV
// ---------------------------------------------------------------------------

/** Split one CSV line, honouring double quotes. */
function splitLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quoted = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (quoted) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') quoted = false;
      else cur += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

export function parseCsv(text: string): Record<string, string>[] {
  const body = text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
  const lines = body.split(/\r?\n/);
  const header = splitLine(lines[0]).map((h) => h.trim());
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const cells = splitLine(lines[i]);
    const row: Record<string, string> = {};
    header.forEach((h, j) => {
      if (h) row[h] = (cells[j] ?? "").trim();
    });
    rows.push(row);
  }
  return rows;
}

/** "17/08/13" or "17/08/2013" plus an optional "15:00" (UK local). */
export function parseDate(date: string, time?: string): string | null {
  const m = date.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!m) return null;
  const dd = m[1].padStart(2, "0");
  const mm = m[2].padStart(2, "0");
  const yyyy = m[3].length === 2 ? `20${m[3]}` : m[3];
  // UK kickoffs never cross midnight in UTC (at most one hour apart), so
  // the UK clock time is kept as the UTC time; the join is by UTC day.
  const t = time && /^\d{1,2}:\d{2}$/.test(time) ? `${time.padStart(5, "0")}:00` : "12:00:00";
  return `${yyyy}-${mm}-${dd}T${t}Z`;
}

const num = (v: string | undefined): number | null => {
  if (v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 1 ? n : null;
};

function trio(row: Record<string, string>, h: string, d: string, a: string): PriceTrio | undefined {
  const home = num(row[h]);
  const draw = num(row[d]);
  const away = num(row[a]);
  if (home === null || draw === null || away === null) return undefined;
  return { home, draw, away };
}

/** Bookmaker column prefixes kept per row (pre-match, closing). */
const BOOKS: [string, string, string][] = [
  ["B365", "B365", "B365C"],
  ["BW", "BW", "BWC"],
  ["WH", "WH", "WHC"],
  ["1XB", "1XB", "1XBC"],
  ["BFE", "BFE", "BFEC"],
];

export function parseFootballDataCsv(
  text: string,
  league: LeagueId,
  startYear: number
): {
  records: OddsRecord[];
  unmatched: UnmatchedName[];
  skipped: { noResult: number; noSharp: number };
} {
  const rows = parseCsv(text);
  const records: OddsRecord[] = [];
  const unmatched: UnmatchedName[] = [];
  const skipped = { noResult: 0, noSharp: 0 };
  const season = seasonLabelFor(league, startYear);

  rows.forEach((row, i) => {
    if (!row.HomeTeam || !row.AwayTeam) return;
    const home = resolveAbbr(league, row.HomeTeam);
    const away = resolveAbbr(league, row.AwayTeam);
    if (!home || !away) {
      unmatched.push({ row: i + 2, home: row.HomeTeam, away: row.AwayTeam });
      return;
    }
    const date = parseDate(row.Date, row.Time);
    if (!date) return;
    const hg = Number(row.FTHG);
    const ag = Number(row.FTAG);
    if (row.FTHG === "" || row.FTAG === "" || !Number.isFinite(hg) || !Number.isFinite(ag)) {
      skipped.noResult++;
      return;
    }

    const pinnacleClose = trio(row, "PSCH", "PSCD", "PSCA");
    const betfairClose = trio(row, "BFECH", "BFECD", "BFECA");
    const avg = trio(row, "AvgCH", "AvgCD", "AvgCA");
    let sharp: PriceTrio | undefined;
    let sharpBook: SharpBook | undefined;
    if (pinnacleClose) [sharp, sharpBook] = [pinnacleClose, "pinnacle"];
    else if (betfairClose) [sharp, sharpBook] = [betfairClose, "betfair-exchange"];
    else if (avg) [sharp, sharpBook] = [avg, "avg"];
    if (!sharp || !sharpBook) {
      skipped.noSharp++;
      return;
    }

    const book: Record<string, PriceTrio> = {};
    for (const [key, pre, close] of BOOKS) {
      const p = trio(row, `${pre}H`, `${pre}D`, `${pre}A`);
      const c = trio(row, `${close}H`, `${close}D`, `${close}A`);
      if (p) book[key] = p;
      if (c) book[`${key}C`] = c;
    }
    const ps = trio(row, "PSH", "PSD", "PSA");
    if (ps) book.PS = ps;
    if (pinnacleClose) book.PSC = pinnacleClose;

    records.push({
      league,
      season,
      date,
      home,
      away,
      market: "fullTime",
      sharp,
      sharpBook,
      sharpOpen: ps ?? trio(row, "BFEH", "BFED", "BFEA"),
      avg,
      max: trio(row, "MaxCH", "MaxCD", "MaxCA"),
      avgOpen: trio(row, "AvgH", "AvgD", "AvgA") ?? trio(row, "BbAvH", "BbAvD", "BbAvA"),
      maxOpen: trio(row, "MaxH", "MaxD", "MaxA") ?? trio(row, "BbMxH", "BbMxD", "BbMxA"),
      book,
      result: { homeGoals: hg, awayGoals: ag },
      source: "football-data",
    });
  });
  return { records, unmatched, skipped };
}

// ---------------------------------------------------------------------------
// HTTP
// ---------------------------------------------------------------------------

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function downloadSeasonCsv(league: LeagueId, startYear: number): Promise<string> {
  const url = seasonUrl(league, startYear);
  let lastError: unknown;
  for (let attempt = 0; attempt <= RETRY_DELAYS_MS.length; attempt++) {
    try {
      const resp = await axios.get<string>(url, {
        headers: { "User-Agent": USER_AGENT, Accept: "text/csv" },
        timeout: 60_000,
        responseType: "text",
        maxRedirects: 3,
        validateStatus: () => true,
      });
      if (resp.status === 200 && typeof resp.data === "string") return resp.data;
      if (resp.status === 404) throw new Error(`football-data: ${url} not found`);
      lastError = new Error(`football-data: HTTP ${resp.status} for ${url}`);
      if (resp.status !== 429 && resp.status < 500) throw lastError;
      const retryAfter = Number(resp.headers?.["retry-after"]);
      const wait = Number.isFinite(retryAfter) && retryAfter > 0
        ? retryAfter * 1000
        : RETRY_DELAYS_MS[attempt] ?? 0;
      if (attempt < RETRY_DELAYS_MS.length) {
        console.warn(`football-data: HTTP ${resp.status}, retrying in ${wait / 1000}s`);
        await sleep(wait);
      }
    } catch (e) {
      if (e instanceof Error && e.message.includes("not found")) throw e;
      lastError = e;
      if (attempt < RETRY_DELAYS_MS.length) await sleep(RETRY_DELAYS_MS[attempt]);
    }
  }
  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

/** Start year of the season a date falls in (August kick-off). */
function currentStartYear(now = new Date()): number {
  return now.getUTCMonth() >= 6 ? now.getUTCFullYear() : now.getUTCFullYear() - 1;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export const footballDataProvider: OddsProvider = {
  id: "football-data",
  supports: (league) => league in DIVISION,
  async fetchSeason(league, startYear, opts = {}) {
    const season = seasonLabelFor(league, startYear);
    const cached = readOddsSeason(league, season);
    const stale =
      !cached ||
      opts.force ||
      (!cached.complete && Date.now() - new Date(cached.fetchedAt).getTime() > DAY_MS);
    if (cached && !stale) return { records: cached.records, unmatched: cached.unmatched };

    const text = await downloadSeasonCsv(league, startYear);
    const parsed = parseFootballDataCsv(text, league, startYear);
    const complete = startYear < currentStartYear() && parsed.records.length >= 380;
    writeOddsSeason(league, season, {
      source: "football-data",
      fetchedAt: new Date().toISOString(),
      startYear,
      complete,
      records: parsed.records,
      unmatched: parsed.unmatched,
      skipped: parsed.skipped,
    });
    return { records: parsed.records, unmatched: parsed.unmatched };
  },
};

/** Store a CSV downloaded by hand (when the site rate-limits). */
export function importSeasonFile(path: string, league: LeagueId, startYear: number) {
  const text = fs.readFileSync(path, "utf8");
  const parsed = parseFootballDataCsv(text, league, startYear);
  const season = seasonLabelFor(league, startYear);
  writeOddsSeason(league, season, {
    source: "football-data",
    fetchedAt: new Date().toISOString(),
    startYear,
    complete: startYear < currentStartYear() && parsed.records.length >= 380,
    records: parsed.records,
    unmatched: parsed.unmatched,
    skipped: parsed.skipped,
  });
  return parsed;
}
