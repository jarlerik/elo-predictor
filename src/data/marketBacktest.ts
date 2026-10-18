/**
 * Walk-forward backtest of the Elo model against bookmaker prices.
 *
 * Replays a league's stored game history (data/games) in date order and,
 * for every game that has odds (data/odds), records the probabilities the
 * model would have shown before it, the market's de-vigged probabilities,
 * and the outcome. Nothing from a later game reaches an earlier prediction:
 *
 * - ratings come from `computeElosFromGames`'s `onGame` hook, which fires
 *   before the game is applied, with a fixed reference instant (or no age
 *   weighting at all) so the walk does not depend on the day it is run;
 * - the draw factor and the outcome-frequency baseline of a season are
 *   fitted on the seasons before it only;
 * - the first `burnInSeasons` seasons build ratings and are not scored.
 *
 * On top of the rows, `simulate` plays a betting policy and returns settled
 * ledger rows, so the same `summarize` / `segments` that score live bets
 * score the simulation. `skillOf` compares the model's Brier and log loss
 * with the sharp close, the market average and the baseline.
 *
 * Brier here is the multi-class sum over outcomes (0..2), as in backtest.ts.
 */
import { createHash } from "crypto";
import { GameRecord } from "../utils/types";
import { LeagueId, LEAGUES } from "../utils/leagues";
import { computeElosFromGames } from "../elo/calculator";
import {
  eloToWinProb,
  fitDrawFactorFromHistory,
  isFullTimeDraw,
  isRegulationDraw,
  SOCCER_DRAW_FACTOR,
  HOCKEY_DRAW_FACTOR,
} from "../elo/probabilities";
import { devig, MARKET_SIDES } from "../utils/sharp";
import { kellyStake } from "../utils/kelly";
import { OddsRecord, PriceTrio } from "../odds/types";
import { joinOdds } from "../odds/store";
import { LedgerRow, newRow, round2 } from "./ledger";
import { summarize, segments, Summary, SegmentBy, SEGMENT_KEYS, Segments } from "./metrics";
import { brierOf, logLossOf, Bucket, emptyBuckets, addToBucket, finishBuckets, seasonLabel } from "./backtest";

export type Outcome = 0 | 1 | 2;
export type Side = "home" | "draw" | "away";
const SIDES: Side[] = ["home", "draw", "away"];

export interface EloConfig {
  homeAdv: number;
  baseK: number;
  timeWeighting: boolean;
  /** Reference instant for the age weight; defaults to the last game's date. */
  now?: number;
}

export interface WalkForwardConfig {
  league: LeagueId;
  /** Seasons present in the history, ascending. Filled from the games when empty. */
  seasons: string[];
  /** Leading seasons that only build ratings. */
  burnInSeasons: number;
  /** Last training season (label as in GameRecord.season); later ones are test. */
  trainUntil: string;
  elo: EloConfig;
  /** Multiplier on the fitted draw factor (sensitivity axis). */
  drawFactorScale: number;
}

export interface Policy {
  id: string;
  /** Which price list the bet is placed at: the close or the pre-match one. */
  timing: "close" | "prematch";
  /** The simulated bookmaker: best market price, the sharp book, or the average. */
  price: "max" | "sharp" | "avg";
  /** Probability the bet is sized and selected on. */
  prob: "model" | "shrunk";
  /** Weight on the model in `shrunk` (the rest on the de-vigged sharp price). */
  shrinkWeight: number;
  /** Minimum p × odds − 1 to bet. */
  minEdge: number;
  minOdds?: number;
  maxOdds?: number;
  /** Skip games where either side has played fewer games this season. */
  minGamesPlayed?: number;
  stake: { kind: "flat"; units: number } | { kind: "kelly"; divider: number; bankroll: number };
  /** Bet every side that clears the edge, not just the best one. */
  allowMultiple?: boolean;
}

export const DEFAULT_POLICIES: Policy[] = [
  { id: "sharp-model-0", timing: "close", price: "sharp", prob: "model", shrinkWeight: 1, minEdge: 0, stake: { kind: "flat", units: 1 } },
  { id: "max-model-3", timing: "close", price: "max", prob: "model", shrinkWeight: 1, minEdge: 0.03, stake: { kind: "flat", units: 1 } },
  { id: "max-model-5", timing: "close", price: "max", prob: "model", shrinkWeight: 1, minEdge: 0.05, stake: { kind: "flat", units: 1 } },
  { id: "max-shrunk-2", timing: "close", price: "max", prob: "shrunk", shrinkWeight: 0.5, minEdge: 0.02, stake: { kind: "flat", units: 1 } },
  { id: "max-shrunk-2-kelly", timing: "close", price: "max", prob: "shrunk", shrinkWeight: 0.5, minEdge: 0.02, stake: { kind: "kelly", divider: 4, bankroll: 100 } },
  { id: "max-sharp-only-2", timing: "close", price: "max", prob: "shrunk", shrinkWeight: 0, minEdge: 0.02, stake: { kind: "flat", units: 1 } },
  { id: "prematch-max-shrunk-2", timing: "prematch", price: "max", prob: "shrunk", shrinkWeight: 0.5, minEdge: 0.02, stake: { kind: "flat", units: 1 } },
];

export interface WalkRow {
  gamePk: number;
  date: string;
  season: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  gamesPlayed: { home: number; away: number };
  drawFactor: number;
  /** Model 1X2 probabilities and what happened. */
  p: [number, number, number];
  y: Outcome;
  /** Outcome frequencies of the seasons before this one. */
  baseline: [number, number, number];
  odds: OddsRecord | null;
  /** De-vigged sharp close and market average close, when priced. */
  pSharp: [number, number, number] | null;
  pAvg: [number, number, number] | null;
}

export interface WalkResult {
  config: WalkForwardConfig;
  rows: WalkRow[];
  data: {
    gamesTotal: number;
    gamesScored: number;
    oddsRows: number;
    matched: number;
    unmatchedGames: number;
    unmatchedOdds: number;
    duplicates: string[];
    seasonsWithoutMaxClose: string[];
    sharpBooks: Record<string, number>;
  };
}

function outcomeOf(g: GameRecord, hockey: boolean): Outcome {
  if (hockey && g.decidedInOTorSO) return 1;
  if (g.homeGoals > g.awayGoals) return 0;
  if (g.awayGoals > g.homeGoals) return 2;
  return 1;
}

function toProbs(trio: PriceTrio | undefined): [number, number, number] | null {
  if (!trio || trio.draw === undefined) return null;
  const p = devig({ home: trio.home, draw: trio.draw, away: trio.away }, MARKET_SIDES.fullTime);
  return p ? [p.home, p.draw, p.away] : null;
}

export function seasonsOf(games: GameRecord[]): string[] {
  return [...new Set(games.map((g) => g.season))].sort();
}

/** Replay the history; one row per scored game. */
export function walkForward(
  games: GameRecord[],
  odds: OddsRecord[],
  cfg: WalkForwardConfig
): WalkResult {
  const hockey = LEAGUES[cfg.league].sport === "hockey";
  const seasons = cfg.seasons.length ? cfg.seasons : seasonsOf(games);
  const scored = new Set(seasons.slice(cfg.burnInSeasons));
  const sorted = [...games].sort((a, b) => a.date.localeCompare(b.date) || a.gamePk - b.gamePk);
  const now = cfg.elo.now ?? (sorted.length ? new Date(sorted[sorted.length - 1].date).getTime() : Date.now());
  const eloOpts = {
    homeAdv: cfg.elo.homeAdv,
    baseK: cfg.elo.baseK,
    timeWeighting: cfg.elo.timeWeighting,
    now,
  };

  // Per-season draw factor and baseline from earlier seasons only.
  const drawFactor = new Map<string, number>();
  const baseline = new Map<string, [number, number, number]>();
  const fallback = hockey ? HOCKEY_DRAW_FACTOR : SOCCER_DRAW_FACTOR;
  for (const s of scored) {
    const prior = sorted.filter((g) => g.season < s);
    const nu = fitDrawFactorFromHistory(prior, hockey ? isRegulationDraw : isFullTimeDraw, {
      ...eloOpts,
      fallback,
      currentTeams: new Set(),
    });
    drawFactor.set(s, nu * cfg.drawFactorScale);
    const f: [number, number, number] = [0, 0, 0];
    for (const g of prior) f[outcomeOf(g, hockey)]++;
    const n = prior.length || 1;
    baseline.set(s, [f[0] / n, f[1] / n, f[2] / n]);
  }

  const join = joinOdds(sorted, odds);
  const rows: WalkRow[] = [];
  computeElosFromGames(sorted, {
    ...eloOpts,
    currentTeams: new Set(),
    onGame: (g, homeElo, awayElo, played) => {
      if (!scored.has(g.season)) return;
      const nu = drawFactor.get(g.season) ?? fallback;
      const probs = eloToWinProb(homeElo, awayElo, cfg.elo.homeAdv, nu);
      const o = join.matched.get(g.gamePk) ?? null;
      rows.push({
        gamePk: g.gamePk,
        date: g.date,
        season: g.season,
        home: g.homeAbbr,
        away: g.awayAbbr,
        homeElo,
        awayElo,
        gamesPlayed: played,
        drawFactor: nu,
        p: [probs.homeWin, probs.draw, probs.awayWin],
        y: outcomeOf(g, hockey),
        baseline: baseline.get(g.season)!,
        odds: o,
        pSharp: o ? toProbs(o.sharp) : null,
        pAvg: o ? toProbs(o.avg) : null,
      });
    },
  });

  const sharpBooks: Record<string, number> = {};
  const seasonsWithMax = new Set<string>();
  for (const r of rows) {
    if (!r.odds) continue;
    sharpBooks[r.odds.sharpBook] = (sharpBooks[r.odds.sharpBook] ?? 0) + 1;
    if (r.odds.max) seasonsWithMax.add(r.season);
  }
  return {
    config: { ...cfg, seasons, elo: { ...cfg.elo, now } },
    rows,
    data: {
      gamesTotal: sorted.length,
      gamesScored: rows.length,
      oddsRows: odds.length,
      matched: join.matched.size,
      unmatchedGames: join.unmatchedGames.length,
      unmatchedOdds: join.unmatchedOdds.length,
      duplicates: join.duplicates,
      seasonsWithoutMaxClose: [...scored].filter((s) => !seasonsWithMax.has(s)),
      sharpBooks,
    },
  };
}

// ---------------------------------------------------------------------------
// Skill: model vs market
// ---------------------------------------------------------------------------

export interface Score {
  brier: number;
  logLoss: number;
}

export interface SkillRow {
  label: string;
  n: number;
  model: Score;
  /** De-vigged sharp close. */
  market: Score;
  /** De-vigged market average close; null before 2019-20. */
  avg: Score | null;
  baseline: Score;
  /** 0.5 × model + 0.5 × sharp. */
  shrunk: Score;
  /** model − market; negative means the model is sharper. */
  delta: Score;
  /** Standard error of the per-game log-loss difference model − market. */
  deltaLogLossSe: number;
}

const round4 = (v: number) => Math.round(v * 10000) / 10000;
const mix = (a: number[], b: number[], w: number): [number, number, number] => [
  w * a[0] + (1 - w) * b[0],
  w * a[1] + (1 - w) * b[1],
  w * a[2] + (1 - w) * b[2],
];

/** Scores over the rows that have a sharp price. */
export function skillOf(label: string, rows: WalkRow[]): SkillRow | null {
  const priced = rows.filter((r) => r.pSharp);
  const n = priced.length;
  if (!n) return null;
  const acc = { model: [0, 0], market: [0, 0], avg: [0, 0], baseline: [0, 0], shrunk: [0, 0] };
  let avgN = 0;
  const diffs: number[] = [];
  for (const r of priced) {
    const m = r.pSharp!;
    acc.model[0] += brierOf(r.p, r.y);
    acc.model[1] += logLossOf(r.p, r.y);
    acc.market[0] += brierOf(m, r.y);
    acc.market[1] += logLossOf(m, r.y);
    acc.baseline[0] += brierOf(r.baseline, r.y);
    acc.baseline[1] += logLossOf(r.baseline, r.y);
    const s = mix(r.p, m, 0.5);
    acc.shrunk[0] += brierOf(s, r.y);
    acc.shrunk[1] += logLossOf(s, r.y);
    if (r.pAvg) {
      avgN++;
      acc.avg[0] += brierOf(r.pAvg, r.y);
      acc.avg[1] += logLossOf(r.pAvg, r.y);
    }
    diffs.push(logLossOf(r.p, r.y) - logLossOf(m, r.y));
  }
  const score = (a: number[], k: number): Score => ({ brier: round4(a[0] / k), logLoss: round4(a[1] / k) });
  const model = score(acc.model, n);
  const market = score(acc.market, n);
  const meanDiff = diffs.reduce((s, d) => s + d, 0) / n;
  const varDiff = diffs.reduce((s, d) => s + (d - meanDiff) ** 2, 0) / Math.max(1, n - 1);
  return {
    label,
    n,
    model,
    market,
    avg: avgN ? score(acc.avg, avgN) : null,
    baseline: score(acc.baseline, n),
    shrunk: score(acc.shrunk, n),
    delta: { brier: round4(model.brier - market.brier), logLoss: round4(model.logLoss - market.logLoss) },
    deltaLogLossSe: round4(Math.sqrt(varDiff / n)),
  };
}

export function skillBySeason(rows: WalkRow[]): SkillRow[] {
  const out: SkillRow[] = [];
  for (const s of seasonsOfRows(rows)) {
    const row = skillOf(seasonLabel(s), rows.filter((r) => r.season === s));
    if (row) out.push(row);
  }
  return out;
}

const seasonsOfRows = (rows: WalkRow[]) => [...new Set(rows.map((r) => r.season))].sort();

/** Reliability of each outcome's probability, pooled over outcomes. */
export function calibrationOf(rows: WalkRow[]): { model: Bucket[]; market: Bucket[] } {
  const model = emptyBuckets();
  const market = emptyBuckets();
  for (const r of rows) {
    if (!r.pSharp) continue;
    for (let i = 0; i < 3; i++) {
      addToBucket(model, r.p[i], r.y === i);
      addToBucket(market, r.pSharp[i], r.y === i);
    }
  }
  return { model: finishBuckets(model), market: finishBuckets(market) };
}

// ---------------------------------------------------------------------------
// Simulation: a policy over the rows, as settled ledger rows
// ---------------------------------------------------------------------------

const keyDate = (iso: string) => {
  const d = new Date(iso);
  const dd = String(d.getUTCDate()).padStart(2, "0");
  const mm = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${dd}.${mm}.${d.getUTCFullYear()}`;
};

const trioRecord = (t: PriceTrio): Record<string, number> =>
  t.draw === undefined ? { home: t.home, away: t.away } : { home: t.home, draw: t.draw, away: t.away };

export interface SimulationStats {
  gamesConsidered: number;
  gamesWithoutPrice: number;
  bets: number;
}

export function simulate(
  rows: WalkRow[],
  policy: Policy,
  league: LeagueId
): { rows: LedgerRow[]; stats: SimulationStats } {
  const out: LedgerRow[] = [];
  const stats: SimulationStats = { gamesConsidered: 0, gamesWithoutPrice: 0, bets: 0 };
  const market = LEAGUES[league].sport === "hockey" ? "regulation" : "fullTime";

  for (const r of rows) {
    if (!r.odds) continue;
    stats.gamesConsidered++;
    const o = r.odds;
    const sharpTrio = policy.timing === "close" ? o.sharp : o.sharpOpen ?? o.sharp;
    const priceTrio =
      policy.price === "sharp"
        ? sharpTrio
        : policy.price === "max"
          ? policy.timing === "close" ? o.max : o.maxOpen
          : policy.timing === "close" ? o.avg : o.avgOpen;
    const pSharp = toProbs(sharpTrio);
    if (!priceTrio || priceTrio.draw === undefined || !pSharp) {
      stats.gamesWithoutPrice++;
      continue;
    }
    if (
      policy.minGamesPlayed !== undefined &&
      Math.min(r.gamesPlayed.home, r.gamesPlayed.away) < policy.minGamesPlayed
    )
      continue;

    const prob = policy.prob === "model" ? r.p : mix(r.p, pSharp, policy.shrinkWeight);
    const prices: [number, number, number] = [priceTrio.home, priceTrio.draw, priceTrio.away];
    const candidates: { side: number; edge: number }[] = [];
    for (let i = 0; i < 3; i++) {
      const edge = prob[i] * prices[i] - 1;
      if (edge < policy.minEdge) continue;
      if (policy.minOdds !== undefined && prices[i] < policy.minOdds) continue;
      if (policy.maxOdds !== undefined && prices[i] > policy.maxOdds) continue;
      candidates.push({ side: i, edge });
    }
    if (!candidates.length) continue;
    candidates.sort((a, b) => b.edge - a.edge);
    const chosen = policy.allowMultiple ? candidates : candidates.slice(0, 1);

    for (const c of chosen) {
      const side = SIDES[c.side];
      const odds = prices[c.side];
      const p = prob[c.side];
      const stake =
        policy.stake.kind === "flat"
          ? policy.stake.units
          : round2(kellyStake(policy.stake.bankroll, p, odds, policy.stake.divider));
      if (!(stake > 0)) continue;
      const key = `${r.home}__${r.away}_${keyDate(r.date)}`;
      const won = r.y === c.side;
      const row = newRow({
        fileStem: `bt:${policy.id}:${r.season}:${key}`,
        index: c.side,
        key,
        home: r.home,
        away: r.away,
        date: r.date,
        placedAt: r.date,
        league,
        market,
        pick: side === "draw" ? "DRAW" : side === "home" ? r.home : r.away,
        stake,
        oddsTaken: odds,
        probability: p,
        bookmaker: policy.price === "max" ? "market-max" : policy.price === "avg" ? "market-avg" : o.sharpBook,
        marketOdds: trioRecord(priceTrio),
        model: {
          probs: { home: r.p[0], draw: r.p[1], away: r.p[2] },
          homeElo: round2(r.homeElo),
          awayElo: round2(r.awayElo),
          drawFactor: r.drawFactor,
          homeAdv: null,
          gamesPlayed: r.gamesPlayed,
        },
        sharpOdds: trioRecord(sharpTrio),
        sharpSource: o.sharpBook,
        bankrollBefore: policy.stake.kind === "kelly" ? policy.stake.bankroll : null,
        kellyDivider: policy.stake.kind === "kelly" ? policy.stake.divider : null,
        flags: ["backtest", `policy:${policy.id}`],
      });
      row.sharpClosingOdds = trioRecord(o.sharp);
      row.closingOdds = o.sharp[side] ?? null;
      row.settledAt = r.date;
      row.result = won ? "win" : "loss";
      row.finalScore = o.result ? `${o.result.homeGoals}-${o.result.awayGoals}` : null;
      row.decidedInOTorSO = false;
      row.return = won ? round2(stake * odds) : 0;
      out.push(row);
      stats.bets++;
    }
  }
  return { rows: out, stats };
}

export type SummaryLite = Omit<Summary, "series">;
export const dropSeries = (s: Summary): SummaryLite => {
  const { series: _s, ...rest } = s;
  return rest;
};

export interface PolicyReport {
  policy: Policy;
  stats: SimulationStats;
  summary: SummaryLite;
  /** Train and test seasons separately. */
  train: SummaryLite;
  test: SummaryLite;
  bySeason: { season: string; summary: SummaryLite }[];
  segments: Partial<Record<SegmentBy, Segments>>;
}

export function reportPolicy(walk: WalkResult, policy: Policy): PolicyReport {
  const { rows, stats } = simulate(walk.rows, policy, walk.config.league);
  const train = rows.filter((r) => seasonOfRow(r) <= walk.config.trainUntil);
  const test = rows.filter((r) => seasonOfRow(r) > walk.config.trainUntil);
  const bySeason = walk.config.seasons
    .slice(walk.config.burnInSeasons)
    .map((season) => ({
      season: seasonLabel(season),
      summary: dropSeries(summarize(rows.filter((r) => seasonOfRow(r) === season))),
    }))
    .filter((s) => s.summary.counts.settled > 0);
  const segs: Partial<Record<SegmentBy, Segments>> = {};
  for (const by of SEGMENT_KEYS) {
    if (by === "league" || by === "leagueMarket" || by === "market") continue;
    segs[by] = segments(rows, by);
  }
  return {
    policy,
    stats,
    summary: dropSeries(summarize(rows)),
    train: dropSeries(summarize(train)),
    test: dropSeries(summarize(test)),
    bySeason,
    segments: segs,
  };
}

/** Season label of a simulated row, from the flag-free id prefix. */
function seasonOfRow(row: LedgerRow): string {
  return row.id.split(":")[2];
}

/** Mean of max-close / sharp-close − 1 over all priced games and sides. */
export function clvProxy(rows: WalkRow[]): { mean: number | null; beatShare: number | null; n: number } {
  const v: number[] = [];
  for (const r of rows) {
    const o = r.odds;
    if (!o?.max || o.max.draw === undefined || o.sharp.draw === undefined) continue;
    v.push(o.max.home / o.sharp.home - 1, o.max.draw / o.sharp.draw - 1, o.max.away / o.sharp.away - 1);
  }
  if (!v.length) return { mean: null, beatShare: null, n: 0 };
  return {
    mean: round4(v.reduce((s, x) => s + x, 0) / v.length),
    beatShare: round4(v.filter((x) => x > 0).length / v.length),
    n: v.length,
  };
}

/** Same inputs and config give the same hash. */
export function determinismHash(rows: WalkRow[]): string {
  const h = createHash("sha1");
  for (const r of rows) h.update(`${r.gamePk}|${r.p.map((x) => x.toFixed(6)).join(",")}|${r.y}\n`);
  return h.digest("hex");
}

// ---------------------------------------------------------------------------
// Sensitivity: choose on train, report on test
// ---------------------------------------------------------------------------

export interface GridAxes {
  homeAdv: number[];
  baseK: number[];
  timeWeighting: boolean[];
  drawFactorScale: number[];
  minEdge: number[];
  shrinkWeight: number[];
}

export const DEFAULT_AXES: GridAxes = {
  homeAdv: [30, 45, 60],
  baseK: [15, 20, 25, 30],
  timeWeighting: [false, true],
  drawFactorScale: [0.9, 1, 1.1],
  minEdge: [0.02, 0.03, 0.05, 0.08],
  shrinkWeight: [0, 0.5, 1],
};

export interface GridCell {
  elo: { homeAdv: number; baseK: number; timeWeighting: boolean; drawFactorScale: number };
  /** Model log loss on priced train / test games. */
  train: { n: number; logLoss: number; delta: number };
  test: { n: number; logLoss: number; delta: number };
  /** Best policy (max close, flat stake) at this cell by train yield. */
  policy: { minEdge: number; shrinkWeight: number; trainYield: number | null; trainBets: number; testYield: number | null; testBets: number };
}

export interface GridResult {
  axes: GridAxes;
  cells: GridCell[];
  /** The cell with the lowest train log loss, with its best policy. */
  chosen: GridCell;
}

export function grid(games: GameRecord[], odds: OddsRecord[], base: WalkForwardConfig, axes = DEFAULT_AXES): GridResult {
  const cells: GridCell[] = [];
  for (const homeAdv of axes.homeAdv)
    for (const baseK of axes.baseK)
      for (const timeWeighting of axes.timeWeighting)
        for (const drawFactorScale of axes.drawFactorScale) {
          const cfg: WalkForwardConfig = {
            ...base,
            elo: { ...base.elo, homeAdv, baseK, timeWeighting },
            drawFactorScale,
          };
          const walk = walkForward(games, odds, cfg);
          const trainRows = walk.rows.filter((r) => r.season <= base.trainUntil);
          const testRows = walk.rows.filter((r) => r.season > base.trainUntil);
          const st = skillOf("train", trainRows);
          const te = skillOf("test", testRows);
          let best: GridCell["policy"] | null = null;
          for (const minEdge of axes.minEdge)
            for (const shrinkWeight of axes.shrinkWeight) {
              const policy: Policy = {
                id: `grid-${minEdge}-${shrinkWeight}`,
                timing: "close",
                price: "max",
                prob: "shrunk",
                shrinkWeight,
                minEdge,
                stake: { kind: "flat", units: 1 },
              };
              const tr = summarize(simulate(trainRows, policy, base.league).rows);
              const ts = summarize(simulate(testRows, policy, base.league).rows);
              const cand = {
                minEdge,
                shrinkWeight,
                trainYield: tr.yield,
                trainBets: tr.counts.settled,
                testYield: ts.yield,
                testBets: ts.counts.settled,
              };
              // Yield on fewer than 100 train bets is noise; prefer the larger sample.
              const score = (c: typeof cand) => (c.trainBets < 100 || c.trainYield === null ? -Infinity : c.trainYield);
              if (!best || score(cand) > score(best)) best = cand;
            }
          cells.push({
            elo: { homeAdv, baseK, timeWeighting, drawFactorScale },
            train: { n: st?.n ?? 0, logLoss: st?.model.logLoss ?? NaN, delta: st?.delta.logLoss ?? NaN },
            test: { n: te?.n ?? 0, logLoss: te?.model.logLoss ?? NaN, delta: te?.delta.logLoss ?? NaN },
            policy: best!,
          });
        }
  const chosen = cells.reduce((a, b) => (b.train.logLoss < a.train.logLoss ? b : a));
  return { axes, cells, chosen };
}

// ---------------------------------------------------------------------------
// Full report
// ---------------------------------------------------------------------------

export interface MarketBacktestReport {
  league: LeagueId;
  generatedAt: string;
  config: WalkForwardConfig;
  data: WalkResult["data"];
  skill: {
    overall: SkillRow | null;
    train: SkillRow | null;
    test: SkillRow | null;
    bySeason: SkillRow[];
    calibration: { model: Bucket[]; market: Bucket[] };
  };
  policies: PolicyReport[];
  clvProxy: ReturnType<typeof clvProxy>;
  sensitivity: GridResult | null;
  determinismHash: string;
}

export function buildReport(
  walk: WalkResult,
  policies: Policy[],
  sensitivity: GridResult | null
): MarketBacktestReport {
  const train = walk.rows.filter((r) => r.season <= walk.config.trainUntil);
  const test = walk.rows.filter((r) => r.season > walk.config.trainUntil);
  return {
    league: walk.config.league,
    generatedAt: new Date().toISOString(),
    config: walk.config,
    data: walk.data,
    skill: {
      overall: skillOf("All scored seasons", walk.rows),
      train: skillOf("Train", train),
      test: skillOf("Test", test),
      bySeason: skillBySeason(walk.rows),
      calibration: calibrationOf(walk.rows),
    },
    policies: policies.map((p) => reportPolicy(walk, p)),
    clvProxy: clvProxy(walk.rows),
    sensitivity,
    determinismHash: determinismHash(walk.rows),
  };
}

// ---------------------------------------------------------------------------
// Markdown summary
// ---------------------------------------------------------------------------

const pct = (v: number | null | undefined) => (v === null || v === undefined ? "–" : `${(v * 100).toFixed(1)}%`);
const f3 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(3));
const f2 = (v: number | null | undefined) => (v === null || v === undefined || Number.isNaN(v) ? "–" : v.toFixed(2));

function skillTable(rows: SkillRow[]): string {
  const head =
    "| Season | n | Model LL | Sharp LL | Δ LL (±se) | Avg LL | Shrunk LL | Baseline LL | Model Brier | Sharp Brier |\n" +
    "| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |\n";
  return (
    head +
    rows
      .map(
        (r) =>
          `| ${r.label} | ${r.n} | ${f3(r.model.logLoss)} | ${f3(r.market.logLoss)} | ${r.delta.logLoss >= 0 ? "+" : ""}${f3(r.delta.logLoss)} (±${f3(r.deltaLogLossSe)}) | ${f3(r.avg?.logLoss)} | ${f3(r.shrunk.logLoss)} | ${f3(r.baseline.logLoss)} | ${f3(r.model.brier)} | ${f3(r.market.brier)} |`
      )
      .join("\n")
  );
}

function policyLine(label: string, s: SummaryLite): string {
  return `| ${label} | ${s.counts.settled} | ${f2(s.turnover)} | ${f2(s.profit)} | ${pct(s.yield)} | ${pct(s.expectedYield)} | ${pct(s.sharp.turnover ? s.sharp.expectedProfit / s.sharp.turnover : null)} | ${f2(s.zScore)} | ${pct(s.hitRate)} | ${f2(s.maxDrawdown.amount)} | ${pct(s.clv.mean)} |`;
}

export function reportMarkdown(r: MarketBacktestReport): string {
  const lines: string[] = [];
  const cfg = r.config;
  lines.push(`# Market backtest · ${LEAGUES[r.league].name}`);
  lines.push("");
  lines.push(`Generated ${r.generatedAt}. Seasons ${seasonLabel(cfg.seasons[0])} → ${seasonLabel(cfg.seasons[cfg.seasons.length - 1])}, burn-in ${cfg.burnInSeasons}, train until ${seasonLabel(cfg.trainUntil)}.`);
  lines.push(`Elo: homeAdv ${cfg.elo.homeAdv}, K ${cfg.elo.baseK}, age weighting ${cfg.elo.timeWeighting ? "on" : "off"}, draw-factor scale ${cfg.drawFactorScale}. Hash \`${r.determinismHash.slice(0, 12)}\`.`);
  lines.push("");
  lines.push(`Data: ${r.data.gamesScored} scored games of ${r.data.gamesTotal}; ${r.data.matched} with odds (${r.data.unmatchedGames} games without, ${r.data.unmatchedOdds} odds rows unmatched). Sharp reference: ${Object.entries(r.data.sharpBooks).map(([k, v]) => `${k} ${v}`).join(", ")}.` + (r.data.seasonsWithoutMaxClose.length ? ` No market max close in ${r.data.seasonsWithoutMaxClose.map(seasonLabel).join(", ")}.` : ""));
  lines.push("");
  lines.push("## Skill: model vs the sharp close");
  lines.push("");
  lines.push("Log loss and Brier are per game; Brier is the three-outcome sum (0..2). Δ LL < 0 means the model beats the de-vigged sharp close; a Δ smaller than about 2 × se is noise.");
  lines.push("");
  const skillRows = [r.skill.overall, r.skill.train, r.skill.test, ...r.skill.bySeason].filter((x): x is SkillRow => !!x);
  lines.push(skillTable(skillRows));
  lines.push("");
  lines.push("### Calibration (pooled over outcomes)");
  lines.push("");
  lines.push("| Bucket | n model | model pred | model obs | n sharp | sharp pred | sharp obs |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
  r.skill.calibration.model.forEach((b, i) => {
    const m = r.skill.calibration.market[i];
    lines.push(`| ${b.lo.toFixed(1)}–${b.hi.toFixed(1)} | ${b.count} | ${f3(b.predicted)} | ${f3(b.observed)} | ${m.count} | ${f3(m.predicted)} | ${f3(m.observed)} |`);
  });
  lines.push("");
  lines.push(`CLV proxy (market max close vs sharp close, all sides): mean ${pct(r.clvProxy.mean)}, share above sharp ${pct(r.clvProxy.beatShare)} over ${r.clvProxy.n} prices.`);
  lines.push("");
  lines.push("## Policies");
  lines.push("");
  lines.push("One bet per game at most (best edge). `exp. yield` is what the policy's own probability implied; `sharp exp.` what the de-vigged sharp price implied for the same bets (positive = the simulated book was overpriced against the market). `CLV` is odds taken / sharp close − 1.");
  lines.push("");
  const head = "| Policy | bets | turnover | profit | yield | exp. yield | sharp exp. | z | hit | max DD | CLV |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |";
  lines.push(head);
  for (const p of r.policies) {
    lines.push(policyLine(`**${p.policy.id}** all`, p.summary));
    lines.push(policyLine(`${p.policy.id} train`, p.train));
    lines.push(policyLine(`${p.policy.id} test`, p.test));
  }
  lines.push("");
  for (const p of r.policies) {
    lines.push(`### ${p.policy.id}`);
    lines.push("");
    lines.push(`timing ${p.policy.timing}, price ${p.policy.price}, prob ${p.policy.prob}${p.policy.prob === "shrunk" ? ` (model weight ${p.policy.shrinkWeight})` : ""}, min edge ${pct(p.policy.minEdge)}, stake ${p.policy.stake.kind === "flat" ? `flat ${p.policy.stake.units}` : `Kelly/${p.policy.stake.divider} of ${p.policy.stake.bankroll}`}. ${p.stats.gamesConsidered} games considered, ${p.stats.gamesWithoutPrice} without a price.`);
    lines.push("");
    lines.push("| Season | bets | yield | exp. yield | sharp exp. | z | CLV |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
    for (const s of p.bySeason) {
      const x = s.summary;
      lines.push(`| ${s.season} | ${x.counts.settled} | ${pct(x.yield)} | ${pct(x.expectedYield)} | ${pct(x.sharp.turnover ? x.sharp.expectedProfit / x.sharp.turnover : null)} | ${f2(x.zScore)} | ${pct(x.clv.mean)} |`);
    }
    lines.push("");
    for (const by of ["pick", "oddsBand", "sharpEdgeBand", "edgeBand", "eloGap", "phase"] as SegmentBy[]) {
      const seg = p.segments[by];
      if (!seg) continue;
      lines.push(`**By ${by}**`);
      lines.push("");
      lines.push("| Segment | bets | yield | exp. yield | sharp exp. | z | CLV |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |");
      for (const row of seg.rows) {
        lines.push(`| ${row.label} | ${row.counts.settled} | ${pct(row.yield)} | ${pct(row.expectedYield)} | ${pct(row.sharp.turnover ? row.sharp.expectedProfit / row.sharp.turnover : null)} | ${f2(row.zScore)} | ${pct(row.clv.mean)} |`);
      }
      lines.push("");
    }
  }
  if (r.sensitivity) {
    const g = r.sensitivity;
    lines.push("## Sensitivity (chosen on train log loss, reported on test)");
    lines.push("");
    const c = g.chosen;
    lines.push(`Chosen: homeAdv ${c.elo.homeAdv}, K ${c.elo.baseK}, age weighting ${c.elo.timeWeighting ? "on" : "off"}, draw scale ${c.elo.drawFactorScale} → train LL ${f3(c.train.logLoss)} (Δ ${f3(c.train.delta)}), test LL ${f3(c.test.logLoss)} (Δ ${f3(c.test.delta)}). Best train policy there: min edge ${pct(c.policy.minEdge)}, model weight ${c.policy.shrinkWeight}: train yield ${pct(c.policy.trainYield)} (${c.policy.trainBets} bets), test yield ${pct(c.policy.testYield)} (${c.policy.testBets} bets).`);
    lines.push("");
    lines.push("| homeAdv | K | age wt | draw scale | train LL | train Δ | test LL | test Δ | policy (edge / w) | train yield (bets) | test yield (bets) |\n| ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: | --- | ---: | ---: |");
    const sorted = [...g.cells].sort((a, b) => a.train.logLoss - b.train.logLoss);
    for (const cell of sorted.slice(0, 24)) {
      lines.push(`| ${cell.elo.homeAdv} | ${cell.elo.baseK} | ${cell.elo.timeWeighting ? "on" : "off"} | ${cell.elo.drawFactorScale} | ${f3(cell.train.logLoss)} | ${f3(cell.train.delta)} | ${f3(cell.test.logLoss)} | ${f3(cell.test.delta)} | ${pct(cell.policy.minEdge)} / ${cell.policy.shrinkWeight} | ${pct(cell.policy.trainYield)} (${cell.policy.trainBets}) | ${pct(cell.policy.testYield)} (${cell.policy.testBets}) |`);
    }
    if (sorted.length > 24) lines.push(`| … ${sorted.length - 24} more cells in the JSON | | | | | | | | | | |`);
    lines.push("");
  }
  return lines.join("\n");
}
