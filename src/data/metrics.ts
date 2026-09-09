/**
 * Betting-performance metrics computed from ledger rows (section B of
 * docs/METRICS_AND_DASHBOARD.md). Pure functions: nothing here touches disk.
 *
 * Conventions:
 * - "settled" means result is win or loss. Void lines return the stake and
 *   are left out of turnover, profit and expectation; they are only counted.
 * - Profit is return − stake. Expected profit uses the model probability at
 *   bet time: stake × (p × odds − 1).
 * - Market-expected profit needs the bookmaker's full price list for the
 *   market so the overround can be removed. It is reported on that subset
 *   only, next to the actual and model-expected profit of the same subset.
 */
import { LedgerLeague, LedgerMarket, LedgerRow, round2 } from "./ledger";

/** Settled bets below this count are shown muted on the dashboard. */
export const MIN_SAMPLE = 30;

export interface SeriesPoint {
  id: string;
  /** Settlement time; migrated rows share one timestamp. */
  at: string | null;
  /** Cumulative actual profit after this bet. */
  actual: number;
  /** Cumulative model-expected profit after this bet. */
  expected: number;
  /** ±1σ of cumulative profit under the model's probabilities. */
  sigma: number;
}

export interface Summary {
  counts: { settled: number; pending: number; voided: number; wins: number };
  turnover: number;
  profit: number;
  /** profit / turnover, null with no turnover. */
  yield: number | null;
  expectedProfit: number;
  expectedYield: number | null;
  hitRate: number | null;
  expectedHitRate: number | null;
  /** (profit − expected) / σ, null when σ is 0. */
  zScore: number | null;
  sigma: number;
  /**
   * Bets whose bookmaker prices cover the whole market. `expectedProfit`
   * is what the de-vigged book price implied; `actual` and `modelExpected`
   * are the same bets' realised and model-expected profit.
   */
  market: {
    sample: number;
    turnover: number;
    actual: number;
    modelExpected: number;
    expectedProfit: number;
  };
  clv: {
    sample: number;
    /** Mean of oddsTaken / closingOdds − 1. */
    mean: number | null;
    /** Share of bets with oddsTaken > closingOdds. */
    beatCloseShare: number | null;
  };
  maxDrawdown: {
    amount: number;
    /** Series indexes of the peak and the trough. */
    from: number;
    to: number;
    percentOfBankroll: number | null;
  };
  pending: { stake: number; expectedProfit: number };
  /** Set from data/bankroll.json once step 6 of the plan is in. */
  bankroll: number | null;
  series: SeriesPoint[];
  minSample: number;
}

/** Which side of the market a row's pick is, for the 1X2 price lists. */
function pickSide(row: LedgerRow): "home" | "draw" | "away" | null {
  if (row.pick === "DRAW") return "draw";
  if (row.pick === row.game.home) return "home";
  if (row.pick === row.game.away) return "away";
  return null;
}

/**
 * Bookmaker's probability of the row's pick with the overround removed by
 * normalising 1/odds over the full market. Null when the row has no full
 * price list, or when its odds are the model's fair odds (flag oddsIsMinOdd).
 */
export function bookProbability(row: LedgerRow): number | null {
  if (!row.marketOdds || row.flags?.includes("oddsIsMinOdd")) return null;
  if (row.market === "correctScore") return null;
  const sides =
    row.market === "moneyline" ? ["home", "away"] : ["home", "draw", "away"];
  const side = pickSide(row);
  if (!side) return null;
  let total = 0;
  for (const s of sides) {
    const o = row.marketOdds[s];
    if (!(typeof o === "number" && o > 1)) return null;
    total += 1 / o;
  }
  const own = row.marketOdds[side];
  return own && own > 1 ? 1 / own / total : null;
}

const isSettled = (r: LedgerRow) =>
  !!r.settledAt && (r.result === "win" || r.result === "loss");

/** Settled rows in settlement order, ties broken by placement time and id. */
export function settledInOrder(rows: LedgerRow[]): LedgerRow[] {
  return rows.filter(isSettled).sort((a, b) => {
    const s = (a.settledAt ?? "").localeCompare(b.settledAt ?? "");
    if (s !== 0) return s;
    const p = (a.placedAt ?? "").localeCompare(b.placedAt ?? "");
    return p !== 0 ? p : a.id.localeCompare(b.id);
  });
}

const expectedOf = (r: LedgerRow) =>
  r.stake * (r.probability * r.oddsTaken - 1);
const varianceOf = (r: LedgerRow) =>
  r.stake * r.stake * r.probability * (1 - r.probability) * r.oddsTaken ** 2;

export function summarize(
  rows: LedgerRow[],
  bankroll: number | null = null
): Summary {
  const settled = settledInOrder(rows);
  const pendingRows = rows.filter((r) => !r.settledAt);
  const voided = rows.filter((r) => r.settledAt && r.result === "void").length;

  let turnover = 0;
  let profit = 0;
  let expected = 0;
  let variance = 0;
  let wins = 0;
  let probSum = 0;
  const market = {
    sample: 0,
    turnover: 0,
    actual: 0,
    modelExpected: 0,
    expectedProfit: 0,
  };
  const clvValues: number[] = [];
  const series: SeriesPoint[] = [];

  for (const r of settled) {
    const rowProfit = (r.return ?? 0) - r.stake;
    turnover += r.stake;
    profit += rowProfit;
    expected += expectedOf(r);
    variance += varianceOf(r);
    probSum += r.probability;
    if (r.result === "win") wins++;

    const pBook = bookProbability(r);
    if (pBook !== null) {
      market.sample++;
      market.turnover += r.stake;
      market.actual += rowProfit;
      market.modelExpected += expectedOf(r);
      market.expectedProfit += r.stake * (pBook * r.oddsTaken - 1);
    }
    if (r.closingOdds && r.closingOdds > 1) {
      clvValues.push(r.oddsTaken / r.closingOdds - 1);
    }
    series.push({
      id: r.id,
      at: r.settledAt,
      actual: round2(profit),
      expected: round2(expected),
      sigma: round2(Math.sqrt(variance)),
    });
  }

  // Largest peak-to-trough fall of cumulative profit, starting from 0.
  let peak = 0;
  let peakIndex = -1;
  const maxDrawdown = { amount: 0, from: -1, to: -1 };
  series.forEach((p, i) => {
    if (p.actual > peak) {
      peak = p.actual;
      peakIndex = i;
    }
    const fall = peak - p.actual;
    if (fall > maxDrawdown.amount) {
      maxDrawdown.amount = fall;
      maxDrawdown.from = peakIndex;
      maxDrawdown.to = i;
    }
  });

  const sigma = Math.sqrt(variance);
  const n = settled.length;
  const pendingStake = pendingRows.reduce((s, r) => s + r.stake, 0);
  const pendingExpected = pendingRows.reduce((s, r) => s + expectedOf(r), 0);

  return {
    counts: { settled: n, pending: pendingRows.length, voided, wins },
    turnover: round2(turnover),
    profit: round2(profit),
    yield: turnover > 0 ? profit / turnover : null,
    expectedProfit: round2(expected),
    expectedYield: turnover > 0 ? expected / turnover : null,
    hitRate: n > 0 ? wins / n : null,
    expectedHitRate: n > 0 ? probSum / n : null,
    zScore: sigma > 0 ? (profit - expected) / sigma : null,
    sigma: round2(sigma),
    market: {
      sample: market.sample,
      turnover: round2(market.turnover),
      actual: round2(market.actual),
      modelExpected: round2(market.modelExpected),
      expectedProfit: round2(market.expectedProfit),
    },
    clv: {
      sample: clvValues.length,
      mean:
        clvValues.length > 0
          ? clvValues.reduce((s, v) => s + v, 0) / clvValues.length
          : null,
      beatCloseShare:
        clvValues.length > 0
          ? clvValues.filter((v) => v > 0).length / clvValues.length
          : null,
    },
    maxDrawdown: {
      amount: round2(maxDrawdown.amount),
      from: maxDrawdown.from,
      to: maxDrawdown.to,
      percentOfBankroll:
        bankroll && bankroll > 0 ? maxDrawdown.amount / bankroll : null,
    },
    pending: {
      stake: round2(pendingStake),
      expectedProfit: round2(pendingExpected),
    },
    bankroll,
    series,
    minSample: MIN_SAMPLE,
  };
}

// ---------------------------------------------------------------------------
// Segments (section C of the plan): the summary figures, sliced. Each slice
// is a list of groups; a group's figures are the plain summary of its rows,
// so everything on the headline tiles can be read per segment.
// ---------------------------------------------------------------------------

export type SegmentBy =
  | "leagueMarket"
  | "league"
  | "market"
  | "pick"
  | "oddsBand"
  | "edgeBand"
  | "eloGap";

export const SEGMENT_KEYS: SegmentBy[] = [
  "leagueMarket",
  "league",
  "market",
  "pick",
  "oddsBand",
  "edgeBand",
  "eloGap",
];

export const isSegmentBy = (v: unknown): v is SegmentBy =>
  typeof v === "string" && (SEGMENT_KEYS as string[]).includes(v);

export type SegmentRow = Omit<Summary, "series" | "minSample" | "bankroll"> & {
  key: string;
  label: string;
};

export interface Segments {
  by: SegmentBy;
  minSample: number;
  rows: SegmentRow[];
}

const LEAGUE_LABELS: Record<LedgerLeague, string> = {
  nhl: "NHL",
  liiga: "Liiga",
  epl: "EPL",
  ucl: "UCL",
  worldcup: "World Cup",
};
const MARKET_LABELS: Record<LedgerMarket, string> = {
  regulation: "60-min 1X2",
  moneyline: "Moneyline",
  fullTime: "Full-time 1X2",
  correctScore: "Correct score",
};
const LEAGUE_ORDER = Object.keys(LEAGUE_LABELS);
const MARKET_ORDER = Object.keys(MARKET_LABELS);

/** Odds bands from the plan; correct-score lines land in the top two. */
const ODDS_BANDS: [number, string][] = [
  [1.5, "< 1.5"],
  [2, "1.5–2"],
  [3, "2–3"],
  [5, "3–5"],
  [10, "5–10"],
  [Infinity, "> 10"],
];
const EDGE_BANDS: [number, string][] = [
  [-1e-9, "< 0%"],
  [0.05, "0–5%"],
  [0.1, "5–10%"],
  [0.2, "10–20%"],
  [Infinity, "> 20%"],
];
const ELO_GAP_BANDS: [number, string][] = [
  [25, "0–25"],
  [50, "25–50"],
  [100, "50–100"],
  [Infinity, "> 100"],
];

/** First band whose upper bound the value is at or below. */
function band(bands: [number, string][], v: number): [number, string] {
  const i = bands.findIndex(([hi]) => v <= hi);
  const idx = i < 0 ? bands.length - 1 : i;
  return [idx, bands[idx][1]];
}

/** Group key, order and label of one row under a slice. */
function groupOf(row: LedgerRow, by: SegmentBy): {
  key: string;
  order: number;
  label: string;
} {
  const league = row.league ?? "unknown";
  const leagueLabel = row.league ? LEAGUE_LABELS[row.league] : "Unknown league";
  const leagueOrder = row.league ? LEAGUE_ORDER.indexOf(row.league) : 99;
  const marketOrder = MARKET_ORDER.indexOf(row.market);
  switch (by) {
    case "league":
      return { key: league, order: leagueOrder, label: leagueLabel };
    case "market":
      return {
        key: row.market,
        order: marketOrder,
        label: MARKET_LABELS[row.market],
      };
    case "leagueMarket":
      return {
        key: `${league}:${row.market}`,
        order: leagueOrder * 10 + marketOrder,
        label: `${leagueLabel} · ${MARKET_LABELS[row.market]}`,
      };
    case "pick": {
      if (row.market === "correctScore")
        return { key: "score", order: 3, label: "Score line" };
      const side = pickSide(row);
      const order = side === "home" ? 0 : side === "draw" ? 1 : side === "away" ? 2 : 4;
      const label =
        side === "home" ? "Home" : side === "draw" ? "Draw" : side === "away" ? "Away" : "Unknown";
      return { key: side ?? "unknown", order, label };
    }
    case "oddsBand": {
      const [order, label] = band(ODDS_BANDS, row.oddsTaken);
      return { key: `odds${order}`, order, label };
    }
    case "edgeBand": {
      // Rows saved at the model's own fair odds have no measured edge.
      if (row.flags?.includes("oddsIsMinOdd"))
        return { key: "noPrice", order: 99, label: "No book price" };
      const edge = row.probability * row.oddsTaken - 1;
      const [order, label] = band(EDGE_BANDS, edge < -1e-9 ? edge : Math.max(0, edge));
      return { key: `edge${order}`, order, label };
    }
    case "eloGap": {
      const h = row.model?.homeElo;
      const a = row.model?.awayElo;
      if (typeof h !== "number" || typeof a !== "number")
        return { key: "noSnapshot", order: 99, label: "No model snapshot" };
      const [order, label] = band(ELO_GAP_BANDS, Math.abs(h - a));
      return { key: `gap${order}`, order, label };
    }
  }
}

export function segments(rows: LedgerRow[], by: SegmentBy): Segments {
  const groups = new Map<
    string,
    { order: number; label: string; rows: LedgerRow[] }
  >();
  for (const row of rows) {
    const g = groupOf(row, by);
    const existing = groups.get(g.key);
    if (existing) existing.rows.push(row);
    else groups.set(g.key, { order: g.order, label: g.label, rows: [row] });
  }
  const out: { order: number; row: SegmentRow }[] = [];
  for (const [key, g] of groups) {
    const { series: _series, minSample: _min, bankroll: _b, ...rest } =
      summarize(g.rows);
    out.push({ order: g.order, row: { key, label: g.label, ...rest } });
  }
  out.sort(
    (a, b) => a.order - b.order || a.row.label.localeCompare(b.row.label)
  );
  return { by, minSample: MIN_SAMPLE, rows: out.map((o) => o.row) };
}
