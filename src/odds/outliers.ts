/**
 * The outlier rule of Kaunitz, Zhong & Kreiner (2017), "Beating the
 * bookies with their own numbers" (arXiv:1710.02824): the bookmakers'
 * average price is an accurate probability, so bet wherever one bookmaker
 * stands clearly above the average.
 *
 *   p_cons = 1 / mean(odds across bookmakers)                      (Eq. 1)
 *   p_real ≈ p_cons − α                                             (Eq. 4)
 *   bet when   odds > 1 / (p_cons − α),   α = 0.05                  (Eq. 7)
 *
 * The paper fitted α on 479,440 football games (home 0.034, draw 0.057,
 * away 0.037, so the mean odds overstate the probability by about the
 * margin) and used 0.05 for every side as the trade-off between expected
 * value and the number of bets. It is a soccer 1X2 figure; the hockey
 * two-way market has a smaller overround and needs its own value, which
 * `npm run backtest:outliers` sweeps on the stored history.
 *
 * Pure functions; no I/O. `lines` is the price of every bookmaker that
 * quotes the market, keyed by bookmaker, with the sides as keys.
 */

export const KAUNITZ_ALPHA = 0.05;

export type Lines = Record<string, Record<string, number>>;

export interface Consensus {
  /** p_cons per side (Eq. 1); sums to more than one, as the paper's does. */
  p: Record<string, number>;
  /** Mean odds per side. */
  meanOdds: Record<string, number>;
  /** Books that priced every side and went into the mean. */
  books: string[];
}

/**
 * Consensus probability per side from the mean odds (Eq. 1), over the
 * books not in `exclude`. Null with fewer than `minBooks` books, as in the
 * paper (three).
 */
export function meanOddsConsensus(
  lines: Lines,
  sides: string[],
  exclude: Iterable<string> = [],
  minBooks = 3
): Consensus | null {
  const skip = new Set(exclude);
  const books = Object.entries(lines)
    .filter(([book, o]) => !skip.has(book) && sides.every((s) => typeof o[s] === "number" && o[s] > 1))
    .map(([book]) => book);
  if (books.length < minBooks) return null;
  const meanOdds: Record<string, number> = {};
  const p: Record<string, number> = {};
  for (const s of sides) {
    meanOdds[s] = books.reduce((sum, b) => sum + lines[b][s], 0) / books.length;
    p[s] = 1 / meanOdds[s];
  }
  return { p, meanOdds, books };
}

/** Odds a bookmaker must beat for a side (Eq. 7); Infinity when p_cons ≤ α. */
export function kaunitzThreshold(pCons: number, alpha = KAUNITZ_ALPHA): number {
  return pCons > alpha ? 1 / (pCons - alpha) : Infinity;
}

/** Expected return of one unit at `odds` under p_real = p_cons − α (Eq. 5). */
export function kaunitzEv(odds: number, pCons: number, alpha = KAUNITZ_ALPHA): number {
  return odds * (pCons - alpha) - 1;
}

export interface Outlier {
  book: string;
  side: string;
  odds: number;
  pCons: number;
  meanOdds: number;
  /** Odds the book had to beat at this α. */
  threshold: number;
  /** Eq. 5 expected value per unit staked. */
  ev: number;
  /** Books behind the consensus. */
  consensusBooks: number;
}

/**
 * Every (book, side) whose price clears the threshold. `candidates` limits
 * the books that may be bet (the ones the bettor has an account with);
 * the consensus is taken over the other books, so a candidate never
 * confirms itself. With `candidates` unset every book is a candidate and
 * the consensus is over all of them, as in the paper.
 */
export function findOutliers(
  lines: Lines,
  sides: string[],
  opts: { alpha?: number; candidates?: Iterable<string> | null; minBooks?: number } = {}
): Outlier[] {
  const alpha = opts.alpha ?? KAUNITZ_ALPHA;
  const candidates = opts.candidates ? new Set(opts.candidates) : null;
  const cons = meanOddsConsensus(lines, sides, candidates ?? [], opts.minBooks);
  if (!cons) return [];
  const out: Outlier[] = [];
  for (const [book, o] of Object.entries(lines)) {
    if (candidates && !candidates.has(book)) continue;
    for (const side of sides) {
      const odds = o[side];
      if (!(typeof odds === "number" && odds > 1)) continue;
      const threshold = kaunitzThreshold(cons.p[side], alpha);
      if (odds > threshold) {
        out.push({
          book,
          side,
          odds,
          pCons: cons.p[side],
          meanOdds: cons.meanOdds[side],
          threshold,
          ev: kaunitzEv(odds, cons.p[side], alpha),
          consensusBooks: cons.books.length,
        });
      }
    }
  }
  return out.sort((a, b) => b.ev - a.ev);
}

/** Best price per side across `lines`, with the book that offers it. */
export function bestPrices(lines: Lines, sides: string[]): Record<string, { odds: number; book: string } | null> {
  const out: Record<string, { odds: number; book: string } | null> = {};
  for (const s of sides) {
    let best: { odds: number; book: string } | null = null;
    for (const [book, o] of Object.entries(lines)) {
      const odds = o[s];
      if (typeof odds === "number" && odds > 1 && (!best || odds > best.odds)) best = { odds, book };
    }
    out[s] = best;
  }
  return out;
}
