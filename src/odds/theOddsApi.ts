/**
 * The Odds API (the-odds-api.com): paid historical snapshots of every
 * bookmaker's prices at 5-minute intervals since June 2020, for the NHL and
 * most soccer leagues. Not wired up; this is the slot for it.
 *
 * Shape to implement when a key is available:
 *   GET /v4/historical/sports/{sport}/odds?apiKey&regions=eu&markets=h2h,h2h_3_way&date=<ISO>
 *   -> [{ id, commence_time, home_team, away_team,
 *         bookmakers: [{ key: "pinnacle", markets: [{ key, outcomes: [{ name, price }] }] }] }]
 * One call per game day at ~an hour before the first puck drop gives the
 * closing lines of that day's games (10 credits per region per market).
 * Sport keys: icehockey_nhl, soccer_epl. Map `home_team`/`away_team` with
 * a provider alias table like src/odds/aliases.ts.
 */
import { OddsProvider } from "./types";

export const theOddsApiProvider: OddsProvider = {
  id: "the-odds-api",
  supports: () => false,
  async fetchSeason() {
    throw new Error("the-odds-api: not configured (see src/odds/theOddsApi.ts)");
  },
};
