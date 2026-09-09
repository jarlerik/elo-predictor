import React, { useState } from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

export interface Moneyline {
  homeWinProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minAwayOdd?: number;
}

export interface Prediction {
  homeTeam: string;
  awayTeam: string;
  /** "regulation": hockey 60-minute result; "fullTime": soccer. */
  market?: "regulation" | "fullTime";
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
    odds: number | undefined,
    market: string,
    label: string,
    setBusy: (busy: boolean) => void
  ) => {
    if (!odds) {
      setMessage({
        type: "error",
        text: "Odds not available for this bet",
      });
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
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save bet");
      }

      await response.json();
      setMessage({
        type: "success",
        text: `Bet saved for ${label}!`,
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
    const odds =
      team === "home"
        ? prediction.minHomeOdd
        : team === "away"
        ? prediction.minAwayOdd
        : prediction.minDrawOdd;
    const label =
      team === "draw" ? drawLabel : team === "home" ? homeName : awayName;

    return saveBet(
      teamAbbr,
      probability,
      odds,
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
      side === "home" ? moneyline.minHomeOdd : moneyline.minAwayOdd,
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
            disabled={saving.home || !prediction.minHomeOdd}
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
              disabled={saving.draw || !prediction.minDrawOdd}
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
            disabled={saving.away || !prediction.minAwayOdd}
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
              <button
                className="bet-button"
                onClick={() => handleMoneylineBet("home")}
                disabled={savingMoneyline.home || !moneyline.minHomeOdd}
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
              <button
                className="bet-button"
                onClick={() => handleMoneylineBet("away")}
                disabled={savingMoneyline.away || !moneyline.minAwayOdd}
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
