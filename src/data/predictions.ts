/**
 * Prediction log (data change 2 of docs/METRICS_AND_DASHBOARD.md): every
 * 1X2 prediction shown, bet or not, in data/predictions.jsonl. One row per
 * league, pairing and calendar day; showing the same game again on the
 * same day replaces the snapshot. A bet on the game attaches the
 * bookmaker's price list, which is what the skill-vs-market check needs.
 *
 * Rows are scored against the league's played games once the game shows
 * up in the history: the first game between the two teams on or after the
 * day the prediction was shown, within a fortnight.
 */
import fs from "fs";
import path from "path";
import { GameRecord } from "../utils/types";
import { LEAGUES } from "../utils/leagues";
import { LedgerLeague, ModelSnapshot, isLedgerLeague } from "./ledger";
import { ensureLeague } from "./leagueData";
import { ensureUcl } from "./uclFetcher";
import { Bucket, addToBucket, emptyBuckets, finishBuckets } from "./backtest";

export type PredictionMarket = "regulation" | "fullTime";

export interface PredictionRow {
  /** `${league}:${home}:${away}:${YYYY-MM-DD}` */
  id: string;
  /** Last time the prediction was shown. */
  at: string;
  firstAt: string;
  league: LedgerLeague;
  game: { home: string; away: string; date: string | null };
  market: PredictionMarket;
  model: ModelSnapshot;
  /** Bookmaker 1X2 prices from a bet on this game, when one was placed. */
  marketOdds: Record<string, number> | null;
  /** Full 1X2 closing prices, entered by hand. */
  closingOdds: Record<string, number> | null;
  bet: boolean;
}

export function predictionsPath(): string {
  return path.join(process.cwd(), "data", "predictions.jsonl");
}

export function readPredictions(): PredictionRow[] {
  const file = predictionsPath();
  if (!fs.existsSync(file)) return [];
  const rows: PredictionRow[] = [];
  for (const line of fs.readFileSync(file, "utf-8").split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed) as PredictionRow);
    } catch {
      console.error("predictions: skipping unparsable line:", trimmed.slice(0, 80));
    }
  }
  return rows;
}

export function writePredictions(rows: PredictionRow[]): void {
  const file = predictionsPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, rows.map((r) => JSON.stringify(r)).join("\n") + (rows.length ? "\n" : ""));
  fs.renameSync(tmp, file);
}

const dayOf = (iso: string) => iso.slice(0, 10);

export function predictionId(
  league: string,
  home: string,
  away: string,
  day: string
): string {
  return `${league}:${home.toUpperCase()}:${away.toUpperCase()}:${day}`;
}

/** Record a prediction that was just shown. Same game, same day: replace. */
export function logPrediction(input: {
  league: string;
  home: string;
  away: string;
  market: PredictionMarket;
  model: ModelSnapshot;
}): PredictionRow | null {
  if (!isLedgerLeague(input.league)) return null;
  const now = new Date().toISOString();
  const id = predictionId(input.league, input.home, input.away, dayOf(now));
  const rows = readPredictions();
  const i = rows.findIndex((r) => r.id === id);
  const row: PredictionRow = {
    id,
    at: now,
    firstAt: i >= 0 ? rows[i].firstAt : now,
    league: input.league,
    game: { home: input.home.toUpperCase(), away: input.away.toUpperCase(), date: null },
    market: input.market,
    model: input.model,
    marketOdds: i >= 0 ? rows[i].marketOdds : null,
    closingOdds: i >= 0 ? rows[i].closingOdds : null,
    bet: i >= 0 ? rows[i].bet : false,
  };
  if (i >= 0) rows[i] = row;
  else rows.push(row);
  writePredictions(rows);
  return row;
}

/**
 * A bet was placed on the game today: mark the day's prediction row as bet
 * and keep the bookmaker's 1X2 prices when the bet carried them.
 */
export function notePredictionBet(
  league: string | null,
  home: string,
  away: string,
  marketOdds: Record<string, number> | null
): void {
  if (!league || !isLedgerLeague(league)) return;
  const id = predictionId(league, home, away, dayOf(new Date().toISOString()));
  const rows = readPredictions();
  const row = rows.find((r) => r.id === id);
  if (!row) return;
  row.bet = true;
  const full =
    marketOdds &&
    ["home", "draw", "away"].every((k) => typeof marketOdds[k] === "number" && marketOdds[k] > 1);
  if (full) row.marketOdds = { home: marketOdds!.home, draw: marketOdds!.draw, away: marketOdds!.away };
  writePredictions(rows);
}

/** Set (or clear) the full 1X2 closing prices of a logged prediction. */
export function setPredictionClosing(
  id: string,
  closing: Record<string, number> | null
): PredictionRow | null {
  const rows = readPredictions();
  const row = rows.find((r) => r.id === id);
  if (!row) return null;
  row.closingOdds = closing;
  writePredictions(rows);
  return row;
}

// ---------------------------------------------------------------------------
// Scoring against played games
// ---------------------------------------------------------------------------

type Outcome = 0 | 1 | 2;

export interface ScoredPrediction {
  id: string;
  at: string;
  league: LedgerLeague;
  home: string;
  away: string;
  market: PredictionMarket;
  probs: [number, number, number];
  marketOdds: Record<string, number> | null;
  closingOdds: Record<string, number> | null;
  bet: boolean;
  /** Filled once the game is in the history. */
  gameDate: string | null;
  score: string | null;
  outcome: Outcome | null;
  /** Model probability of what happened. */
  pActual: number | null;
}

export interface PredictionReport {
  logged: number;
  scored: number;
  awaiting: number;
  /** Rows whose league has no game history to score against (World Cup). */
  unscorable: number;
  brier: number | null;
  brierBaseline: number | null;
  logLoss: number | null;
  logLossBaseline: number | null;
  hit: { predicted: number; observed: number } | null;
  buckets: Bucket[];
  /** Model against the de-vigged bookmaker on the rows that have prices. */
  market: {
    sample: number;
    modelBrier: number;
    bookBrier: number;
    modelLogLoss: number;
    bookLogLoss: number;
  } | null;
  /** Rows with closing prices: how much the close moved from the bet price. */
  closing: { sample: number; modelBrier: number; closeBrier: number } | null;
  rows: ScoredPrediction[];
  minSample: number;
}

const EPS = 1e-12;
const round4 = (v: number) => Math.round(v * 10000) / 10000;
const FORTNIGHT = 14 * 24 * 60 * 60 * 1000;

function outcomeOf(g: GameRecord, sport: "hockey" | "soccer"): Outcome {
  if (sport === "hockey" && g.decidedInOTorSO) return 1;
  if (g.homeGoals > g.awayGoals) return 0;
  if (g.awayGoals > g.homeGoals) return 2;
  return 1;
}

/** De-vig a 1X2 price list by normalising 1/odds. */
function bookProbs(odds: Record<string, number>): [number, number, number] | null {
  const o = [odds.home, odds.draw, odds.away];
  if (!o.every((x) => typeof x === "number" && x > 1)) return null;
  const inv = o.map((x) => 1 / x);
  const total = inv[0] + inv[1] + inv[2];
  return [inv[0] / total, inv[1] / total, inv[2] / total];
}

const brierOf = (p: number[], y: number) =>
  p.reduce((s, v, i) => s + (v - (i === y ? 1 : 0)) ** 2, 0);
const logLossOf = (p: number[], y: number) => -Math.log(Math.max(p[y], EPS));

async function gamesFor(league: LedgerLeague): Promise<{
  games: GameRecord[];
  sport: "hockey" | "soccer";
} | null> {
  if (league === "nhl" || league === "liiga" || league === "epl") {
    const state = await ensureLeague(league);
    return { games: state.games, sport: LEAGUES[league].sport };
  }
  if (league === "ucl") {
    const { games } = await ensureUcl();
    return { games, sport: "soccer" };
  }
  return null;
}

export async function scorePredictions(
  rows: PredictionRow[],
  minSample = 30
): Promise<PredictionReport> {
  const leagues = [...new Set(rows.map((r) => r.league))];
  const history = new Map<LedgerLeague, Awaited<ReturnType<typeof gamesFor>>>();
  for (const l of leagues) history.set(l, await gamesFor(l));

  // League outcome frequencies, the "always the league average" baseline.
  const baselines = new Map<LedgerLeague, [number, number, number]>();
  for (const [l, h] of history) {
    if (!h || h.games.length === 0) continue;
    const f = [0, 0, 0];
    for (const g of h.games) f[outcomeOf(g, h.sport)]++;
    baselines.set(l, [f[0] / h.games.length, f[1] / h.games.length, f[2] / h.games.length]);
  }

  const scored: ScoredPrediction[] = rows.map((r) => {
    const p = r.model.probs;
    const probs: [number, number, number] = p
      ? [p.home ?? 0, p.draw ?? 0, p.away ?? 0]
      : [0, 0, 0];
    const base: ScoredPrediction = {
      id: r.id,
      at: r.at,
      league: r.league,
      home: r.game.home,
      away: r.game.away,
      market: r.market,
      probs,
      marketOdds: r.marketOdds,
      closingOdds: r.closingOdds,
      bet: r.bet,
      gameDate: null,
      score: null,
      outcome: null,
      pActual: null,
    };
    const h = history.get(r.league);
    if (!h) return base;
    const shownDay = new Date(dayOf(r.at)).getTime();
    const game = h.games.find(
      (g) =>
        g.homeAbbr.toUpperCase() === r.game.home &&
        g.awayAbbr.toUpperCase() === r.game.away &&
        new Date(dayOf(g.date)).getTime() >= shownDay &&
        new Date(dayOf(g.date)).getTime() <= shownDay + FORTNIGHT
    );
    if (!game) return base;
    const outcome = outcomeOf(game, h.sport);
    return {
      ...base,
      gameDate: game.date,
      score: `${game.homeGoals}-${game.awayGoals}${game.decidedInOTorSO ? " OT" : ""}`,
      outcome,
      pActual: round4(probs[outcome]),
    };
  });

  const done = scored.filter((s) => s.outcome !== null && baselines.has(s.league));
  let brier = 0;
  let brierBase = 0;
  let logLoss = 0;
  let logLossBase = 0;
  let hitPred = 0;
  let hits = 0;
  const buckets = emptyBuckets();
  const market = { sample: 0, modelBrier: 0, bookBrier: 0, modelLogLoss: 0, bookLogLoss: 0 };
  const closing = { sample: 0, modelBrier: 0, closeBrier: 0 };
  for (const s of done) {
    const y = s.outcome as Outcome;
    const base = baselines.get(s.league)!;
    brier += brierOf(s.probs, y);
    brierBase += brierOf(base, y);
    logLoss += logLossOf(s.probs, y);
    logLossBase += logLossOf(base, y);
    // "Hit" = the model's most likely outcome happened.
    const top = s.probs.indexOf(Math.max(...s.probs));
    hitPred += s.probs[top];
    if (top === y) hits++;
    for (let o = 0; o < 3; o++) addToBucket(buckets, s.probs[o], y === o);
    const book = s.marketOdds ? bookProbs(s.marketOdds) : null;
    if (book) {
      market.sample++;
      market.modelBrier += brierOf(s.probs, y);
      market.bookBrier += brierOf(book, y);
      market.modelLogLoss += logLossOf(s.probs, y);
      market.bookLogLoss += logLossOf(book, y);
    }
    const close = s.closingOdds ? bookProbs(s.closingOdds) : null;
    if (close) {
      closing.sample++;
      closing.modelBrier += brierOf(s.probs, y);
      closing.closeBrier += brierOf(close, y);
    }
  }
  const n = done.length;
  const unscorable = scored.filter((s) => !history.get(s.league)).length;

  return {
    logged: rows.length,
    scored: n,
    awaiting: rows.length - n - unscorable,
    unscorable,
    brier: n ? round4(brier / n) : null,
    brierBaseline: n ? round4(brierBase / n) : null,
    logLoss: n ? round4(logLoss / n) : null,
    logLossBaseline: n ? round4(logLossBase / n) : null,
    hit: n ? { predicted: round4(hitPred / n), observed: round4(hits / n) } : null,
    buckets: finishBuckets(buckets),
    market:
      market.sample > 0
        ? {
            sample: market.sample,
            modelBrier: round4(market.modelBrier / market.sample),
            bookBrier: round4(market.bookBrier / market.sample),
            modelLogLoss: round4(market.modelLogLoss / market.sample),
            bookLogLoss: round4(market.bookLogLoss / market.sample),
          }
        : null,
    closing:
      closing.sample > 0
        ? {
            sample: closing.sample,
            modelBrier: round4(closing.modelBrier / closing.sample),
            closeBrier: round4(closing.closeBrier / closing.sample),
          }
        : null,
    rows: [...scored].sort((a, b) => b.at.localeCompare(a.at)),
    minSample,
  };
}
