/**
 * Compare Elo settings in one table: train and test log loss against the
 * sharp close, the test delta with its standard error, the test delta by
 * season phase, and the test yield of a flat 3 %-edge policy at the market
 * average close. One line per variant, a second per variant to run.
 *
 *   npm run backtest:compare -- '[{"name":"baseline","elo":{}},{"name":"K 30","elo":{"baseK":30}}]'
 *   npm run backtest:compare -- nhl --train-until 2023 --burnin 1 '[...]'
 *
 * `elo` takes any EloConfig field (src/data/marketBacktest.ts): homeAdv,
 * baseK, timeWeighting, seasonRegression, newTeamElo, marginMode, goalStep,
 * earlyK, scale, probScale, probModel, blendWeight. The acceptance rule is
 * in docs/CONTINUOUS_IMPROVEMENT.md: test delta down by more than 2 × se.
 */
import { readStoredGames } from "../src/data/gameStore";
import { readAllOdds } from "../src/odds/store";
import { walkForward, skillOf, skillMlOf, blendCurve, skillByPhase, seasonsOf, seasonStartYear, simulate, WalkForwardConfig, EloConfig, Policy } from "../src/data/marketBacktest";
import { summarize } from "../src/data/metrics";
import { LeagueId, LEAGUES, isLeagueId } from "../src/utils/leagues";

const argv = process.argv.slice(2);
const league: LeagueId = isLeagueId(argv[0]) ? (argv.shift() as LeagueId) : "epl";
const trainUntilYear = Number(flagValue("--train-until") ?? (league === "epl" ? 2021 : league === "nhl" ? 2023 : 2025));
const variants: { name: string; elo: Partial<EloConfig> }[] = JSON.parse(
  argv.find((a) => a.startsWith("[")) ?? '[{"name":"baseline","elo":{}}]'
);
function flagValue(name: string): string | undefined {
  const i = argv.indexOf(name);
  return i >= 0 ? argv[i + 1] : undefined;
}
const { games, seasons } = readStoredGames(league);
const odds = readAllOdds(league).filter((o) => seasons.includes(o.season));
if (!games.length || !odds.length) {
  console.error("no stored games/odds; run npm run games:fetch and npm run odds:fetch");
  process.exit(1);
}
const base: WalkForwardConfig = {
  league,
  seasons: seasonsOf(games),
  burnInSeasons: Number(flagValue("--burnin") ?? 2),
  trainUntil: `${trainUntilYear}${trainUntilYear + 1}`,
  elo: { homeAdv: LEAGUES[league].homeAdv, baseK: 20, timeWeighting: false, seasonRegression: 0, newTeamElo: 1500 },
  drawFactorScale: 1,
};
console.log(`${LEAGUES[league].name}: ${games.length} games, ${odds.length} odds rows, seasons ${seasons[0]}..${seasons[seasons.length - 1]}, burn-in ${base.burnInSeasons}, train until ${base.trainUntil}`);
const policy: Policy = { id: "p", timing: "close", price: "avg", prob: "model", shrinkWeight: 1, minEdge: 0.03, stake: { kind: "flat", units: 1 } };
const f = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "  –  " : (v >= 0 ? "+" : "") + v.toFixed(3));
console.log("config".padEnd(44), "trainLL  trainΔ   testLL   testΔ(se)      phases 0-5/6-15/16-30/31+     best blend w (gain)   ML testΔ(se)   avg-price yield(test bets)");
for (const v of variants) {
  const cfg = { ...base, elo: { ...base.elo, ...v.elo } };
  const w = walkForward(games, odds, cfg);
  const train = (season: string) => seasonStartYear(season) <= trainUntilYear;
  const tr = skillOf("t", w.rows.filter((r) => train(r.season)));
  const te = skillOf("t", w.rows.filter((r) => !train(r.season)));
  if (!tr || !te) {
    const priced = new Map<string, number>();
    for (const r of w.rows) if (r.pSharp) priced.set(r.season, (priced.get(r.season) ?? 0) + 1);
    console.log(v.name.padEnd(44), `no priced games on the ${!tr ? "train" : "test"} side; priced per season:`, [...priced].map(([k, n]) => `${k}:${n}`).join(" ") || "none");
    continue;
  }
  const ph = skillByPhase(w.rows.filter((r) => !train(r.season))).map((p) => f(p.delta.logLoss)).join("/");
  const sim = summarize(simulate(w.rows.filter((r) => !train(r.season)), policy, league).rows);
  const testRows = w.rows.filter((r) => !train(r.season));
  const curve = blendCurve(testRows);
  const best = curve.reduce((a, b) => (b.logLoss < a.logLoss ? b : a));
  const blend = `w=${best.weight} (${f(best.logLoss - curve[0].logLoss)})`;
  const ml = skillMlOf("ml", testRows);
  const mlText = ml ? `${f(ml.delta.logLoss)}(${ml.deltaLogLossSe.toFixed(3)})` : "   –   ";
  console.log(v.name.padEnd(44), tr.model.logLoss.toFixed(3), " ", f(tr.delta.logLoss), " ", te.model.logLoss.toFixed(3), " ", f(te.delta.logLoss), `(${te.deltaLogLossSe.toFixed(3)})`, " ", ph, " ", blend.padEnd(20), mlText, " ", sim.yield === null ? "–" : (sim.yield * 100).toFixed(1) + "%", `(${sim.counts.settled})`);
}
