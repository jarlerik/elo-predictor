import React, { useEffect, useState } from "react";
import TeamSelector from "./TeamSelector";
import PredictionResult from "./PredictionResult";
import ScorePrediction from "./ScorePrediction";
import { LeagueId, LEAGUES } from "../utils/leagues";

interface Team {
  abbr: string;
  elo: number;
}

interface Prediction {
  homeTeam: string;
  awayTeam: string;
  homeWinProbability: number;
  drawProbability: number;
  awayWinProbability: number;
  minHomeOdd?: number;
  minDrawOdd?: number;
  minAwayOdd?: number;
}

interface GamePredictionProps {
  league: LeagueId;
}

const GamePrediction: React.FC<GamePredictionProps> = ({ league }) => {
  const info = LEAGUES[league];
  const [teams, setTeams] = useState<Team[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [prediction, setPrediction] = useState<Prediction | null>(null);
  const [scorePrediction, setScorePrediction] =
    useState<ScorePrediction | null>(null);
  const [selectedHome, setSelectedHome] = useState<string>("");
  const [selectedAway, setSelectedAway] = useState<string>("");

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setTeams([]);
    setPrediction(null);
    setScorePrediction(null);
    setSelectedHome("");
    setSelectedAway("");

    fetch(`/api/teams?league=${league}`)
      .then(async (r) => {
        if (!r.ok) {
          const body = await r.json().catch(() => ({}));
          throw new Error(body.error || `Failed to load ${info.name} teams`);
        }
        return r.json();
      })
      .then((data) => {
        if (!cancelled) setTeams(data);
      })
      .catch((err) => {
        if (!cancelled)
          setError(err instanceof Error ? err.message : "An error occurred");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [league]);

  const handlePredict = async () => {
    if (!selectedHome || !selectedAway) {
      setError("Please select both home and away teams");
      return;
    }
    if (selectedHome === selectedAway) {
      setError("Please select two different teams");
      return;
    }

    try {
      setError(null);

      const params = new URLSearchParams({
        league,
        home: selectedHome,
        away: selectedAway,
      });

      // Fetch both predictions in parallel
      const [predictionResponse, scoreResponse] = await Promise.all([
        fetch(`/api/predict?${params.toString()}`),
        fetch(`/api/predict/score?${params.toString()}`),
      ]);

      if (!predictionResponse.ok) {
        const body = await predictionResponse.json().catch(() => ({}));
        throw new Error(body.error || "Failed to get prediction");
      }
      if (!scoreResponse.ok) {
        const body = await scoreResponse.json().catch(() => ({}));
        throw new Error(body.error || "Failed to get score prediction");
      }

      const predictionData = await predictionResponse.json();
      const scoreData = await scoreResponse.json();

      setPrediction(predictionData);
      setScorePrediction(scoreData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "An error occurred");
    }
  };

  return (
    <div className="page-content">
      <div className="page-header">
        <h1>
          {info.icon} {info.name} Prediction
        </h1>
        <p>
          {info.sport === "soccer"
            ? "1X2 (home / draw / away) and correct-score odds from Elo"
            : "Calculate probabilities for betting"}
        </p>
      </div>

      {error && (
        <div className="error">
          {error}
          <button onClick={() => setError(null)}>×</button>
        </div>
      )}

      {loading ? (
        <div className="loading">Loading {info.name} teams...</div>
      ) : (
        <div className="prediction-section">
          <TeamSelector
            teams={teams}
            selectedHome={selectedHome}
            selectedAway={selectedAway}
            onHomeChange={setSelectedHome}
            onAwayChange={setSelectedAway}
            onPredict={handlePredict}
          />

          {prediction && <PredictionResult prediction={prediction} />}
          {scorePrediction && (
            <ScorePrediction scorePrediction={scorePrediction} />
          )}
        </div>
      )}
    </div>
  );
};

export default GamePrediction;
