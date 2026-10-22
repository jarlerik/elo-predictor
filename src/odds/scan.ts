/**
 * Morning scan: apply the outlier rule (src/odds/outliers.ts) to a live
 * board (src/odds/liveBoard.ts) for the books the bettor can use.
 *
 * Each game yields up to two markets: the three-way line (soccer 1X2, or
 * the hockey 60-minute 1X2 that Unibet and LeoVegas quote) and the hockey
 * two-way line (winner including overtime, the only hockey market
 * Veikkaus shows here). The consensus of each market is taken over the
 * books that are not candidates, so a Finnish book never confirms itself.
 *
 * Alongside the paper's figures every candidate carries the edge against
 * the de-vigged sharp price (Pinnacle when it quotes the market, else the
 * median of the other books), which is what the ledger's closing line
 * value is measured against.
 */
import { Board, BoardEvent, FI_BOOKS, ScanLeague } from "./liveBoard";
import { Lines, findOutliers, meanOddsConsensus, KAUNITZ_ALPHA } from "./outliers";
import { devig, overround, MARKET_SIDES } from "../utils/sharp";
import { OddsMarket, PriceTrio, TwoWay } from "./types";

export interface Candidate {
  league: ScanLeague;
  eventId: string;
  commence: string;
  home: string;
  away: string;
  market: OddsMarket;
  /** Team code (or provider name when unmapped) or "DRAW". */
  pick: string;
  side: "home" | "draw" | "away";
  book: string;
  odds: number;
  pCons: number;
  meanOdds: number;
  threshold: number;
  /** Eq. 5 expected value at α. */
  ev: number;
  consensusBooks: number;
  /** De-vigged probability of the pick at the sharp reference. */
  sharpFair: number | null;
  sharpSource: "pinnacle" | "consensus-median" | null;
  /** sharpFair × odds − 1. */
  sharpEdge: number | null;
  /** The candidate book's overround on this market (1.07 = 7 % margin). */
  bookOverround: number | null;
  /** The book's full line, for the bet form. */
  bookLine: Record<string, number>;
  /** Sharp line for the ledger (Pinnacle's, or the de-vigged median as odds). */
  sharpLine: Record<string, number> | null;
}

export interface GameSummary {
  league: ScanLeague;
  eventId: string;
  commence: string;
  home: string;
  away: string;
  mapped: boolean;
  threeWayBooks: number;
  twoWayBooks: number;
  /** Consensus p (Eq. 1) of the three-way market, or null. */
  pThree: { home: number; draw: number; away: number } | null;
  pTwo: { home: number; away: number } | null;
  pinnacle: Record<string, number> | null;
  /** Each candidate book's lines, keyed by book then market. */
  books: Record<string, Partial<Record<OddsMarket, Record<string, number>>>>;
  /** Best Eq. 5 value among the candidate books, or null when none clears α. */
  best: Candidate | null;
}

export interface ScanOptions {
  alpha?: number;
  /** Books that may be bet; default the Finnish ones. */
  books?: readonly string[];
  /** Keep games starting within this many hours of `now`. */
  hours?: number;
  now?: number;
}

export interface LeagueScan {
  league: ScanLeague;
  fetchedAt: string;
  cached: boolean;
  creditsLeft: number | null;
  alpha: number;
  books: string[];
  games: GameSummary[];
  candidates: Candidate[];
  unmatched: string[];
}

/** Provider trios as plain side → odds maps for the rule functions. */
const toLines = (lines: Record<string, PriceTrio | TwoWay>): Lines =>
  Object.fromEntries(Object.entries(lines).map(([book, o]) => [book, { ...o } as Record<string, number>]));

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/** De-vigged median of the non-candidate books, as a probability per side. */
function medianFair(lines: Lines, sides: string[], exclude: Set<string>): Record<string, number> | null {
  const probs: Record<string, number>[] = [];
  for (const [book, o] of Object.entries(lines)) {
    if (exclude.has(book)) continue;
    const p = devig(o, sides);
    if (p) probs.push(p);
  }
  if (probs.length < 3) return null;
  const raw: Record<string, number> = {};
  for (const s of sides) raw[s] = median(probs.map((p) => p[s]));
  const t = sides.reduce((sum, s) => sum + raw[s], 0);
  for (const s of sides) raw[s] /= t;
  return raw;
}

function scanMarket(
  ev: BoardEvent,
  market: OddsMarket,
  lines: Lines,
  opts: Required<Pick<ScanOptions, "alpha" | "books">>
): Candidate[] {
  const sides = MARKET_SIDES[market];
  const candidates = new Set(opts.books);
  const hits = findOutliers(lines, sides, { alpha: opts.alpha, candidates });
  if (!hits.length) return [];
  const pin = lines.pinnacle && !candidates.has("pinnacle") ? devig(lines.pinnacle, sides) : null;
  const fair = pin ?? medianFair(lines, sides, candidates);
  const sharpSource: Candidate["sharpSource"] = pin ? "pinnacle" : fair ? "consensus-median" : null;
  const sharpLine = pin
    ? lines.pinnacle
    : fair
      ? Object.fromEntries(sides.map((s) => [s, Math.round((1 / fair[s]) * 1000) / 1000]))
      : null;
  const home = ev.home ?? ev.homeName;
  const away = ev.away ?? ev.awayName;
  return hits.map((h) => {
    const side = h.side as Candidate["side"];
    const p = fair ? fair[side] : null;
    return {
      league: ev.league,
      eventId: ev.id,
      commence: ev.commence,
      home,
      away,
      market,
      pick: side === "draw" ? "DRAW" : side === "home" ? home : away,
      side,
      book: h.book,
      odds: h.odds,
      pCons: h.pCons,
      meanOdds: h.meanOdds,
      threshold: h.threshold,
      ev: h.ev,
      consensusBooks: h.consensusBooks,
      sharpFair: p,
      sharpSource,
      sharpEdge: p == null ? null : p * h.odds - 1,
      bookOverround: overround(lines[h.book], sides),
      bookLine: lines[h.book],
      sharpLine,
    };
  });
}

export function scanBoard(board: Board, opts: ScanOptions = {}): LeagueScan {
  const alpha = opts.alpha ?? KAUNITZ_ALPHA;
  const books = [...(opts.books ?? FI_BOOKS)];
  const now = opts.now ?? Date.now();
  const horizon = now + (opts.hours ?? 36) * 3_600_000;
  const candidateSet = new Set(books);
  const games: GameSummary[] = [];
  const candidates: Candidate[] = [];

  for (const ev of board.events) {
    const t = new Date(ev.commence).getTime();
    if (!Number.isFinite(t) || t < now || t > horizon) continue;
    const three = toLines(ev.threeWay);
    const two = toLines(ev.twoWay);
    const soccer = ev.league === "epl" || ev.league === "ucl";
    const threeMarket: OddsMarket = soccer ? "fullTime" : "regulation";

    const found: Candidate[] = [
      ...scanMarket(ev, threeMarket, three, { alpha, books }),
      ...(soccer ? [] : scanMarket(ev, "moneyline", two, { alpha, books })),
    ];
    candidates.push(...found);

    const cThree = meanOddsConsensus(three, MARKET_SIDES[threeMarket], candidateSet);
    const cTwo = soccer ? null : meanOddsConsensus(two, MARKET_SIDES.moneyline, candidateSet);
    const bookLines: GameSummary["books"] = {};
    for (const b of books) {
      const entry: Partial<Record<OddsMarket, Record<string, number>>> = {};
      if (three[b]) entry[threeMarket] = three[b];
      if (!soccer && two[b]) entry.moneyline = two[b];
      if (Object.keys(entry).length) bookLines[b] = entry;
    }
    games.push({
      league: ev.league,
      eventId: ev.id,
      commence: ev.commence,
      home: ev.home ?? ev.homeName,
      away: ev.away ?? ev.awayName,
      mapped: Boolean(ev.home && ev.away),
      threeWayBooks: Object.keys(three).length,
      twoWayBooks: Object.keys(two).length,
      pThree: cThree ? { home: cThree.p.home, draw: cThree.p.draw, away: cThree.p.away } : null,
      pTwo: cTwo ? { home: cTwo.p.home, away: cTwo.p.away } : null,
      pinnacle: three.pinnacle ?? two.pinnacle ?? null,
      books: bookLines,
      best: found.length ? found.reduce((a, b) => (b.ev > a.ev ? b : a)) : null,
    });
  }
  candidates.sort((a, b) => b.ev - a.ev);
  return {
    league: board.league,
    fetchedAt: board.fetchedAt,
    cached: board.cached,
    creditsLeft: board.creditsLeft,
    alpha,
    books,
    games,
    candidates,
    unmatched: board.unmatched,
  };
}
