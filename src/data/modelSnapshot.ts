/**
 * The model's view of one pairing at bet time, for the ledger's
 * `probability` and `model` fields: Elo ratings and 1X2 / two-way
 * probabilities from the league state (NHL, Liiga, EPL, NBA), the
 * Champions League ratings, or the seeded national-team ratings.
 */
import fs from "fs";
import path from "path";
import { ensureLeague } from "./leagueData";
import { ensureUcl } from "./uclFetcher";
import { LedgerLeague, LedgerMarket, ModelSnapshot } from "./ledger";
import { eloToWinProb, findTeamElo, NO_DRAW, SOCCER_DRAW_FACTOR } from "../elo/probabilities";
import { LEAGUES, isLeagueId } from "../utils/leagues";

export interface ModelView {
  snapshot: ModelSnapshot;
  /** Probability of each side of the bet's market. */
  probs: Record<string, number>;
}

const r4 = (x: number) => Math.round(x * 10000) / 10000;

/** Null when a team is unknown to the model or the league has no ratings. */
export async function modelView(
  league: LedgerLeague,
  home: string,
  away: string,
  market: LedgerMarket
): Promise<ModelView | null> {
  let homeElo: number | null = null;
  let awayElo: number | null = null;
  let homeAdv = 60;
  let drawFactor = SOCCER_DRAW_FACTOR;
  if (isLeagueId(league)) {
    const state = await ensureLeague(league);
    homeElo = findTeamElo(home, state.elos)?.elo ?? null;
    awayElo = findTeamElo(away, state.elos)?.elo ?? null;
    homeAdv = state.homeAdv;
    drawFactor = state.drawFactor;
    // The two-way winner incl. overtime has no draw (basketball's state
    // draw factor is already zero).
    if (LEAGUES[league].sport !== "soccer" && market === "moneyline") drawFactor = NO_DRAW;
  } else if (league === "ucl") {
    const { ratings } = await ensureUcl();
    homeElo = ratings[home] ?? null;
    awayElo = ratings[away] ?? null;
  } else if (league === "worldcup") {
    const file = path.join(process.cwd(), "data", "soccer", "ratings.json");
    const raw = JSON.parse(fs.readFileSync(file, "utf-8"));
    const ratings = (raw.ratings ?? raw) as Record<string, number>;
    homeElo = ratings[home] ?? null;
    awayElo = ratings[away] ?? null;
    homeAdv = 0; // neutral venues
  }
  if (homeElo == null || awayElo == null) return null;
  const p = eloToWinProb(homeElo, awayElo, homeAdv, drawFactor);
  const probs: Record<string, number> =
    market === "moneyline"
      ? { home: r4(p.homeWin), away: r4(p.awayWin) }
      : { home: r4(p.homeWin), draw: r4(p.draw), away: r4(p.awayWin) };
  return {
    snapshot: {
      probs: { home: r4(p.homeWin), draw: r4(p.draw), away: r4(p.awayWin) },
      homeElo: Math.round(homeElo * 10) / 10,
      awayElo: Math.round(awayElo * 10) / 10,
      drawFactor,
      homeAdv,
    },
    probs,
  };
}
