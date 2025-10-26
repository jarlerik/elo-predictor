import express from "express";
import { fetchMultipleSeasons } from "../data/nhlFetcher";
import { computeElosFromGames } from "../elo/calculator";
import { eloToWinProb, findTeamElo } from "../elo/probabilities";
import { TeamElo } from "../utils/types";
import { computeRecentStatsForTeam } from "../score/recentStats";
import { computeExpectedGoals } from "../score/expectedGoals";
import {
  computeScoreProbabilities,
  annotateWithMarketOdds,
  topValueBets,
} from "../score/correctScore";

const router = express.Router();

let cachedElos: TeamElo[] | null = null;

async function ensureElos() {
  if (cachedElos) return cachedElos;
  // seasons: 2 previous + current
  const seasons = ["20222023", "20232024", "20242025"];
  const games = await fetchMultipleSeasons(seasons);
  const elos = computeElosFromGames(games);
  cachedElos = elos;
  return elos;
}

router.get("/teams", async (req, res) => {
  try {
    const elos = await ensureElos();
    res.json(elos);
  } catch (e) {
    console.error("failed to fetch team elos", e);
    res.status(500).json({ error: "failed to fetch team elos" });
  }
});

router.get("/predict", async (req, res) => {
  try {
    const home = ((req.query.home as string) || "").toUpperCase();
    const away = ((req.query.away as string) || "").toUpperCase();
    if (!home || !away)
      return res
        .status(400)
        .json({ error: "please provide home and away (abbr)" });

    const elos = await ensureElos();
    const homeTeamElo = findTeamElo(home, elos);
    const awayTeamElo = findTeamElo(away, elos);
    if (!homeTeamElo)
      return res.status(404).json({ error: `team not found: ${home}` });
    if (!awayTeamElo)
      return res.status(404).json({ error: `team not found: ${away}` });

    const probs = eloToWinProb(homeTeamElo.elo, awayTeamElo.elo);

    const minHomeOdd =
      probs.homeWin > 0 ? Math.round((1 / probs.homeWin) * 100) / 100 : 0;
    const minAwayOdd =
      probs.awayWin > 0 ? Math.round((1 / probs.awayWin) * 100) / 100 : 0;

    res.json({
      homeTeam: homeTeamElo.abbr,
      awayTeam: awayTeamElo.abbr,
      homeWinProbability: Math.round(probs.homeWin * 10000) / 10000,
      drawProbability: 0.0,
      awayWinProbability: Math.round(probs.awayWin * 10000) / 10000,
      minHomeOdd,
      minAwayOdd,
      homeElo: homeTeamElo.elo,
      awayElo: awayTeamElo.elo,
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
});

router.get("/predict/score", async (req, res) => {
  try {
    const home = ((req.query.home as string) || "").toUpperCase();
    const away = ((req.query.away as string) || "").toUpperCase();
    if (!home || !away)
      return res
        .status(400)
        .json({ error: "please provide home and away (abbr)" });

    // ensure elos and games loaded
    const seasons = ["20222023", "20232024", "20242025"];
    const games = await fetchMultipleSeasons(seasons); // sorted ascending
    const elos = await ensureElos();
    const homeTeam = elos.find((t: any) => t.abbr.toUpperCase() === home);
    const awayTeam = elos.find((t: any) => t.abbr.toUpperCase() === away);
    if (!homeTeam || !awayTeam)
      return res.status(404).json({ error: "team not found" });

    // compute recent stats
    const homeStats = computeRecentStatsForTeam(home, games, 20);
    const awayStats = computeRecentStatsForTeam(away, games, 20);

    const { lambdaHome, lambdaAway } = computeExpectedGoals(
      homeStats,
      awayStats,
      homeTeam.elo,
      awayTeam.elo
    );

    const probs = computeScoreProbabilities(lambdaHome, lambdaAway, 8);

    // marketOdds optional param as URL-encoded JSON string or plain JSON
    let marketOdds: Record<string, number> | undefined = undefined;
    if (req.query.marketOdds) {
      try {
        const raw = req.query.marketOdds as string;
        marketOdds = JSON.parse(decodeURIComponent(raw));
      } catch (e) {
        // ignore parse errors
      }
    }

    annotateWithMarketOdds(probs, marketOdds);
    const top = topValueBets(probs, 10);

    res.json({
      homeTeam: homeTeam.abbr,
      awayTeam: awayTeam.abbr,
      lambdaHome: Math.round(lambdaHome * 1000) / 1000,
      lambdaAway: Math.round(lambdaAway * 1000) / 1000,
      top10: top,
      allTop100: probs.slice(0, 100),
    });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
});

export default router;
