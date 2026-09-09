/**
 * Grid search of the Elo home advantage per league on the backtest: a full
 * Elo walk and draw-factor refit at each candidate, scored by 1X2 log loss
 * and Brier, with the predicted vs observed home-win rate alongside.
 *
 *   npm run fit:homeadv            # all three leagues
 *   npm run fit:homeadv -- nhl     # one league
 *
 * The chosen values live in LEAGUES[id].homeAdv (src/utils/leagues.ts).
 */
import { ensureLeague } from "../src/data/leagueData";
import { computeElosFromGames } from "../src/elo/calculator";
import {
  fitDrawFactor,
  isRegulationDraw,
  SOCCER_DRAW_FACTOR,
} from "../src/elo/probabilities";
import { backtestLeague } from "../src/data/backtest";
import { LEAGUE_IDS, LEAGUES, LeagueId, isLeagueId } from "../src/utils/leagues";

const arg = process.argv[2];
const leagues: LeagueId[] = arg
  ? arg.split(",").filter(isLeagueId)
  : LEAGUE_IDS;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;

for (const league of leagues) {
  const state = await ensureLeague(league);
  console.log(
    `== ${LEAGUES[league].name}: ${state.games.length} games, current homeAdv ${LEAGUES[league].homeAdv}`
  );
  console.log(
    "homeAdv  logLoss   brier    home pred/obs   draw pred/obs   drawFactor"
  );
  const scores: { homeAdv: number; logLoss: number }[] = [];
  for (let homeAdv = 0; homeAdv <= 120; homeAdv += 10) {
    const elos = computeElosFromGames(state.games, {
      currentTeams: state.currentTeams,
      homeAdv,
    });
    const drawFactor =
      LEAGUES[league].sport === "soccer"
        ? SOCCER_DRAW_FACTOR
        : fitDrawFactor(state.games, elos, isRegulationDraw, { homeAdv });
    const o = backtestLeague(league, { ...state, elos, drawFactor, homeAdv }, homeAdv)
      .overall;
    scores.push({ homeAdv, logLoss: o.logLoss });
    console.log(
      `${String(homeAdv).padStart(7)}  ${o.logLoss.toFixed(4)}  ${o.brier.toFixed(4)}   ` +
        `${pct(o.outcomes.home.predicted)} / ${pct(o.outcomes.home.observed)}   ` +
        `${pct(o.outcomes.draw.predicted)} / ${pct(o.outcomes.draw.observed)}   ` +
        drawFactor.toFixed(3)
    );
  }
  // Log loss is flat near the optimum; list every candidate within 0.0005
  // of the best and let the home-win rate break the tie.
  const min = Math.min(...scores.map((x) => x.logLoss));
  const near = scores.filter((x) => x.logLoss - min < 0.0005).map((x) => x.homeAdv);
  console.log(`lowest log loss at homeAdv ${near.join(" / ")}\n`);
}
