import React, { useEffect, useState } from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";
import {
  BookmakerField,
  OddsInput,
  parseOdds,
  useBookmaker,
} from "./BookOdds";
import { useBankroll } from "./bankroll";

export interface Moneyline {
  homeWinProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minAwayOdd?: number;
}

export interface Prediction {
  league?: string;
  homeTeam: string;
  awayTeam: string;
  /** "regulation": hockey 60-minute result; "fullTime": soccer. */
  market?: "regulation" | "fullTime";
  drawFactor?: number;
  homeElo?: number;
  awayElo?: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minDrawOdd?: number;
  minAwayOdd?: number;
  /** Hockey only: two-way market including OT/SO. */
  moneyline?: Moneyline;
}

type Outcome = "home" | "draw" | "away";
type MoneylineSide = "home" | "away";

interface PredictionResultProps {
  prediction: Prediction;
}

const PredictionResult: React.FC<PredictionResultProps> = ({ prediction }) => {
  const [saving, setSaving] = useState<Record<Outcome, boolean>>({
    home: false,
    draw: false,
    away: false,
  });
  const [savingMoneyline, setSavingMoneyline] = useState<
    Record<MoneylineSide, boolean>
  >({ home: false, away: false });
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);
  // Stake in euros applied to the next bet saved from this card.
  const [stake, setStake] = useState<string>("1");
  // Bookmaker prices typed for each outcome; the bet is saved at these odds.
  type BookKey = "home" | "draw" | "away" | "mlHome" | "mlAway";
  const emptyBook: Record<BookKey, string> = {
    home: "",
    draw: "",
    away: "",
    mlHome: "",
    mlAway: "",
  };
  const [book, setBook] = useState<Record<BookKey, string>>(emptyBook);
  const setBookOdds = (key: BookKey, value: string) =>
    setBook((prev) => ({ ...prev, [key]: value }));
  const [bookmaker, setBookmaker] = useBookmaker();
  // Bankroll and Kelly divider for the stake hint and the ledger snapshot.
  const { bankroll, kelly } = useBankroll();
  const useStake = (v: number) => setStake(v.toFixed(2));
  useEffect(() => {
    setBook(emptyBook);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prediction.homeTeam, prediction.awayTeam]);

  // Soccer draws at full time; hockey draws on the 60-minute score (the
  // game goes to OT/SO). Knockout markets can return 0 -> no draw card.
  const hasDraw = prediction.drawProbability > 0;
  const isRegulation = prediction.market === "regulation";
  const drawLabel = isRegulation ? "Draw (60 min)" : "Draw";
  const homeName = TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam;
  const awayName = TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam;
  const moneyline = prediction.moneyline;

  const homePercent = (prediction.homeWinProbability * 100).toFixed(1);
  const drawPercent = (prediction.drawProbability * 100).toFixed(1);
  const awayPercent = (prediction.awayWinProbability * 100).toFixed(1);

  const saveBet = async (
    teamAbbr: string,
    probability: number,
    odds: number | null,
    marketOdds: Record<string, number>,
    market: string,
    label: string,
    setBusy: (busy: boolean) => void
  ) => {
    if (!odds) {
      setMessage({
        type: "error",
        text: `Enter the bookmaker's odds for ${label} before saving`,
      });
      return;
    }

    const stakeValue = Number(stake);
    if (!Number.isFinite(stakeValue) || stakeValue <= 0) {
      setMessage({ type: "error", text: "Enter a stake greater than 0€" });
      return;
    }

    setBusy(true);
    setMessage(null);

    try {
      const response = await fetch("/api/bets/save-winner", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          homeTeam: prediction.homeTeam,
          awayTeam: prediction.awayTeam,
          team: teamAbbr,
          probability,
          odds,
          market,
          stake: stakeValue,
          league: prediction.league,
          bookmaker: bookmaker || undefined,
          bankrollBefore: bankroll?.current ?? undefined,
          kellyDivider: bankroll?.kellyDivider,
          marketOdds,
          // Snapshot of the model at bet time for the ledger.
          model: {
            probs:
              market === "moneyline" && moneyline
                ? {
                    home: moneyline.homeWinProbability,
                    draw: 0,
                    away: moneyline.awayWinProbability,
                  }
                : {
                    home: prediction.homeWinProbability,
                    draw: prediction.drawProbability,
                    away: prediction.awayWinProbability,
                  },
            homeElo: prediction.homeElo ?? null,
            awayElo: prediction.awayElo ?? null,
            drawFactor:
              market === "moneyline" ? 0 : prediction.drawFactor ?? null,
            homeAdv: 60,
          },
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save bet");
      }

      await response.json();
      setMessage({
        type: "success",
        text: `Bet saved for ${label} (${stakeValue.toFixed(2)}€)!`,
      });
    } catch (err) {
      console.error("Failed to save bet:", err);
      setMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "An error occurred while saving bet",
      });
    } finally {
      setBusy(false);
    }
  };

  // Every outcome of the market that has a valid price typed.
  const filledOdds = (
    inputs: Record<string, string>
  ): Record<string, number> => {
    const out: Record<string, number> = {};
    for (const [k, v] of Object.entries(inputs)) {
      const n = parseOdds(v);
      if (n !== null) out[k] = n;
    }
    return out;
  };

  const handleBet = (team: Outcome) => {
    const teamAbbr =
      team === "home"
        ? prediction.homeTeam
        : team === "away"
        ? prediction.awayTeam
        : "DRAW";
    const probability =
      team === "home"
        ? prediction.homeWinProbability
        : team === "away"
        ? prediction.awayWinProbability
        : prediction.drawProbability;
    const label =
      team === "draw" ? drawLabel : team === "home" ? homeName : awayName;

    return saveBet(
      teamAbbr,
      probability,
      parseOdds(book[team]),
      filledOdds({ home: book.home, draw: book.draw, away: book.away }),
      prediction.market ?? "fullTime",
      label,
      (busy) => setSaving((prev) => ({ ...prev, [team]: busy }))
    );
  };

  const handleMoneylineBet = (side: MoneylineSide) => {
    if (!moneyline) return;
    const teamAbbr = side === "home" ? prediction.homeTeam : prediction.awayTeam;
    return saveBet(
      teamAbbr,
      side === "home"
        ? moneyline.homeWinProbability
        : moneyline.awayWinProbability,
      parseOdds(side === "home" ? book.mlHome : book.mlAway),
      filledOdds({ home: book.mlHome, away: book.mlAway }),
      "moneyline",
      `${side === "home" ? homeName : awayName} (incl. OT/SO)`,
      (busy) => setSavingMoneyline((prev) => ({ ...prev, [side]: busy }))
    );
  };

  return (
    <div className="prediction-result">
      <h3>Prediction Results</h3>
      <div className="game-matchup">
        <span className="home-team">
          {TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam}
        </span>
        <span className="vs">vs</span>
        <span className="away-team">
          {TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam}
        </span>
      </div>

      {message && (
        <div
          className={`bet-message ${message.type}`}
          style={{
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: "6px",
            backgroundColor:
              message.type === "success" ? "rgba(34, 197, 94, 0.1)" : "rgba(248, 81, 73, 0.1)",
            color: message.type === "success" ? "#22c55e" : "#f85149",
            border: `1px solid ${
              message.type === "success" ? "#22c55e" : "#f85149"
            }`,
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
          }}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{
              background: "none",
              border: "none",
              color: "inherit",
              cursor: "pointer",
              fontSize: "1.2rem",
              lineHeight: "1",
              padding: "0",
              marginLeft: "0.5rem",
            }}
          >
            ×
          </button>
        </div>
      )}

      <label className="stake-field">
        <span>Stake (€)</span>
        <input
          type="number"
          min="0.01"
          step="0.5"
          inputMode="decimal"
          value={stake}
          onChange={(e) => setStake(e.target.value)}
          className="stake-input"
        />
      </label>{" "}
      <BookmakerField value={bookmaker} onChange={setBookmaker} />

      <div className="probabilities">
        <div className="probability-card home-win">
          <div className="probability-content">
            <div className="team-name">
              {TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam}
            </div>
            <div className="percentage">{homePercent}%</div>
            {prediction.minHomeOdd && (
              <div className="odds">
                Min Odds: {prediction.minHomeOdd.toFixed(2)}
              </div>
            )}
            <OddsInput
              kelly={kelly}
              onUseStake={useStake}
              value={book.home}
              onChange={(v) => setBookOdds("home", v)}
              probability={prediction.homeWinProbability}
            />
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${homePercent}%` }}
              ></div>
            </div>
          </div>
          <button
            className="bet-button"
            onClick={() => handleBet("home")}
            disabled={saving.home || !parseOdds(book.home)}
          >
            {saving.home ? "Saving..." : "Bet on " + (TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam)}
          </button>
        </div>

        {hasDraw && (
          <div className="probability-card draw">
            <div className="probability-content">
              <div className="team-name">{drawLabel}</div>
              <div className="percentage">{drawPercent}%</div>
              {prediction.minDrawOdd && (
                <div className="odds">
                  Min Odds: {prediction.minDrawOdd.toFixed(2)}
                </div>
              )}
              <OddsInput
                kelly={kelly}
                onUseStake={useStake}
                value={book.draw}
                onChange={(v) => setBookOdds("draw", v)}
                probability={prediction.drawProbability}
              />
              <div className="bar">
                <div
                  className="bar-fill"
                  style={{ width: `${drawPercent}%` }}
                ></div>
              </div>
            </div>
            <button
              className="bet-button"
              onClick={() => handleBet("draw")}
              disabled={saving.draw || !parseOdds(book.draw)}
            >
              {saving.draw ? "Saving..." : `Bet on ${drawLabel}`}
            </button>
          </div>
        )}

        <div className="probability-card away-win">
          <div className="probability-content">
            <div className="team-name">
              {TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam}
            </div>
            <div className="percentage">{awayPercent}%</div>
            {prediction.minAwayOdd && (
              <div className="odds">
                Min Odds: {prediction.minAwayOdd.toFixed(2)}
              </div>
            )}
            <OddsInput
              kelly={kelly}
              onUseStake={useStake}
              value={book.away}
              onChange={(v) => setBookOdds("away", v)}
              probability={prediction.awayWinProbability}
            />
            <div className="bar">
              <div
                className="bar-fill"
                style={{ width: `${awayPercent}%` }}
              ></div>
            </div>
          </div>
          <button
            className="bet-button"
            onClick={() => handleBet("away")}
            disabled={saving.away || !parseOdds(book.away)}
          >
            {saving.away ? "Saving..." : "Bet on " + (TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam)}
          </button>
        </div>
      </div>

      {isRegulation && (
        <p className="market-note">
          1X2 is settled on the 60-minute score: a game that goes to overtime
          or a shootout counts as a draw.
        </p>
      )}

      {moneyline && (
        <div className="moneyline">
          <h4>Winner incl. OT/SO</h4>
          <div className="moneyline-rows">
            <div className="moneyline-row">
              <span className="team-name">{homeName}</span>
              <span className="percentage">
                {(moneyline.homeWinProbability * 100).toFixed(1)}%
              </span>
              <span className="odds">
                {moneyline.minHomeOdd
                  ? `Min Odds: ${moneyline.minHomeOdd.toFixed(2)}`
                  : ""}
              </span>
              <OddsInput
                kelly={kelly}
                onUseStake={useStake}
                value={book.mlHome}
                onChange={(v) => setBookOdds("mlHome", v)}
                probability={moneyline.homeWinProbability}
              />
              <button
                className="bet-button"
                onClick={() => handleMoneylineBet("home")}
                disabled={savingMoneyline.home || !parseOdds(book.mlHome)}
              >
                {savingMoneyline.home ? "Saving..." : "Bet"}
              </button>
            </div>
            <div className="moneyline-row">
              <span className="team-name">{awayName}</span>
              <span className="percentage">
                {(moneyline.awayWinProbability * 100).toFixed(1)}%
              </span>
              <span className="odds">
                {moneyline.minAwayOdd
                  ? `Min Odds: ${moneyline.minAwayOdd.toFixed(2)}`
                  : ""}
              </span>
              <OddsInput
                kelly={kelly}
                onUseStake={useStake}
                value={book.mlAway}
                onChange={(v) => setBookOdds("mlAway", v)}
                probability={moneyline.awayWinProbability}
              />
              <button
                className="bet-button"
                onClick={() => handleMoneylineBet("away")}
                disabled={savingMoneyline.away || !parseOdds(book.mlAway)}
              >
                {savingMoneyline.away ? "Saving..." : "Bet"}
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="prediction-summary">
        <p>
          <strong>Most Likely Outcome:</strong>{" "}
          {prediction.drawProbability > prediction.homeWinProbability &&
          prediction.drawProbability > prediction.awayWinProbability
            ? drawLabel
            : prediction.homeWinProbability > prediction.awayWinProbability
            ? `${
                TEAM_FULL_NAMES[prediction.homeTeam] || prediction.homeTeam
              } wins at home`
            : `${
                TEAM_FULL_NAMES[prediction.awayTeam] || prediction.awayTeam
              } wins on the road`}
        </p>
      </div>
    </div>
  );
};

export default PredictionResult;
