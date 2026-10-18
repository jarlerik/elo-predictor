/**
 * Compare Elo settings in one table: train and test log loss against the
 * sharp close, the test delta with its standard error, the test delta by
 * season phase, and the test yield of a flat 3 %-edge policy at the market
 * average close. One line per variant, a second per variant to run.
 *
 *   npm run backtest:compare -- '[{"name":"baseline","elo":{}},{"name":"K 30","elo":{"baseK":30}}]'
 *
 * `elo` takes any EloConfig field (src/data/marketBacktest.ts): homeAdv,
 * baseK, timeWeighting, seasonRegression, newTeamElo, marginMode, goalStep,
 * earlyK, scale, probScale, probModel, blendWeight. The acceptance rule is
 * in docs/CONTINUOUS_IMPROVEMENT.md: test delta down by more than 2 × se.
 */
import { readStoredGames } from "../src/data/gameStore";
import { readAllOdds } from "../src/odds/store";
import { walkForward, skillOf, skillByPhase, seasonsOf, simulate, WalkForwardConfig, EloConfig, Policy } from "../src/data/marketBacktest";
import { summarize } from "../src/data/metrics";

const { games, seasons } = readStoredGames("epl");
const odds = readAllOdds("epl").filter((o) => seasons.includes(o.season));
if (!games.length || !odds.length) {
  console.error("no stored games/odds; run npm run games:fetch and npm run odds:fetch");
  process.exit(1);
}
const base: WalkForwardConfig = { league: "epl", seasons: seasonsOf(games), burnInSeasons: 2, trainUntil: "20212022", elo: { homeAdv: 45, baseK: 20, timeWeighting: false, seasonRegression: 0, newTeamElo: 1500 }, drawFactorScale: 1 };
const policy: Policy = { id: "p", timing: "close", price: "avg", prob: "model", shrinkWeight: 1, minEdge: 0.03, stake: { kind: "flat", units: 1 } };
const f = (v: number | undefined) => (v === undefined || Number.isNaN(v) ? "  –  " : (v >= 0 ? "+" : "") + v.toFixed(3));
const league = "epl";
const variants: { name: string; elo: Partial<EloConfig> }[] = JSON.parse(
  process.argv[2] ?? '[{"name":"baseline","elo":{}}]'
);
console.log("config".padEnd(44), "trainLL  trainΔ   testLL   testΔ(se)      phases 0-5/6-15/16-30/31+        avg-price yield(test bets)");
for (const v of variants) {
  const cfg = { ...base, elo: { ...base.elo, ...v.elo } };
  const w = walkForward(games, odds, cfg);
  const tr = skillOf("t", w.rows.filter((r) => r.season <= cfg.trainUntil))!;
  const te = skillOf("t", w.rows.filter((r) => r.season > cfg.trainUntil))!;
  const ph = skillByPhase(w.rows.filter((r) => r.season > cfg.trainUntil)).map((p) => f(p.delta.logLoss)).join("/");
  const sim = summarize(simulate(w.rows.filter((r) => r.season > cfg.trainUntil), policy, league).rows);
  console.log(v.name.padEnd(44), tr.model.logLoss.toFixed(3), " ", f(tr.delta.logLoss), " ", te.model.logLoss.toFixed(3), " ", f(te.delta.logLoss), `(${te.deltaLogLossSe.toFixed(3)})`, " ", ph, " ", sim.yield === null ? "–" : (sim.yield * 100).toFixed(1) + "%", `(${sim.counts.settled})`);
}
