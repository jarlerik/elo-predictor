import express from "express";
import fs from "fs";
import path from "path";
import { ensureLeague } from "../data/leagueData";
import { ensureUcl } from "../data/uclFetcher";
import {
  eloToWinProb,
  findTeamElo,
  NO_DRAW,
  SOCCER_DRAW_FACTOR,
} from "../elo/probabilities";
import { LeagueId, LEAGUES, isLeagueId } from "../utils/leagues";
import { computeRecentStatsForTeam } from "../score/recentStats";
import { computeExpectedGoals } from "../score/expectedGoals";
import { computeScoreProbabilities, topValueBets } from "../score/correctScore";
import {
  soccerExpectedGoals,
  SOCCER_BASE_TOTAL,
} from "../score/soccerGoals";
import {
  appendLedger,
  ensureLedger,
  inferLeague,
  isLedgerLeague,
  LedgerLeague,
  LedgerMarket,
  LedgerRow,
  ModelSnapshot,
  newRow,
  round2,
  settleRows,
} from "../data/ledger";
import { isSegmentBy, segments, summarize } from "../data/metrics";
import { backtestFor } from "../data/backtest";

const router = express.Router();

// Optional bet metadata shared by both save endpoints. Everything here is
// nullable: the bet forms send what they have and the ledger keeps the gaps.
function betMeta(body: any, home: string, away: string) {
  const league: LedgerLeague | null = isLedgerLeague(body.league)
    ? body.league
    : inferLeague(home, away);
  const bookmaker =
    typeof body.bookmaker === "string" && body.bookmaker.trim()
      ? body.bookmaker.trim()
      : null;
  let marketOdds: Record<string, number> | null = null;
  if (body.marketOdds && typeof body.marketOdds === "object") {
    marketOdds = {};
    for (const [k, v] of Object.entries(body.marketOdds)) {
      const n = Number(v);
      if (Number.isFinite(n) && n > 1) marketOdds[k] = n;
    }
    if (Object.keys(marketOdds).length === 0) marketOdds = null;
  }
  const model: ModelSnapshot | null =
    body.model && typeof body.model === "object" ? body.model : null;
  const numOrNull = (v: unknown) => {
    const n = Number(v);
    return v !== undefined && v !== null && Number.isFinite(n) ? n : null;
  };
  return {
    league,
    bookmaker,
    marketOdds,
    model,
    bankrollBefore: numOrNull(body.bankrollBefore),
    kellyDivider: numOrNull(body.kellyDivider),
  };
}

// Stake in euros for a bet entry. Bets saved before stakes were tracked have
// no stake field and are counted as 1€ each.
const DEFAULT_STAKE = 1;

function parseStake(value: unknown): number | null {
  if (value === undefined || value === null || value === "") {
    return DEFAULT_STAKE;
  }
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) {
    return null;
  }
  return Math.round(n * 100) / 100;
}

// Game-history leagues (NHL, Liiga, Premier League) share the endpoints
// below and are selected with ?league=nhl|liiga|epl (default: nhl).
function leagueFrom(req: express.Request): LeagueId | null {
  const raw = req.query.league;
  if (raw === undefined || raw === "") return "nhl";
  const id = String(raw).toLowerCase();
  return isLeagueId(id) ? id : null;
}

const fairOdd = (p: number) => (p > 0 ? Math.round((1 / p) * 100) / 100 : 0);

router.get("/leagues", (req, res) => {
  res.json(Object.values(LEAGUES));
});

router.get("/teams", async (req, res) => {
  const league = leagueFrom(req);
  if (!league) return res.status(400).json({ error: "unknown league" });
  try {
    const { elos } = await ensureLeague(league);
    res.json(elos);
  } catch (e) {
    console.error(`failed to fetch team elos (${league})`, e);
    res.status(500).json({ error: "failed to fetch team elos" });
  }
});

router.get("/predict", async (req, res) => {
  const league = leagueFrom(req);
  if (!league) return res.status(400).json({ error: "unknown league" });
  try {
    const home = ((req.query.home as string) || "").toUpperCase();
    const away = ((req.query.away as string) || "").toUpperCase();
    if (!home || !away)
      return res
        .status(400)
        .json({ error: "please provide home and away (abbr)" });

    const { elos, drawFactor } = await ensureLeague(league);
    const homeTeamElo = findTeamElo(home, elos);
    const awayTeamElo = findTeamElo(away, elos);
    if (!homeTeamElo)
      return res.status(404).json({ error: `team not found: ${home}` });
    if (!awayTeamElo)
      return res.status(404).json({ error: `team not found: ${away}` });

    // 1X2 market. Soccer: full-time result. Hockey: 60-minute result, where
    // a game tied after regulation (goes to OT/SO) is the draw; the league's
    // draw factor is fitted from its OT/SO rate.
    const sport = LEAGUES[league].sport;
    const probs = eloToWinProb(
      homeTeamElo.elo,
      awayTeamElo.elo,
      undefined,
      drawFactor
    );

    const body: Record<string, unknown> = {
      league,
      market: sport === "hockey" ? "regulation" : "fullTime",
      drawFactor,
      homeTeam: homeTeamElo.abbr,
      awayTeam: awayTeamElo.abbr,
      homeWinProbability: Math.round(probs.homeWin * 10000) / 10000,
      drawProbability: Math.round(probs.draw * 10000) / 10000,
      awayWinProbability: Math.round(probs.awayWin * 10000) / 10000,
      minHomeOdd: fairOdd(probs.homeWin),
      minDrawOdd: fairOdd(probs.draw),
      minAwayOdd: fairOdd(probs.awayWin),
      homeElo: homeTeamElo.elo,
      awayElo: awayTeamElo.elo,
    };

    // Hockey also has a two-way market that includes OT/SO (moneyline).
    if (sport === "hockey") {
      const ml = eloToWinProb(
        homeTeamElo.elo,
        awayTeamElo.elo,
        undefined,
        NO_DRAW
      );
      body.moneyline = {
        homeWinProbability: Math.round(ml.homeWin * 10000) / 10000,
        awayWinProbability: Math.round(ml.awayWin * 10000) / 10000,
        minHomeOdd: fairOdd(ml.homeWin),
        minAwayOdd: fairOdd(ml.awayWin),
      };
    }

    res.json(body);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "failed" });
  }
});

// ---------------------------------------------------------------------------
// Seeded-rating soccer competitions: World Cup (national teams, seeded from
// eloratings.net) and Champions League (clubs, seeded from clubelo.com and
// updated with played games). Selected with ?competition=worldcup|ucl.
// ---------------------------------------------------------------------------

type SoccerCompetition = "worldcup" | "ucl";

interface SoccerContext {
  competition: SoccerCompetition;
  ratings: Record<string, number>;
  /** World Cup games are at neutral venues; Champions League games are not. */
  defaultNeutral: boolean;
}

// National-team ratings, loaded once from the seed file.
let cachedSoccerRatings: Record<string, number> | null = null;

function loadSoccerRatings(): Record<string, number> {
  if (cachedSoccerRatings) return cachedSoccerRatings;
  const ratingsPath = path.join(
    process.cwd(),
    "data",
    "soccer",
    "ratings.json"
  );
  const raw = JSON.parse(fs.readFileSync(ratingsPath, "utf-8"));
  cachedSoccerRatings = (raw.ratings ?? raw) as Record<string, number>;
  return cachedSoccerRatings;
}

async function soccerContext(
  req: express.Request
): Promise<SoccerContext | null> {
  const raw = String(req.query.competition ?? "worldcup").toLowerCase();
  if (raw === "worldcup")
    return {
      competition: "worldcup",
      ratings: loadSoccerRatings(),
      defaultNeutral: true,
    };
  if (raw === "ucl") {
    const { ratings } = await ensureUcl();
    return { competition: "ucl", ratings, defaultNeutral: false };
  }
  return null;
}

const num = (v: unknown) => (v === undefined ? undefined : Number(v as string));

/** Home advantage in Elo points: ?homeAdv= wins, then ?neutral=, then the competition default. */
function homeAdvFrom(req: express.Request, defaultNeutral: boolean): number {
  const homeAdvParam = num(req.query.homeAdv);
  if (homeAdvParam !== undefined && !Number.isNaN(homeAdvParam))
    return homeAdvParam;
  const neutral =
    req.query.neutral === undefined
      ? defaultNeutral
      : req.query.neutral !== "false";
  return neutral ? 0 : 60;
}

// Champions League standings-style view: seed, current rating, games played.
router.get("/ucl/teams", async (req, res) => {
  try {
    const { teams, seedRefreshed } = await ensureUcl();
    res.json({ seedRefreshed, teams });
  } catch (e) {
    console.error("failed to load ucl teams", e);
    res.status(500).json({ error: "failed to load ucl teams" });
  }
});

// List teams with their current ratings (mirrors /teams).
router.get("/soccer/teams", async (req, res) => {
  try {
    const ctx = await soccerContext(req);
    if (!ctx) return res.status(400).json({ error: "unknown competition" });
    const teams = Object.entries(ctx.ratings)
      .map(([abbr, elo]) => ({ abbr, elo }))
      .sort((a, b) => b.elo - a.elo);
    res.json(teams);
  } catch (e) {
    console.error("failed to load soccer teams", e);
    res.status(500).json({ error: "failed to load soccer teams" });
  }
});

// 1X2 (home / draw / away) prediction for a seeded soccer competition.
// Defaults: the competition's venue rule and the soccer draw factor (ν).
// Ratings can be overridden per request via ?homeElo=&awayElo= so it's
// testable without seeded teams.
router.get("/predict/soccer", async (req, res) => {
  try {
    const home = ((req.query.home as string) || "").toUpperCase();
    const away = ((req.query.away as string) || "").toUpperCase();
    if (!home || !away)
      return res
        .status(400)
        .json({ error: "please provide home and away (3-letter code)" });

    const ctx = await soccerContext(req);
    if (!ctx) return res.status(400).json({ error: "unknown competition" });

    const homeElo = num(req.query.homeElo) ?? ctx.ratings[home];
    const awayElo = num(req.query.awayElo) ?? ctx.ratings[away];
    if (homeElo === undefined || Number.isNaN(homeElo))
      return res.status(404).json({ error: `unknown team / no rating: ${home}` });
    if (awayElo === undefined || Number.isNaN(awayElo))
      return res.status(404).json({ error: `unknown team / no rating: ${away}` });

    // Single-match knockouts can't draw -> pass ?drawFactor=0.
    const drawFactorParam = num(req.query.drawFactor);
    const drawFactor =
      drawFactorParam !== undefined && !Number.isNaN(drawFactorParam)
        ? drawFactorParam
        : SOCCER_DRAW_FACTOR;

    const homeAdv = homeAdvFrom(req, ctx.defaultNeutral);

    const probs = eloToWinProb(homeElo, awayElo, homeAdv, drawFactor);

    res.json({
      competition: ctx.competition,
      homeTeam: home,
      awayTeam: away,
      homeElo,
      awayElo,
      homeAdv,
      drawFactor,
      homeWinProbability: Math.round(probs.homeWin * 10000) / 10000,
      drawProbability: Math.round(probs.draw * 10000) / 10000,
      awayWinProbability: Math.round(probs.awayWin * 10000) / 10000,
      minHomeOdd: fairOdd(probs.homeWin),
      minDrawOdd: fairOdd(probs.draw),
      minAwayOdd: fairOdd(probs.awayWin),
    });
  } catch (e) {
    console.error("failed to predict soccer", e);
    res.status(500).json({ error: "failed to predict soccer" });
  }
});

// Correct-score odds for a seeded soccer competition, derived from Elo via
// the supremacy+total model (no game history needed). Mirrors the response
// shape of /predict/score so the ScorePrediction UI component renders it.
router.get("/predict/soccer/score", async (req, res) => {
  try {
    const home = ((req.query.home as string) || "").toUpperCase();
    const away = ((req.query.away as string) || "").toUpperCase();
    if (!home || !away)
      return res
        .status(400)
        .json({ error: "please provide home and away (3-letter code)" });

    const ctx = await soccerContext(req);
    if (!ctx) return res.status(400).json({ error: "unknown competition" });

    const homeElo = num(req.query.homeElo) ?? ctx.ratings[home];
    const awayElo = num(req.query.awayElo) ?? ctx.ratings[away];
    if (homeElo === undefined || Number.isNaN(homeElo))
      return res.status(404).json({ error: `unknown team / no rating: ${home}` });
    if (awayElo === undefined || Number.isNaN(awayElo))
      return res.status(404).json({ error: `unknown team / no rating: ${away}` });

    const homeAdv = homeAdvFrom(req, ctx.defaultNeutral);

    const baseTotalParam = num(req.query.baseTotal);
    const baseTotal =
      baseTotalParam !== undefined && !Number.isNaN(baseTotalParam)
        ? baseTotalParam
        : SOCCER_BASE_TOTAL;

    const { lambdaHome, lambdaAway } = soccerExpectedGoals(
      homeElo,
      awayElo,
      homeAdv,
      baseTotal
    );

    // Soccer rarely exceeds ~6 goals/side; cap there.
    const probs = computeScoreProbabilities(lambdaHome, lambdaAway, 6);
    const top = topValueBets(probs, 10);

    res.json({
      competition: ctx.competition,
      homeTeam: home,
      awayTeam: away,
      lambdaHome: Math.round(lambdaHome * 1000) / 1000,
      lambdaAway: Math.round(lambdaAway * 1000) / 1000,
      top10: top,
      allTop100: probs.slice(0, 100),
    });
  } catch (e) {
    console.error("failed to predict soccer score", e);
    res.status(500).json({ error: "failed to predict soccer score" });
  }
});

router.get("/predict/score", async (req, res) => {
  const league = leagueFrom(req);
  if (!league) return res.status(400).json({ error: "unknown league" });
  try {
    const home = ((req.query.home as string) || "").toUpperCase();
    const away = ((req.query.away as string) || "").toUpperCase();
    if (!home || !away)
      return res
        .status(400)
        .json({ error: "please provide home and away (abbr)" });

    // games are sorted ascending; elos already computed from them
    const { games, elos } = await ensureLeague(league);
    const homeTeam = findTeamElo(home, elos);
    const awayTeam = findTeamElo(away, elos);
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

    // Soccer rarely exceeds ~6 goals/side; hockey needs more headroom.
    const maxGoals = LEAGUES[league].sport === "soccer" ? 6 : 8;
    const probs = computeScoreProbabilities(lambdaHome, lambdaAway, maxGoals);

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
      league,
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
    const { homeTeam, awayTeam, scores, stake } = req.body;

    if (!homeTeam || !awayTeam || !scores || !Array.isArray(scores)) {
      return res
        .status(400)
        .json({ error: "please provide homeTeam, awayTeam, and scores array" });
    }

    // One stake per score line; a per-line `stake` on a score overrides the
    // shared one.
    const sharedStake = parseStake(stake);
    if (sharedStake === null) {
      return res.status(400).json({ error: "stake must be a positive number" });
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

    // One line per score. `odds` is the bookmaker price when the form sent
    // one, else the model's min odd (older clients), which is flagged in
    // the ledger; `minOdd` keeps the model's break-even price either way.
    const takenOdds = scores.map((score: any) => {
      const n = Number(score.odds);
      return Number.isFinite(n) && n > 1 ? Math.round(n * 100) / 100 : null;
    });
    const formattedScores = scores.map((score: any, i: number) => ({
      score: score.score,
      probability: score.probability,
      odds: takenOdds[i] ?? score.minOdd,
      minOdd: score.minOdd,
      stake: parseStake(score.stake) ?? sharedStake,
    }));

    // Lines saved earlier today for the same game stay in the file; new
    // lines are appended so ledger ids (file stem + index) stay unique.
    const filePath = path.join(betsDir, filename);
    let existing: any[] = [];
    if (fs.existsSync(filePath)) {
      try {
        const parsed = JSON.parse(fs.readFileSync(filePath, "utf-8"));
        if (Array.isArray(parsed)) existing = parsed;
      } catch (e) {
        console.error("Failed to read score bet file, starting new:", e);
      }
    }
    fs.writeFileSync(
      filePath,
      JSON.stringify([...existing, ...formattedScores], null, 2)
    );

    const meta = betMeta(req.body, homeTeam, awayTeam);
    const placedAt = now.toISOString();
    const key = `${homeTeam}__${awayTeam}_${dateStr}`;
    ensureLedger();
    appendLedger(
      formattedScores.map((line: any, i: number) =>
        newRow({
          fileStem: key,
          index: existing.length + i,
          key,
          home: homeTeam,
          away: awayTeam,
          placedAt,
          league: meta.league,
          market: "correctScore",
          pick: String(line.score),
          stake: line.stake,
          oddsTaken: Number(line.odds),
          probability: Number(line.probability),
          bookmaker: meta.bookmaker,
          marketOdds: meta.marketOdds,
          model: meta.model,
          bankrollBefore: meta.bankrollBefore,
          kellyDivider: meta.kellyDivider,
          flags: takenOdds[i] === null ? ["oddsIsMinOdd"] : [],
        })
      )
    );

    res.json({ success: true, filename });
  } catch (e) {
    console.error("failed to save bets", e);
    res.status(500).json({ error: "failed to save bets" });
  }
});

router.post("/bets/save-winner", async (req, res) => {
  try {
    const { homeTeam, awayTeam, team, probability, odds, market, stake } =
      req.body;

    if (!homeTeam || !awayTeam || !team || probability === undefined || !odds) {
      return res.status(400).json({
        error: "please provide homeTeam, awayTeam, team, probability, and odds",
      });
    }

    const stakeValue = parseStake(stake);
    if (stakeValue === null) {
      return res.status(400).json({ error: "stake must be a positive number" });
    }

    // Format date as DD.MM.YYYY
    const now = new Date();
    const day = String(now.getDate()).padStart(2, "0");
    const month = String(now.getMonth() + 1).padStart(2, "0");
    const year = now.getFullYear();
    const dateStr = `${day}.${month}.${year}`;

    // Generate filename: HOME_ABBR__AWAY_ABBR_DD.MM.YYYY_winner.json
    const filename = `${homeTeam}__${awayTeam}_${dateStr}_winner.json`;

    // Create data/bets directory if it doesn't exist
    const betsDir = path.join(process.cwd(), "data", "bets");
    if (!fs.existsSync(betsDir)) {
      fs.mkdirSync(betsDir, { recursive: true });
    }

    // Read existing winner bets or initialize empty array
    const filePath = path.join(betsDir, filename);
    let winnerBets: any[] = [];
    if (fs.existsSync(filePath)) {
      try {
        const fileContent = fs.readFileSync(filePath, "utf-8");
        winnerBets = JSON.parse(fileContent);
        if (!Array.isArray(winnerBets)) {
          winnerBets = [];
        }
      } catch (e) {
        console.error(
          "Failed to read winner bet file, initializing new array:",
          e
        );
        winnerBets = [];
      }
    }

    // Add new winner bet
    // `market` says how the bet settles: "regulation" (hockey 60-minute
    // result, tie = DRAW), "fullTime" (soccer) or "moneyline" (hockey incl.
    // OT/SO). Older bets have no market and were all moneyline/fullTime.
    const newBet = {
      team,
      probability,
      odds,
      homeTeam,
      awayTeam,
      ...(typeof market === "string" && market ? { market } : {}),
      stake: stakeValue,
      timestamp: new Date().toISOString(),
    };

    const index = winnerBets.length;
    winnerBets.push(newBet);

    // Write JSON file
    fs.writeFileSync(filePath, JSON.stringify(winnerBets, null, 2));

    const meta = betMeta(req.body, homeTeam, awayTeam);
    const key = `${homeTeam}__${awayTeam}_${dateStr}`;
    const ledgerMarket: LedgerMarket =
      market === "regulation" || market === "moneyline"
        ? market
        : "fullTime";
    ensureLedger();
    appendLedger([
      newRow({
        fileStem: `${key}_winner`,
        index,
        key,
        home: homeTeam,
        away: awayTeam,
        placedAt: newBet.timestamp,
        league: meta.league,
        market: ledgerMarket,
        pick: String(team),
        stake: stakeValue,
        oddsTaken: Number(odds),
        probability: Number(probability),
        bookmaker: meta.bookmaker,
        marketOdds: meta.marketOdds,
        model: meta.model,
        bankrollBefore: meta.bankrollBefore,
        kellyDivider: meta.kellyDivider,
        // Without bookmaker prices the client sent the model's min odd.
        flags: meta.marketOdds ? [] : ["oddsIsMinOdd"],
      }),
    ]);

    res.json({ success: true, filename, bet: newBet });
  } catch (e) {
    console.error("failed to save winner bet", e);
    res.status(500).json({ error: "failed to save winner bet" });
  }
});

router.get("/bets/list", async (req, res) => {
  try {
    const betsDir = path.join(process.cwd(), "data", "bets");

    if (!fs.existsSync(betsDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(betsDir);
    const jsonFiles = files.filter(
      (file) => file.endsWith(".json") && !file.endsWith("_winner.json")
    );

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

router.get("/bets/total", async (req, res) => {
  try {
    // Stakes in euros from the ledger, split by whether the line is settled.
    let settledStake = 0;
    let settledCount = 0;
    let pendingStake = 0;
    let pendingCount = 0;
    for (const row of ensureLedger()) {
      if (row.settledAt) {
        settledStake += row.stake;
        settledCount += 1;
      } else {
        pendingStake += row.stake;
        pendingCount += 1;
      }
    }

    res.json({
      total: round2(settledStake),
      count: settledCount,
      pending: round2(pendingStake),
      pendingCount,
    });
  } catch (e) {
    console.error("failed to calculate total bets", e);
    res.status(500).json({ error: "failed to calculate total bets" });
  }
});

router.get("/bets/list-winners", async (req, res) => {
  try {
    const betsDir = path.join(process.cwd(), "data", "bets");

    if (!fs.existsSync(betsDir)) {
      return res.json([]);
    }

    const files = fs.readdirSync(betsDir);
    const winnerFiles = files.filter((file) => file.endsWith("_winner.json"));

    const betsList = winnerFiles
      .map((filename) => {
        // Parse filename: HOME__AWAY_DD.MM.YYYY_winner.json
        const nameWithoutExt = filename.replace("_winner.json", "");
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
          console.error(`Failed to read winner bet file ${filename}:`, e);
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
    console.error("failed to list winner bets", e);
    res.status(500).json({ error: "failed to list winner bets" });
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

// Settled ledger lines in the shape the Results page has always used, plus
// the ledger id, stake and result so the page can grow into the dashboard.
router.get("/results", async (req, res) => {
  try {
    const rows = ensureLedger()
      .filter((r) => r.settledAt)
      .map((r) => ({
        id: r.id,
        game: r.game.key,
        ...(r.market === "correctScore" ? { score: r.pick } : { team: r.pick }),
        market: r.market,
        league: r.league,
        probability: r.probability,
        odds: r.oddsTaken,
        stake: r.stake,
        result: r.result,
        return: r.return ?? 0,
        settledAt: r.settledAt,
      }));
    res.json(rows);
  } catch (e) {
    console.error("failed to fetch results", e);
    res.status(500).json({ error: "failed to fetch results" });
  }
});

// Legacy settlement call from the Played Bets pages: game key + pick +
// return. Settles the matching unsettled ledger line (win when the return
// is positive, otherwise loss).
router.post("/results/add", async (req, res) => {
  try {
    const { game, score, team, odds, return: returnValue } = req.body;
    if (!game || (!score && !team) || returnValue === undefined) {
      return res.status(400).json({
        error: "please provide game, score or team, and return",
      });
    }
    const payout = Number(returnValue);
    if (!Number.isFinite(payout) || payout < 0) {
      return res.status(400).json({ error: "return must be a number >= 0" });
    }
    const pick = String(score ?? team);
    const candidates = ensureLedger().filter(
      (r) => r.game.key === game && r.pick === pick && !r.settledAt
    );
    if (candidates.length === 0) {
      return res
        .status(404)
        .json({ error: `no unsettled bet line for ${game} / ${pick}` });
    }
    const oddsNum = Number(odds);
    const target =
      candidates.find((r) => r.oddsTaken === oddsNum) ?? candidates[0];
    const [updated] = settleRows([target.id], {
      result: payout > 0 ? "win" : "loss",
      return: payout,
    });
    res.json({ success: true, result: updated });
  } catch (e) {
    console.error("failed to save result", e);
    res.status(500).json({ error: "failed to save result" });
  }
});

// ---------------------------------------------------------------------------
// Ledger: every bet line with its settlement state. See docs/METRICS_AND_DASHBOARD.md.
// ---------------------------------------------------------------------------

router.get("/ledger", async (req, res) => {
  try {
    let rows: LedgerRow[] = ensureLedger();
    const game = req.query.game;
    if (typeof game === "string" && game) {
      rows = rows.filter((r) => r.game.key === game);
    }
    if (req.query.pending === "true") rows = rows.filter((r) => !r.settledAt);
    res.json(rows);
  } catch (e) {
    console.error("failed to read ledger", e);
    res.status(500).json({ error: "failed to read ledger" });
  }
});

// Settle one or more lines: { id | ids, result: win|loss|void, return?,
// finalScore?, decidedInOTorSO? }. A win needs a return; loss pays 0 and
// void pays the stake back.
router.post("/ledger/settle", async (req, res) => {
  try {
    const { id, ids, result, finalScore, decidedInOTorSO } = req.body;
    const targets: string[] = Array.isArray(ids)
      ? ids.filter((x) => typeof x === "string")
      : typeof id === "string"
      ? [id]
      : [];
    if (targets.length === 0) {
      return res.status(400).json({ error: "please provide id or ids" });
    }
    if (result !== "win" && result !== "loss" && result !== "void") {
      return res
        .status(400)
        .json({ error: "result must be win, loss or void" });
    }
    let payout: number | null = null;
    if (result === "win") {
      payout = Number(req.body.return);
      if (!Number.isFinite(payout) || payout <= 0) {
        return res
          .status(400)
          .json({ error: "a win needs a return greater than 0" });
      }
      if (targets.length > 1) {
        return res
          .status(400)
          .json({ error: "settle wins one line at a time" });
      }
    }
    const updated = settleRows(targets, {
      result,
      return: payout,
      finalScore: typeof finalScore === "string" ? finalScore : null,
      decidedInOTorSO:
        typeof decidedInOTorSO === "boolean" ? decidedInOTorSO : null,
    });
    if (updated.length === 0) {
      return res.status(404).json({ error: "no ledger line with that id" });
    }
    res.json({ success: true, rows: updated });
  } catch (e) {
    console.error("failed to settle", e);
    res.status(500).json({ error: "failed to settle" });
  }
});

// ---------------------------------------------------------------------------
// Metrics: headline figures and the cumulative profit series, computed from
// the ledger on every request. See docs/METRICS_AND_DASHBOARD.md section B.
// ---------------------------------------------------------------------------

router.get("/metrics/summary", async (req, res) => {
  try {
    res.json(summarize(ensureLedger()));
  } catch (e) {
    console.error("failed to compute summary", e);
    res.status(500).json({ error: "failed to compute summary" });
  }
});

/** Summary figures sliced by ?by=leagueMarket|league|market|pick|oddsBand|edgeBand|eloGap. */
router.get("/metrics/segments", async (req, res) => {
  const by = req.query.by === undefined ? "leagueMarket" : req.query.by;
  if (!isSegmentBy(by)) return res.status(400).json({ error: "unknown slice" });
  try {
    res.json(segments(ensureLedger(), by));
  } catch (e) {
    console.error("failed to compute segments", e);
    res.status(500).json({ error: "failed to compute segments" });
  }
});

/**
 * Model quality on the league's full game history (section A of the plan):
 * Brier and log loss against the league-average baseline, calibration
 * buckets, draw and home-advantage checks, per season and rolling. Cached
 * with the league's Elo state, so it is recomputed on the same 6h refresh.
 */
router.get("/metrics/model", async (req, res) => {
  const league = leagueFrom(req);
  if (!league) return res.status(400).json({ error: "unknown league" });
  try {
    const state = await ensureLeague(league);
    res.json(backtestFor(league, state));
  } catch (e) {
    console.error(`failed to backtest ${league}`, e);
    res.status(500).json({ error: "failed to backtest" });
  }
});

export default router;
