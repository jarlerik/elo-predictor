/**
 * Model-quality backtest (section A of docs/METRICS_AND_DASHBOARD.md).
 *
 * Walks a league's game history in date order and scores, for every game,
 * the probabilities the model would have shown before it: 1X2 from the Elo
 * ratings as they stood at the time (Davidson draw model), the hockey
 * moneyline, and the correct score from the recent-form Poisson layer. It
 * needs no bets.
 *
 * Two approximations, both deliberate:
 * - The draw factor is the league's fitted value over the whole history
 *   (one scalar), not refitted before each game.
 * - Elo's K factor weights games by their age relative to now (see
 *   calculator.ts), so the ratings "before game i" are those of the live
 *   walk, which is the model as it is actually used.
 *
 * The baseline for Brier and log loss is "always the league's outcome
 * frequencies" over the full history (climatology). The correct-score
 * baseline is an independent Poisson at the league's mean goals per side.
 */
import { GameRecord } from "../utils/types";
import { LeagueId, LEAGUES, Sport } from "../utils/leagues";
import { LeagueState } from "./leagueData";
import { computeElosFromGames } from "../elo/calculator";
import { eloToWinProb, NO_DRAW } from "../elo/probabilities";
import { computeRecentStatsForTeam } from "../score/recentStats";
import { computeExpectedGoals } from "../score/expectedGoals";
import { computeScoreProbabilities, poissonPmf } from "../score/correctScore";

export const HOME_ADV = 60;
/** Games in the rolling window and how often a point is emitted. */
export const ROLLING_WINDOW = 100;
export const ROLLING_STEP = 10;
const BUCKETS = 10;

type Outcome = 0 | 1 | 2; // home, draw, away

/** One scored game. Kept in memory so segments can be re-cut cheaply. */
export interface GamePrediction {
  date: string;
  season: string;
  home: string;
  away: string;
  homeElo: number;
  awayElo: number;
  /** 1X2 probabilities [home, draw, away] and the outcome that happened. */
  p: [number, number, number];
  y: Outcome;
  /** Hockey only: two-way probabilities including OT/SO. */
  ml: { p: [number, number]; y: 0 | 1 } | null;
  score: {
    home: number;
    away: number;
    /** Model probability of the score that happened (tail-clamped). */
    pActual: number;
    /** Probability of the model's most likely score and whether it hit. */
    pTop: number;
    topHit: boolean;
  };
}

export interface Bucket {
  lo: number;
  hi: number;
  count: number;
  /** Mean predicted probability in the bucket. */
  predicted: number;
  /** Share of those predictions that came true. */
  observed: number;
}

export interface Check {
  predicted: number;
  observed: number;
}

export interface Segment {
  label: string;
  n: number;
  from: string;
  to: string;
  brier: number;
  brierBaseline: number;
  logLoss: number;
  logLossBaseline: number;
  outcomes: { home: Check; draw: Check; away: Check };
  buckets: Bucket[];
  bucketsByOutcome: { home: Bucket[]; draw: Bucket[]; away: Bucket[] };
  moneyline: {
    brier: number;
    brierBaseline: number;
    logLoss: number;
    logLossBaseline: number;
    home: Check;
  } | null;
  correctScore: {
    logLoss: number;
    logLossBaseline: number;
    meanProbability: number;
    topScore: Check;
    meanGoals: { home: number; away: number };
  };
}

export interface RollingPoint {
  /** Index of the last game in the window (1-based). */
  index: number;
  date: string;
  brier: number;
  brierBaseline: number;
  logLoss: number;
  logLossBaseline: number;
}

export interface Backtest {
  league: LeagueId;
  name: string;
  sport: Sport;
  market: "regulation" | "fullTime";
  homeAdv: number;
  drawFactor: number;
  games: number;
  overall: Segment;
  seasons: Segment[];
  rolling: { window: number; step: number; points: RollingPoint[] };
  /** Outcome frequencies the baseline scores use. */
  baseline: { home: number; draw: number; away: number };
  /** Not available until bookmaker odds are stored for played games. */
  skillVsMarket: null;
  computedAt: string;
}

const EPS = 1e-12;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** Poisson probability of k goals with everything ≥ maxG collapsed into the last cell. */
function poissonWithTail(k: number, lambda: number, maxG: number): number {
  if (k < maxG) return poissonPmf(k, lambda);
  let below = 0;
  for (let i = 0; i < maxG; i++) below += poissonPmf(i, lambda);
  return Math.max(0, 1 - below);
}

function outcomeOf(g: GameRecord, sport: Sport): Outcome {
  if (sport === "hockey" && g.decidedInOTorSO) return 1;
  if (g.homeGoals > g.awayGoals) return 0;
  if (g.awayGoals > g.homeGoals) return 2;
  return 1;
}

/** Score every game of the league once. */
export function predictHistory(
  league: LeagueId,
  state: LeagueState,
  homeAdv = HOME_ADV
): GamePrediction[] {
  const sport = LEAGUES[league].sport;
  const maxGoals = sport === "soccer" ? 6 : 8;
  const drawFactor = state.drawFactor;
  const out: GamePrediction[] = [];
  // Per-team history so far, for the recent-form layer. Same result as
  // filtering the full list, without the quadratic cost.
  const played = new Map<string, GameRecord[]>();
  const history = (abbr: string) => {
    let list = played.get(abbr);
    if (!list) {
      list = [];
      played.set(abbr, list);
    }
    return list;
  };

  computeElosFromGames(state.games, {
    currentTeams: state.currentTeams,
    homeAdv,
    onGame: (g, homeElo, awayElo) => {
      const probs = eloToWinProb(homeElo, awayElo, homeAdv, drawFactor);
      const p: [number, number, number] = [
        probs.homeWin,
        probs.draw,
        probs.awayWin,
      ];

      let ml: GamePrediction["ml"] = null;
      if (sport === "hockey") {
        const two = eloToWinProb(homeElo, awayElo, homeAdv, NO_DRAW);
        ml = {
          p: [two.homeWin, two.awayWin],
          y: g.homeGoals > g.awayGoals ? 0 : 1,
        };
      }

      const homeStats = computeRecentStatsForTeam(g.homeAbbr, history(g.homeAbbr), 20);
      const awayStats = computeRecentStatsForTeam(g.awayAbbr, history(g.awayAbbr), 20);
      const { lambdaHome, lambdaAway } = computeExpectedGoals(
        homeStats,
        awayStats,
        homeElo,
        awayElo
      );
      const scores = computeScoreProbabilities(lambdaHome, lambdaAway, maxGoals);
      const h = Math.min(g.homeGoals, maxGoals);
      const a = Math.min(g.awayGoals, maxGoals);
      const actual = scores.find((s) => s.home === h && s.away === a);
      const top = scores[0];

      out.push({
        date: g.date,
        season: g.season,
        home: g.homeAbbr,
        away: g.awayAbbr,
        homeElo,
        awayElo,
        p,
        y: outcomeOf(g, sport),
        ml,
        score: {
          home: g.homeGoals,
          away: g.awayGoals,
          pActual: actual?.probability ?? 0,
          pTop: top.probability,
          topHit: top.home === h && top.away === a,
        },
      });

      history(g.homeAbbr).push(g);
      history(g.awayAbbr).push(g);
    },
  });
  return out;
}

/** "Always the league average": frequencies over the whole history. */
export interface Baseline {
  /** 1X2 outcome frequencies [home, draw, away]. */
  p: [number, number, number];
  /** Two-way home-win rate incl. OT/SO (hockey), null otherwise. */
  mlHome: number | null;
  /** Mean goals per side, for the constant-Poisson score baseline. */
  meanGoals: { home: number; away: number };
}

export function baselineOf(games: GamePrediction[]): Baseline {
  const f: [number, number, number] = [0, 0, 0];
  let mlN = 0;
  let mlHome = 0;
  let goalsHome = 0;
  let goalsAway = 0;
  for (const g of games) {
    f[g.y]++;
    if (g.ml) {
      mlN++;
      if (g.ml.y === 0) mlHome++;
    }
    goalsHome += g.score.home;
    goalsAway += g.score.away;
  }
  const n = games.length || 1;
  return {
    p: [f[0] / n, f[1] / n, f[2] / n],
    mlHome: mlN > 0 ? mlHome / mlN : null,
    meanGoals: { home: goalsHome / n, away: goalsAway / n },
  };
}

function brierOf(p: number[], y: number): number {
  let s = 0;
  for (let i = 0; i < p.length; i++) s += (p[i] - (i === y ? 1 : 0)) ** 2;
  return s;
}

const logLossOf = (p: number[], y: number) => -Math.log(Math.max(p[y], EPS));

export function emptyBuckets(): Bucket[] {
  return Array.from({ length: BUCKETS }, (_, i) => ({
    lo: i / BUCKETS,
    hi: (i + 1) / BUCKETS,
    count: 0,
    predicted: 0,
    observed: 0,
  }));
}

export function addToBucket(buckets: Bucket[], p: number, hit: boolean) {
  const i = Math.min(BUCKETS - 1, Math.floor(p * BUCKETS));
  const b = buckets[i];
  b.count++;
  b.predicted += p;
  b.observed += hit ? 1 : 0;
}

export function finishBuckets(buckets: Bucket[]): Bucket[] {
  return buckets.map((b) => ({
    ...b,
    predicted: b.count ? round4(b.predicted / b.count) : 0,
    observed: b.count ? round4(b.observed / b.count) : 0,
  }));
}

/** Score a set of games against the league-wide baseline. */
export function segmentOf(
  label: string,
  games: GamePrediction[],
  baseline: Baseline,
  maxGoals: number
): Segment {
  const base = baseline.p;
  const mlBase =
    baseline.mlHome === null ? null : [baseline.mlHome, 1 - baseline.mlHome];
  const n = games.length;
  let brier = 0;
  let brierBase = 0;
  let logLoss = 0;
  let logLossBase = 0;
  const predicted = [0, 0, 0];
  const observed = [0, 0, 0];
  const pooled = emptyBuckets();
  const byOutcome = [emptyBuckets(), emptyBuckets(), emptyBuckets()];

  let mlN = 0;
  let mlBrier = 0;
  let mlBrierBase = 0;
  let mlLogLoss = 0;
  let mlLogLossBase = 0;
  let mlHomePred = 0;
  let mlHomeObs = 0;

  let scoreLogLoss = 0;
  let scoreProb = 0;
  let topPred = 0;
  let topHits = 0;
  let goalsHome = 0;
  let goalsAway = 0;

  for (const g of games) {
    brier += brierOf(g.p, g.y);
    brierBase += brierOf(base, g.y);
    logLoss += logLossOf(g.p, g.y);
    logLossBase += logLossOf(base, g.y);
    for (let o = 0; o < 3; o++) {
      predicted[o] += g.p[o];
      if (g.y === o) observed[o]++;
      addToBucket(pooled, g.p[o], g.y === o);
      addToBucket(byOutcome[o], g.p[o], g.y === o);
    }
    if (g.ml && mlBase) {
      mlN++;
      mlBrier += brierOf(g.ml.p, g.ml.y);
      mlBrierBase += brierOf(mlBase, g.ml.y);
      mlLogLoss += logLossOf(g.ml.p, g.ml.y);
      mlLogLossBase += logLossOf(mlBase, g.ml.y);
      mlHomePred += g.ml.p[0];
      if (g.ml.y === 0) mlHomeObs++;
    }
    scoreLogLoss += -Math.log(Math.max(g.score.pActual, EPS));
    scoreProb += g.score.pActual;
    topPred += g.score.pTop;
    if (g.score.topHit) topHits++;
    goalsHome += g.score.home;
    goalsAway += g.score.away;
  }

  // Correct-score baseline: independent Poisson at the league's mean goals.
  const { home: baseHome, away: baseAway } = baseline.meanGoals;
  let scoreLogLossBase = 0;
  for (const g of games) {
    const ph = poissonWithTail(Math.min(g.score.home, maxGoals), baseHome, maxGoals);
    const pa = poissonWithTail(Math.min(g.score.away, maxGoals), baseAway, maxGoals);
    scoreLogLossBase += -Math.log(Math.max(ph * pa, EPS));
  }
  const meanHome = n ? goalsHome / n : 0;
  const meanAway = n ? goalsAway / n : 0;

  const d = n || 1;
  const check = (o: number): Check => ({
    predicted: round4(predicted[o] / d),
    observed: round4(observed[o] / d),
  });

  return {
    label,
    n,
    from: games[0]?.date ?? "",
    to: games[n - 1]?.date ?? "",
    brier: round4(brier / d),
    brierBaseline: round4(brierBase / d),
    logLoss: round4(logLoss / d),
    logLossBaseline: round4(logLossBase / d),
    outcomes: { home: check(0), draw: check(1), away: check(2) },
    buckets: finishBuckets(pooled),
    bucketsByOutcome: {
      home: finishBuckets(byOutcome[0]),
      draw: finishBuckets(byOutcome[1]),
      away: finishBuckets(byOutcome[2]),
    },
    moneyline:
      mlN > 0
        ? {
            brier: round4(mlBrier / mlN),
            brierBaseline: round4(mlBrierBase / mlN),
            logLoss: round4(mlLogLoss / mlN),
            logLossBaseline: round4(mlLogLossBase / mlN),
            home: {
              predicted: round4(mlHomePred / mlN),
              observed: round4(mlHomeObs / mlN),
            },
          }
        : null,
    correctScore: {
      logLoss: round4(scoreLogLoss / d),
      logLossBaseline: round4(scoreLogLossBase / d),
      meanProbability: round4(scoreProb / d),
      topScore: {
        predicted: round4(topPred / d),
        observed: round4(topHits / d),
      },
      meanGoals: { home: round4(meanHome), away: round4(meanAway) },
    },
  };
}

/** "20252026" → "2025-26"; Liiga's "2026" (season end year) → "2025-26". */
export function seasonLabel(season: string): string {
  if (/^\d{8}$/.test(season)) return `${season.slice(0, 4)}-${season.slice(6)}`;
  if (/^\d{4}$/.test(season)) {
    const end = Number(season);
    return `${end - 1}-${String(end).slice(2)}`;
  }
  return season;
}

function rollingSeries(
  games: GamePrediction[],
  baseline: Baseline
): RollingPoint[] {
  const points: RollingPoint[] = [];
  if (games.length < ROLLING_WINDOW) return points;
  const b = games.map((g) => brierOf(g.p, g.y));
  const bb = games.map((g) => brierOf(baseline.p, g.y));
  const l = games.map((g) => logLossOf(g.p, g.y));
  const lb = games.map((g) => logLossOf(baseline.p, g.y));
  const sum = (arr: number[], end: number) => {
    let s = 0;
    for (let i = end - ROLLING_WINDOW; i < end; i++) s += arr[i];
    return s / ROLLING_WINDOW;
  };
  for (let end = ROLLING_WINDOW; end <= games.length; end += ROLLING_STEP) {
    points.push({
      index: end,
      date: games[end - 1].date,
      brier: round4(sum(b, end)),
      brierBaseline: round4(sum(bb, end)),
      logLoss: round4(sum(l, end)),
      logLossBaseline: round4(sum(lb, end)),
    });
  }
  const last = games.length;
  if (points[points.length - 1]?.index !== last) {
    points.push({
      index: last,
      date: games[last - 1].date,
      brier: round4(sum(b, last)),
      brierBaseline: round4(sum(bb, last)),
      logLoss: round4(sum(l, last)),
      logLossBaseline: round4(sum(lb, last)),
    });
  }
  return points;
}

export function backtestLeague(
  league: LeagueId,
  state: LeagueState,
  homeAdv = HOME_ADV
): Backtest {
  const info = LEAGUES[league];
  const maxGoals = info.sport === "soccer" ? 6 : 8;
  const games = predictHistory(league, state, homeAdv);
  const baseline = baselineOf(games);

  const bySeason = new Map<string, GamePrediction[]>();
  for (const g of games) {
    const list = bySeason.get(g.season);
    if (list) list.push(g);
    else bySeason.set(g.season, [g]);
  }

  return {
    league,
    name: info.name,
    sport: info.sport,
    market: info.sport === "hockey" ? "regulation" : "fullTime",
    homeAdv,
    drawFactor: state.drawFactor,
    games: games.length,
    baseline: {
      home: round4(baseline.p[0]),
      draw: round4(baseline.p[1]),
      away: round4(baseline.p[2]),
    },
    overall: segmentOf("All seasons", games, baseline, maxGoals),
    seasons: [...bySeason.entries()].map(([season, list]) =>
      segmentOf(seasonLabel(season), list, baseline, maxGoals)
    ),
    rolling: {
      window: ROLLING_WINDOW,
      step: ROLLING_STEP,
      points: rollingSeries(games, baseline),
    },
    skillVsMarket: null,
    computedAt: new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Cache: one backtest per league, tied to the LeagueState it was computed
// from, so it is redone exactly when the game history is refreshed.
// ---------------------------------------------------------------------------

const cache = new Map<LeagueId, { loadedAt: number; result: Backtest }>();

export function backtestFor(league: LeagueId, state: LeagueState): Backtest {
  const hit = cache.get(league);
  if (hit && hit.loadedAt === state.loadedAt) return hit.result;
  const result = backtestLeague(league, state);
  cache.set(league, { loadedAt: state.loadedAt, result });
  return result;
}
