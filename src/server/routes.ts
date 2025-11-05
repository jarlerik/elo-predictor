import express from "express";
import fs from "fs";
import path from "path";
import { fetchMultipleSeasons } from "../data/nhlFetcher";
import { computeElosFromGames } from "../elo/calculator";
import { eloToWinProb, findTeamElo } from "../elo/probabilities";
import { TeamElo } from "../utils/types";
import { computeRecentStatsForTeam } from "../score/recentStats";
import { computeExpectedGoals } from "../score/expectedGoals";
import { computeScoreProbabilities, topValueBets } from "../score/correctScore";

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

router.post("/bets/save", async (req, res) => {
  try {
    const { homeTeam, awayTeam, scores } = req.body;

    if (!homeTeam || !awayTeam || !scores || !Array.isArray(scores)) {
      return res
        .status(400)
        .json({ error: "please provide homeTeam, awayTeam, and scores array" });
    }

    // Format date as DD.MM.YYYY
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const dateStr = `${day}.${month}.${year}`;

    // Generate filename: HOME_ABBR__AWAY_ABBR_DD.MM.YYYY.json
    const filename = `${homeTeam}__${awayTeam}_${dateStr}.json`;

    // Create data/bets directory if it doesn't exist
    const betsDir = path.join(process.cwd(), "data", "bets");
    if (!fs.existsSync(betsDir)) {
      fs.mkdirSync(betsDir, { recursive: true });
    }

    // Format scores for JSON: score, probability, odds (where odds maps to minOdd)
    const formattedScores = scores.map((score: any) => ({
      score: score.score,
      probability: score.probability,
      odds: score.minOdd,
    }));

    // Write JSON file
    const filePath = path.join(betsDir, filename);
    fs.writeFileSync(filePath, JSON.stringify(formattedScores, null, 2));

    res.json({ success: true, filename });
  } catch (e) {
    console.error("failed to save bets", e);
    res.status(500).json({ error: "failed to save bets" });
  }
});

router.get("/bets/list", async (req, res) => {
  try {
    const betsDir = path.join(process.cwd(), "data", "bets");

    if (!fs.existsSync(betsDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(betsDir);
    const jsonFiles = files.filter((file) => file.endsWith(".json"));

    const betsList = jsonFiles
      .map((filename) => {
        // Parse filename: HOME__AWAY_DD.MM.YYYY.json
        const nameWithoutExt = filename.replace(".json", "");
        const parts = nameWithoutExt.split("__"); // Split by double underscore

        if (parts.length < 2) {
          return null;
        }

        const homeTeam = parts[0];
        const rest = parts[1];
        const restParts = rest.split("_");

        if (restParts.length < 2) {
          return null;
        }

        const awayTeam = restParts[0];
        const date = restParts.slice(1).join("_"); // In case date has underscores

        // Read file to count array elements
        const filePath = path.join(betsDir, filename);
        let betCount = 0;
        try {
          const fileContent = fs.readFileSync(filePath, "utf-8");
          const bets = JSON.parse(fileContent);
          if (Array.isArray(bets)) {
            betCount = bets.length;
          }
        } catch (e) {
          console.error(`Failed to read bet file ${filename}:`, e);
        }

        return {
          filename,
          homeTeam,
          awayTeam,
          date,
          betCount,
        };
      })
      .filter((item) => item !== null);

    res.json(betsList);
  } catch (e) {
    console.error("failed to list bets", e);
    res.status(500).json({ error: "failed to list bets" });
  }
});

router.get("/bets/:filename", async (req, res) => {
  try {
    const { filename } = req.params;
    const betsDir = path.join(process.cwd(), "data", "bets");
    const filePath = path.join(betsDir, filename);

    if (!fs.existsSync(filePath)) {
      return res.status(404).json({ error: "Bet file not found" });
    }

    const fileContent = fs.readFileSync(filePath, "utf-8");
    const bets = JSON.parse(fileContent);

    res.json(bets);
  } catch (e) {
    console.error("failed to fetch bet file", e);
    res.status(500).json({ error: "failed to fetch bet file" });
  }
});

router.get("/results", async (req, res) => {
  try {
    const resultsDir = path.join(process.cwd(), "data");
    const resultsPath = path.join(resultsDir, "results.json");

    if (!fs.existsSync(resultsPath)) {
      return res.json([]);
    }

    const fileContent = fs.readFileSync(resultsPath, "utf-8");
    const results = JSON.parse(fileContent);

    if (!Array.isArray(results)) {
      return res.json([]);
    }

    res.json(results);
  } catch (e) {
    console.error("failed to fetch results", e);
    res.status(500).json({ error: "failed to fetch results" });
  }
});

router.post("/results/add", async (req, res) => {
  try {
    const { game, score, probability, odds, return: returnValue } = req.body;

    if (
      !game ||
      !score ||
      probability === undefined ||
      odds === undefined ||
      returnValue === undefined
    ) {
      return res.status(400).json({
        error: "please provide game, score, probability, odds, and return",
      });
    }

    const resultsDir = path.join(process.cwd(), "data");
    const resultsPath = path.join(resultsDir, "results.json");

    // Read existing results or initialize empty array
    let results: any[] = [];
    if (fs.existsSync(resultsPath)) {
      try {
        const fileContent = fs.readFileSync(resultsPath, "utf-8");
        results = JSON.parse(fileContent);
        if (!Array.isArray(results)) {
          results = [];
        }
      } catch (e) {
        console.error(
          "Failed to read results file, initializing new array:",
          e
        );
        results = [];
      }
    } else {
      // Create data directory if it doesn't exist
      if (!fs.existsSync(resultsDir)) {
        fs.mkdirSync(resultsDir, { recursive: true });
      }
    }

    // Create new result item
    const newResult = {
      game,
      score,
      probability,
      odds,
      return: returnValue,
    };

    // Append to array
    results.push(newResult);

    // Write back to file
    fs.writeFileSync(resultsPath, JSON.stringify(results, null, 2));

    res.json({ success: true, result: newResult });
  } catch (e) {
    console.error("failed to save result", e);
    res.status(500).json({ error: "failed to save result" });
  }
});

export default router;
