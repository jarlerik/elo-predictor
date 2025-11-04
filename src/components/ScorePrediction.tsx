import React, { useState, useEffect } from "react";
import { TEAM_FULL_NAMES } from "../utils/teamData";

interface ScoreProbability {
  home: number;
  away: number;
  score: string;
  probability: number;
  minOdd: number;
  expectedValue?: number | null;
}

interface ScorePrediction {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  top10: ScoreProbability[];
}

interface ScorePredictionProps {
  scorePrediction: ScorePrediction;
}

const ScorePrediction: React.FC<ScorePredictionProps> = ({
  scorePrediction,
}) => {
  const [checkedBets, setCheckedBets] = useState<boolean[]>(
    new Array(scorePrediction.top10.length).fill(true)
  );
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    setCheckedBets(new Array(scorePrediction.top10.length).fill(true));
  }, [scorePrediction.top10.length]);

  const handleCheckboxChange = (index: number) => {
    const newCheckedBets = [...checkedBets];
    newCheckedBets[index] = !newCheckedBets[index];
    setCheckedBets(newCheckedBets);
  };

  const handlePlayBets = async () => {
    // Filter checked scores
    const checkedScores = scorePrediction.top10.filter(
      (_, index) => checkedBets[index]
    );

    if (checkedScores.length === 0) {
      setMessage({
        type: "error",
        text: "Please select at least one bet to save",
      });
      return;
    }

    setLoading(true);
    setMessage(null);

    try {
      const response = await fetch("/api/bets/save", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          homeTeam: scorePrediction.homeTeam,
          awayTeam: scorePrediction.awayTeam,
          scores: checkedScores,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        throw new Error(errorData.error || "Failed to save bets");
      }

      const data = await response.json();
      setMessage({
        type: "success",
        text: `Bets saved successfully! (${data.filename})`,
      });
    } catch (err) {
      setMessage({
        type: "error",
        text:
          err instanceof Error
            ? err.message
            : "An error occurred while saving bets",
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="score-prediction">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: "1rem",
          marginBottom: "1rem",
        }}
      >
        <h3>Top 10 Score Value Bets</h3>
        <button
          className="predict-button"
          onClick={handlePlayBets}
          disabled={loading}
        >
          {loading
            ? "Saving..."
            : `Play top ${checkedBets.filter(Boolean).length} bets`}
        </button>
      </div>

      {message && (
        <div
          style={{
            padding: "0.75rem",
            marginBottom: "1rem",
            borderRadius: "4px",
            backgroundColor: message.type === "success" ? "#d4edda" : "#f8d7da",
            color: message.type === "success" ? "#155724" : "#721c24",
            border: `1px solid ${
              message.type === "success" ? "#c3e6cb" : "#f5c6cb"
            }`,
          }}
        >
          {message.text}
          <button
            onClick={() => setMessage(null)}
            style={{
              float: "right",
              background: "none",
              border: "none",
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

      <div className="expected-goals">
        <div className="goal-expectation">
          <span className="team-name">
            {TEAM_FULL_NAMES[scorePrediction.homeTeam] ||
              scorePrediction.homeTeam}
          </span>
          <span className="lambda">
            Expected Goals: {scorePrediction.lambdaHome}
          </span>
        </div>
        <div className="goal-expectation">
          <span className="team-name">
            {TEAM_FULL_NAMES[scorePrediction.awayTeam] ||
              scorePrediction.awayTeam}
          </span>
          <span className="lambda">
            Expected Goals: {scorePrediction.lambdaAway}
          </span>
        </div>
      </div>

      <div className="value-bets">
        {scorePrediction.top10.map((bet, index) => (
          <div
            key={index}
            className="value-bet-card"
            style={{ display: "flex", alignItems: "center", gap: "1rem" }}
          >
            <input
              type="checkbox"
              checked={checkedBets[index]}
              onChange={() => handleCheckboxChange(index)}
              style={{ cursor: "pointer" }}
            />
            <div className="bet-info" style={{ flex: 1 }}>
              <div className="bet-type">Score: {bet.score}</div>
              <div className="bet-details">
                {TEAM_FULL_NAMES[scorePrediction.homeTeam] ||
                  scorePrediction.homeTeam}{" "}
                {bet.home} - {bet.away}{" "}
                {TEAM_FULL_NAMES[scorePrediction.awayTeam] ||
                  scorePrediction.awayTeam}
              </div>
            </div>
            <div className="bet-stats">
              <div className="probability">
                {(bet.probability * 100).toFixed(2)}%
              </div>
              <div className="odds">Min Odds: {bet.minOdd.toFixed(2)}</div>
              {bet.expectedValue && (
                <div className="value">
                  Expected Value: {bet.expectedValue.toFixed(2)}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default ScorePrediction;
