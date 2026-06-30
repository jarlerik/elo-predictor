import React, { useEffect, useState } from "react";
import ScorePrediction from "./ScorePrediction";
import { COUNTRY_NAMES } from "../utils/soccerTeams";

interface Team {
  abbr: string;
  elo: number;
}

interface ScorePredictionData {
  homeTeam: string;
  awayTeam: string;
  lambdaHome: number;
  lambdaAway: number;
  top10: any[];
  allTop100?: any[];
}

interface SoccerPrediction {
  homeTeam: string;
  awayTeam: string;
  homeElo: number;
  awayElo: number;
  homeAdv: number;
  drawFactor: number;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  minHomeOdd: number;
  minDrawOdd: number;
  minAwayOdd: number;
}

type Outcome = "home" | "draw" | "away";

const SoccerPrediction: React.FC = () => {
  const [teams, setTeams] = useState<Team[]>([]);
  const [selectedHome, setSelectedHome] = useState<string>("");
  const [selectedAway, setSelectedAway] = useState<string>("");
  const [knockout, setKnockout] = useState<boolean>(false);
  const [hostNation, setHostNation] = useState<boolean>(false);
  const [prediction, setPrediction] = useState<SoccerPrediction | null>(null);
  const [scorePrediction, setScorePrediction] =
    useState<ScorePredictionData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState<Outcome | null>(null);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    fetch("/api/soccer/teams")
      .then((r) => r.json())
      .then(setTeams)
      .catch(() => setError("Failed to load soccer teams"));
  }, []);

  const name = (abbr: string) => COUNTRY_NAMES[abbr] || abbr;
  const sorted = [...teams].sort((a, b) =>
    name(a.abbr).localeCompare(name(b.abbr))
  );

  const handlePredict = async () => {
    if (!selectedHome || !selectedAway) {
      setError("Please select both teams");
      return;
    }
    if (selectedHome === selectedAway) {
      setError("Please select two different teams");
      return;
    }
    setError(null);
    setMessage(null);
    try {
      const params = new URLSearchParams({
        home: selectedHome,
        away: selectedAway,
      });
      // Knockout games can't draw; neutral venue unless host nation is set.
      if (knockout) params.set("drawFactor", "0");
      if (hostNation) params.set("neutral", "false");

      // Score odds use the same venue (neutral/host) but draws are inherent to
      // the Poisson model, so the knockout flag doesn't apply there.
      const scoreParams = new URLSearchParams({
        home: selectedHome,
        away: selectedAway,
      });
      if (hostNation) scoreParams.set("neutral", "false");

      const [res, scoreRes] = await Promise.all([
        fetch(`/api/predict/soccer?${params.toString()}`),
        fetch(`/api/predict/soccer/score?${scoreParams.toString()}`),
      ]);
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to get prediction");
      }
      if (!scoreRes.ok) {
        const body = await scoreRes.json().catch(() => ({}));
        throw new Error(body.error || "Failed to get score prediction");
      }
      setPrediction(await res.json());
      setScorePrediction(await scoreRes.json());
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  const handleBet = async (outcome: Outcome) => {
    if (!prediction) return;
    const team =
      outcome === "home"
        ? prediction.homeTeam
        : outcome === "away"
        ? prediction.awayTeam
        : "DRAW";
    const probability =
      outcome === "home"
        ? prediction.homeWinProbability
        : outcome === "away"
        ? prediction.awayWinProbability
        : prediction.drawProbability;
    const odds =
      outcome === "home"
        ? prediction.minHomeOdd
        : outcome === "away"
        ? prediction.minAwayOdd
        : prediction.minDrawOdd;

    if (!odds) {
      setMessage({ type: "error", text: "Odds not available for this bet" });
      return;
    }

    setSaving(outcome);
    setMessage(null);
    try {
      const res = await fetch("/api/bets/save-winner", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          homeTeam: prediction.homeTeam,
          awayTeam: prediction.awayTeam,
          team,
          probability,
          odds,
        }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error || "Failed to save bet");
      }
      setMessage({ type: "success", text: `Bet saved for ${team}!` });
    } catch (err) {
      setMessage({
        type: "error",
        text: err instanceof Error ? err.message : "Failed to save bet",
      });
    } finally {
      setSaving(null);
    }
  };

  const pct = (p: number) => (p * 100).toFixed(1);

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>World Cup Prediction</h1>
        <p>1X2 (home / draw / away) odds for international matches</p>
      </div>

      {error && (
        <div className="error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      <div className="prediction-section">
        <div className="team-selector">
          <div className="team-selection">
            <div className="team-field">
              <label htmlFor="soccer-home">Team A:</label>
              <select
                id="soccer-home"
                value={selectedHome}
                onChange={(e) => setSelectedHome(e.target.value)}
                className="team-select"
              >
                <option value="">Select team</option>
                {sorted.map((t) => (
                  <option key={t.abbr} value={t.abbr}>
                    {name(t.abbr)} ({t.abbr}) — {t.elo}
                  </option>
                ))}
              </select>
            </div>

            <div className="vs-divider">
              <span>vs</span>
            </div>

            <div className="team-field">
              <label htmlFor="soccer-away">Team B:</label>
              <select
                id="soccer-away"
                value={selectedAway}
                onChange={(e) => setSelectedAway(e.target.value)}
                className="team-select"
              >
                <option value="">Select team</option>
                {sorted.map((t) => (
                  <option key={t.abbr} value={t.abbr}>
                    {name(t.abbr)} ({t.abbr}) — {t.elo}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div
            className="soccer-options"
            style={{
              display: "flex",
              gap: "1.5rem",
              margin: "0.75rem 0",
              flexWrap: "wrap",
            }}
          >
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={knockout}
                onChange={(e) => setKnockout(e.target.checked)}
              />
              Knockout (no draw)
            </label>
            <label style={{ display: "flex", gap: "0.4rem", alignItems: "center" }}>
              <input
                type="checkbox"
                checked={hostNation}
                onChange={(e) => setHostNation(e.target.checked)}
              />
              Team A is host nation (home advantage)
            </label>
          </div>

          <button
            onClick={handlePredict}
            disabled={!selectedHome || !selectedAway}
            className="predict-button"
          >
            Predict Outcome
          </button>
        </div>

        {prediction && (
          <div className="prediction-result">
            <h3>Prediction Results</h3>
            <div className="game-matchup">
              <span className="home-team">{name(prediction.homeTeam)}</span>
              <span className="vs">vs</span>
              <span className="away-team">{name(prediction.awayTeam)}</span>
            </div>

            {message && (
              <div
                className={`bet-message ${message.type}`}
                style={{
                  padding: "0.75rem",
                  marginBottom: "1rem",
                  borderRadius: "6px",
                  backgroundColor:
                    message.type === "success"
                      ? "rgba(34, 197, 94, 0.1)"
                      : "rgba(248, 81, 73, 0.1)",
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
                  }}
                >
                  ×
                </button>
              </div>
            )}

            <div className="probabilities">
              <div className="probability-card home-win">
                <div className="probability-content">
                  <div className="team-name">{name(prediction.homeTeam)}</div>
                  <div className="percentage">
                    {pct(prediction.homeWinProbability)}%
                  </div>
                  {prediction.minHomeOdd > 0 && (
                    <div className="odds">
                      Min Odds: {prediction.minHomeOdd.toFixed(2)}
                    </div>
                  )}
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{ width: `${pct(prediction.homeWinProbability)}%` }}
                    ></div>
                  </div>
                </div>
                <button
                  className="bet-button"
                  onClick={() => handleBet("home")}
                  disabled={saving === "home" || !prediction.minHomeOdd}
                >
                  {saving === "home"
                    ? "Saving..."
                    : `Bet on ${name(prediction.homeTeam)}`}
                </button>
              </div>

              <div className="probability-card draw">
                <div className="probability-content">
                  <div className="team-name">Draw</div>
                  <div className="percentage">
                    {pct(prediction.drawProbability)}%
                  </div>
                  {prediction.minDrawOdd > 0 && (
                    <div className="odds">
                      Min Odds: {prediction.minDrawOdd.toFixed(2)}
                    </div>
                  )}
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{ width: `${pct(prediction.drawProbability)}%` }}
                    ></div>
                  </div>
                </div>
                <button
                  className="bet-button"
                  onClick={() => handleBet("draw")}
                  disabled={saving === "draw" || !prediction.minDrawOdd}
                >
                  {saving === "draw" ? "Saving..." : "Bet on Draw"}
                </button>
              </div>

              <div className="probability-card away-win">
                <div className="probability-content">
                  <div className="team-name">{name(prediction.awayTeam)}</div>
                  <div className="percentage">
                    {pct(prediction.awayWinProbability)}%
                  </div>
                  {prediction.minAwayOdd > 0 && (
                    <div className="odds">
                      Min Odds: {prediction.minAwayOdd.toFixed(2)}
                    </div>
                  )}
                  <div className="bar">
                    <div
                      className="bar-fill"
                      style={{ width: `${pct(prediction.awayWinProbability)}%` }}
                    ></div>
                  </div>
                </div>
                <button
                  className="bet-button"
                  onClick={() => handleBet("away")}
                  disabled={saving === "away" || !prediction.minAwayOdd}
                >
                  {saving === "away"
                    ? "Saving..."
                    : `Bet on ${name(prediction.awayTeam)}`}
                </button>
              </div>
            </div>

            <div className="prediction-summary">
              <p>
                <strong>Setup:</strong>{" "}
                {prediction.homeAdv > 0
                  ? `${name(prediction.homeTeam)} at home`
                  : "neutral venue"}
                , draw factor ν = {prediction.drawFactor}
              </p>
            </div>
          </div>
        )}

        {scorePrediction && (
          <ScorePrediction scorePrediction={scorePrediction} />
        )}
      </div>
    </div>
  );
};

export default SoccerPrediction;
