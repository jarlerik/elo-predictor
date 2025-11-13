import React, { useState } from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minAwayOdd?: number;
}

interface PredictionResultProps {
  prediction: Prediction;
}

const PredictionResult: React.FC<PredictionResultProps> = ({ prediction }) => {
  const [saving, setSaving] = useState<{ home: boolean; away: boolean }>({
    home: false,
    away: false,
  });
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const homePercent = (prediction.homeWinProbability * 100).toFixed(1);
  const awayPercent = (prediction.awayWinProbability * 100).toFixed(1);

  const handleBet = async (team: "home" | "away") => {
    const isHome = team === "home";
    const teamAbbr = isHome ? prediction.homeTeam : prediction.awayTeam;
    const probability = isHome
      ? prediction.homeWinProbability
      : prediction.awayWinProbability;
    const odds = isHome ? prediction.minHomeOdd : prediction.minAwayOdd;

    if (!odds) {
      setMessage({
        type: "error",
        text: "Odds not available for this bet",
      });
      return;
    }

    setSaving((prev) => ({ ...prev, [team]: true }));
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
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save bet");
      }

      const data = await response.json();
      const teamName =
        TEAM_FULL_NAMES[teamAbbr] || teamAbbr;
      setMessage({
        type: "success",
        text: `Bet saved for ${teamName}!`,
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
      setSaving((prev) => ({ ...prev, [team]: false }));
    }
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

      <div className="prediction-summary">
        <p>
          <strong>Most Likely Outcome:</strong>{" "}
          {prediction.homeWinProbability > prediction.awayWinProbability
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
