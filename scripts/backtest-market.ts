/**
 * Walk-forward backtest of the Elo model against stored bookmaker prices.
 *
 *   npm run backtest:market                        # epl, every stored season
 *   npm run backtest:market -- epl --from 2012 --to 2026
 *   npm run backtest:market -- epl --burnin 2 --train-until 2021
 *   npm run backtest:market -- epl --grid          # sensitivity over Elo and policy settings
 *   npm run backtest:market -- epl --rows          # also write the per-bet rows
 *   npm run backtest:market -- epl --homeadv 45 --k 20 --age-weighting
 *   npm run backtest:market -- epl --regress 0.33 --new-team 1450
 *   npm run backtest:market -- epl --margin signed --scale 400 --prob-scale 320
 *
 * Reads data/games/<league>/ and data/odds/<league>/ only (fill them with
 * `npm run games:fetch` and `npm run odds:fetch`). Writes
 * data/reports/backtest-<league>-<stamp>.json and .md, and prints the
 * Markdown. Two runs on the same data give the same hash.
 */
import fs from "fs";
import path from "path";
import { readStoredGames } from "../src/data/gameStore";
import { readAllOdds } from "../src/odds/store";
import {
  buildReport,
  DEFAULT_POLICIES,
  axesFor,
  grid,
  reportMarkdown,
  seasonsOf,
  simulate,
  walkForward,
  WalkForwardConfig,
} from "../src/data/marketBacktest";
import { LeagueId, LEAGUES, isLeagueId } from "../src/utils/leagues";

const args = process.argv.slice(2);
const flag = (name: string) => {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
};
const has = (name: string) => args.includes(name);
const league: LeagueId = isLeagueId(args[0]) ? args[0] : "epl";

const from = flag("--from") ? Number(flag("--from")) : undefined;
const to = flag("--to") ? Number(flag("--to")) : undefined;
const { games, seasons } = readStoredGames(league, from, to);
if (!games.length) {
  console.error(`no stored games for ${league}; run npm run games:fetch -- ${league} <from> <to>`);
  process.exit(1);
}
const odds = readAllOdds(league).filter((o) => seasons.includes(o.season));
if (!odds.length) {
  console.error(`no stored odds for ${league}; run npm run odds:fetch -- ${league} <from> <to>`);
  process.exit(1);
}

const burnIn = Number(flag("--burnin") ?? 2);
const trainUntilYear = Number(flag("--train-until") ?? 2021);
const trainUntil = `${trainUntilYear}${trainUntilYear + 1}`;
const cfg: WalkForwardConfig = {
  league,
  seasons: seasonsOf(games),
  burnInSeasons: burnIn,
  trainUntil,
  elo: {
    homeAdv: Number(flag("--homeadv") ?? LEAGUES[league].homeAdv),
    baseK: Number(flag("--k") ?? LEAGUES[league].baseK),
    timeWeighting: has("--age-weighting"),
    seasonRegression: Number(flag("--regress") ?? 0),
    newTeamElo: Number(flag("--new-team") ?? 1500),
    marginMode: (flag("--margin") as "unsigned" | "signed" | "none" | "points" | undefined) ?? LEAGUES[league].marginMode ?? "unsigned",
    scale: Number(flag("--scale") ?? 400),
    probScale: flag("--prob-scale") ? Number(flag("--prob-scale")) : undefined,
  },
  drawFactorScale: Number(flag("--draw-scale") ?? 1),
};

console.error(
  `${LEAGUES[league].name}: ${games.length} games over ${seasons.length} seasons, ${odds.length} odds rows; ` +
    `burn-in ${burnIn}, train until ${trainUntil}`
);
const t0 = Date.now();
const walk = walkForward(games, odds, cfg);
const sensitivity = has("--grid")
  ? grid(games, odds, cfg, axesFor(LEAGUES[league].sport))
  : null;
const report = buildReport(walk, DEFAULT_POLICIES, sensitivity);
const md = reportMarkdown(report);
console.error(`computed in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

const dir = path.join(process.cwd(), "data", "reports");
fs.mkdirSync(dir, { recursive: true });
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 13);
const base = path.join(dir, `backtest-${league}-${stamp}`);
fs.writeFileSync(`${base}.json`, JSON.stringify(report, null, 1));
fs.writeFileSync(`${base}.md`, md);
if (has("--rows")) {
  const rows = DEFAULT_POLICIES.flatMap((p) => simulate(walk.rows, p, league).rows);
  fs.writeFileSync(`${base}-rows.jsonl`, rows.map((r) => JSON.stringify(r)).join("\n") + "\n");
}
console.log(md);
console.error(`\nwrote ${base}.json and .md`);
